# Portions derived from ComfyUI_MiniMaxH3_Director
# Copyright AIMixer and contributors
# Originally licensed under Apache License 2.0
# Modified for MiniMax H3 Motion Director, 2026-08-10
# This derivative project is distributed under GPL-3.0.

"""H3-native five-frame seam bridges for V2V and RV2V.

The original source is conditioning only.  Final output is assembled from the
two nominal generated segments plus the three regenerated middle bridge frames.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

import torch


SOURCE_BRIDGE_TASKS = frozenset({"v2v", "rv2v"})
SOURCE_BRIDGE_FRAME_COUNT = 5
SOURCE_BRIDGE_ERROR = (
    "Source Bridge v1 supports only 0 or 5 frames. Use 0 to disable or 5 "
    "for the H3-native bridge window."
)


@dataclass(frozen=True)
class SourceBridgeWindow:
    """Source-time mapping for one H3-native five-frame bridge."""

    boundary: int
    source_start: int
    source_end: int
    first_anchor_source_time: int
    last_anchor_source_time: int
    emitted_source_start: int
    emitted_source_end: int

    @property
    def frame_count(self) -> int:
        return self.source_end - self.source_start


@dataclass(frozen=True)
class GeneratedSourceBridge:
    left_segment_index: int
    right_segment_index: int
    window: SourceBridgeWindow
    frames: torch.Tensor


def validate_source_bridge_frames(value: int) -> int:
    value = int(value)
    if value not in {0, SOURCE_BRIDGE_FRAME_COUNT}:
        raise ValueError(SOURCE_BRIDGE_ERROR)
    return value


def source_bridge_enabled(task_key: str, frames: int) -> bool:
    return str(task_key).lower() in SOURCE_BRIDGE_TASKS and int(frames) == 5


def source_bridge_boundary_enabled(left_segment, right_segment, frames: int) -> bool:
    """Return whether this exact boundary opted into the Source Bridge strategy."""
    # Mixed v1 uses independent segment-local Source Videos.  The existing
    # bridge assumes a shared physical source timeline, so it is intentionally
    # unavailable even though the compiled backend keys are v2v/rv2v.
    if getattr(left_segment, "mixed_mode", None) or getattr(right_segment, "mixed_mode", None):
        return False
    if not (
        source_bridge_enabled(getattr(left_segment, "task_key", ""), frames)
        and source_bridge_enabled(getattr(right_segment, "task_key", ""), frames)
    ):
        return False
    link = getattr(right_segment, "context_link", None)
    # Missing is the legacy workflow fallback: Source Bridge remains global.
    if link is None:
        return True
    return bool(getattr(link, "visual_enabled", False))


def should_apply_visual_motion_context(
    motion_context_enabled: bool,
    task_key: str,
    timeline_slot: int,
    source_bridge_frames: int,
    explicit_i2v_reset: bool,
) -> bool:
    if not motion_context_enabled or explicit_i2v_reset:
        return False
    if source_bridge_enabled(task_key, source_bridge_frames):
        return False
    return int(timeline_slot) > 0


def bridge_window_for_boundary(boundary: int) -> SourceBridgeWindow:
    boundary = int(boundary)
    return SourceBridgeWindow(
        boundary=boundary,
        source_start=boundary - 2,
        source_end=boundary + 3,
        first_anchor_source_time=boundary - 2,
        last_anchor_source_time=boundary + 2,
        emitted_source_start=boundary - 1,
        emitted_source_end=boundary + 2,
    )


def bridge_anchors(
    left_segment,
    left_frames: torch.Tensor,
    right_segment,
    right_frames: torch.Tensor,
    window: SourceBridgeWindow,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Extract generated B-2/B+2 anchors in IMAGE batch form."""
    left_offset = window.first_anchor_source_time - int(left_segment.start_frame)
    right_offset = window.last_anchor_source_time - int(right_segment.start_frame)
    if not 0 <= left_offset < int(left_frames.shape[0]):
        raise ValueError("Source Bridge first anchor is outside the left generated segment.")
    if not 0 <= right_offset < int(right_frames.shape[0]):
        raise ValueError("Source Bridge last anchor is outside the right generated segment.")
    return left_frames[left_offset : left_offset + 1], right_frames[right_offset : right_offset + 1]


def _identity(value: Any, depth: int = 0):
    if depth > 8:
        return f"{type(value).__module__}.{type(value).__qualname__}"
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, torch.Tensor):
        tensor = value.detach().cpu().contiguous()
        probe = tensor.reshape(-1)
        if int(probe.numel()) > 8192:
            indices = torch.linspace(
                0, int(probe.numel()) - 1, 8192, dtype=torch.float64
            ).long()
            probe = probe.index_select(0, indices)
        if probe.is_floating_point():
            probe = probe.float()
        return {
            "shape": list(tensor.shape),
            "dtype": str(tensor.dtype),
            "sha256": hashlib.sha256(probe.numpy().tobytes()).hexdigest(),
        }
    if isinstance(value, dict):
        return {
            str(key): _identity(item, depth + 1)
            for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
        }
    if isinstance(value, (list, tuple)):
        return [_identity(item, depth + 1) for item in value]
    if hasattr(value, "__dict__"):
        return _identity(vars(value), depth + 1)
    return repr(value)


def reference_bundle_fingerprint(segment) -> str:
    payload = {
        "refs": _identity(getattr(segment, "refs", None) or []),
        "ref_audios": _identity(getattr(segment, "ref_audios", None) or []),
        "ref_videos": _identity(getattr(segment, "ref_videos", None) or []),
        "ref_video_audios": _identity(
            getattr(segment, "ref_video_audios", None) or []
        ),
        "reference_video_meta": _identity(
            getattr(segment, "reference_video_meta", None) or {}
        ),
        "reference_video_start_frame": int(
            getattr(segment, "reference_video_start_frame", 0) or 0
        ),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def reference_bundles_match(left_segment, right_segment) -> bool:
    return reference_bundle_fingerprint(left_segment) == reference_bundle_fingerprint(
        right_segment
    )


def assemble_source_bridges(
    segments,
    nominal_outputs: dict[int, torch.Tensor],
    bridges: list[GeneratedSourceBridge],
) -> dict[int, torch.Tensor]:
    """Replace B-1/B/B+1 with bridge frames 1/2/3, preserving ownership."""
    by_index = {int(seg.index): seg for seg in segments}
    output: dict[int, torch.Tensor] = {}
    for index, frames in nominal_outputs.items():
        segment = by_index.get(int(index))
        if segment is None:
            raise ValueError(f"Source Bridge output references unknown segment {index}.")
        if int(frames.shape[0]) != int(segment.frame_count):
            raise ValueError(
                f"Source Bridge segment {int(index) + 1} has {int(frames.shape[0])} "
                f"frames; expected nominal length {int(segment.frame_count)}."
            )
        output[int(index)] = frames.clone()

    for bridge in bridges:
        left = by_index.get(int(bridge.left_segment_index))
        right = by_index.get(int(bridge.right_segment_index))
        if left is None or right is None:
            raise ValueError("Source Bridge references an unknown adjacent segment.")
        if int(left.end_frame) != int(right.start_frame):
            raise ValueError("Source Bridge segments are not nominally adjacent.")
        if int(bridge.frames.shape[0]) < SOURCE_BRIDGE_FRAME_COUNT:
            raise ValueError("Source Bridge decode returned fewer than 5 frames.")
        if int(left.index) not in output or int(right.index) not in output:
            raise ValueError("Source Bridge requires both nominal generated segments.")

        boundary = int(bridge.window.boundary)
        left_time = boundary - 1
        left_offset = left_time - int(left.start_frame)
        right_offsets = [boundary - int(right.start_frame), boundary + 1 - int(right.start_frame)]
        if not 0 <= left_offset < int(output[int(left.index)].shape[0]):
            raise ValueError("Source Bridge B-1 output frame is unavailable.")
        if any(
            offset < 0 or offset >= int(output[int(right.index)].shape[0])
            for offset in right_offsets
        ):
            raise ValueError("Source Bridge B/B+1 output frames are unavailable.")

        output[int(left.index)][left_offset] = bridge.frames[1]
        output[int(right.index)][right_offsets[0]] = bridge.frames[2]
        output[int(right.index)][right_offsets[1]] = bridge.frames[3]

    return output
