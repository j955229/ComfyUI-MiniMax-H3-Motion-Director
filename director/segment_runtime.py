# Portions derived from ComfyUI_MiniMaxH3_Director
# Copyright AIMixer and contributors
# Originally licensed under Apache License 2.0
# Modified for MiniMax H3 Motion Director, 2026-08-09
# This derivative project is distributed under GPL-3.0.
# See NOTICE and LICENSES/Apache-2.0-AIMixer.txt.

"""Per-segment helpers shared by the Director executor."""

from __future__ import annotations

import base64
import io

import torch
from PIL import Image

from ..lib.image_prep import fit_canvas, fit_video_long_edge
from ..lib.video_io import (
    load_timeline_segment,
    logical_frame_count,
    resolve_logical_frame_entry,
)
from .frame_align import pad_or_trim_frames
from .plan import DirectorPlan
from .source_bridge import (
    SOURCE_BRIDGE_TASKS,
    SourceBridgeWindow,
    bridge_window_for_boundary,
)


def needs_source_video(task_key: str) -> bool:
    return task_key in {"i2v", "fl2v", "v2v", "rv2v"}


def is_gen_timeline_plan(plan: DirectorPlan) -> bool:
    mode = str((plan.raw or {}).get("timelineMode") or "").lower()
    return mode in ("gen_blank", "gen_image", "prompt_batch", "image_batch", "fl2v")


def resolve_source_bridge_window(
    plan: DirectorPlan,
    left_segment,
    right_segment,
) -> tuple[SourceBridgeWindow | None, str | None]:
    """Resolve an exact five-frame source window or a safe hard-cut reason."""
    if (
        getattr(left_segment, "task_key", "") not in SOURCE_BRIDGE_TASKS
        or getattr(right_segment, "task_key", "") not in SOURCE_BRIDGE_TASKS
    ):
        return None, "Source Bridge applies only to adjacent V2V/RV2V segments."
    boundary = int(right_segment.start_frame)
    if int(left_segment.end_frame) != boundary:
        return None, "Source Bridge skipped: the segment boundary is discontinuous."
    if (
        int(left_segment.start_frame) > boundary - 2
        or int(right_segment.end_frame) < boundary + 3
    ):
        return None, (
            "Source Bridge skipped: five continuous source frames and both "
            "generated anchor positions are not available around this boundary."
        )
    if (
        getattr(left_segment, "source_clip", None) is not None
        or getattr(right_segment, "source_clip", None) is not None
        or (plan.raw or {}).get("externalGroups", {}).get("active")
    ):
        return None, "Source Bridge skipped: no shared physical source timeline."

    window = bridge_window_for_boundary(boundary)
    if window.source_start < 0:
        return None, "Source Bridge skipped: five continuous source frames are unavailable at BOF."

    sv = getattr(plan, "source_video", None)
    if is_gen_timeline_plan(plan) and isinstance(sv, torch.Tensor) and int(sv.shape[0]) > 0:
        if window.source_end > int(sv.shape[0]):
            return None, "Source Bridge skipped: five continuous source frames are unavailable at EOF."
        return window, None

    total = logical_frame_count(plan.raw)
    if window.source_end > total:
        return None, "Source Bridge skipped: five continuous source frames are unavailable at EOF."
    first_clip, first_source = resolve_logical_frame_entry(plan.raw, window.source_start)
    for offset, logical_index in enumerate(range(window.source_start, window.source_end)):
        clip_index, source_frame = resolve_logical_frame_entry(plan.raw, logical_index)
        if clip_index != first_clip:
            return None, "Source Bridge skipped: the window crosses a physical source file boundary."
        if source_frame != first_source + offset:
            return None, "Source Bridge skipped: the source timeline contains an edited discontinuity."
    return window, None


def load_source_bridge_clip(
    plan: DirectorPlan,
    window: SourceBridgeWindow,
) -> torch.Tensor:
    """Load the five real source frames used only as Bridge conditioning."""
    if window is None or int(window.frame_count) != 5:
        raise ValueError("Source Bridge requires exactly five continuous source frames.")
    sv = getattr(plan, "source_video", None)
    if is_gen_timeline_plan(plan) and isinstance(sv, torch.Tensor) and int(sv.shape[0]) > 0:
        clip = sv[int(window.source_start) : int(window.source_end)].clone()
    else:
        clip = load_timeline_segment(plan.raw, window.source_start, window.source_end)
    if int(clip.shape[0]) != 5:
        raise ValueError(
            "Source Bridge requires exactly five real continuous source frames; padding is not allowed."
        )
    return clip


def resolve_segment_raw_clip(plan: DirectorPlan, seg) -> torch.Tensor:
    """Prefer in-memory gen canvas / segment clip; fall back to timeline video decode."""
    if seg.source_clip is not None and seg.source_clip.shape[0] > 0:
        return seg.source_clip.clone()

    # Pure t2v (incl. external groups) has no source frames.
    if getattr(seg, "task_key", "") == "t2v":
        return torch.zeros((0, 16, 16, 3), dtype=torch.float32)

    # FL2V end-only deliberately has no source_clip. The generation timeline's
    # tiny gray source_video is schema padding, not image0.
    if getattr(seg, "task_key", "") == "fl2v" and is_gen_timeline_plan(plan):
        return torch.zeros((0, 16, 16, 3), dtype=torch.float32)

    sv = plan.source_video
    if is_gen_timeline_plan(plan) and sv is not None and int(sv.shape[0]) > 0:
        start = max(0, int(seg.start_frame))
        end = min(int(seg.end_frame), int(sv.shape[0]))
        if end > start:
            return sv[start:end].clone()

    if (plan.raw or {}).get("externalGroups", {}).get("active"):
        return torch.zeros((0, 16, 16, 3), dtype=torch.float32)

    return load_timeline_segment(plan.raw, seg.start_frame, seg.end_frame)


def resolve_segment_raw_clip_with_lookahead(
    plan: DirectorPlan,
    seg,
    *,
    end_extra: int = 0,
) -> torch.Tensor:
    """Like ``resolve_segment_raw_clip``, but may pull frames past ``seg.end_frame``.

    Extra frames are conditioning-only (continuity gen length matching); they are
    not kept in the exported segment after trim.
    """
    extra = max(0, int(end_extra))
    if extra <= 0:
        return resolve_segment_raw_clip(plan, seg)

    if seg.source_clip is not None and seg.source_clip.shape[0] > 0:
        # Gen canvases have no timeline lookahead beyond the clip itself.
        return seg.source_clip.clone()

    if getattr(seg, "task_key", "") == "fl2v" and is_gen_timeline_plan(plan):
        return torch.zeros((0, 16, 16, 3), dtype=torch.float32)

    end = int(seg.end_frame) + extra
    sv = plan.source_video
    if is_gen_timeline_plan(plan) and sv is not None and int(sv.shape[0]) > 0:
        start = max(0, int(seg.start_frame))
        end = min(end, int(sv.shape[0]))
        if end > start:
            return sv[start:end].clone()

    total = logical_frame_count(plan.raw)
    start = max(0, int(seg.start_frame))
    visible_end = min(max(start, int(seg.end_frame)), total)
    end = min(max(visible_end, end), total)

    # Conditioning lookahead may continue only through sequential frames from
    # the same physical source clip. At a file boundary (or an edited source
    # jump), stop and let the dedicated H3 reference helper pad the tail.
    if end > visible_end and visible_end > start:
        clip_index, source_frame = resolve_logical_frame_entry(
            plan.raw, visible_end - 1
        )
        safe_end = visible_end
        expected_source_frame = source_frame + 1
        for logical_index in range(visible_end, end):
            next_clip, next_source_frame = resolve_logical_frame_entry(
                plan.raw, logical_index
            )
            if (
                next_clip != clip_index
                or next_source_frame != expected_source_frame
            ):
                break
            safe_end = logical_index + 1
            expected_source_frame += 1
        end = safe_end

    if end <= start:
        return resolve_segment_raw_clip(plan, seg)
    return load_timeline_segment(plan.raw, start, end)


def source_passthrough_chunk(plan: DirectorPlan, seg) -> torch.Tensor:
    """Scaled source frames for skipped v2v segments with no generation cache yet."""
    raw_clip = resolve_segment_raw_clip(plan, seg)
    target_len = raw_clip.shape[0]
    if plan.output_mode == "fixed":
        clip = fit_canvas(raw_clip, plan.width, plan.height)
    else:
        clip = fit_video_long_edge(
            raw_clip,
            plan.ref_max_size,
            stride=int(getattr(plan, "spatial_stride", 32)),
        )
    return pad_or_trim_frames(clip, target_len).cpu().float()


def segment_passthrough_chunk(plan: DirectorPlan, seg) -> torch.Tensor | None:
    """Fill an unselected segment only when a real source video is available.

    Generated-video tasks must never use their internal placeholder/source
    conditioning frames as final output. If their generated segment cache is
    missing, return None so the executor reports the missing cache instead of
    exporting gray placeholder frames or still source images.
    """
    task_key = str(getattr(seg, "task_key", "") or "").lower()

    if task_key in {"t2v", "i2v", "r2v", "fl2v"}:
        return None

    if seg.source_clip is not None and seg.source_clip.shape[0] > 0:
        target_len = max(1, seg.frame_count or int(seg.source_clip.shape[0]))
        clip = seg.source_clip.clone()
        if clip.shape[0] > target_len:
            clip = clip[:target_len]
        return clip.cpu().float()

    if needs_source_video(task_key):
        try:
            return source_passthrough_chunk(plan, seg)
        except Exception:
            return None

    return None


def tensor_frame_to_jpeg_b64(frame: torch.Tensor) -> str:
    arr = (frame.detach().cpu().clamp(0, 1).numpy() * 255).astype("uint8")
    img = Image.fromarray(arr)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def frames_label(seg) -> str:
    return f"帧 {seg.start_frame}–{seg.end_frame} ({seg.frame_count}f)"
