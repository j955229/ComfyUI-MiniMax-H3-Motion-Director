"""High-resolution conditioning synchronization for H3 latent-space refine."""

from __future__ import annotations

from typing import Any

import torch
import torch.nn.functional as F


def _unpack(out):
    if hasattr(out, "args") and out.args:
        return out.args
    if isinstance(out, (tuple, list)):
        return out
    return (out,)


def _resize_keyframe_latent(latent: torch.Tensor, vae, width: int, height: int) -> torch.Tensor:
    from nodes import VAEDecode, VAEEncode

    images = _unpack(VAEDecode().decode(vae, {"samples": latent}))[0]
    if not isinstance(images, torch.Tensor) or images.ndim != 4:
        raise RuntimeError("MiniMax H3 keyframe VAE decode returned an invalid IMAGE batch.")
    if (int(images.shape[2]), int(images.shape[1])) != (int(width), int(height)):
        images = F.interpolate(
            images[..., :3].movedim(-1, 1).float(),
            size=(int(height), int(width)),
            mode="bilinear",
            align_corners=False,
        ).movedim(1, -1).to(images.dtype)
    encoded = _unpack(VAEEncode().encode(vae, images))[0]
    tensor = encoded.get("samples") if isinstance(encoded, dict) else encoded
    if not isinstance(tensor, torch.Tensor):
        raise RuntimeError("MiniMax H3 keyframe VAE encode returned an invalid LATENT.")
    return tensor


def sync_h3_keyframe_conditioning(conditioning: Any, vae, *, width: int, height: int):
    """Re-encode H3 target keyframe latents at the final spatial canvas.

    Reference-media blocks are intentionally left alone: they are independent
    H3 reference rows rather than target-canvas keyframes. Motion Context
    keyframes are also left for Director's existing RGB re-pin callback.
    """
    if not isinstance(conditioning, (list, tuple)):
        return conditioning
    try:
        from ..patches import MC_KEY
    except Exception:  # tests / old ComfyUI install
        MC_KEY = "__motion_director_context__"

    out = []
    for entry in conditioning:
        if not isinstance(entry, (list, tuple)) or len(entry) < 2:
            out.append(entry)
            continue
        cond_tensor, metadata = entry[0], entry[1]
        if not isinstance(metadata, dict):
            out.append(entry)
            continue
        meta = dict(metadata)
        keyframes = []
        for keyframe in list(metadata.get("minimax_keyframes") or []):
            if not isinstance(keyframe, dict):
                keyframes.append(keyframe)
                continue
            updated = dict(keyframe)
            latent = keyframe.get("latent")
            if (
                keyframe.get(MC_KEY) is None
                and isinstance(latent, torch.Tensor)
                and latent.ndim in {4, 5}
                and tuple(latent.shape[-2:]) != (int(height) // 16, int(width) // 16)
            ):
                updated["latent"] = _resize_keyframe_latent(
                    latent, vae, int(width), int(height)
                )
            keyframes.append(updated)
        if "minimax_keyframes" in metadata:
            meta["minimax_keyframes"] = keyframes
        out.append([cond_tensor, meta])
    return out


__all__ = ["sync_h3_keyframe_conditioning"]
