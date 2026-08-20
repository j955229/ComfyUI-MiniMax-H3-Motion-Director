"""Segment-final lifecycle facade for the preserved MiniMax H3 executor.

The original executor implementation is kept byte-for-byte in
``executor_core_legacy.py``.  This facade runs that function with a per-call
copy of its globals so Face Refine can become part of each final segment state
without global monkeypatches or broad executor rewrites.
"""

from __future__ import annotations

import time
import types
from dataclasses import replace
from typing import Any

import torch

from . import executor_core_legacy as _legacy
from .audio_export import AUDIO_MODE_GENERATE, resolve_audio_mode
from .context_cache import load_motion_context_cache
from .context_links import resolve_context_link
from .core_sampling import resolve_sampling_mode, validate_external_sampling
from .face_refine_pipeline import FaceRefineOutcome, apply_face_refine as _apply_face_refine
from .face_refine_validation import validate_face_refine_runtime
from .postprocess_config import normalize_postprocess_config
from .segment_cache import load_segment_cache
from .source_bridge import source_bridge_boundary_enabled


class _TimedVAE:
    """Delegate a VAE while measuring only encode calls made through the proxy."""

    def __init__(self, target, bucket: dict[str, float], key: str):
        self._target = target
        self._bucket = bucket
        self._key = key

    def __getattr__(self, name: str):
        return getattr(self._target, name)

    def encode(self, *args, **kwargs):
        started = time.perf_counter()
        try:
            return self._target.encode(*args, **kwargs)
        finally:
            self._bucket[self._key] = self._bucket.get(self._key, 0.0) + (
                time.perf_counter() - started
            )


def _aggregate_face_outcome(
    images: torch.Tensor,
    outcomes: dict[int, FaceRefineOutcome],
) -> FaceRefineOutcome:
    """Represent already-completed segment-final work to the legacy report path."""
    if not outcomes:
        return FaceRefineOutcome(images=images, status="SEGMENT_FINAL")

    ordered = [outcomes[key] for key in sorted(outcomes)]
    statistics_rows = [item.statistics or {} for item in ordered if item.statistics]
    total_frames = sum(int(row.get("frames") or 0) for row in statistics_rows)
    total_detected = sum(int(row.get("detected") or 0) for row in statistics_rows)
    total_interpolated = sum(int(row.get("interpolated") or 0) for row in statistics_rows)
    statistics: dict[str, Any] = {}
    if statistics_rows:
        statistics.update(
            frames=total_frames,
            detected=total_detected,
            interpolated=total_interpolated,
            face_px_min=min(float(row.get("face_px_min") or 0.0) for row in statistics_rows),
            face_px_max=max(float(row.get("face_px_max") or 0.0) for row in statistics_rows),
        )
        if total_frames > 0:
            statistics["face_px_mean"] = sum(
                float(row.get("face_px_mean") or 0.0) * int(row.get("frames") or 0)
                for row in statistics_rows
            ) / total_frames
        denoise_rows = [row for row in statistics_rows if "denoise_mean" in row]
        denoise_frames = sum(int(row.get("frames") or 0) for row in denoise_rows)
        if denoise_rows:
            statistics["denoise_min"] = min(float(row["denoise_min"]) for row in denoise_rows)
            statistics["denoise_max"] = max(float(row["denoise_max"]) for row in denoise_rows)
            statistics["denoise_mean"] = (
                sum(
                    float(row["denoise_mean"]) * int(row.get("frames") or 0)
                    for row in denoise_rows
                ) / max(1, denoise_frames)
            )

    sampling_chunks: list[float] = []
    timings = {
        "detection_tracking": 0.0,
        "mask": 0.0,
        "stitch": 0.0,
        "total": 0.0,
        "sampling_chunks": sampling_chunks,
    }
    for item in ordered:
        row = item.timings or {}
        timings["detection_tracking"] += float(row.get("detection_tracking", 0.0))
        timings["mask"] += float(row.get("mask", 0.0))
        timings["stitch"] += float(row.get("stitch", 0.0))
        timings["total"] += float(row.get("total", 0.0))
        sampling_chunks.extend(float(value) for value in row.get("sampling_chunks", []))

    return FaceRefineOutcome(
        images=images,
        status="SEGMENT_FINAL",
        statistics=statistics,
        canvas="per-segment",
        steps=max((int(item.steps or 0) for item in ordered), default=0),
        base_denoise=max((float(item.base_denoise or 0.0) for item in ordered), default=0.0),
        timings=timings,
    )


def _append_segment_final_report(
    report: str,
    outcomes: dict[int, FaceRefineOutcome],
    context_timings: dict[int, dict[str, float]],
) -> str:
    lines = ["", "[Face Refine Segment-Final]", "Mode: segment-final"]
    for slot, outcome in sorted(outcomes.items()):
        history = int((outcome.timings or {}).get("tracking_history_frames", 0))
        lines.append(
            f"S{slot + 1}: {outcome.status}; tracking history={history} frame(s); "
            f"visual latent={'INVALIDATED' if outcome.succeeded else 'UNCHANGED'}"
        )
        if outcome.error:
            lines.append(f"S{slot + 1} Error: {outcome.error}")
    lines.extend(["", "[Motion Context Encode Timing]"])
    if not context_timings:
        lines.append("No Motion Context encode calls in this run.")
    else:
        for slot, timing in sorted(context_timings.items()):
            lines.append(
                f"S{slot + 1}: calls={int(timing.get('calls', 0))}; "
                f"VideoVAE Encode={float(timing.get('video_vae', 0.0)):.2f}s; "
                f"AudioVAE Refresh={float(timing.get('audio_vae', 0.0)):.2f}s; "
                f"Context/Repin Total={float(timing.get('total', 0.0)):.2f}s"
            )
    return (report or "") + "\n" + "\n".join(lines)


def execute_director_plan_core(
    plan,
    *,
    node_id: str | None = None,
    model,
    vae,
    audio_vae,
    clip,
    cfg: float = 1.0,
    seed: int = 0,
    steps: int = 25,
    sampler: str = "res_multistep",
    scheduler: str = "simple",
    shift_video: float = 12.0,
    shift_audio: float = 3.0,
    external_sampler=None,
    external_sigmas=None,
    motion_context_enabled: bool = True,
    context_length: int = 22,
    source_overlap_frames: int = 5,
    audio_context_enabled: bool = True,
    color_reanchor_enabled: bool = False,
    pin_renorm_enabled: bool = False,
    clear_vram_between_segments: bool = True,
    postprocess_config: str | dict[str, Any] = "",
):
    postprocess = normalize_postprocess_config(postprocess_config)
    face_config = postprocess["face_refine"]
    validate_face_refine_runtime(face_config)

    all_segments = list(plan.segments)
    source_bridge_pairs = [
        (left, right)
        for left, right in zip(all_segments, all_segments[1:])
        if source_bridge_boundary_enabled(left, right, int(source_overlap_frames))
    ]

    call_kwargs = {
        "node_id": node_id,
        "model": model,
        "vae": vae,
        "audio_vae": audio_vae,
        "clip": clip,
        "cfg": cfg,
        "seed": seed,
        "steps": steps,
        "sampler": sampler,
        "scheduler": scheduler,
        "shift_video": shift_video,
        "shift_audio": shift_audio,
        "external_sampler": external_sampler,
        "external_sigmas": external_sigmas,
        "motion_context_enabled": motion_context_enabled,
        "context_length": context_length,
        "source_overlap_frames": source_overlap_frames,
        "audio_context_enabled": audio_context_enabled,
        "color_reanchor_enabled": color_reanchor_enabled,
        "pin_renorm_enabled": pin_renorm_enabled,
        "clear_vram_between_segments": clear_vram_between_segments,
        "postprocess_config": postprocess_config,
    }

    # Source Bridge pixels do not exist until both nominal segments are ready.
    # Keep the preserved assembled Face Refine path for those timelines.
    if not face_config["enabled"] or source_bridge_pairs:
        return _legacy.execute_director_plan_core(plan, **call_kwargs)

    run_indices = (
        plan.run_indices
        if plan.run_indices is not None
        else frozenset(range(len(all_segments)))
    )
    generated_segments = [seg for seg in all_segments if int(seg.index) in run_indices]
    generated_position = {int(seg.index): pos for pos, seg in enumerate(generated_segments)}
    face_outcomes: dict[int, FaceRefineOutcome] = {}
    face_changed: dict[int, bool] = {}
    final_by_slot: dict[int, torch.Tensor] = {}
    context_timings: dict[int, dict[str, float]] = {}
    trim_cursor = 0
    pending_seam: dict[str, Any] | None = None
    last_final_slot: int | None = None

    sampling_mode = resolve_sampling_mode(external_sampler, external_sigmas)
    face_steps = int(steps)
    if sampling_mode == "external":
        _, face_steps = validate_external_sampling(model, external_sampler, external_sigmas)

    original_trim = _legacy.trim_segment_av
    original_seam = _legacy.apply_seam_color_match
    original_prepare = _legacy.prepare_latent_context_tail
    original_context = _legacy.apply_exported_motion_context

    def previous_history(seg) -> torch.Tensor | None:
        slot = int(seg.timeline_index)
        history = final_by_slot.get(slot - 1)
        if isinstance(history, torch.Tensor):
            return history
        previous_seg = next(
            (
                candidate
                for candidate in all_segments
                if int(candidate.timeline_index) == slot - 1
            ),
            None,
        )
        if previous_seg is None:
            return None
        settings = getattr(plan, "cache_settings", None) or {}
        cached_context = load_motion_context_cache(
            node_id,
            previous_seg,
            plan,
            settings=settings,
            strict=False,
        )
        if cached_context is not None and isinstance(cached_context.frames, torch.Tensor):
            return cached_context.frames
        cached_segment = load_segment_cache(node_id, previous_seg, plan)
        return cached_segment if isinstance(cached_segment, torch.Tensor) else None

    def face_phase(seg, phase: str, value: float) -> None:
        pos = generated_position.get(int(seg.index), 0)
        _legacy.report_director_progress(
            node_id,
            segment_index=pos,
            segment_total=max(1, len(generated_segments)),
            phase=phase,
            phase_value=value,
            phase_max=1,
            frames_label=_legacy.frames_label(seg),
            task_key=seg.task_key,
            timeline_segment_index=int(seg.timeline_index),
            timeline_segment_total=max(len(all_segments), int(seg.timeline_index) + 1),
        )

    def run_face(seg, images: torch.Tensor) -> torch.Tensor:
        nonlocal last_final_slot
        slot = int(seg.timeline_index)
        outcome = _apply_face_refine(
            face_config,
            images=images,
            model=model,
            vae=vae,
            audio_vae=audio_vae,
            clip=clip,
            prompt=str(
                getattr(plan, "global_prompt", "")
                or "Refine the tracked face with stable natural detail."
            ),
            seed=int(seed) + slot,
            cfg=cfg,
            steps=int(face_steps),
            sampler_name=sampler,
            scheduler=scheduler,
            shift_video=shift_video,
            shift_audio=shift_audio,
            chunk_lengths=[int(images.shape[0])],
            tracking_history=previous_history(seg),
            on_phase=lambda phase, value: face_phase(seg, phase, value),
            on_step_preview=None,
            preview_every=int(postprocess["preview"]["preview_every"]),
        )
        face_outcomes[slot] = outcome
        face_changed[slot] = bool(outcome.succeeded)
        final = outcome.images.detach().cpu().float() if outcome.succeeded else images
        final_by_slot[slot] = final
        last_final_slot = slot
        return final

    def seam_expected(seg) -> bool:
        if not color_reanchor_enabled or int(seg.timeline_index) <= 0:
            return False
        link = resolve_context_link(
            seg,
            motion_context_enabled=bool(motion_context_enabled),
            audio_context_enabled=bool(audio_context_enabled),
            audio_generate=resolve_audio_mode(plan) == AUDIO_MODE_GENERATE,
            source_bridge_active=False,
        )
        return bool(link.visual)

    def trim_hook(*args, **kwargs):
        nonlocal trim_cursor, pending_seam
        if pending_seam is not None:
            raise RuntimeError(
                "Face Refine lifecycle error: expected seam-color hook was not consumed."
            )
        result = original_trim(*args, **kwargs)
        if trim_cursor >= len(generated_segments):
            raise RuntimeError(
                "Face Refine lifecycle error: segment/trim call count diverged."
            )
        seg = generated_segments[trim_cursor]
        trim_cursor += 1
        images, audio = result
        if seam_expected(seg):
            pending_seam = {"segment": seg}
            return images, audio
        return run_face(seg, images), audio

    def seam_hook(images, context_frames):
        nonlocal pending_seam
        seamed = original_seam(images, context_frames)
        if pending_seam is None:
            return seamed
        seg = pending_seam["segment"]
        pending_seam = None
        return run_face(seg, seamed)

    def prepare_hook(latent, handoff):
        if pending_seam is not None:
            raise RuntimeError(
                "Face Refine lifecycle error: latent handoff reached before final face pixels."
            )
        updated_handoff = dict(handoff)
        valid = not bool(face_changed.get(int(last_final_slot or 0), False))
        updated_handoff["visual_latent_valid"] = valid
        tail_latent, tail_handoff = original_prepare(latent, updated_handoff)
        tail_latent = dict(tail_latent)
        tail_handoff = dict(tail_handoff)
        tail_latent["visual_latent_valid"] = valid
        tail_handoff["visual_latent_valid"] = valid
        return tail_latent, tail_handoff

    def context_hook(conditioning, **kwargs):
        active_position = min(len(final_by_slot), max(0, len(generated_segments) - 1))
        slot = (
            int(generated_segments[active_position].timeline_index)
            if generated_segments
            else 0
        )
        timing = context_timings.setdefault(
            slot,
            {"calls": 0.0, "video_vae": 0.0, "audio_vae": 0.0, "total": 0.0},
        )
        local_timing: dict[str, float] = {}
        call = dict(kwargs)
        if call.get("video_vae") is not None:
            call["video_vae"] = _TimedVAE(call["video_vae"], local_timing, "video")
        if call.get("audio_vae") is not None:
            call["audio_vae"] = _TimedVAE(call["audio_vae"], local_timing, "audio")

        context_latent = call.get("context_latent")
        visual_invalid = bool(
            call.get("visual_enabled", True)
            and isinstance(context_latent, dict)
            and context_latent.get("visual_latent_valid") is False
            and not call.get("color_reanchor_enabled", False)
        )
        if visual_invalid:
            # The legacy implementation already has the exact pixel-encode path
            # behind Color Re-anchor. With no anchor this performs no colour
            # transform; it only forces final RGB -> VideoVAE while leaving the
            # independent audio latent/waveform logic intact.
            call["color_reanchor_enabled"] = True
            call["color_anchor"] = None

        started = time.perf_counter()
        merged, info = original_context(conditioning, **call)
        elapsed = time.perf_counter() - started
        if visual_invalid:
            info = replace(
                info,
                color_reanchor_status="OFF",
                visual_source="pixels (fallback)",
            )
        timing["calls"] += 1
        timing["video_vae"] += float(local_timing.get("video", 0.0))
        timing["audio_vae"] += float(local_timing.get("audio", 0.0))
        timing["total"] += elapsed
        return merged, info

    def assembled_face_noop(_config, *, images, **_kwargs):
        return _aggregate_face_outcome(images, face_outcomes)

    # Run the preserved executor with a private globals dictionary. This is
    # thread-safe: no module-level function is monkeypatched for other runs.
    function_globals = dict(_legacy.execute_director_plan_core.__globals__)
    function_globals.update(
        trim_segment_av=trim_hook,
        apply_seam_color_match=seam_hook,
        prepare_latent_context_tail=prepare_hook,
        apply_exported_motion_context=context_hook,
        apply_face_refine=assembled_face_noop,
        report_director_report=lambda *_args, **_kwargs: None,
    )
    runner = types.FunctionType(
        _legacy.execute_director_plan_core.__code__,
        function_globals,
        name=_legacy.execute_director_plan_core.__name__,
        argdefs=_legacy.execute_director_plan_core.__defaults__,
        closure=_legacy.execute_director_plan_core.__closure__,
    )
    runner.__kwdefaults__ = dict(_legacy.execute_director_plan_core.__kwdefaults__ or {})

    combined, segment_outputs, segment_audios, report = runner(plan, **call_kwargs)
    if pending_seam is not None or trim_cursor != len(generated_segments):
        raise RuntimeError(
            "Face Refine lifecycle error: final segment state was not completed for every generated segment."
        )
    report = _append_segment_final_report(report, face_outcomes, context_timings)
    return combined, segment_outputs, segment_audios, report


def __getattr__(name: str):
    return getattr(_legacy, name)


__all__ = ["execute_director_plan_core"]
