"""Color-statistics re-anchoring for exported visual Motion Context frames."""

from __future__ import annotations

from typing import Any

import torch


COLOR_REANCHOR_STRENGTH = 0.5
COLOR_REANCHOR_PIPELINE = "color_reanchor_chain_baseline_v3"
COLOR_ANCHOR_POLICY = "visual_chain_root_v1"

SEAM_COLOR_MATCH_STRENGTH = 0.65
SEAM_COLOR_MATCH_FRAMES = 24
SEAM_COLOR_REFERENCE_FRAMES = 4


def apply_color_reanchor(
    frames: torch.Tensor,
    anchor: torch.Tensor | dict[str, Any] | None,
    *,
    strength: float = COLOR_REANCHOR_STRENGTH,
    eps: float = 1e-6,
) -> torch.Tensor:
    """Blend per-frame RGB statistics toward one stable visual anchor."""
    if anchor is None:
        return frames
    if not isinstance(frames, torch.Tensor) or frames.ndim != 4 or int(frames.shape[0]) == 0:
        return frames
    if int(frames.shape[-1]) < 3:
        raise ValueError("Color Re-anchor expects IMAGE tensors shaped [F,H,W,C] with RGB channels.")

    amount = min(1.0, max(0.0, float(strength)))
    if amount <= 0.0:
        return frames

    source_dtype = frames.dtype
    rgb = frames[..., :3].float()
    frame_mean = rgb.mean(dim=(1, 2), keepdim=True)
    frame_std = rgb.std(dim=(1, 2), keepdim=True, unbiased=False)
    if isinstance(anchor, dict):
        anchor_mean = torch.as_tensor(anchor.get("mean"), device=frames.device, dtype=torch.float32)
        anchor_std = torch.as_tensor(anchor.get("std"), device=frames.device, dtype=torch.float32)
        if anchor_mean.numel() != 3 or anchor_std.numel() != 3:
            raise ValueError("Color Re-anchor baseline statistics must contain three RGB values.")
        anchor_mean = anchor_mean.reshape(1, 1, 1, 3)
        anchor_std = anchor_std.reshape(1, 1, 1, 3)
    elif isinstance(anchor, torch.Tensor) and int(anchor.numel()) > 0:
        if anchor.ndim == 3:
            anchor = anchor.unsqueeze(0)
        if anchor.ndim != 4 or int(anchor.shape[-1]) < 3:
            raise ValueError("Color Re-anchor expects IMAGE tensors shaped [F,H,W,C] with RGB channels.")
        anchor_rgb = anchor[..., :3].to(device=frames.device, dtype=torch.float32)
        anchor_mean = anchor_rgb.mean(dim=(0, 1, 2), keepdim=True)
        anchor_std = anchor_rgb.std(dim=(0, 1, 2), keepdim=True, unbiased=False)
    else:
        return frames
    matched = ((rgb - frame_mean) / (frame_std + float(eps))) * anchor_std + anchor_mean
    blended = (rgb * (1.0 - amount) + matched * amount).clamp(0.0, 1.0)

    out = frames.clone()
    out[..., :3] = blended.to(dtype=source_dtype)
    return out

def apply_seam_color_match(
    frames: torch.Tensor,
    previous_frames: torch.Tensor | None,
    *,
    strength: float = SEAM_COLOR_MATCH_STRENGTH,
    fade_frames: int = SEAM_COLOR_MATCH_FRAMES,
    reference_frames: int = SEAM_COLOR_REFERENCE_FRAMES,
    eps: float = 1e-6,
) -> torch.Tensor:
    """Match the beginning of a new segment to the previous exported segment.

    A single RGB mean/std transform is estimated from the previous segment tail
    and the new segment head, then faded out across the first few frames. This
    reduces visible exposure / white-balance jumps without grading the entire
    new segment.
    """
    if (
        previous_frames is None
        or not isinstance(previous_frames, torch.Tensor)
        or previous_frames.ndim != 4
        or int(previous_frames.shape[0]) <= 0
    ):
        return frames

    if (
        not isinstance(frames, torch.Tensor)
        or frames.ndim != 4
        or int(frames.shape[0]) <= 0
    ):
        return frames

    if int(frames.shape[-1]) < 3 or int(previous_frames.shape[-1]) < 3:
        return frames

    amount = min(1.0, max(0.0, float(strength)))
    if amount <= 0.0:
        return frames

    fade_count = min(
        max(1, int(fade_frames)),
        int(frames.shape[0]),
    )
    reference_count = max(1, int(reference_frames))

    prev_count = min(
        reference_count,
        int(previous_frames.shape[0]),
    )
    new_count = min(
        reference_count,
        int(frames.shape[0]),
    )

    source_dtype = frames.dtype

    previous_rgb = previous_frames[
        -prev_count:, ..., :3
    ].to(
        device=frames.device,
        dtype=torch.float32,
    )

    new_rgb = frames[
        :new_count, ..., :3
    ].float()

    previous_mean = previous_rgb.mean(
        dim=(0, 1, 2),
        keepdim=True,
    )
    previous_std = previous_rgb.std(
        dim=(0, 1, 2),
        keepdim=True,
        unbiased=False,
    )

    new_mean = new_rgb.mean(
        dim=(0, 1, 2),
        keepdim=True,
    )
    new_std = new_rgb.std(
        dim=(0, 1, 2),
        keepdim=True,
        unbiased=False,
    )

    scale = previous_std / (new_std + float(eps))
    scale = scale.clamp(0.67, 1.5)

    bias = previous_mean - new_mean * scale

    out = frames.clone()
    head = frames[:fade_count, ..., :3].float()

    matched = (
        head * scale + bias
    ).clamp(0.0, 1.0)

    if fade_count == 1:
        weights = torch.tensor(
            [amount],
            device=frames.device,
            dtype=torch.float32,
        )
    else:
        weights = torch.linspace(
            amount,
            0.0,
            fade_count,
            device=frames.device,
            dtype=torch.float32,
        )

    weights = weights.view(
        fade_count,
        1,
        1,
        1,
    )

    blended = (
        head * (1.0 - weights)
        + matched * weights
    ).clamp(0.0, 1.0)

    out[:fade_count, ..., :3] = blended.to(
        dtype=source_dtype
    )

    return out

def color_anchor_statistics(frames: torch.Tensor, *, source: str) -> dict[str, Any]:
    if not isinstance(frames, torch.Tensor) or frames.ndim != 4 or int(frames.shape[0]) <= 0:
        raise ValueError("Color Re-anchor cannot establish a baseline from empty frames.")
    rgb = frames[..., :3].detach().float().cpu()
    return {
        "policy": COLOR_ANCHOR_POLICY,
        "source": str(source),
        "mean": [float(value) for value in rgb.mean(dim=(0, 1, 2)).tolist()],
        "std": [float(value) for value in rgb.std(dim=(0, 1, 2), unbiased=False).tolist()],
    }


def validate_color_anchor_statistics(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict) or value.get("policy") != COLOR_ANCHOR_POLICY:
        return None
    try:
        mean = [float(item) for item in value["mean"]]
        std = [float(item) for item in value["std"]]
    except (KeyError, TypeError, ValueError):
        return None
    if len(mean) != 3 or len(std) != 3:
        return None
    values = torch.tensor(mean + std, dtype=torch.float32)
    if not bool(torch.isfinite(values).all()) or bool((torch.tensor(std) < 0).any()):
        return None
    return {
        "policy": COLOR_ANCHOR_POLICY,
        "source": str(value.get("source") or "visual chain root"),
        "mean": mean,
        "std": std,
    }


def _picture_one(segment) -> torch.Tensor | None:
    for ref in getattr(segment, "refs", None) or []:
        tensor = getattr(ref, "tensor", None)
        if int(getattr(ref, "index", -1)) == 0 and isinstance(tensor, torch.Tensor):
            if tensor.ndim == 3:
                tensor = tensor.unsqueeze(0)
            if tensor.ndim == 4 and int(tensor.shape[0]) > 0:
                return tensor[:1]
    return None


def _segment_slot(segment) -> int:
    return int(getattr(segment, "timeline_index", getattr(segment, "index", 0)))


def resolve_color_anchor(
    plan,
    segment,
    *,
    source_frames: torch.Tensor | None = None,
    source_bridge_active: bool = False,
) -> torch.Tensor | None:
    """Resolve the stable anchor from already-effective segment media."""
    if source_bridge_active:
        return None
    task_key = str(getattr(segment, "task_key", "")).lower()

    if task_key == "i2v":
        current_slot = _segment_slot(segment)
        anchor = None
        for candidate in getattr(plan, "segments", None) or []:
            if _segment_slot(candidate) > current_slot:
                continue
            if str(getattr(candidate, "task_key", "")).lower() != "i2v":
                continue
            source = getattr(candidate, "source_clip", None)
            if isinstance(source, torch.Tensor) and source.ndim == 4 and int(source.shape[0]) > 0:
                anchor = source[:1]
        return anchor

    if task_key in {"v2v", "rv2v"}:
        if isinstance(source_frames, torch.Tensor) and source_frames.ndim == 4:
            if int(source_frames.shape[0]) > 0:
                return source_frames[:1]
    return None


def establish_color_chain_baseline(
    segment,
    *,
    generated_frames: torch.Tensor,
    source_frames: torch.Tensor | None = None,
) -> dict[str, Any]:
    """Create one persistent baseline at the root of a visual chain."""
    task_key = str(getattr(segment, "task_key", "")).lower()
    if task_key == "i2v":
        source = getattr(segment, "source_clip", None)
        if isinstance(source, torch.Tensor) and source.ndim == 4 and int(source.shape[0]) > 0:
            return color_anchor_statistics(source[:1], source="I2V chain-root source image")
    if task_key == "fl2v":
        first = _picture_one(segment)
        if first is not None:
            return color_anchor_statistics(first[:1], source="FL2V chain-root First Frame")
    if task_key in {"v2v", "rv2v"}:
        if isinstance(source_frames, torch.Tensor) and source_frames.ndim == 4 and int(source_frames.shape[0]) > 0:
            return color_anchor_statistics(source_frames[:1], source=f"{task_key.upper()} chain-root source video")
    # T2V/R2V and source-less fallbacks intentionally use the generated chain
    # root. Picture refs remain identity references and never become a grade.
    return color_anchor_statistics(generated_frames, source=f"{task_key.upper()} chain-root generated result")


def color_reanchor_cache_settings(enabled: bool) -> dict[str, Any]:
    return {
        "color_reanchor_enabled": bool(enabled),
        "color_reanchor_pipeline": COLOR_REANCHOR_PIPELINE,
        "color_anchor_policy": COLOR_ANCHOR_POLICY,
    }


__all__ = [
    "COLOR_REANCHOR_PIPELINE",
    "COLOR_ANCHOR_POLICY",
    "COLOR_REANCHOR_STRENGTH",
    "SEAM_COLOR_MATCH_STRENGTH",
    "SEAM_COLOR_MATCH_FRAMES",
    "SEAM_COLOR_REFERENCE_FRAMES",
    "apply_color_reanchor",
    "apply_seam_color_match",
    "color_anchor_statistics",
    "color_reanchor_cache_settings",
    "establish_color_chain_baseline",
    "resolve_color_anchor",
    "validate_color_anchor_statistics",
]
