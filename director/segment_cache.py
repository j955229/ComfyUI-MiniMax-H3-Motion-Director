# Portions derived from ComfyUI_MiniMaxH3_Director
# Copyright AIMixer and contributors
# Originally licensed under Apache License 2.0
# Modified for MiniMax H3 Motion Director, 2026-08-09
# This derivative project is distributed under GPL-3.0.
# See NOTICE and LICENSES/Apache-2.0-AIMixer.txt.

"""Disk cache for MiniMax H3 Motion Director segment decode outputs (partial re-run + merge).

Cache is best-effort: write failures (cloud RO mounts, same-name overwrite
blocks, full disks) must never abort the main generation run.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from pathlib import Path
from typing import Any, Callable

import torch

import folder_paths

from ..lib.image_prep import H3_SPATIAL_PIPELINE
from ..lib.tensor_fingerprint import tensor_fingerprint
from .frame_align import H3_REFERENCE_VIDEO_PIPELINE, H3_SOURCE_BRIDGE_PIPELINE
from .color_reanchor import COLOR_REANCHOR_PIPELINE
from .context_identity import context_producer_fingerprint
from .context_links import context_link_identity
from .plan import DirectorPlan, SegmentPlan

log = logging.getLogger("ComfyUI-MiniMax-H3-Motion-Director.director.cache")


def _cache_root(node_id: str) -> Path | None:
    try:
        root = Path(folder_paths.get_output_directory()) / "minimax_seg_cache" / str(node_id)
        root.mkdir(parents=True, exist_ok=True)
        return root
    except OSError as exc:
        log.warning("Segment cache dir unavailable (%s); cache disabled for this run.", exc)
        return None


def segment_cache_fingerprint(seg: SegmentPlan, plan: DirectorPlan) -> dict[str, Any]:
    """Stable identity for a segment; cache invalidates when edit params change."""
    ref_files = sorted(f"img{ref.index}" for ref in seg.refs)
    ref_audio_files = sorted(
        f"aud{getattr(a, 'index', i)}:{(getattr(a, 'audio_file', '') or '')}"
        for i, a in enumerate(getattr(seg, "ref_audios", None) or [])
    )
    ref_video_files = sorted(
        f"vid{getattr(v, 'index', i)}:{(getattr(v, 'video_file', '') or '')}"
        for i, v in enumerate(getattr(seg, "ref_videos", None) or [])
    )
    ref_video_file = (
        seg.reference_video_meta.get("videoFile")
        or seg.reference_video_meta.get("fileName")
        or ""
    ).strip()
    fingerprint = {
        "index": seg.index,
        "start": seg.start_frame,
        "end": seg.end_frame,
        "prompt": seg.prompt,
        "negative": seg.negative_prompt,
        "task_key": seg.task_key,
        "width": plan.width,
        "height": plan.height,
        "output_mode": plan.output_mode,
        "ref_max": plan.ref_max_size,
        "refs": ref_files,
        "source_clip": tensor_fingerprint(getattr(seg, "source_clip", None)),
        "ref_image_tensors": [
            {
                "index": int(getattr(ref, "index", -1)),
                "tensor": tensor_fingerprint(getattr(ref, "tensor", None)),
            }
            for ref in getattr(seg, "refs", None) or []
        ],
        "ref_audios": ref_audio_files,
        "ref_videos": ref_video_files,
        "ref_video": ref_video_file,
        "ref_video_start": seg.reference_video_start_frame,
        "continuity": plan.continuity_enabled,
        "continuity_overlap": plan.continuity_overlap_frames if plan.continuity_enabled else 0,
        # Bump when continuity sampling/handoff semantics change (invalidates stale segs).
        "continuity_pipeline": "minimax_h3_lastframe_v1",
        "color_reanchor_enabled": bool(getattr(plan, "color_reanchor_enabled", False)),
        "color_reanchor_pipeline": COLOR_REANCHOR_PIPELINE,
        "spatial_stride": int(getattr(plan, "spatial_stride", 32)),
        "spatial_pipeline": H3_SPATIAL_PIPELINE,
        "context_link": context_link_identity(seg),
    }
    if seg.task_key in {"v2v", "rv2v"}:
        fingerprint["reference_video_pipeline"] = H3_REFERENCE_VIDEO_PIPELINE
        fingerprint["source_bridge_pipeline"] = H3_SOURCE_BRIDGE_PIPELINE
        fingerprint["source_overlap_frames"] = max(
            0, int(getattr(plan, "source_overlap_frames", 0))
        )
    cache_settings = getattr(plan, "cache_settings", None)
    if isinstance(cache_settings, dict):
        fingerprint["context_dependency"] = context_producer_fingerprint(
            seg, plan, cache_settings
        )["producer_digest"]
    return fingerprint


def _safe_unlink(path: Path) -> bool:
    try:
        if path.is_file() or path.is_symlink():
            path.unlink()
        return True
    except OSError:
        return False


def _atomic_publish(tmp: Path, dest: Path) -> None:
    """Move ``tmp`` to ``dest``, tolerating clouds that block same-name overwrite."""
    try:
        os.replace(tmp, dest)
        return
    except OSError:
        pass
    # Some cloud mounts reject overwrite of an existing name; remove then rename.
    _safe_unlink(dest)
    try:
        os.replace(tmp, dest)
        return
    except OSError:
        pass
    try:
        tmp.rename(dest)
        return
    except OSError:
        # Last resort: keep the unique temp as the published file name is blocked.
        # Caller may still fail if even create-new is denied.
        raise


def _write_via_temp(dest: Path, write_fn: Callable[[Path], None]) -> None:
    """Write to a unique temp name in the same folder, then publish to ``dest``."""
    tmp = dest.with_name(f".{dest.name}.{uuid.uuid4().hex}.tmp")
    try:
        write_fn(tmp)
        _atomic_publish(tmp, dest)
    finally:
        _safe_unlink(tmp)


def save_segment_cache(
    node_id: str | None,
    seg: SegmentPlan,
    plan: DirectorPlan,
    tensor: torch.Tensor,
) -> None:
    """Persist a segment tensor. Never raises; cache miss on next run is fine."""
    if not node_id:
        return
    root = _cache_root(node_id)
    if root is None:
        return
    fp = segment_cache_fingerprint(seg, plan)
    idx = seg.index
    pt_path = root / f"seg_{idx:04d}.pt"
    meta_path = root / f"seg_{idx:04d}.meta.json"
    try:
        payload = tensor.cpu().float().contiguous()
        _write_via_temp(pt_path, lambda p: torch.save(payload, p))
        text = json.dumps(fp, ensure_ascii=False, sort_keys=True)
        _write_via_temp(
            meta_path,
            lambda p: p.write_text(text, encoding="utf-8"),
        )
        log.debug(
            "Cached segment %d for node %s (%d frames)",
            idx + 1,
            node_id,
            int(tensor.shape[0]),
        )
    except Exception as exc:
        # Xiangong / similar: RO mount or same-name write; skip cache, keep run alive.
        log.warning(
            "Segment %d cache write skipped (%s). Generation continues without disk cache.",
            idx + 1,
            exc,
        )
        for stray in root.glob(f".seg_{idx:04d}.*"):
            _safe_unlink(stray)


def load_segment_cache(
    node_id: str | None,
    seg: SegmentPlan,
    plan: DirectorPlan,
) -> torch.Tensor | None:
    if not node_id:
        return None
    root = _cache_root(node_id)
    if root is None:
        return None
    idx = seg.index
    meta_path = root / f"seg_{idx:04d}.meta.json"
    tensor_path = root / f"seg_{idx:04d}.pt"
    if not meta_path.is_file() or not tensor_path.is_file():
        return None
    try:
        stored = json.loads(meta_path.read_text(encoding="utf-8"))
        expected = segment_cache_fingerprint(seg, plan)
        if stored != expected:
            log.info(
                "Segment %d cache stale (timeline changed); re-run this segment to refresh.",
                idx + 1,
            )
            return None
        return torch.load(tensor_path, map_location="cpu", weights_only=True)
    except Exception as exc:
        log.warning("Failed to load segment %d cache: %s", idx + 1, exc)
        return None


def save_segment_audio_cache(
    node_id: str | None,
    seg: SegmentPlan,
    plan: DirectorPlan,
    audio: dict[str, Any] | None,
) -> None:
    """Persist the complete generated audio for one decoded segment."""
    if not node_id:
        return

    root = _cache_root(node_id)
    if root is None:
        return

    idx = seg.index
    audio_path = root / f"seg_{idx:04d}.audio.pt"

    waveform = audio.get("waveform") if isinstance(audio, dict) else None
    sample_rate = int(audio.get("sample_rate") or 0) if isinstance(audio, dict) else 0

    if (
        not isinstance(waveform, torch.Tensor)
        or waveform.numel() <= 0
        or sample_rate <= 0
    ):
        _safe_unlink(audio_path)
        return

    payload = {
        "fingerprint": segment_cache_fingerprint(seg, plan),
        "waveform": waveform.detach().cpu().contiguous(),
        "sample_rate": sample_rate,
    }

    try:
        _write_via_temp(
            audio_path,
            lambda path: torch.save(payload, path),
        )
        log.debug(
            "Cached full audio for segment %d on node %s (%d samples)",
            idx + 1,
            node_id,
            int(waveform.shape[-1]),
        )
    except Exception as exc:
        log.warning(
            "Segment %d audio cache write skipped (%s).",
            idx + 1,
            exc,
        )
        _safe_unlink(audio_path)


def load_segment_audio_cache(
    node_id: str | None,
    seg: SegmentPlan,
    plan: DirectorPlan,
) -> dict[str, Any] | None:
    """Load the complete generated audio belonging to a full segment cache."""
    if not node_id:
        return None

    root = _cache_root(node_id)
    if root is None:
        return None

    idx = seg.index
    audio_path = root / f"seg_{idx:04d}.audio.pt"

    if not audio_path.is_file():
        return None

    try:
        payload = torch.load(
            audio_path,
            map_location="cpu",
            weights_only=True,
        )

        if not isinstance(payload, dict):
            return None

        expected = segment_cache_fingerprint(seg, plan)
        if payload.get("fingerprint") != expected:
            log.info(
                "Segment %d full audio cache stale; ignoring.",
                idx + 1,
            )
            return None

        waveform = payload.get("waveform")
        sample_rate = int(payload.get("sample_rate") or 0)

        if (
            not isinstance(waveform, torch.Tensor)
            or waveform.ndim != 3
            or waveform.numel() <= 0
            or sample_rate <= 0
        ):
            return None

        return {
            "waveform": waveform.float().contiguous(),
            "sample_rate": sample_rate,
        }

    except Exception as exc:
        log.warning(
            "Failed to load segment %d full audio cache: %s",
            idx + 1,
            exc,
        )
        return None
