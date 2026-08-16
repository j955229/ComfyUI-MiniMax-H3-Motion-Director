# Portions derived from ComfyUI_MiniMaxH3_Director
# Copyright AIMixer and contributors
# Originally licensed under Apache License 2.0
# Modified for MiniMax H3 Motion Director, 2026-08-09
# This derivative project is distributed under GPL-3.0.
# See NOTICE and LICENSES/Apache-2.0-AIMixer.txt.

"""Image and video preprocessing for MiniMax H3 visual conditioning."""

from __future__ import annotations

import torch
from comfy.utils import common_upscale

from .frame_assembly import assemble_frame_chunks


H3_SPATIAL_STRIDE = 32
H3_CONDITIONING_SPATIAL_STRIDE = H3_SPATIAL_STRIDE
H3_SPATIAL_PIPELINE = "h3_global_spatial_stride_32_v2"


def snap_dimension(value: int, stride: int) -> int:
    """Round *value* to the nearest multiple of *stride*, keeping at least *stride*."""
    return max(stride, round(value / stride) * stride)


def resolve_h3_canvas(width: int, height: int, *, stride: int) -> tuple[int, int]:
    """Snap one authoritative H3 canvas without changing its time axis."""
    return snap_dimension(int(width), int(stride)), snap_dimension(int(height), int(stride))


def resolve_h3_spatial_stride(
    task_key: str,
    *,
    segment_count: int = 1,
    motion_context_enabled: bool = False,
    has_reference_video: bool = False,
    source_bridge_frames: int = 0,
) -> int:
    """Return the one authoritative pixel stride used by every H3 task."""
    del task_key, segment_count, motion_context_enabled, has_reference_video, source_bridge_frames
    return H3_SPATIAL_STRIDE


def preflight_h3_visual_conditioning(
    frames: torch.Tensor,
    *,
    task_key: str,
    path: str,
    required_stride: int = H3_CONDITIONING_SPATIAL_STRIDE,
) -> torch.Tensor:
    """Fail before H3 patchify when a visual conditioning tensor is not grid-safe."""
    if not isinstance(frames, torch.Tensor) or frames.ndim != 4:
        raise ValueError(
            "H3 visual conditioning expects IMAGE frames [F,H,W,C]: "
            f"task={task_key} path={path} required_stride={int(required_stride)}"
        )
    height = int(frames.shape[1])
    width = int(frames.shape[2])
    stride = int(required_stride)
    if width % stride or height % stride:
        raise ValueError(
            "H3 visual conditioning requires 32-pixel spatial alignment: "
            f"task={task_key} path={path} size={width}x{height} "
            f"required_stride={stride}"
        )
    return frames


def fit_long_edge(image: torch.Tensor, max_edge: int, stride: int = H3_SPATIAL_STRIDE) -> torch.Tensor:
    """Match official ComfyUI H3 long-edge resizing and snap to the requested stride."""
    rgb = image[:, :, :, :3]
    height, width = rgb.shape[1], rgb.shape[2]
    scale = min(max_edge / max(height, width), 1.0)
    new_h = max(stride, round(height * scale / stride) * stride)
    new_w = max(stride, round(width * scale / stride) * stride)
    return common_upscale(
        rgb.movedim(-1, 1), new_w, new_h, "area", "disabled"
    ).movedim(1, -1)


def fit_canvas(
    frames: torch.Tensor,
    width: int,
    height: int,
    upscale_mode: str = "area",
) -> torch.Tensor:
    """Resize video frames to a fixed canvas (width x height)."""
    rgb = frames[..., :3]
    return common_upscale(
        rgb.movedim(-1, 1), width, height, upscale_mode, "center"
    ).movedim(1, -1)


def fit_video_long_edge(
    frames: torch.Tensor,
    max_edge: int,
    stride: int = H3_SPATIAL_STRIDE,
) -> torch.Tensor:
    """Scale each frame so its long side is at most *max_edge*, preserving aspect ratio."""
    if frames.shape[0] == 0:
        return frames
    chunks = [fit_long_edge(frames[i : i + 1], max_edge, stride=stride) for i in range(frames.shape[0])]
    return torch.cat(chunks, dim=0)


def pad_frames_to_canvas(
    frames: torch.Tensor,
    width: int,
    height: int,
    *,
    fill: float = 0.5,
) -> torch.Tensor:
    """Center-pad a frame sequence onto a fixed canvas (letterbox)."""
    if frames.ndim != 4:
        raise ValueError("frames must be [F, H, W, C]")
    f, h, w, c = frames.shape
    if h == height and w == width:
        return frames
    out = torch.full((f, height, width, c), fill, dtype=frames.dtype, device=frames.device)
    y0 = max(0, (height - h) // 2)
    x0 = max(0, (width - w) // 2)
    copy_h = min(h, height - y0)
    copy_w = min(w, width - x0)
    out[:, y0 : y0 + copy_h, x0 : x0 + copy_w, :] = frames[:, :copy_h, :copy_w, :]
    return out


def cat_frames_variable_size(clips: list[torch.Tensor], *, fill: float = 0.5) -> torch.Tensor:
    """Concatenate clips, using file-backed storage for multi-GiB final outputs."""
    return assemble_frame_chunks(clips, fill=fill)


def resolve_output_dimensions(
    source_w: int,
    source_h: int,
    *,
    mode: str = "long_edge",
    long_edge: int = 848,
    fixed_width: int = 832,
    fixed_height: int = 480,
    stride: int = H3_SPATIAL_STRIDE,
) -> tuple[int, int, int, str]:
    """Return (width, height, ref_max_size, mode) for MiniMax H3 Motion Director output."""
    mode = (mode or "long_edge").lower()
    if mode == "fixed":
        w = snap_dimension(int(fixed_width), stride)
        h = snap_dimension(int(fixed_height), stride)
        return w, h, max(w, h), "fixed"

    long_edge = max(stride, int(long_edge))
    if source_w <= 0 or source_h <= 0:
        w = snap_dimension(int(fixed_width), stride)
        h = snap_dimension(int(fixed_height), stride)
        return w, h, long_edge, "long_edge"

    if max(source_w, source_h) <= long_edge:
        return snap_dimension(source_w, stride), snap_dimension(source_h, stride), long_edge, "long_edge"

    scale = long_edge / max(source_w, source_h)
    w = snap_dimension(int(round(source_w * scale)), stride)
    h = snap_dimension(int(round(source_h * scale)), stride)
    return w, h, long_edge, "long_edge"


def normalize_to_vae_range(frames: torch.Tensor) -> torch.Tensor:
    """Map [0, 1] images to [-1, 1] for Wan-style VAE encoding."""
    return frames * 2.0 - 1.0
