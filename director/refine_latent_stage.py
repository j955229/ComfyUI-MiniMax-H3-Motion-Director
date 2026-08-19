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


def _is_source_bridge_anchor(metadata: dict[str, Any], keyframe: dict[str, Any], mc_key: str) -> bool:
    """Recognize the H3-native five-frame Source Bridge endpoint anchors.

    Source Bridge intentionally reuses ``motion_context_index`` so the guarded
    PackedLayout patch can address the interior/end coordinate, but unlike
    normal Motion Context it has exactly a five-frame generation canvas. Those
    endpoint latents must follow a learned-latent spatial upscale.
    """
    if int(metadata.get("minimax_frame_count") or 0) != 5:
        return False
    try:
        index = int(keyframe.get(mc_key))
    except (TypeError, ValueError):
        return False
    return index in {0, 4}


def sync_h3_keyframe_conditioning(conditioning: Any, vae, *, width: int, height: int):
    """Re-encode H3 target keyframe latents at the final spatial canvas.

    Reference-media blocks are intentionally left alone: they are independent
    H3 reference rows rather than target-canvas keyframes. Normal Motion Context
    keyframes are left for Director's existing RGB re-pin callback. The special
    five-frame Source Bridge endpoint anchors are re-encoded here because Source
    Bridge runs Global Refine without that Motion Context re-pin callback.
    """
    if not isinstance(conditioning, (list, tuple)):
        return conditioning
    try:
        from ..patches import MC_KEY
    except Exception:  # tests / alternate package loading
        MC_KEY = "motion_context_index"

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
            should_sync = (
                keyframe.get(MC_KEY) is None
                or _is_source_bridge_anchor(metadata, keyframe, MC_KEY)
            )
            if (
                should_sync
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