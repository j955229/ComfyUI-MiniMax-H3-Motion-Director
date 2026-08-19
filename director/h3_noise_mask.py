"""MiniMax H3 video/audio noise-mask helpers.

Director treats an H3 noise mask as part of the AV latent state. Video masks
are spatially remapped when the video latent canvas changes; audio masks stay
on their original temporal grid.
"""

from __future__ import annotations

from typing import Any

import torch
import torch.nn.functional as F


def _nested_parts(value: Any) -> tuple[tuple[Any, ...] | None, bool]:
    if value is None:
        return None, False
    if not bool(getattr(value, "is_nested", False)):
        return None, False
    unbind = getattr(value, "unbind", None)
    if not callable(unbind):
        tensors = getattr(value, "tensors", None)
        if tensors is None:
            raise TypeError("MiniMax H3 nested mask does not expose unbind()/tensors.")
        return tuple(tensors), True
    return tuple(unbind()), True


def split_h3_mask(mask: Any) -> tuple[Any, Any, bool]:
    """Return ``(video_mask, audio_mask, is_nested)`` for an H3 noise mask."""
    parts, nested = _nested_parts(mask)
    if not nested:
        return mask, None, False
    if parts is None or len(parts) != 2:
        raise ValueError("MiniMax H3 nested noise_mask must contain video and audio masks.")
    return parts[0], parts[1], True


def _restore_dtype(value: torch.Tensor, dtype: torch.dtype) -> torch.Tensor:
    if dtype == torch.bool:
        return value >= 0.5
    return value.to(dtype=dtype)


def resize_video_mask(mask: torch.Tensor | None, target_h: int, target_w: int):
    """Nearest-neighbour spatial resize while preserving video time/value semantics."""
    if mask is None:
        return None
    if not isinstance(mask, torch.Tensor):
        raise TypeError("MiniMax H3 video noise_mask must be a torch.Tensor.")
    height = max(1, int(target_h))
    width = max(1, int(target_w))
    if mask.ndim < 3:
        raise ValueError(
            "MiniMax H3 video noise_mask must expose spatial H/W dimensions; "
            f"got shape {tuple(mask.shape)}."
        )
    if tuple(mask.shape[-2:]) == (height, width):
        return mask

    dtype = mask.dtype
    compute = mask if torch.is_floating_point(mask) else mask.to(torch.float32)
    if mask.ndim == 3:
        resized = F.interpolate(
            compute.unsqueeze(1), size=(height, width), mode="nearest"
        ).squeeze(1)
    elif mask.ndim == 4:
        resized = F.interpolate(compute, size=(height, width), mode="nearest")
    elif mask.ndim == 5:
        b, c, t, old_h, old_w = compute.shape
        flattened = compute.permute(0, 2, 1, 3, 4).reshape(b * t, c, old_h, old_w)
        flattened = F.interpolate(flattened, size=(height, width), mode="nearest")
        resized = flattened.reshape(b, t, c, height, width).permute(0, 2, 1, 3, 4)
    else:
        raise ValueError(
            "MiniMax H3 video noise_mask must be 3D, 4D, or 5D; "
            f"got shape {tuple(mask.shape)}."
        )
    return _restore_dtype(resized, dtype)


def _make_nested(video_mask: Any, audio_mask: Any):
    try:
        import comfy.nested_tensor
    except ImportError as exc:  # pragma: no cover - ComfyUI runtime dependency
        raise RuntimeError(
            "MiniMax H3 nested noise_mask requires comfy.nested_tensor."
        ) from exc
    return comfy.nested_tensor.NestedTensor((video_mask, audio_mask))


def remap_h3_noise_mask(mask: Any, target_h: int, target_w: int):
    """Remap only the H3 video mask spatial grid; preserve audio mask exactly."""
    if mask is None:
        return None
    video_mask, audio_mask, nested = split_h3_mask(mask)
    video_mask = resize_video_mask(video_mask, target_h, target_w)
    if not nested:
        return video_mask
    return _make_nested(video_mask, audio_mask)


def with_noise_mask(latent: dict, mask: Any) -> dict:
    """Return a latent copy with an explicit mask value (or no mask for None)."""
    out = dict(latent)
    if mask is None:
        out.pop("noise_mask", None)
    else:
        out["noise_mask"] = mask
    return out


__all__ = [
    "remap_h3_noise_mask",
    "resize_video_mask",
    "split_h3_mask",
    "with_noise_mask",
]
