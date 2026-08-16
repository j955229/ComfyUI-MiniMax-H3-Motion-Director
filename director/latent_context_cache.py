"""Versioned AV-latent Motion Context handoff cache."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch

import folder_paths

from .cache_path import cache_root
from .context_cache import context_fingerprint
from .segment_cache import _write_via_temp

log = logging.getLogger("ComfyUI-MiniMax-H3-Motion-Director.latent_context_cache")

LATENT_CACHE_VERSION = 6
LATENT_CACHE_FORMAT = "minimax_h3_motion_director_av_latent_tail_v6"
LATENT_HANDOFF_PIPELINE = "motion_context_latent_tail_v6_color_chain_pin_composed"
MAX_PERSISTED_CONTEXT_FRAMES = 39


@dataclass(frozen=True)
class CachedLatentContext:
    latent: dict[str, Any]
    handoff: dict[str, Any]
    metadata: dict[str, Any]


def _cache_root(node_id: str | None) -> Path | None:
    if not node_id:
        return None
    try:
        return cache_root(
            folder_paths.get_output_directory(),
            "minimax_motion_context_cache",
            node_id,
        )
    except OSError as exc:
        log.warning("AV latent cache directory unavailable: %s", exc)
        return None


def av_latent_to_cpu(latent: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(latent, dict) or "samples" not in latent:
        raise ValueError("Motion Director: sampled AV latent is missing 'samples'.")
    samples = latent["samples"]
    if hasattr(samples, "unbind"):
        parts = tuple(part.detach().cpu().contiguous() for part in samples.unbind())
    elif isinstance(samples, (tuple, list)):
        parts = tuple(
            part.detach().cpu().contiguous() if isinstance(part, torch.Tensor) else part
            for part in samples
        )
    elif isinstance(samples, torch.Tensor):
        parts = samples.detach().cpu().contiguous()
    else:
        raise ValueError("Motion Director: unsupported AV latent samples container.")
    out: dict[str, Any] = {"samples": parts}
    for key, value in latent.items():
        if key == "samples":
            continue
        out[key] = value.detach().cpu().contiguous() if isinstance(value, torch.Tensor) else value
    return out


def _sample_streams(latent: dict[str, Any]) -> list[Any]:
    samples = latent.get("samples") if isinstance(latent, dict) else None
    if hasattr(samples, "unbind"):
        return list(samples.unbind())
    if isinstance(samples, (tuple, list)):
        return list(samples)
    if isinstance(samples, torch.Tensor):
        return [samples]
    return []


def prepare_latent_context_tail(
    latent: dict[str, Any],
    handoff: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Keep only the largest reusable H3 AV-latent endpoint window.

    The returned handoff uses a local 0..span timeline.  Original coordinates
    remain diagnostic metadata and are never needed to consume the tail.
    """
    required = {"context_end_frame", "trim_frames", "export_frames", "sample_frames"}
    if not isinstance(handoff, dict) or not required.issubset(handoff):
        raise ValueError("AV latent handoff metadata is incomplete.")

    from .motion_context import (
        _audio_context_from_latent,
        select_context_span,
        video_context_from_latent,
    )

    original = {
        key: int(handoff.get("original_" + key, handoff[key]))
        for key in required
    }
    stored_tail_frames = select_context_span(
        MAX_PERSISTED_CONTEXT_FRAMES,
        int(handoff["export_frames"]),
    )
    blocks, _offsets, selected_end = video_context_from_latent(
        latent,
        span=stored_tail_frames,
        context_end_frame=int(handoff["context_end_frame"]),
    )
    video_tail = torch.cat(blocks, dim=2).detach().cpu().contiguous()
    streams: list[torch.Tensor] = [video_tail]
    if len(_sample_streams(latent)) >= 2:
        audio_ref, _audio_steps = _audio_context_from_latent(
            latent,
            span=stored_tail_frames,
            context_end_frame=selected_end,
        )
        streams.append(audio_ref["audio_latent"].detach().cpu().contiguous())

    tail_latent: dict[str, Any] = {"samples": tuple(streams)}
    for key, value in latent.items():
        if key != "samples" and not isinstance(value, torch.Tensor):
            tail_latent[key] = value

    tail_handoff = {
        "context_end_frame": stored_tail_frames,
        "trim_frames": 0,
        "export_frames": stored_tail_frames,
        "sample_frames": stored_tail_frames,
        "stored_tail_frames": stored_tail_frames,
        "original_context_end_frame": original["context_end_frame"],
        "original_trim_frames": original["trim_frames"],
        "original_export_frames": original["export_frames"],
        "original_sample_frames": original["sample_frames"],
        "selected_source_end_frame": int(
            handoff.get("selected_source_end_frame", selected_end)
        ),
    }
    baseline = handoff.get("pin_renorm_baseline_std")
    if baseline is not None:
        tail_handoff["pin_renorm_baseline_std"] = float(baseline)
    from .color_reanchor import validate_color_anchor_statistics

    color_anchor = validate_color_anchor_statistics(handoff.get("color_anchor_stats"))
    if color_anchor is not None:
        tail_handoff["color_anchor_stats"] = color_anchor
    return tail_latent, tail_handoff


def _settings(settings: dict[str, Any]) -> dict[str, Any]:
    return {**dict(settings or {}), "latent_handoff_pipeline": LATENT_HANDOFF_PIPELINE}


def save_latent_context_cache(
    node_id: str | None,
    seg,
    plan,
    *,
    latent: dict[str, Any],
    handoff: dict[str, Any],
    settings: dict[str, Any],
) -> bool:
    root = _cache_root(node_id)
    if root is None:
        return False
    try:
        slot = int(getattr(seg, "timeline_index", seg.index))
        tail_latent, tail_handoff = prepare_latent_context_tail(latent, handoff)
        metadata = {
            "pipeline": LATENT_HANDOFF_PIPELINE,
            "segment_index": slot,
            "fps": float(plan.frame_rate),
            "stored_tail_frames": int(tail_handoff["stored_tail_frames"]),
            "original_export_frames": int(tail_handoff["original_export_frames"]),
            "fingerprint": context_fingerprint(seg, plan, _settings(settings)),
        }
        payload = {
            "format": LATENT_CACHE_FORMAT,
            "version": LATENT_CACHE_VERSION,
            "metadata": metadata,
            "handoff": tail_handoff,
            "latent": tail_latent,
        }
        destination = root / ("seg_%04d.av.pt" % slot)
        _write_via_temp(destination, lambda path: torch.save(payload, path))
        return True
    except Exception as exc:
        log.warning(
            "Motion Context AV latent cache write failed for segment %d: %s",
            int(getattr(seg, "timeline_index", seg.index)) + 1,
            exc,
        )
        return False


def load_latent_context_cache(
    node_id: str | None,
    seg,
    plan,
    *,
    settings: dict[str, Any],
) -> CachedLatentContext | None:
    root = _cache_root(node_id)
    if root is None:
        return None
    try:
        slot = int(getattr(seg, "timeline_index", seg.index))
        path = root / ("seg_%04d.av.pt" % slot)
        if not path.is_file():
            return None
        payload = torch.load(path, map_location="cpu", weights_only=True)
        if not isinstance(payload, dict):
            return None
        if payload.get("format") != LATENT_CACHE_FORMAT:
            return None
        if int(payload.get("version", -1)) != LATENT_CACHE_VERSION:
            return None
        metadata = payload.get("metadata")
        handoff = payload.get("handoff")
        latent = payload.get("latent")
        if not isinstance(metadata, dict) or not isinstance(handoff, dict):
            return None
        if metadata.get("pipeline") != LATENT_HANDOFF_PIPELINE:
            return None
        if metadata.get("fingerprint") != context_fingerprint(seg, plan, _settings(settings)):
            return None
        if int(metadata.get("segment_index", -1)) != slot:
            return None
        if abs(float(metadata.get("fps", 0.0)) - float(plan.frame_rate)) > 1e-9:
            return None
        if not isinstance(latent, dict) or "samples" not in latent:
            return None
        required = {
            "context_end_frame",
            "trim_frames",
            "export_frames",
            "sample_frames",
            "stored_tail_frames",
            "original_context_end_frame",
            "original_trim_frames",
            "original_export_frames",
            "original_sample_frames",
            "selected_source_end_frame",
        }
        if not required.issubset(handoff):
            return None
        clean_handoff = {key: int(handoff[key]) for key in required}
        if handoff.get("pin_renorm_baseline_std") is not None:
            baseline = float(handoff["pin_renorm_baseline_std"])
            if not torch.isfinite(torch.tensor(baseline)) or baseline <= 0:
                return None
            clean_handoff["pin_renorm_baseline_std"] = baseline
        from .color_reanchor import validate_color_anchor_statistics

        if handoff.get("color_anchor_stats") is not None:
            color_anchor = validate_color_anchor_statistics(handoff["color_anchor_stats"])
            if color_anchor is None:
                return None
            clean_handoff["color_anchor_stats"] = color_anchor
        stored = clean_handoff["stored_tail_frames"]
        if stored not in {1, 5, 22, 39}:
            return None
        if not (
            clean_handoff["context_end_frame"] == stored
            and clean_handoff["export_frames"] == stored
            and clean_handoff["sample_frames"] == stored
            and clean_handoff["trim_frames"] == 0
            and clean_handoff["original_export_frames"] >= stored
            and int(metadata.get("stored_tail_frames", -1)) == stored
            and int(metadata.get("original_export_frames", -1))
            == clean_handoff["original_export_frames"]
        ):
            return None
        # Reject structurally valid metadata wrapped around an incomplete tail.
        from .motion_context import video_context_from_latent

        video_context_from_latent(
            latent,
            span=stored,
            context_end_frame=clean_handoff["context_end_frame"],
        )
        return CachedLatentContext(
            latent=latent,
            handoff=clean_handoff,
            metadata=metadata,
        )
    except Exception as exc:
        log.warning("Motion Context AV latent cache read failed: %s", exc)
        return None


__all__ = [
    "CachedLatentContext",
    "LATENT_CACHE_FORMAT",
    "LATENT_CACHE_VERSION",
    "LATENT_HANDOFF_PIPELINE",
    "MAX_PERSISTED_CONTEXT_FRAMES",
    "av_latent_to_cpu",
    "load_latent_context_cache",
    "prepare_latent_context_tail",
    "save_latent_context_cache",
]
