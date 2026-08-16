"""Versioned exported Motion Context cache for selection runs."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch

import folder_paths

from ..lib.tensor_fingerprint import tensor_fingerprint
from .audio_trim import audio_has_samples
from .cache_path import cache_root
from .context_identity import context_producer_fingerprint
from .segment_cache import _write_via_temp

log = logging.getLogger("ComfyUI-MiniMax-H3-Motion-Director.context_cache")

CACHE_VERSION = 3
CACHE_FORMAT = "minimax_h3_motion_director_exported_context_tail_v3"
MAX_PERSISTED_CONTEXT_FRAMES = 39


class MotionContextCacheError(RuntimeError):
    pass


@dataclass(frozen=True)
class CachedMotionContext:
    frames: torch.Tensor | None
    audio: dict[str, Any] | None
    metadata: dict[str, Any]
    latent: dict[str, Any] | None = None
    handoff: dict[str, Any] | None = None


def context_fingerprint(seg, plan, settings: dict[str, Any]) -> dict[str, Any]:
    try:
        return context_producer_fingerprint(seg, plan, settings)
    except Exception as exc:
        if isinstance(exc, MotionContextCacheError):
            raise
        raise MotionContextCacheError(str(exc)) from exc


def _cache_root(node_id: str | None) -> Path:
    if not node_id:
        raise MotionContextCacheError(
            "Motion Director: the node has no unique_id, so Motion Context cache "
            "cannot be used for selection runs."
        )
    return cache_root(
        folder_paths.get_output_directory(),
        "minimax_motion_context_cache",
        node_id,
    )


def save_motion_context_cache(
    node_id: str | None,
    seg,
    plan,
    *,
    frames: torch.Tensor,
    audio: dict[str, Any] | None,
    settings: dict[str, Any],
) -> bool:
    """Persist only the final, reusable exported RGB/audio endpoint tail."""
    try:
        if not isinstance(frames, torch.Tensor) or frames.ndim != 4:
            raise ValueError("exported frames must be an NHWC tensor")
        original_export_frames = int(frames.shape[0])
        if original_export_frames <= 0:
            raise ValueError("exported frames are empty")
        stored_tail_frames = min(MAX_PERSISTED_CONTEXT_FRAMES, original_export_frames)
        frames_tail = frames[-stored_tail_frames:].detach().cpu().float().contiguous()
        root = _cache_root(node_id)
        slot = int(getattr(seg, "timeline_index", seg.index))
        dest = root / ("seg_%04d.pt" % slot)
        metadata = {
            "fps": float(plan.frame_rate),
            "stored_tail_frames": stored_tail_frames,
            "original_export_frames": original_export_frames,
            "width": int(frames_tail.shape[2]),
            "height": int(frames_tail.shape[1]),
            "segment_index": slot,
            "fingerprint": context_fingerprint(seg, plan, settings),
        }
        payload: dict[str, Any] = {
            "format": CACHE_FORMAT,
            "version": CACHE_VERSION,
            "metadata": metadata,
            "frames": frames_tail,
        }
        if audio_has_samples(audio):
            sample_rate = int(audio["sample_rate"])
            waveform = audio["waveform"]
            wanted_samples = max(
                1,
                int(round(stored_tail_frames / float(plan.frame_rate) * sample_rate)),
            )
            stored_audio_samples = min(int(waveform.shape[-1]), wanted_samples)
            if stored_audio_samples > 0:
                payload["audio_waveform"] = (
                    waveform[..., -stored_audio_samples:].detach().cpu().contiguous()
                )
                payload["audio_sample_rate"] = sample_rate
                metadata["stored_audio_samples"] = stored_audio_samples
        _write_via_temp(dest, lambda path: torch.save(payload, path))
        return True
    except Exception as exc:
        log.warning(
            "Motion Context cache write failed for segment %d: %s",
            int(getattr(seg, "timeline_index", seg.index)) + 1,
            exc,
        )
        return False


def _cache_error(seg_index: int, detail: str) -> MotionContextCacheError:
    return MotionContextCacheError(
        "Segment %d requires a valid generated result from Segment %d for "
        "Motion Context. Generate the previous segment first or run the complete "
        "sequence. Cache detail: %s"
        % (seg_index + 2, seg_index + 1, detail)
    )


def load_motion_context_cache(
    node_id: str | None,
    seg,
    plan,
    *,
    settings: dict[str, Any],
    strict: bool = False,
) -> CachedMotionContext | None:
    """Load a previous segment's exported endpoint and reject every stale field."""
    try:
        root = _cache_root(node_id)
        slot = int(getattr(seg, "timeline_index", seg.index))
        path = root / ("seg_%04d.pt" % slot)
        if not path.is_file():
            raise _cache_error(slot, "cache file is missing")
        payload = torch.load(path, map_location="cpu", weights_only=True)
        if not isinstance(payload, dict):
            raise _cache_error(slot, "cache payload is not a dictionary")
        if payload.get("format") != CACHE_FORMAT or int(payload.get("version", -1)) != CACHE_VERSION:
            raise _cache_error(slot, "cache version/format is unsupported")
        metadata = payload.get("metadata")
        if not isinstance(metadata, dict):
            raise _cache_error(slot, "metadata is missing")
        expected = context_fingerprint(seg, plan, settings)
        if metadata.get("fingerprint") != expected:
            raise _cache_error(slot, "timeline or generation settings changed")
        frames = payload.get("frames")
        if not isinstance(frames, torch.Tensor) or frames.ndim != 4 or int(frames.shape[0]) <= 0:
            raise _cache_error(slot, "exported frame tensor is corrupt")
        checks = {
            "stored_tail_frames": int(frames.shape[0]),
            "width": int(frames.shape[2]),
            "height": int(frames.shape[1]),
            "segment_index": slot,
        }
        for key, value in checks.items():
            if int(metadata.get(key, -1)) != value:
                raise _cache_error(slot, "%s does not match cached data" % key)
        stored_tail_frames = int(metadata.get("stored_tail_frames", -1))
        original_export_frames = int(metadata.get("original_export_frames", -1))
        if not (1 <= stored_tail_frames <= MAX_PERSISTED_CONTEXT_FRAMES):
            raise _cache_error(slot, "stored tail length is outside the supported range")
        if original_export_frames < stored_tail_frames:
            raise _cache_error(slot, "original export length is inconsistent")
        if abs(float(metadata.get("fps", 0.0)) - float(plan.frame_rate)) > 1e-9:
            raise _cache_error(slot, "FPS changed")
        audio = None
        wave = payload.get("audio_waveform")
        if isinstance(wave, torch.Tensor) and wave.numel() > 0:
            sr = int(payload.get("audio_sample_rate") or 0)
            if wave.ndim != 3 or sr <= 0:
                raise _cache_error(slot, "cached audio is corrupt")
            if int(metadata.get("stored_audio_samples", -1)) != int(wave.shape[-1]):
                raise _cache_error(slot, "stored audio length does not match cached data")
            audio = {"waveform": wave, "sample_rate": sr}
        return CachedMotionContext(frames=frames.float(), audio=audio, metadata=metadata)
    except MotionContextCacheError:
        if strict:
            raise
        return None
    except Exception as exc:
        if strict:
            slot = int(getattr(seg, "timeline_index", seg.index))
            raise _cache_error(slot, "cache read failed: %s" % exc) from exc
        log.warning("Motion Context cache read failed: %s", exc)
        return None


__all__ = [
    "CACHE_VERSION",
    "MAX_PERSISTED_CONTEXT_FRAMES",
    "CachedMotionContext",
    "MotionContextCacheError",
    "context_fingerprint",
    "load_motion_context_cache",
    "save_motion_context_cache",
    "tensor_fingerprint",
]
