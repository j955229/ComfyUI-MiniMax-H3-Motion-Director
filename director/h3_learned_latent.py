"""Director adapter for the separately installed LBH MiniMax H3 latent upscaler."""

from __future__ import annotations

import glob
import os
import sys
from typing import Any

import torch

from .h3_noise_mask import remap_h3_noise_mask, with_noise_mask

VAE_DOWNSAMPLE = 16
_NODE_2D = "MinimaxH3LatentUpscalerNode2D"
_NODE_3D = "MinimaxH3LatentUpscaler3D"


def _unpack(out: Any) -> tuple[Any, ...]:
    if hasattr(out, "args") and out.args:
        return tuple(out.args)
    if isinstance(out, (tuple, list)):
        return tuple(out)
    return (out,)


def _registry() -> dict[str, Any]:
    try:
        import nodes
    except ImportError as exc:  # pragma: no cover - ComfyUI runtime dependency
        raise RuntimeError("LBH H3 latent upscale requires a running ComfyUI node registry.") from exc
    return getattr(nodes, "NODE_CLASS_MAPPINGS", {}) or {}


def lbh_available(variant: str = "2d") -> bool:
    key = _NODE_3D if str(variant).lower() == "3d" else _NODE_2D
    return key in _registry()


def _node_class(variant: str):
    selected = str(variant or "2d").strip().lower()
    if selected not in {"2d", "3d"}:
        raise ValueError(f"Unsupported H3 learned latent variant: {variant}")
    key = _NODE_3D if selected == "3d" else _NODE_2D
    cls = _registry().get(key)
    if cls is None:
        raise RuntimeError(
            "LBH MiniMax H3 Latent Upscaler is not installed/loaded. Install "
            "LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler separately, restart "
            f"ComfyUI, and ensure node {key} is available."
        )
    return cls, selected


def list_lbh_models() -> list[str]:
    """List external LBH checkpoints without importing or copying its implementation."""
    try:
        import folder_paths
    except ImportError:
        return []
    paths: list[str] = []
    try:
        paths.extend(folder_paths.get_folder_paths("latent_upscale_models") or [])
    except Exception:
        models_dir = getattr(folder_paths, "models_dir", None)
        if models_dir:
            paths.append(os.path.join(models_dir, "latent_upscale_models"))
    names: set[str] = set()
    for folder in paths:
        for pattern in ("*.safetensors", "*.pth"):
            for path in glob.glob(os.path.join(folder, pattern)):
                names.add(os.path.basename(path))
    return sorted(names)


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


def release_lbh_upscaler_cache(node_class=None) -> None:
    """Drop LBH's module-global model cache before high-resolution H3 sampling."""
    classes = []
    if node_class is not None:
        classes.append(node_class)
    else:
        mappings = _registry()
        classes.extend(
            cls for key in (_NODE_2D, _NODE_3D) if (cls := mappings.get(key)) is not None
        )
    seen: set[str] = set()
    for cls in classes:
        module_name = str(getattr(cls, "__module__", ""))
        if not module_name or module_name in seen:
            continue
        seen.add(module_name)
        module = sys.modules.get(module_name)
        cache = getattr(module, "MODEL_CACHE", None) if module is not None else None
        if isinstance(cache, dict):
            cache.clear()
    try:
        import comfy.model_management as model_management
        empty = getattr(model_management, "soft_empty_cache", None)
        if callable(empty):
            empty()
        elif torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
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
    variant: str = "2d",
    precision: str = "fp16",
    device: str = "cuda",
) -> dict:
    """Upscale H3 video latent through LBH while preserving Director AV/mask state."""
    if not str(model_name or "").strip():
        raise ValueError("H3 learned latent upscale requires an LBH model checkpoint.")
    target_w, target_h = _validate_target(width, height)
    cls, selected = _node_class(variant)
    video_latent, audio_latent = _split_av(latent)
    source = video_latent.get("samples") if isinstance(video_latent, dict) else None
    if not isinstance(source, torch.Tensor) or source.ndim not in {4, 5}:
        raise ValueError("H3 learned latent upscale expected a video latent tensor.")
    source_h, source_w = int(source.shape[-2]), int(source.shape[-1])
    source_t = int(source.shape[-3]) if source.ndim == 5 else 1
    if target_h < source_h or target_w < source_w:
        raise ValueError("H3 learned latent backend supports upscale only.")

    try:
        if selected == "2d":
            scale_h = target_h / float(source_h)
            scale_w = target_w / float(source_w)
            if abs(scale_h - scale_w) > 1e-6:
                raise ValueError(
                    "LBH 2D latent upscaler uses one uniform scale and cannot change "
                    "aspect ratio. Select the 3D variant or keep the final aspect ratio."
                )
            result = _unpack(
                cls().run(
                    video_latent,
                    str(model_name),
                    float(scale_w),
                    str(device),
                    str(precision),
                )
            )[0]
        else:
            module = sys.modules.get(str(getattr(cls, "__module__", "")))
            upscale_mode = getattr(module, "UpscaleMode", None) if module is not None else None
            target_mode = (
                getattr(upscale_mode, "TARGET_DIMENSIONS", None)
                if upscale_mode is not None else None
            ) or "target dimensions"
            mode = {
                "mode": target_mode,
                "width": int(width),
                "height": int(height),
            }
            execute = getattr(cls, "execute", None)
            if not callable(execute):
                raise RuntimeError("Loaded LBH 3D node does not expose execute().")
            result = _unpack(
                execute(
                    video_latent,
                    str(model_name),
                    mode,
                    VAE_DOWNSAMPLE,
                    False,
                    str(device),
                    str(precision),
                )
            )[0]

        if not isinstance(result, dict) or not isinstance(result.get("samples"), torch.Tensor):
            raise RuntimeError("LBH H3 latent upscaler returned an invalid LATENT output.")
        upscaled = result["samples"]
        actual_h, actual_w = int(upscaled.shape[-2]), int(upscaled.shape[-1])
        actual_t = int(upscaled.shape[-3]) if upscaled.ndim == 5 else 1
        if (actual_h, actual_w) != (target_h, target_w):
            raise RuntimeError(
                "LBH H3 latent upscaler changed Director's target canvas: expected "
                f"latent {target_w}x{target_h}, got {actual_w}x{actual_h}."
            )
        if actual_t != source_t:
            raise RuntimeError(
                "LBH H3 latent upscaler changed temporal length: expected "
                f"{source_t}, got {actual_t}."
            )

        out = _join_av(result, audio_latent, latent)
        mask = remap_h3_noise_mask(
            latent.get("noise_mask"), target_h=target_h, target_w=target_w
        )
        return with_noise_mask(out, mask)
    finally:
        release_lbh_upscaler_cache(cls)


__all__ = [
    "lbh_available",
    "list_lbh_models",
    "release_lbh_upscaler_cache",
    "upscale_h3_av_latent",
]
