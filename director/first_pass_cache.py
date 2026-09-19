"""Persistent full H3 AV latents for postprocess-only Director reruns."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import torch

import comfy.nested_tensor
import folder_paths

from .cache_path import cache_root
from .context_identity import context_producer_fingerprint
from .segment_cache import _write_via_temp, segment_cache_fingerprint

log = logging.getLogger("ComfyUI-MiniMax-H3-Motion-Director.first_pass_cache")

FIRST_PASS_CACHE_VERSION = 1
FIRST_PASS_CACHE_FORMAT = "minimax_h3_motion_director_first_pass_av_v1"
GLOBAL_REFINE_CACHE_FORMAT = "minimax_h3_motion_director_global_refine_av_v1"
FIRST_PASS_PIPELINE = "first_pass_av_draft_v1"
_POSTPROCESS_SETTINGS = {"global_refine", "face_refine"}


def generation_cache_settings(settings: dict[str, Any]) -> dict[str, Any]:
    result = {
        str(key): value
        for key, value in dict(settings or {}).items()
        if str(key) not in _POSTPROCESS_SETTINGS
    }
    result["first_pass_pipeline"] = FIRST_PASS_PIPELINE
    return result


def first_pass_cache_fingerprint(seg, plan, settings: dict[str, Any]) -> dict[str, Any]:
    """Return the first-pass identity without Global/Face Refine settings."""
    generation_settings = generation_cache_settings(settings)
    fingerprint = segment_cache_fingerprint(seg, plan)
    fingerprint["context_dependency"] = context_producer_fingerprint(
        seg, plan, generation_settings
    )["producer_digest"]
    fingerprint["first_pass_pipeline"] = FIRST_PASS_PIPELINE
    return fingerprint


def _cache_root(node_id: str | None) -> Path | None:
    if not node_id:
        return None
    try:
        return cache_root(
            folder_paths.get_output_directory(),
            "minimax_first_pass_cache",
            node_id,
        )
    except OSError as exc:
        log.warning("First-pass AV latent cache directory unavailable: %s", exc)
        return None


def _cache_filename(slot: int) -> str:
    return "seg_%04d.first_pass.av.pt" % int(slot)


def _to_cpu_value(value: Any):
    if isinstance(value, torch.Tensor):
        return value.detach().cpu().contiguous()
    if bool(getattr(value, "is_nested", False)):
        unbind = getattr(value, "unbind", None)
        parts = unbind() if callable(unbind) else getattr(value, "tensors", None)
        if parts is None:
            raise TypeError("Nested latent value does not expose its tensors.")
        return tuple(_to_cpu_value(part) for part in parts)
    if isinstance(value, dict):
        return {str(key): _to_cpu_value(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return tuple(_to_cpu_value(item) for item in value)
    if isinstance(value, list):
        return [_to_cpu_value(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise TypeError(f"Unsupported first-pass latent cache value: {type(value)!r}")


def _nested_tensors(value: Any) -> tuple[torch.Tensor, ...] | None:
    if not isinstance(value, (tuple, list)) or not value:
        return None
    if not all(isinstance(item, torch.Tensor) for item in value):
        return None
    return tuple(value)


def _restore_av_latent(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    streams = _nested_tensors(value.get("samples"))
    if streams is None or len(streams) != 2:
        return None
    video, audio = streams
    if video.ndim not in {4, 5} or audio.ndim != 4:
        return None

    latent = dict(value)
    latent["samples"] = comfy.nested_tensor.NestedTensor(streams)
    mask_streams = _nested_tensors(latent.get("noise_mask"))
    if mask_streams is not None:
        if len(mask_streams) != 2:
            return None
        latent["noise_mask"] = comfy.nested_tensor.NestedTensor(mask_streams)
    return latent


def _save_latent_cache(
    node_id: str | None,
    seg,
    plan,
    *,
    latent: dict[str, Any],
    settings: dict[str, Any],
    cache_format: str,
    filename: str,
    stage_label: str,
    metadata: dict[str, Any] | None = None,
) -> bool:
    root = _cache_root(node_id)
    if root is None:
        return False
    slot = int(getattr(seg, "timeline_index", seg.index))
    try:
        cached_latent = _to_cpu_value(latent)
        streams = _nested_tensors(cached_latent.get("samples"))
        if streams is None or len(streams) != 2:
            raise ValueError("First-pass cache expected H3 video and audio latent streams.")
        payload = {
            "format": cache_format,
            "version": FIRST_PASS_CACHE_VERSION,
            "segment_index": slot,
            "fingerprint": first_pass_cache_fingerprint(seg, plan, settings),
            "latent": cached_latent,
        }
        if metadata:
            payload["metadata"] = _to_cpu_value(metadata)
        _write_via_temp(
            root / filename,
            lambda path: torch.save(payload, path),
        )
        return True
    except Exception as exc:
        log.warning(
            "%s AV latent cache write failed for segment %d: %s",
            stage_label,
            slot + 1,
            exc,
        )
        return False


def _load_latent_cache(
    node_id: str | None,
    seg,
    plan,
    *,
    settings: dict[str, Any],
    cache_format: str,
    filename: str,
    stage_label: str,
) -> dict[str, Any] | None:
    root = _cache_root(node_id)
    if root is None:
        return None
    slot = int(getattr(seg, "timeline_index", seg.index))
    path = root / filename
    if not path.is_file():
        return None
    try:
        payload = torch.load(path, map_location="cpu", weights_only=True)
        if not isinstance(payload, dict):
            return None
        if payload.get("format") != cache_format:
            return None
        if int(payload.get("version", -1)) != FIRST_PASS_CACHE_VERSION:
            return None
        if int(payload.get("segment_index", -1)) != slot:
            return None
        if payload.get("fingerprint") != first_pass_cache_fingerprint(seg, plan, settings):
            return None
        return _restore_av_latent(payload.get("latent"))
    except Exception as exc:
        log.warning(
            "%s AV latent cache read failed for segment %d: %s",
            stage_label,
            slot + 1,
            exc,
        )
        return None


def save_first_pass_cache(
    node_id: str | None,
    seg,
    plan,
    *,
    latent: dict[str, Any],
    settings: dict[str, Any],
) -> bool:
    slot = int(getattr(seg, "timeline_index", seg.index))
    return _save_latent_cache(
        node_id,
        seg,
        plan,
        latent=latent,
        settings=settings,
        cache_format=FIRST_PASS_CACHE_FORMAT,
        filename=_cache_filename(slot),
        stage_label="First-pass",
    )


def load_first_pass_cache(
    node_id: str | None,
    seg,
    plan,
    *,
    settings: dict[str, Any],
) -> dict[str, Any] | None:
    slot = int(getattr(seg, "timeline_index", seg.index))
    return _load_latent_cache(
        node_id,
        seg,
        plan,
        settings=settings,
        cache_format=FIRST_PASS_CACHE_FORMAT,
        filename=_cache_filename(slot),
        stage_label="First-pass",
    )


def _global_refine_cache_filename(slot: int) -> str:
    return "seg_%04d.global_refine.av.pt" % int(slot)


def save_global_refine_cache(
    node_id: str | None,
    seg,
    plan,
    *,
    latent: dict[str, Any],
    settings: dict[str, Any],
    refine_config: dict[str, Any],
) -> bool:
    slot = int(getattr(seg, "timeline_index", seg.index))
    return _save_latent_cache(
        node_id,
        seg,
        plan,
        latent=latent,
        settings=settings,
        cache_format=GLOBAL_REFINE_CACHE_FORMAT,
        filename=_global_refine_cache_filename(slot),
        stage_label="Global Refine",
        metadata={"global_refine": refine_config},
    )


def load_global_refine_cache(
    node_id: str | None,
    seg,
    plan,
    *,
    settings: dict[str, Any],
) -> dict[str, Any] | None:
    slot = int(getattr(seg, "timeline_index", seg.index))
    return _load_latent_cache(
        node_id,
        seg,
        plan,
        settings=settings,
        cache_format=GLOBAL_REFINE_CACHE_FORMAT,
        filename=_global_refine_cache_filename(slot),
        stage_label="Global Refine",
    )


__all__ = [
    "FIRST_PASS_CACHE_FORMAT",
    "FIRST_PASS_CACHE_VERSION",
    "FIRST_PASS_PIPELINE",
    "GLOBAL_REFINE_CACHE_FORMAT",
    "first_pass_cache_fingerprint",
    "generation_cache_settings",
    "load_first_pass_cache",
    "load_global_refine_cache",
    "save_first_pass_cache",
    "save_global_refine_cache",
]
