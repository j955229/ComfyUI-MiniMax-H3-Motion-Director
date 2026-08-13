# Portions derived from ComfyUI_MiniMaxH3_Director
# Copyright AIMixer and contributors
# Originally licensed under Apache License 2.0
# Modified for MiniMax H3 Motion Director, 2026-08-09
# This derivative project is distributed under GPL-3.0.
# See NOTICE and LICENSES/Apache-2.0-AIMixer.txt.

"""Exact frame-count alignment for Director merge / cache / preview outputs."""

from __future__ import annotations

import torch


H3_REFERENCE_VIDEO_PIPELINE = "h3_ref_video_align_up_lookahead_v1"
H3_SOURCE_BRIDGE_PIPELINE = "v2v_rv2v_source_bridge_v4_boundary_links"


def minimax_align_frame_count(frame_count: int) -> int:
    """Round up to MiniMax H3 17k+5 frame grid (5, 22, 39, …)."""
    n = max(5, int(frame_count))
    while n % 17 != 5:
        n += 1
    return n


def wan_align_frame_count(frame_count: int) -> int:
    """Legacy alias — MiniMax H3 uses 17k+5, not Wan 4n+1."""
    return minimax_align_frame_count(frame_count)


def pad_or_trim_frames(frames: torch.Tensor, target_len: int) -> torch.Tensor:
    """Trim to at most target_len frames. Does not fabricate last-frame duplicates."""
    target_len = max(0, int(target_len))
    if target_len <= 0:
        return frames[:0]
    if int(frames.shape[0]) > target_len:
        return frames[:target_len]
    return frames


def prepare_h3_reference_video_clip(
    frames: torch.Tensor,
    target_frames: int,
) -> tuple[torch.Tensor, int]:
    """Prepare a conditioning-only reference clip on MiniMax H3's 17k+5 grid.

    Existing frames are never temporally resampled. The caller should include
    real source lookahead where available; this helper only repeats the final
    frame when source EOF or a physical clip boundary leaves a short tail.
    Returns ``(prepared_frames, tail_pad_count)``.
    """
    if not isinstance(frames, torch.Tensor) or frames.ndim != 4:
        raise ValueError("H3 reference video must be an IMAGE frame tensor [N,H,W,C].")
    actual = int(frames.shape[0])
    if actual <= 0:
        raise ValueError("H3 reference video has no source frames.")

    target = minimax_align_frame_count(target_frames)
    prepared = frames[:target]
    pad_count = max(0, target - int(prepared.shape[0]))
    if pad_count:
        prepared = torch.cat(
            [prepared, prepared[-1:].repeat(pad_count, 1, 1, 1)],
            dim=0,
        )

    count = int(prepared.shape[0])
    if count < 5 or count % 17 != 5:
        raise RuntimeError(
            "MiniMax H3 Motion Director internal error: reference video "
            f"preparation produced {count} frames instead of a 17k+5 length."
        )
    return prepared, pad_count
