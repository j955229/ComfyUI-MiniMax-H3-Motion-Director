"""Segment-scoped producer identity for persistent Motion Context tails."""

from __future__ import annotations

import hashlib
import json
from typing import Any

import torch

from ..lib.tensor_fingerprint import tensor_fingerprint
from .context_links import context_link_identity, resolve_context_link
from .source_bridge import source_bridge_enabled


PRODUCER_IDENTITY_SCHEMA = "previous_context_segment_dependencies_v2"
_CONSUMER_ONLY_SETTINGS = {
    "context_length",
    "latent_handoff_pipeline",
}


def _sha_json(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _json_identity(value: Any, depth: int = 0):
    if depth > 8:
        return {"type": f"{type(value).__module__}.{type(value).__qualname__}"}
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, torch.Tensor):
        return tensor_fingerprint(value)
    if isinstance(value, dict):
        return {
            str(key): _json_identity(item, depth + 1)
            for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
        }
    if isinstance(value, (list, tuple)):
        return [_json_identity(item, depth + 1) for item in value]
    return {"type": f"{type(value).__module__}.{type(value).__qualname__}"}


def _audio_identity(item) -> dict[str, Any]:
    audio = getattr(item, "audio", None)
    wave = audio.get("waveform") if isinstance(audio, dict) else None
    return {
        "index": int(getattr(item, "index", -1)),
        "asset_id": str(getattr(item, "asset_id", "") or ""),
        "file": str(getattr(item, "audio_file", "") or ""),
        "sample_rate": int(audio.get("sample_rate") or 0) if isinstance(audio, dict) else 0,
        "waveform": tensor_fingerprint(wave),
    }


def _image_identity(item) -> dict[str, Any]:
    return {
        "index": int(getattr(item, "index", -1)),
        "asset_id": str(getattr(item, "asset_id", "") or ""),
        "tensor": tensor_fingerprint(getattr(item, "tensor", None)),
    }


def _video_identity(item) -> dict[str, Any]:
    return {
        "index": int(getattr(item, "index", -1)),
        "asset_id": str(getattr(item, "asset_id", "") or ""),
        "file": str(getattr(item, "video_file", "") or ""),
        "meta": _json_identity(dict(getattr(item, "meta", None) or {})),
        "tensor": tensor_fingerprint(getattr(item, "tensor", None)),
    }


def _overlapping_source_clips(seg, plan) -> list[dict[str, Any]]:
    raw = getattr(plan, "raw", None) or {}
    start = int(seg.start_frame)
    end = int(seg.end_frame)
    result = []
    for clip in raw.get("videoClips") or raw.get("video_clips") or []:
        clip_start = int(clip.get("logicalStart", clip.get("startFrame", clip.get("start_frame", 0))) or 0)
        clip_end = int(clip.get("logicalEnd", clip.get("endFrame", clip.get("end_frame", 0))) or 0)
        if clip_end > clip_start and (clip_end <= start or clip_start >= end):
            continue
        result.append(
            {
                "file": clip.get("videoFile") or clip.get("fileName") or "",
                "subfolder": clip.get("subfolder") or "",
                "type": clip.get("type") or "",
                "logical_start": clip_start,
                "logical_end": clip_end,
                "source_start": int(clip.get("sourceStartFrame", clip.get("source_start_frame", 0)) or 0),
            }
        )
    return result


def _timeline_source_identity(seg, plan) -> dict[str, Any]:
    raw = getattr(plan, "raw", None) or {}
    source = raw.get("video") or {}
    frame_map = source.get("frameMap") or source.get("frame_map") or []
    if isinstance(frame_map, (list, tuple)):
        frame_map = frame_map[max(0, int(seg.start_frame)):max(0, int(seg.end_frame))]
    return {
        "file": source.get("videoFile") or source.get("fileName") or "",
        "subfolder": source.get("subfolder") or "",
        "type": source.get("type") or "",
        "frame_map": _json_identity(frame_map),
        "clips": _overlapping_source_clips(seg, plan),
    }


def segment_identity(seg, plan) -> dict[str, Any]:
    tags = getattr(seg, "reference_tags", None) or {}
    return {
        "index": int(getattr(seg, "timeline_index", seg.index)),
        "start": int(seg.start_frame),
        "end": int(seg.end_frame),
        "prompt": str(seg.prompt),
        "negative": str(getattr(seg, "negative_prompt", "")),
        "task": str(seg.task_key),
        "task_type": str(getattr(seg, "task_type", "")),
        "use_global": bool(getattr(seg, "use_global", False)),
        "reference_video": _json_identity(dict(getattr(seg, "reference_video_meta", None) or {})),
        "reference_video_start": int(getattr(seg, "reference_video_start_frame", 0)),
        "source_clip": tensor_fingerprint(getattr(seg, "source_clip", None)),
        "timeline_source": _timeline_source_identity(seg, plan),
        "refs": [_image_identity(item) for item in getattr(seg, "refs", None) or []],
        "audios": [_audio_identity(item) for item in getattr(seg, "ref_audios", None) or []],
        "videos": [_video_identity(item) for item in getattr(seg, "ref_videos", None) or []],
        "video_audios": [_audio_identity(item) for item in getattr(seg, "ref_video_audios", None) or []],
        "reference_tags": [
            [str(kind), str(asset_id), str(tag)]
            for (kind, asset_id), tag in sorted(tags.items())
        ],
        "context_link": context_link_identity(seg),
    }


def generation_environment_identity(plan, settings: dict[str, Any]) -> dict[str, Any]:
    producer_settings = {
        str(key): _json_identity(value)
        for key, value in sorted(dict(settings or {}).items())
        if str(key) not in _CONSUMER_ONLY_SETTINGS
    }
    return {
        "fps": float(getattr(plan, "frame_rate", 0.0)),
        "width": int(getattr(plan, "width", 0)),
        "height": int(getattr(plan, "height", 0)),
        "ref_max_size": int(getattr(plan, "ref_max_size", 0)),
        "output_mode": str(getattr(plan, "output_mode", "")),
        "edit_mode": str(getattr(plan, "edit_mode", "")),
        "spatial_stride": int(getattr(plan, "spatial_stride", 32)),
        "source_width": int(getattr(plan, "source_width", 0)),
        "source_height": int(getattr(plan, "source_height", 0)),
        "settings": producer_settings,
    }


def _uses_incoming_context(seg, plan, settings: dict[str, Any]) -> bool:
    source_bridge_frames = int(
        (settings or {}).get(
            "source_overlap_frames", getattr(plan, "source_overlap_frames", 0)
        )
        or 0
    )
    link = resolve_context_link(
        seg,
        motion_context_enabled=bool((settings or {}).get("motion_context_enabled", False)),
        audio_context_enabled=bool((settings or {}).get("audio_context_enabled", False)),
        audio_generate=str((settings or {}).get("audio_mode", "generate")) == "generate",
        source_bridge_active=source_bridge_enabled(str(seg.task_key), source_bridge_frames),
    )
    return link.has_dependency


def context_producer_fingerprint(seg, plan, settings: dict[str, Any]) -> dict[str, Any]:
    segments_by_slot = {
        int(getattr(item, "timeline_index", item.index)): item
        for item in getattr(plan, "segments", None) or []
    }
    environment = generation_environment_identity(plan, settings)
    environment_digest = _sha_json(environment)
    memo: dict[int, str] = {}

    def digest(item) -> str:
        slot = int(getattr(item, "timeline_index", item.index))
        if slot in memo:
            return memo[slot]
        upstream_digest = None
        uses_incoming = _uses_incoming_context(item, plan, settings)
        if uses_incoming:
            previous = segments_by_slot.get(slot - 1)
            upstream_digest = digest(previous) if previous is not None else f"missing:{slot - 1}"
        value = {
            "schema": PRODUCER_IDENTITY_SCHEMA,
            "segment": segment_identity(item, plan),
            "generation_environment_digest": environment_digest,
            # context_length changes the consumer generation, not the cached
            # producer it reads. Include it only for segments that actually
            # consumed an incoming link, so S1 remains reusable when S2's
            # requested span changes while S2/S3 outputs still invalidate.
            "incoming_context_length": (
                int((settings or {}).get("context_length", 0) or 0)
                if uses_incoming
                else None
            ),
            "previous_context_producer_digest": upstream_digest,
        }
        memo[slot] = _sha_json(value)
        return memo[slot]

    slot = int(getattr(seg, "timeline_index", seg.index))
    if segments_by_slot.get(slot) is not seg and slot not in segments_by_slot:
        raise ValueError(f"Motion Director segment {slot + 1} is missing from the current plan.")
    own_identity = segment_identity(seg, plan)
    previous_digest = None
    if _uses_incoming_context(seg, plan, settings):
        previous = segments_by_slot.get(slot - 1)
        previous_digest = digest(previous) if previous is not None else f"missing:{slot - 1}"
    return {
        "producer_identity_schema": PRODUCER_IDENTITY_SCHEMA,
        "segment_index": slot,
        "segment_identity": _sha_json(own_identity),
        "generation_identity": environment_digest,
        "previous_context_producer_digest": previous_digest,
        "producer_digest": digest(seg),
    }


__all__ = [
    "PRODUCER_IDENTITY_SCHEMA",
    "context_producer_fingerprint",
    "generation_environment_identity",
    "segment_identity",
]
