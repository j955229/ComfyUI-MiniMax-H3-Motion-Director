"""High-resolution conditioning synchronization for H3 refine passes."""

from __future__ import annotations

from typing import Any

import torch
import torch.nn.functional as F


_FRAME_PER_TOKEN = (1, 4, 4, 4, 4)


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


def _motion_context_prefix_count(
    metadata: dict[str, Any],
    keyframes: list[Any],
    mc_key: str,
) -> int:
    """Count only Director's leading Motion Context keyframes.

    Normal Motion Context keyframes are prepended in the H3 temporal token
    sequence 0, 1, 5, 9, ... . Relocated native H3 keyframes can also carry the
    same marker key later in the list, so marker presence alone is insufficient.
    Five-frame Source Bridge anchors deliberately use the marker too and are not
    a Motion Context prefix.
    """
    if keyframes and int(metadata.get("minimax_frame_count") or 0) == 5:
        if all(
            isinstance(keyframe, dict)
            and _is_source_bridge_anchor(metadata, keyframe, mc_key)
            for keyframe in keyframes
        ):
            return 0

    count = 0
    expected = 0
    for keyframe in keyframes:
        if not isinstance(keyframe, dict) or keyframe.get(mc_key) is None:
            break
        try:
            marker = int(keyframe.get(mc_key))
        except (TypeError, ValueError):
            break
        if marker != expected:
            break
        expected += _FRAME_PER_TOKEN[count % len(_FRAME_PER_TOKEN)]
        count += 1
    return count


def _strip_motion_context_for_repin(conditioning: Any):
    """Return the native H3 conditioning state needed by refine repin.

    The first sampling pass already contains Motion Context. Global Refine then
    changes the video latent canvas and the executor's existing repin callback
    must add Motion Context again at that canvas. Feeding the already-merged
    conditioning back into ``apply_exported_motion_context`` is invalid and was
    the cause of multi-segment upscale falling back to the low-resolution first
    pass.

    Remove only the leading visual Motion Context keyframes and their generated
    Motion Audio reference. Relocated native H3 keyframes are retained, have
    their marker restored to ``resolved_frame_index``, and are synchronized by
    the normal keyframe resize path below. Audio-only context is left untouched
    because its executor repin callback is intentionally a no-op.
    """
    if not isinstance(conditioning, (list, tuple)):
        return conditioning
    try:
        from ..patches import MC_AUDIO_KEY, MC_KEY
    except Exception:  # tests / alternate package loading
        MC_KEY = "motion_context_index"
        MC_AUDIO_KEY = "motion_audio_context_index"

    out = []
    for entry in conditioning:
        if not isinstance(entry, (list, tuple)) or len(entry) < 2:
            out.append(entry)
            continue
        metadata = entry[1]
        if not isinstance(metadata, dict):
            out.append(entry)
            continue

        keyframes = list(metadata.get("minimax_keyframes") or [])
        prefix_count = _motion_context_prefix_count(metadata, keyframes, MC_KEY)
        if prefix_count <= 0:
            out.append(entry)
            continue

        meta = dict(metadata)
        native_keyframes = []
        for keyframe in keyframes[prefix_count:]:
            if not isinstance(keyframe, dict):
                native_keyframes.append(keyframe)
                continue
            restored = dict(keyframe)
            marker = restored.pop(MC_KEY, None)
            if marker is not None:
                restored["resolved_frame_index"] = int(marker)
            native_keyframes.append(restored)
        meta["minimax_keyframes"] = native_keyframes

        if "minimax_refs" in metadata:
            meta["minimax_refs"] = [
                ref
                for ref in list(metadata.get("minimax_refs") or [])
                if not (
                    isinstance(ref, dict)
                    and ref.get(MC_AUDIO_KEY) is not None
                )
            ]

        new_entry = list(entry)
        new_entry[1] = meta
        out.append(new_entry)
    return out


def sync_h3_keyframe_conditioning(conditioning: Any, vae, *, width: int, height: int):
    """Prepare H3 conditioning for refined-canvas sampling.

    Normal Motion Context from the first pass is removed here because the
    executor immediately reapplies it through the existing RGB repin callback.
    Remaining native H3 keyframes are then re-encoded at the final canvas.
    Reference-media blocks remain untouched. Five-frame Source Bridge endpoint
    anchors are not normal Motion Context and are re-encoded in place because
    Source Bridge does not use that repin callback.
    """
    conditioning = _strip_motion_context_for_repin(conditioning)
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
        new_entry = list(entry)
        new_entry[1] = meta
        out.append(new_entry)
    return out


__all__ = ["sync_h3_keyframe_conditioning"]
