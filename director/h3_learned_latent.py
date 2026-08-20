"""Director-native H3 learned-latent upscale integration."""

from __future__ import annotations

from typing import Any, Callable

import torch

from . import h3_latent_upscaler_runtime as _runtime
from .h3_noise_mask import remap_h3_noise_mask, with_noise_mask
from .vram_cleanup import cleanup_segment_vram

VAE_DOWNSAMPLE = 16


def _unpack(out: Any) -> tuple[Any, ...]:
    if hasattr(out, "args") and out.args:
        return tuple(out.args)
    if isinstance(out, (tuple, list)):
        return tuple(out)
    return (out,)


def list_h3_latent_models() -> list[str]:
    return _runtime.list_h3_latent_models()


# Backward-compatible internal name from the first feature-branch iteration.
def list_lbh_models() -> list[str]:
    return list_h3_latent_models()


def _split_av(latent: dict):
    from comfy_extras.nodes_lt import LTXVSeparateAVLatent

    video_latent, audio_latent = _unpack(LTXVSeparateAVLatent.execute(latent))[:2]
    return video_latent, audio_latent


def _join_av(video_latent: dict, audio_latent: dict, template: dict) -> dict:
    from comfy_extras.nodes_lt import LTXVConcatAVLatent

    joined = _unpack(LTXVConcatAVLatent.execute(video_latent, audio_latent))[0]
    if isinstance(joined, dict):
        out = dict(template)
        out.update(joined)
        return out
    out = dict(template)
    out["samples"] = joined
    return out


def _empty_device_cache() -> None:
    try:
        import comfy.model_management as model_management

        empty = getattr(model_management, "soft_empty_cache", None)
        if callable(empty):
            empty()
            return
    except ImportError:
        pass
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def _validate_target(width: int, height: int) -> tuple[int, int]:
    width = int(width)
    height = int(height)
    if width <= 0 or height <= 0:
        raise ValueError("H3 learned latent target width/height must be positive.")
    if width % VAE_DOWNSAMPLE or height % VAE_DOWNSAMPLE:
        raise ValueError(
            "H3 learned latent target must align to the H3 VAE 16px grid; "
            f"got {width}x{height}."
        )
    return width // VAE_DOWNSAMPLE, height // VAE_DOWNSAMPLE


def upscale_h3_av_latent(
    latent: dict,
    *,
    width: int,
    height: int,
    model_name: str,
    precision: str = "fp16",
    device: str = "cuda",
    on_progress: Callable[[float], None] | None = None,
) -> dict:
    """Upscale H3 video latent natively while preserving Director AV/mask state."""
    if not str(model_name or "").strip():
        raise ValueError("H3 learned latent upscale requires a checkpoint filename.")
    target_w, target_h = _validate_target(width, height)

    video_latent, audio_latent = _split_av(latent)
    source = video_latent.get("samples") if isinstance(video_latent, dict) else None
    if not isinstance(source, torch.Tensor) or source.ndim not in {4, 5}:
        raise ValueError("H3 learned latent upscale expected a video latent tensor.")
    source_h, source_w = int(source.shape[-2]), int(source.shape[-1])
    source_t = int(source.shape[-3]) if source.ndim == 5 else 1
    if target_h < source_h or target_w < source_w:
        raise ValueError("H3 learned latent backend supports upscale only.")

    if str(device or "cuda").strip().lower() == "cuda":
        cleanup_segment_vram(enabled=True, unload_models=True)

    try:
        upscaled = _runtime.run_h3_latent_upscaler(
            source,
            model_name=str(model_name),
            variant="auto",  # runtime keeps this legacy kwarg but checkpoint layout is authoritative
            target_h=target_h,
            target_w=target_w,
            precision=str(precision),
            device=str(device),
            on_progress=on_progress,
        )
        actual_h, actual_w = int(upscaled.shape[-2]), int(upscaled.shape[-1])
        actual_t = int(upscaled.shape[-3]) if upscaled.ndim == 5 else 1
        if (actual_h, actual_w) != (target_h, target_w):
            raise RuntimeError(
                "H3 learned latent runtime changed Director's target canvas: expected "
                f"latent {target_w}x{target_h}, got {actual_w}x{actual_h}."
            )
        if actual_t != source_t:
            raise RuntimeError(
                "H3 learned latent runtime changed temporal length: expected "
                f"{source_t}, got {actual_t}."
            )
        out = _join_av({"samples": upscaled}, audio_latent, latent)
        mask = remap_h3_noise_mask(
            latent.get("noise_mask"), target_h=target_h, target_w=target_w
        )
        return with_noise_mask(out, mask)
    finally:
        _empty_device_cache()


__all__ = [
    "list_h3_latent_models",
    "list_lbh_models",
    "upscale_h3_av_latent",
]
