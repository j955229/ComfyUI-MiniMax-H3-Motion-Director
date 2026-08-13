# Portions derived from ComfyUI_MiniMaxH3_Director
# Copyright AIMixer and contributors
# Originally licensed under Apache License 2.0
# Modified for MiniMax H3 Motion Director, 2026-08-09
# This derivative project is distributed under GPL-3.0.
# See NOTICE and LICENSES/Apache-2.0-AIMixer.txt.

"""Run MiniMax H3 Motion Director segments through the official ComfyUI core pipeline."""

from __future__ import annotations

import logging
from typing import Any

import torch

from ..lib.image_prep import (
    H3_SPATIAL_PIPELINE,
    fit_canvas,
    fit_video_long_edge,
    resolve_h3_canvas,
    resolve_h3_spatial_stride,
)
from ..lib.task_modes import SUPPORTED_TASK_KEYS
from ..nodes.conditioning import (
    append_minimax_keyframe_anchors,
    run_minimax_conditioning,
)
from ..patches import motion_context_patch_status
from .core_sampling import sample_single_stage
from .core_sampling import (
    describe_external_sampler,
    resolve_sampling_mode,
    validate_external_sampling,
)
from .frame_align import (
    H3_REFERENCE_VIDEO_PIPELINE,
    H3_SOURCE_BRIDGE_PIPELINE,
    minimax_align_frame_count,
    pad_or_trim_frames,
    prepare_h3_reference_video_clip,
)
from .audio_trim import audio_has_samples, trim_segment_av
from .context_cache import (
    CachedMotionContext,
    load_motion_context_cache,
    save_motion_context_cache,
    tensor_fingerprint,
)
from .context_links import resolve_context_link
from .motion_context import (
    apply_exported_motion_context,
    select_context_span,
)
from .latent_context_cache import (
    LATENT_HANDOFF_PIPELINE,
    load_latent_context_cache,
    prepare_latent_context_tail,
    save_latent_context_cache,
)
from .audio_export import (
    AUDIO_MODE_GENERATE,
    AUDIO_MODE_MUTE,
    AUDIO_MODE_SOURCE,
    empty_audio_dict,
    resolve_audio_mode,
)
from .segment_runtime import (
    frames_label,
    load_source_bridge_clip,
    resolve_segment_raw_clip,
    resolve_segment_raw_clip_with_lookahead,
    resolve_source_bridge_window,
    segment_passthrough_chunk,
    tensor_frame_to_jpeg_b64,
)
from .color_reanchor import (
    apply_seam_color_match,
    color_reanchor_cache_settings,
    resolve_color_anchor,
)
from .plan import (
    DirectorPlan,
    plan_summary,
    prepare_segment_clip,
    ref_audios_to_dict,
    ref_videos_to_dict,
    reference_video_for_segment,
    refs_to_kwargs_for_context,
    reinforce_r2v_prompt,
    reinforce_rv2v_prompt,
    reinforce_v2v_prompt,
)
from .progress import report_director_finish, report_director_progress, report_director_segment_preview
from .segment_cache import (
    load_segment_audio_cache,
    load_segment_cache,
    save_segment_audio_cache,
    save_segment_cache,
)
from .cache_policy import (
    resolve_nominal_segment_frames,
    should_persist_segment_cache,
    write_segment_cache_if_required,
)
from .source_bridge import (
    GeneratedSourceBridge,
    assemble_source_bridges,
    bridge_anchors,
    reference_bundles_match,
    source_bridge_enabled,
    validate_source_bridge_frames,
)
from .segment_continuity import (
    concat_continuous_chunks,
    is_continuity_active,
    resolve_prev_segment_output,
)
from .vram_cleanup import cleanup_segment_vram

log = logging.getLogger("ComfyUI-MiniMax-H3-Motion-Director.director.core")


def _stable_cache_value(value, depth: int = 0):
    """Describe MODEL patch options without memory-address-based repr strings."""
    if depth > 6:
        return {"type": f"{type(value).__module__}.{type(value).__qualname__}"}
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, torch.Tensor):
        return tensor_fingerprint(value)
    if isinstance(value, dict):
        return {
            str(key): _stable_cache_value(item, depth + 1)
            for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
        }
    if isinstance(value, (list, tuple)):
        return [_stable_cache_value(item, depth + 1) for item in value]
    if callable(value):
        return {
            "callable": f"{getattr(value, '__module__', type(value).__module__)}."
            f"{getattr(value, '__qualname__', type(value).__qualname__)}"
        }
    return {"type": f"{type(value).__module__}.{type(value).__qualname__}"}


def _unpack_node_output(out):
    if hasattr(out, "args"):
        args = out.args
        if args:
            return args
    if isinstance(out, (tuple, list)):
        return out
    raise RuntimeError(f"Unexpected node output: {type(out)!r}")


def _decode_av_latent(samples, vae, audio_vae, *, decode_audio: bool = True):
    from comfy_extras.nodes_lt import LTXVSeparateAVLatent
    from nodes import VAEDecode

    sep = LTXVSeparateAVLatent.execute(samples)
    video_latent, audio_latent = _unpack_node_output(sep)[:2]
    images, = VAEDecode().decode(vae, video_latent)
    if not decode_audio or audio_vae is None:
        return images, empty_audio_dict()
    try:
        from comfy_extras.nodes_audio import VAEDecodeAudio
    except ImportError:
        from comfy_extras.nodes_lt import VAEDecodeAudio  # type: ignore

    audio_out = VAEDecodeAudio.execute(audio_vae, audio_latent)
    audio = _unpack_node_output(audio_out)[0]
    return images, audio


def _ref_tensor_from_seg_refs(refs, index: int) -> torch.Tensor | None:
    for ref in refs or []:
        if int(getattr(ref, "index", -1)) == index and ref.tensor is not None:
            t = ref.tensor
            if t.shape[0] > 0:
                return t[:1]
    return None


def _segment_has_reference_video(segment) -> bool:
    if getattr(segment, "ref_videos", None):
        return True
    meta = getattr(segment, "reference_video_meta", None) or {}
    return bool(str(meta.get("videoFile") or meta.get("fileName") or "").strip())


def _build_minimax_inputs(
    plan: DirectorPlan,
    seg,
    *,
    clip_frames: torch.Tensor | None,
    reference_clip_frames: torch.Tensor | None,
    ctx_w: int,
    ctx_h: int,
    prev_tail: torch.Tensor | None,
):
    """Map segment task + refs to MiniMax ImageToVideo / ReferenceToVideo inputs."""
    task_key = seg.task_key
    first_frame = None
    last_frame = None
    ref_images = None
    ref_videos = None
    ref_audios = None
    ref_video_audios = None

    if task_key == "fl2v":
        from .fl2v_timeline import resolve_fl2v_endpoint_frames

        first_frame, last_frame = resolve_fl2v_endpoint_frames(
            explicit_first=_ref_tensor_from_seg_refs(seg.refs, 0),
            explicit_last=_ref_tensor_from_seg_refs(seg.refs, 1),
            clip_frames=clip_frames,
        )
    elif task_key == "i2v":
        if prev_tail is not None and prev_tail.shape[0] > 0:
            first_frame = prev_tail[-1:].clone()
        elif clip_frames is not None and clip_frames.shape[0] > 0:
            first_frame = clip_frames[:1]
        else:
            first_frame = _ref_tensor_from_seg_refs(seg.refs, 0)
    elif task_key == "r2v":
        ref_kwargs = refs_to_kwargs_for_context(task_key, seg.refs)
        ref_images = {}
        for key, tensor in ref_kwargs.items():
            if tensor is None:
                continue
            idx = key.removeprefix("reference_image_")
            ref_images[f"ref_image_{idx}"] = tensor[:1] if tensor.ndim == 4 else tensor
        if not ref_images:
            ref_images = None
        # Prefer multi-slot ref_videos (r2v batch cards); fall back to legacy single meta.
        ref_videos = ref_videos_to_dict(getattr(seg, "ref_videos", None) or [])
        if not ref_videos:
            nframes = max(5, int(getattr(seg, "frame_count", 0) or plan.total_frames or 124))
            ref_video = reference_video_for_segment(plan, seg, num_frames=nframes)
            if ref_video is not None and ref_video.shape[0] > 0:
                ref_videos = {"ref_video_0": ref_video}
        ref_audios = ref_audios_to_dict(getattr(seg, "ref_audios", None) or [])
        ref_video_audios = _ref_video_audios_to_dict(getattr(seg, "ref_video_audios", None) or [])
    elif task_key in {"v2v", "rv2v"}:
        # MiniMax H3 video edit: each timeline segment's source clip → <Video 1>.
        # rv2v additionally injects 图片1–9 / 音频1–3 as <Picture N> / <Audio J>.
        if clip_frames is None or clip_frames.shape[0] <= 0:
            raise ValueError(
                f"{task_key} segment #{seg.index + 1} has no source frames. "
                "Upload a video in the Director timeline before running."
            )
        if reference_clip_frames is None:
            raise RuntimeError(
                "MiniMax H3 Motion Director internal error: "
                f"{task_key.upper()} <Video 1> reference clip was not prepared."
            )
        reference_count = int(reference_clip_frames.shape[0])
        if reference_count < 5 or reference_count % 17 != 5:
            raise RuntimeError(
                "MiniMax H3 Motion Director internal error:\n"
                f"{task_key.upper()} <Video 1> was prepared with "
                f"{reference_count} frames.\n"
                "Reference video must satisfy 17k+5 before entering "
                "MiniMaxH3ReferenceToVideo."
            )
        ref_videos = {"ref_video_0": reference_clip_frames}
        if task_key == "rv2v":
            # Refs are optional per segment: with refs → <Video 1>+<Picture N>;
            # without refs → same as v2v (source edit only).
            ref_kwargs = refs_to_kwargs_for_context(task_key, seg.refs)
            ref_images = {}
            for key, tensor in ref_kwargs.items():
                if tensor is None:
                    continue
                idx = key.removeprefix("reference_image_")
                ref_images[f"ref_image_{idx}"] = tensor[:1] if tensor.ndim == 4 else tensor
            if not ref_images:
                ref_images = None
            ref_audios = ref_audios_to_dict(getattr(seg, "ref_audios", None) or [])

    return first_frame, last_frame, ref_images, ref_videos, ref_audios, ref_video_audios


def _ref_video_audios_to_dict(items) -> dict | None:
    out: dict = {}
    for item in items or []:
        idx = int(getattr(item, "index", -1))
        audio = getattr(item, "audio", None)
        if idx < 0 or not isinstance(audio, dict) or audio.get("waveform") is None:
            continue
        out[f"ref_video_audio_{idx}"] = audio
    return out or None


def execute_director_plan_core(
    plan: DirectorPlan,
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
) -> tuple[torch.Tensor, list[torch.Tensor], list[dict[str, Any]], str]:
    """Process every segment with MiniMax H3 conditioning + single-stage sampling."""
    audio_mode = resolve_audio_mode(plan)
    decode_audio = audio_mode == AUDIO_MODE_GENERATE
    sampling_mode = resolve_sampling_mode(external_sampler, external_sigmas)
    external_steps = None
    if sampling_mode == "external":
        _, external_steps = validate_external_sampling(
            model, external_sampler, external_sigmas
        )
    motion_enabled = bool(motion_context_enabled)
    requested_context = max(1, int(context_length))
    requested_source_bridge = validate_source_bridge_frames(source_overlap_frames)
    # Keep the old backend/schema field name for workflow compatibility.
    plan.source_overlap_frames = requested_source_bridge
    plan.color_reanchor_enabled = bool(color_reanchor_enabled)
    color_reanchor_requested = bool(color_reanchor_enabled)
    audio_context_requested = bool(audio_context_enabled)
    audio_context_active = bool(
        motion_enabled and audio_context_requested and audio_mode == AUDIO_MODE_GENERATE
    )
    bridge_feature_active = bool(
        requested_source_bridge == 5
        and any(seg.task_key in {"v2v", "rv2v"} for seg in plan.segments)
    )
    explicit_context_active = any(
        bool(getattr(seg, "context_link", None) and seg.context_link.has_dependency)
        for seg in plan.segments
    )
    explicit_visual_active = any(
        bool(getattr(seg, "context_link", None) and seg.context_link.visual_enabled)
        for seg in plan.segments
    )
    context_pipeline_active = bool(motion_enabled or explicit_context_active)
    visual_context_pipeline_active = bool(motion_enabled or explicit_visual_active)
    plan_spatial_stride = max(
        resolve_h3_spatial_stride(
            seg.task_key,
            segment_count=len(plan.segments),
            motion_context_enabled=motion_enabled,
            has_reference_video=_segment_has_reference_video(seg),
            source_bridge_frames=requested_source_bridge,
        )
        for seg in plan.segments
    )
    plan.spatial_stride = int(plan_spatial_stride)
    plan.width, plan.height = resolve_h3_canvas(
        plan.width,
        plan.height,
        stride=plan_spatial_stride,
    )
    if (context_pipeline_active or bridge_feature_active) and len(plan.segments) > 1:
        patch_ready, patch_reason = motion_context_patch_status()
        if not patch_ready:
            raise RuntimeError(
                "Motion Director cannot enable Motion Context because the startup "
                "H3 compatibility self-test failed: %s" % patch_reason
            )

    cache_settings: dict[str, Any] = {
        "pipeline": "exported_motion_context_tail_v3",
        "seed": int(seed),
        "cfg": float(cfg),
        "sampling_mode": sampling_mode,
        "motion_context_enabled": motion_enabled,
        "audio_context_enabled": audio_context_active,
        "audio_mode": audio_mode,
        "context_length": requested_context,
        "context_link_pipeline": "previous_context_link_v1",
        "pin_renorm_enabled": bool(pin_renorm_enabled),
        "model_class": type(getattr(model, "model", None)).__name__,
        "model_options": _stable_cache_value(getattr(model, "model_options", {}) or {}),
    }
    cache_settings.update(color_reanchor_cache_settings(color_reanchor_requested))
    cache_settings.update(
        {
            "spatial_stride": int(plan_spatial_stride),
            "spatial_pipeline": H3_SPATIAL_PIPELINE,
        }
    )
    if any(seg.task_key in {"v2v", "rv2v"} for seg in plan.segments):
        cache_settings["reference_video_pipeline"] = H3_REFERENCE_VIDEO_PIPELINE
        cache_settings["source_bridge_pipeline"] = H3_SOURCE_BRIDGE_PIPELINE
        cache_settings["source_overlap_frames"] = requested_source_bridge
    if sampling_mode == "internal":
        cache_settings.update(
            {
                "steps": int(steps),
                "sampler": str(sampler),
                "scheduler": str(scheduler),
                "shift_video": float(shift_video),
                "shift_audio": float(shift_audio),
            }
        )
    else:
        model_sampling = model.get_model_object("model_sampling")
        cache_settings.update(
            {
                "external_sampler": describe_external_sampler(external_sampler),
                "external_sigmas": tensor_fingerprint(external_sigmas),
                "external_steps": int(external_steps),
                "model_shift_video": float(getattr(model_sampling, "shift", 0.0)),
                "model_shift_audio": float(getattr(model_sampling, "audio_shift", 0.0)),
            }
        )
    plan.cache_settings = cache_settings
    # UI toggle on the player bar (timeline.liveTaePreview); default on.
    raw_live = (plan.raw or {}).get("liveTaePreview", (plan.raw or {}).get("live_tae_preview", True))
    live_tae_preview = False if raw_live in (False, 0, "0", "false", "False", "off") else True

    all_segments = plan.segments
    source_bridge_pairs = [
        (left, right)
        for left, right in zip(all_segments, all_segments[1:])
        if source_bridge_enabled(left.task_key, requested_source_bridge)
        and source_bridge_enabled(right.task_key, requested_source_bridge)
    ]
    persist_segment_cache = should_persist_segment_cache(
        plan,
        source_bridge_active=bool(source_bridge_pairs),
    )
    # Strictly honor「选择运行」— never force-sample unselected segments.
    run_indices = plan.run_indices if plan.run_indices is not None else frozenset(range(len(all_segments)))

    run_list = sorted(run_indices)
    seg_total = len(run_list)
    progress_pos = {idx: pos for pos, idx in enumerate(run_list)}
    passthrough_indices: list[int] = []
    # External groups may compact selected packs to 0..N-1 while UI still shows
    # the full group list — prefer original timeline card count for progress UI.
    ext_meta = (plan.raw or {}).get("externalGroups") or {}
    try:
        timeline_seg_total = int(ext_meta.get("count") or 0) or len(all_segments)
    except (TypeError, ValueError):
        timeline_seg_total = len(all_segments)
    timeline_seg_total = max(timeline_seg_total, len(all_segments))

    selected_results: dict[int, tuple[torch.Tensor, dict[str, Any]]] = {}
    all_export_results: dict[int, tuple[torch.Tensor, dict[str, Any]]] = {}
    nominal_generated_frames: dict[int, torch.Tensor] = {}
    reports: list[str] = [plan_summary(plan), "", "Execution path: ComfyUI official MiniMax H3"]
    reports.append(f"Legacy global Motion Context default: {'ON' if motion_enabled else 'OFF'}")
    reports.append(
        "Previous Context links: per-boundary Visual/Audio policy "
        f"({'explicit' if explicit_context_active else 'legacy fallback'})"
    )
    reports.append(f"Motion Context handoff: {LATENT_HANDOFF_PIPELINE} (latent-first)")
    reports.append(f"Context frames: {requested_context}")
    reports.append(f"Source Bridge frames: {requested_source_bridge} (V2V/RV2V only)")
    reports.append(
        "Full segment disk cache: "
        + ("ON (multi-segment partial-rerun safety / Source Bridge)" if persist_segment_cache else "OFF")
    )
    if source_bridge_pairs:
        reports.append(
            "Source Bridge v1: nominal segment generations + an independent "
            "H3-native five-frame anchored bridge; visual Motion Context skipped "
            "for V2V/RV2V."
        )
    reports.append(f"Legacy global Audio Context default: {'ON' if audio_context_active else 'OFF'}")
    reports.append(f"pin_renorm (experimental): {'ON' if pin_renorm_enabled else 'OFF'}")
    reports.append(f"Color Re-anchor: {'ON' if color_reanchor_requested else 'OFF'}")
    reports.append(
        f"H3 spatial stride: {int(plan_spatial_stride)} "
        f"(authoritative canvas {int(plan.width)}x{int(plan.height)})"
    )
    reports.append(f"Sampling mode: {sampling_mode} (automatic connection detection)")
    if sampling_mode == "internal":
        reports.append(f"Sampler source: internal {sampler}")
        reports.append(f"Sigma source: internal {scheduler} / {int(steps)} steps")
    else:
        reports.append(
            f"Sampler source: external SAMPLER ({describe_external_sampler(external_sampler)})"
        )
        reports.append(f"Sigma source: external SIGMAS / {int(external_steps)} steps")
    if context_pipeline_active:
        reports.append(
            "Motion Context active: Spectrum-style step forecasting is not "
            "validated and should be disabled."
        )
    if clear_vram_between_segments:
        reports.append("VRAM: 段间清理显存已开启。")
    if audio_mode == AUDIO_MODE_MUTE:
        reports.append("Audio: muted — skip audio VAE decode, silent AUDIO output.")
    elif audio_mode == AUDIO_MODE_SOURCE:
        reports.append("Audio: source — skip audio VAE decode, use original timeline audio.")
    else:
        reports.append("Audio: generate — decode MiniMax H3 AV latent audio.")
    if motion_enabled and audio_context_requested and not audio_context_active:
        reports.append(
            f"Audio context override: disabled because output audio mode is {audio_mode}."
        )
    selected_ui = ext_meta.get("selected")
    if selected_ui is not None:
        selected_set = {int(x) for x in selected_ui}
        run_ui = [i + 1 for i in sorted(selected_set)]
        skipped = [i + 1 for i in range(timeline_seg_total) if i not in selected_set]
        reports.append(
            f"Run selection: {len(run_list)}/{timeline_seg_total} segment(s) "
            f"(indices {run_ui}; skipped {skipped or 'none'})"
        )
    elif plan.run_indices is not None:
        skipped = [i + 1 for i in range(len(all_segments)) if i not in run_indices]
        reports.append(
            f"Run selection: {len(run_list)}/{len(all_segments)} segment(s) "
            f"(indices {[i + 1 for i in run_list]}; skipped {skipped or 'none'})"
        )

    if context_pipeline_active:
        if plan.continuity_enabled:
            reports.append(
                "Legacy continuity: ignored while Motion Context is ON "
                "(no double first-frame handoff)."
            )
        else:
            reports.append("Legacy continuity: OFF; Motion Context owns segment handoff.")
    elif plan.continuity_enabled:
        reports.append(
            "Segment continuity: ON — last-frame → next first_frame handoff (no SCAIL / Wan latent lock)."
        )
    else:
        reports.append("Segment continuity: OFF — per-segment generation only.")

    completed_outputs: dict[int, torch.Tensor] = {}
    completed_contexts: dict[int, CachedMotionContext] = {}

    def _run_one_segment(
        seg, *, progress_index: int
    ) -> tuple[torch.Tensor, dict[str, Any] | None]:
        if seg.task_key not in SUPPORTED_TASK_KEYS:
            raise ValueError(
                f"Task '{seg.task_key}' is not supported on MiniMax H3 Motion Director. "
                f"Supported: {', '.join(sorted(SUPPORTED_TASK_KEYS))}."
            )

        ui_idx = seg.timeline_index
        meta = {
            "frames_label": frames_label(seg),
            "task_key": seg.task_key,
            "timeline_segment_index": ui_idx,
            "timeline_segment_total": timeline_seg_total,
        }

        report_director_progress(
            node_id, segment_index=progress_index, segment_total=seg_total,
            phase="prepare", phase_value=0, phase_max=1, **meta,
        )

        target_len = max(1, int(seg.frame_count or plan.total_frames or 124))
        timeline_slot = int(seg.timeline_index)
        source_bridge_active = source_bridge_enabled(
            seg.task_key, requested_source_bridge
        )
        context_link = resolve_context_link(
            seg,
            motion_context_enabled=motion_enabled,
            audio_context_enabled=audio_context_requested,
            audio_generate=audio_mode == AUDIO_MODE_GENERATE,
            source_bridge_active=source_bridge_active,
        )
        apply_visual_context = bool(context_link.visual)
        apply_audio_context = bool(context_link.audio)
        reports.append(
            f"Segment {timeline_slot + 1}: Previous Context — "
            f"Visual {'ON' if apply_visual_context else 'OFF'} "
            f"({context_link.visual_reason}); "
            f"Audio {'ON' if apply_audio_context else 'OFF'} "
            f"({context_link.audio_reason})."
        )
        explicit_i2v_reset = bool(
            seg.task_key == "i2v"
            and timeline_slot > 0
            and seg.source_clip is not None
            and not apply_visual_context
        )
        i2v_continuation = bool(
            seg.task_key == "i2v"
            and timeline_slot > 0
            and seg.source_clip is None
            and apply_visual_context
        )

        if context_pipeline_active and seg.task_key == "i2v":
            if explicit_i2v_reset:
                reports.append(
                    f"Segment {timeline_slot + 1}: explicit I2V image resets incoming "
                    "visual context. Audio follows this boundary's independent setting."
                )
            elif i2v_continuation:
                reports.append(
                    f"Segment {timeline_slot + 1}: I2V continuation via Motion Context."
                )
            else:
                reports.append(
                    f"Segment {timeline_slot + 1}: I2V explicit source image."
                )
        elif context_pipeline_active and seg.task_key == "r2v":
            reports.append(
                f"Segment {timeline_slot + 1}: effective Reference Set = "
                f"{len(seg.refs or [])} Picture, "
                f"{len(getattr(seg, 'ref_videos', None) or [])} Video, "
                f"{len(seg.ref_audios or [])} standalone Audio."
            )

        if i2v_continuation:
            # A continuation has no new raw source by design. Do not ask the
            # generation timeline for video frames: its source_video is only a
            # per-segment indexing placeholder, not a timeline frame buffer.
            raw_clip = torch.zeros((0, 16, 16, 3), dtype=torch.float32)
        else:
            raw_clip = resolve_segment_raw_clip(plan, seg)

        if seg.source_clip is not None:
            body_raw = seg.source_clip
            target_len = max(target_len, int(body_raw.shape[0]))
        else:
            body_raw = raw_clip[:target_len] if int(raw_clip.shape[0]) > target_len else raw_clip

        if body_raw is not None and body_raw.shape[0] > 0:
            if plan.output_mode == "fixed":
                visible_clip_frames = fit_canvas(body_raw, plan.width, plan.height)
            else:
                visible_clip_frames = fit_video_long_edge(
                    body_raw,
                    plan.ref_max_size,
                    stride=plan_spatial_stride,
                )
        else:
            visible_clip_frames = None

        reference_clip_frames = None
        if seg.task_key in {"v2v", "rv2v"}:
            reference_base_frames = target_len
            reference_target_frames = minimax_align_frame_count(reference_base_frames)
            requested_lookahead = max(
                0, reference_target_frames - reference_base_frames
            )
            if requested_lookahead > 0:
                reference_raw = resolve_segment_raw_clip_with_lookahead(
                    plan,
                    seg,
                    end_extra=requested_lookahead,
                )
            else:
                reference_raw = body_raw.clone()

            reference_raw_count = int(reference_raw.shape[0])
            visible_source_count = int(body_raw.shape[0])
            prepared_reference_raw, reference_tail_pad = (
                prepare_h3_reference_video_clip(
                    reference_raw,
                    reference_target_frames,
                )
            )
            reference_lookahead = max(
                0,
                min(reference_raw_count, reference_target_frames)
                - min(reference_base_frames, reference_raw_count),
            )
            if plan.output_mode == "fixed":
                reference_clip_frames = fit_canvas(
                    prepared_reference_raw,
                    plan.width,
                    plan.height,
                )
            else:
                reference_clip_frames = fit_video_long_edge(
                    prepared_reference_raw,
                    plan.ref_max_size,
                    stride=plan_spatial_stride,
                )
            reports.append(
                f"Segment {timeline_slot + 1} {seg.task_key.upper()}:\n"
                f"visible source = {visible_source_count} frames\n"
                f"<Video 1> H3 reference = "
                f"{int(reference_clip_frames.shape[0])} frames\n"
                f"reference lookahead = {reference_lookahead} frames\n"
                f"reference tail pad = {reference_tail_pad} frames\n"
                f"visual motion context = "
                f"{'unchanged' if apply_visual_context else ('skipped' if source_bridge_active else 'off')}\n"
                f"nominal visible output = {target_len} frames"
            )

        context_entry: CachedMotionContext | None = None
        context_span = 0
        color_anchor = None
        if apply_visual_context or apply_audio_context:
            previous_index = timeline_slot - 1
            context_entry = completed_contexts.get(previous_index)
            if context_entry is None:
                previous_seg = next(
                    (
                        candidate
                        for candidate in all_segments
                        if int(candidate.timeline_index) == previous_index
                    ),
                    None,
                )
                if previous_seg is None:
                    raise ValueError(
                        "Segment %d requires Segment %d for Motion Context, but "
                        "the previous segment is absent from this compact execution "
                        "plan. Run the complete sequence once to create a validated "
                        "context cache."
                        % (timeline_slot + 1, previous_index + 1)
                    )
                pixel_context = load_motion_context_cache(
                    node_id,
                    previous_seg,
                    plan,
                    settings=cache_settings,
                    strict=False,
                )
                latent_context = load_latent_context_cache(
                    node_id,
                    previous_seg,
                    plan,
                    settings=cache_settings,
                )
                if pixel_context is None and latent_context is None:
                    # Re-run strict once to preserve the cache layer's precise
                    # missing-vs-stale diagnostic instead of silently falling back.
                    load_motion_context_cache(
                        node_id,
                        previous_seg,
                        plan,
                        settings=cache_settings,
                        strict=True,
                    )
                    raise ValueError("Previous Context cache is unavailable.")
                context_entry = CachedMotionContext(
                    frames=pixel_context.frames if pixel_context is not None else None,
                    audio=pixel_context.audio if pixel_context is not None else None,
                    metadata=(
                        pixel_context.metadata
                        if pixel_context is not None
                        else latent_context.metadata
                    ),
                    latent=latent_context.latent if latent_context is not None else None,
                    handoff=latent_context.handoff if latent_context is not None else None,
                )
            available_context_frames = int(
                (context_entry.handoff or {}).get("export_frames")
                or (
                    context_entry.frames.shape[0]
                    if isinstance(context_entry.frames, torch.Tensor)
                    else 0
                )
            )
            context_span = select_context_span(
                requested_context, available_context_frames
            )
            if context_span != requested_context:
                reports.append(
                    f"Segment {timeline_slot + 1}: requested {requested_context} "
                    f"context frames, using H3-valid exported tail {context_span}."
                )
            if color_reanchor_requested and apply_visual_context:
                color_anchor = resolve_color_anchor(
                    plan,
                    seg,
                    source_frames=body_raw,
                    source_bridge_active=source_bridge_active,
                )
        generation_request = target_len + context_span
        num_frames = minimax_align_frame_count(generation_request)
        if visible_clip_frames is not None:
            # Motion over-generation belongs to the target timeline, not to a
            # user's source/reference video. Keep reference preparation at the
            # requested segment duration.
            visible_clip_frames, _ = prepare_segment_clip(
                visible_clip_frames, minimax_align_frame_count(target_len)
            )

        prev_tail = None
        if not context_pipeline_active and is_continuity_active(plan, seg):
            prev_tail = resolve_prev_segment_output(
                plan, all_segments, seg.index, completed_outputs, node_id
            )

        ctx_w = plan.width
        ctx_h = plan.height
        if visible_clip_frames is not None and visible_clip_frames.shape[0] > 0:
            ctx_h = int(visible_clip_frames.shape[1])
            ctx_w = int(visible_clip_frames.shape[2])

        report_director_progress(
            node_id, segment_index=progress_index, segment_total=seg_total,
            phase="prepare", phase_value=1, phase_max=1, **meta,
        )

        positive_prompt = seg.prompt

        if seg.task_key == "fl2v":
            from .fl2v_timeline import reinforce_fl2v_prompt

            has_start = any(getattr(r, "index", None) == 0 for r in (seg.refs or []))
            has_end = any(getattr(r, "index", None) == 1 for r in (seg.refs or []))
            if not has_start and not has_end and seg.refs:
                # Legacy packs without explicit indices: [start] or [start, end].
                has_start = True
                has_end = len(seg.refs) >= 2
            positive_prompt = reinforce_fl2v_prompt(
                positive_prompt,
                has_end_frame=has_end,
                has_start_frame=has_start,
            )
        elif seg.task_key == "r2v":
            ref_idxs = [int(getattr(r, "index", 0)) for r in (seg.refs or []) if r is not None]
            vid_idxs = [int(getattr(v, "index", 0)) for v in (getattr(seg, "ref_videos", None) or []) if v is not None]
            semantic_audio_tags = [
                value
                for (kind, _asset_id), value in (getattr(seg, "reference_tags", None) or {}).items()
                if kind == "audio"
            ]
            audio_idxs = [
                int(tag.removeprefix("<Audio ").removesuffix(">")) - 1
                for tag in semantic_audio_tags
                if tag.startswith("<Audio ") and tag.endswith(">")
            ] or [
                int(getattr(a, "index", 0))
                for a in (seg.ref_audios or [])
                if a is not None
            ]
            positive_prompt = reinforce_r2v_prompt(
                positive_prompt,
                ref_indices=ref_idxs,
                video_indices=vid_idxs,
                audio_indices=audio_idxs,
            )
        elif seg.task_key == "v2v":
            positive_prompt = reinforce_v2v_prompt(positive_prompt)
        elif seg.task_key == "rv2v":
            ref_idxs = [int(getattr(r, "index", 0)) for r in (seg.refs or []) if r is not None]
            audio_idxs = [int(getattr(a, "index", 0)) for a in (seg.ref_audios or []) if a is not None]
            positive_prompt = reinforce_rv2v_prompt(
                positive_prompt, ref_indices=ref_idxs, audio_indices=audio_idxs,
            )

        report_director_progress(
            node_id, segment_index=progress_index, segment_total=seg_total,
            phase="context_encode", phase_value=0, phase_max=1, **meta,
        )

        first_frame, last_frame, ref_images, ref_videos, ref_audios, ref_video_audios = _build_minimax_inputs(
            plan,
            seg,
            clip_frames=visible_clip_frames,
            reference_clip_frames=reference_clip_frames,
            ctx_w=ctx_w,
            ctx_h=ctx_h,
            prev_tail=prev_tail,
        )

        if ref_videos:
            ref_videos = {
                name: fit_canvas(frames, ctx_w, ctx_h)
                for name, frames in ref_videos.items()
            }

        if seg.task_key in {"r2v", "v2v", "rv2v"} and (
            ref_images or ref_videos or ref_audios or ref_video_audios
        ) and audio_vae is None:
            raise ValueError("r2v/v2v/rv2v / reference conditioning requires audio_vae input.")

        positive, negative, latent, task_hint = run_minimax_conditioning(
            clip=clip,
            vae=vae,
            audio_vae=audio_vae,
            prompt=positive_prompt,
            width=ctx_w,
            height=ctx_h,
            length=num_frames,
            task_key=seg.task_key,
            first_frame=first_frame,
            last_frame=last_frame,
            ref_images=ref_images,
            ref_videos=ref_videos,
            ref_video_audios=ref_video_audios,
            ref_audios=ref_audios,
        )

        motion_info = None
        if context_entry is not None:
            positive, motion_info = apply_exported_motion_context(
                positive,
                video_vae=vae,
                audio_vae=audio_vae,
                latent=latent,
                context_frames=context_entry.frames,
                context_audio=context_entry.audio,
                context_latent=context_entry.latent,
                context_end_frame=int(
                    (context_entry.handoff or {}).get("context_end_frame") or 0
                ) or None,
                context_span=context_span,
                target_frame_count=target_len,
                generation_frame_count=num_frames,
                visual_enabled=apply_visual_context,
                audio_enabled=apply_audio_context,
                fps=float(plan.frame_rate or 24.0),
                color_reanchor_enabled=color_reanchor_requested,
                color_anchor=color_anchor,
                task_key=seg.task_key,
                pin_renorm_enabled=bool(pin_renorm_enabled and apply_visual_context),
                pin_renorm_baseline_std=(
                    (context_entry.handoff or {}).get("pin_renorm_baseline_std")
                    if context_entry is not None
                    else None
                ),
            )

        report_director_progress(
            node_id, segment_index=progress_index, segment_total=seg_total,
            phase="context_encode", phase_value=1, phase_max=1, **meta,
        )

        if clear_vram_between_segments:
            cleanup_segment_vram(enabled=True, unload_models=seg_total > 1)

        def _report_sample_phase(phase: str, value: float) -> None:
            report_director_progress(
                node_id, segment_index=progress_index, segment_total=seg_total,
                phase=phase, phase_value=value, phase_max=1, **meta,
            )

        def _report_step_preview(step: int, total_steps: int, x0) -> None:
            # Live frame for the batch-card preview slot (「生成中…」 area).
            try:
                from .tae_preview import pil_to_jpeg_b64, x0_to_preview_pil

                pil = x0_to_preview_pil(x0, max_side=512)
                if pil is None:
                    return
                report_director_segment_preview(
                    node_id,
                    segment_index=ui_idx,
                    image_b64=pil_to_jpeg_b64(pil),
                    width=pil.width,
                    height=pil.height,
                    live=True,
                    step=step + 1,
                    total_steps=total_steps,
                )
            except Exception as exc:
                log.debug("Live TAE preview skipped: %s", exc)

        try:
            samples = sample_single_stage(
                model=model,
                positive=positive,
                negative=negative,
                latent=latent,
                seed=seed,
                cfg=cfg,
                steps=steps,
                sampler_name=sampler,
                scheduler=scheduler,
                shift_video=shift_video,
                shift_audio=shift_audio,
                external_sampler=external_sampler,
                external_sigmas=external_sigmas,
                on_phase=_report_sample_phase,
                on_step_preview=_report_step_preview if live_tae_preview else None,
                preview_every=1,
            )
        except torch.cuda.OutOfMemoryError as exc:
            raise RuntimeError(
                "Motion Director ran out of VRAM during H3 sampling. Motion "
                "Context adds conditioning rows; reduce resolution, use fewer "
                "references, or keep clear_vram_between_segments enabled. No "
                "context/reference was silently removed."
            ) from exc

        report_director_progress(
            node_id, segment_index=progress_index, segment_total=seg_total,
            phase="decode", phase_value=0, phase_max=1, **meta,
        )
        decoded, audio_dict = _decode_av_latent(
            samples, vae, audio_vae, decode_audio=decode_audio,
        )
        report_director_progress(
            node_id, segment_index=progress_index, segment_total=seg_total,
            phase="decode", phase_value=1, phase_max=1, **meta,
        )

        fps = float(plan.frame_rate or 24.0)
        decoded, audio_dict = trim_segment_av(
            decoded,
            audio_dict,
            head_frames=context_span,
            target_frames=target_len,
            fps=fps,
        )

        if (
            color_reanchor_requested
            and apply_visual_context
            and not source_bridge_active
            and context_entry is not None
            and isinstance(context_entry.frames, torch.Tensor)
            and int(context_entry.frames.shape[0]) > 0
            and isinstance(decoded, torch.Tensor)
            and int(decoded.shape[0]) > 0
        ):
            decoded = apply_seam_color_match(
                decoded,
                context_entry.frames,
            )

        chunk = decoded.cpu().float()
        handoff = {
            # Exclusive endpoint on the sampled timeline. Alignment frames after
            # this coordinate are internal overshoot, never continuation input.
            "context_end_frame": int(context_span + target_len),
            "trim_frames": int(context_span),
            "export_frames": int(target_len),
            "sample_frames": int(num_frames),
        }
        if (
            apply_visual_context
            and motion_info is not None
            and motion_info.pin_renorm_baseline_std is not None
        ):
            handoff["pin_renorm_baseline_std"] = float(
                motion_info.pin_renorm_baseline_std
            )
        sampled_context_latent = None
        cached_handoff = None
        if context_pipeline_active:
            sampled_context_latent, cached_handoff = prepare_latent_context_tail(
                samples,
                handoff,
            )
        if audio_has_samples(audio_dict):
            audio_dict = {
                "waveform": audio_dict["waveform"].detach().cpu(),
                "sample_rate": int(audio_dict["sample_rate"]),
            }
        write_segment_cache_if_required(
            persist_segment_cache,
            lambda: save_segment_cache(
                node_id,
                seg,
                plan,
                chunk,
            ),
        )

        write_segment_cache_if_required(
            persist_segment_cache,
            lambda: save_segment_audio_cache(
                node_id,
                seg,
                plan,
                audio_dict if audio_mode == AUDIO_MODE_GENERATE else None,
            ),
        )
        if context_pipeline_active:
            if not save_motion_context_cache(
                node_id,
                seg,
                plan,
                frames=chunk,
                audio=audio_dict if audio_mode == AUDIO_MODE_GENERATE else None,
                settings=cache_settings,
            ):
                reports.append(
                    f"Segment {ui_idx + 1}: Motion Context cache write failed; "
                    "selection-run continuation from this segment will be unavailable."
                )
            if not save_latent_context_cache(
                node_id,
                seg,
                plan,
                latent=sampled_context_latent,
                handoff=cached_handoff,
                settings=cache_settings,
            ):
                reports.append(
                    f"Segment {ui_idx + 1}: AV latent handoff cache write failed; "
                    "selection-run will use exported RGB/audio fallback if available."
                )
        completed_outputs[seg.index] = chunk
        completed_contexts[timeline_slot] = CachedMotionContext(
            frames=chunk,
            audio=audio_dict if audio_has_samples(audio_dict) else None,
            metadata={
                "fps": float(plan.frame_rate or 24.0),
                "frame_count": int(chunk.shape[0]),
                "width": int(chunk.shape[2]),
                "height": int(chunk.shape[1]),
                "segment_index": int(seg.index),
            },
            latent=sampled_context_latent,
            handoff=cached_handoff,
        )

        if (
            not source_bridge_active
            and seg.task_key in {"t2v", "i2v", "r2v", "fl2v", "v2v", "rv2v"}
            and decoded.shape[0] >= 1
        ):
            try:
                frames_b64 = [
                    tensor_frame_to_jpeg_b64(decoded[i])
                    for i in range(int(decoded.shape[0]))
                ]
                h, w = int(decoded.shape[1]), int(decoded.shape[2])
                report_director_segment_preview(
                    node_id,
                    segment_index=ui_idx,
                    image_b64=frames_b64[0],
                    width=w,
                    height=h,
                    frames=frames_b64,
                    fps=float(plan.frame_rate or 24),
                )
            except Exception as exc:
                log.debug("Segment video preview skipped: %s", exc)

        if clear_vram_between_segments:
            cleanup_segment_vram(enabled=True)

        reports.append(
            f"Segment {ui_idx + 1}/{timeline_seg_total}: {task_hint} "
            f"({target_len} frames, seed={seed})"
        )
        if source_bridge_active:
            reports.append(
                f"Segment {ui_idx + 1}: visual Motion Context skipped; "
                "nominal segment generation retained for Source Bridge anchors."
            )
            if color_reanchor_requested:
                reports.append(
                    f"Segment {ui_idx + 1}: Color Re-anchor skipped (Source Bridge)."
                )
        elif motion_info is None:
            reports.append(f"Segment {ui_idx + 1}: no previous context")
            if color_reanchor_requested:
                reports.append(
                    f"Segment {ui_idx + 1}: Color Re-anchor skipped (no incoming Motion Context)."
                )
        else:
            reports.append(
                f"Segment {ui_idx + 1}: context source = Segment {ui_idx}; "
                f"visual source = {motion_info.visual_source}; "
                f"audio source = {motion_info.audio_source}; "
                f"video context = {motion_info.context_frames} frames; "
                f"audio context = {motion_info.audio_seconds:.3f}s; "
                f"removed start anchors = {motion_info.removed_start_anchors}; "
                f"preserved last anchors = {motion_info.preserved_last_anchors}"
            )
            if pin_renorm_enabled:
                reports.append(
                    f"Segment {ui_idx + 1}: pin_renorm = "
                    f"{motion_info.pin_renorm_status}; "
                    f"baseline std = {motion_info.pin_renorm_baseline_std}; "
                    f"input std = {motion_info.pin_renorm_input_std}; "
                    f"scale = {motion_info.pin_renorm_scale:.6f}"
                )
            reports.append(
                f"Segment {ui_idx + 1}: Color Re-anchor: "
                f"{motion_info.color_reanchor_status}"
            )
        log.info(
            "MiniMax H3 Motion Director segment %d/%d done (%d frames, task=%s)",
            ui_idx + 1, timeline_seg_total, target_len, seg.task_key,
        )
        return chunk, audio_dict

    for seg in all_segments:
        if seg.index in run_indices:
            if clear_vram_between_segments and selected_results:
                cleanup_segment_vram(enabled=True)
            chunk, audio_dict = _run_one_segment(
                seg, progress_index=progress_pos[seg.index]
            )
            result = (chunk, audio_dict or {})
            nominal_generated_frames[int(seg.index)] = chunk
            selected_results[int(seg.index)] = result
            if plan.export_mode == "all":
                all_export_results[int(seg.index)] = result
            continue

        if plan.export_mode != "all":
            continue

        # Full-export reconstruction always requires the full segment cache.
        # Motion Context caches are endpoint tails and must never masquerade as
        # a complete old segment after the V2 tail-cache migration.
        cached = load_segment_cache(node_id, seg, plan)
        cached_context = None
        cached_latent_context = None
        if context_pipeline_active:
            cached_latent_context = load_latent_context_cache(
                node_id,
                seg,
                plan,
                settings=cache_settings,
            )
        if source_bridge_enabled(seg.task_key, requested_source_bridge):
            cached_context = load_motion_context_cache(
                node_id,
                seg,
                plan,
                settings=cache_settings,
                strict=False,
            ) if context_pipeline_active else None
        elif context_pipeline_active:
            cached_context = load_motion_context_cache(
                node_id,
                seg,
                plan,
                settings=cache_settings,
                strict=False,
            )
        if cached_latent_context is not None:
            cached_context = CachedMotionContext(
                frames=cached_context.frames if cached_context is not None else None,
                audio=cached_context.audio if cached_context is not None else None,
                metadata=(
                    cached_context.metadata
                    if cached_context is not None
                    else cached_latent_context.metadata
                ),
                latent=cached_latent_context.latent,
                handoff=cached_latent_context.handoff,
            )
            completed_contexts[int(seg.timeline_index)] = cached_context
        if cached is not None:
            cached = cached.float()

            cached_audio = None
            if audio_mode == AUDIO_MODE_GENERATE:
                cached_audio = load_segment_audio_cache(
                    node_id,
                    seg,
                    plan,
                )

                if not audio_has_samples(cached_audio):
                    raise ValueError(
                        f"Segment {seg.index + 1} has a valid video cache but no "
                        "full generated audio cache. Run the full sequence once "
                        "to rebuild complete video + audio segment caches before "
                        "using partial regeneration."
                    )

            if source_bridge_enabled(seg.task_key, requested_source_bridge):
                nominal_generated_frames[int(seg.index)] = cached

            completed_outputs[seg.index] = cached

            if cached_context is not None:
                completed_contexts[int(seg.timeline_index)] = cached_context

            reports.append(
                f"Segment {seg.index + 1}/{len(all_segments)}: "
                f"loaded from full segment cache ({cached.shape[0]} frames)"
            )

            all_export_results[int(seg.index)] = (
                cached,
                cached_audio if cached_audio is not None else {},
            )
            continue
        # Not selected + no cache: keep full-timeline export by passthrough (do NOT sample).
        fill = segment_passthrough_chunk(plan, seg)
        if fill is None:
            raise ValueError(
                f"Segment {seg.index + 1} is not selected and has no valid cache or source "
                "frames to passthrough. Include it in「选择运行」, or switch export to「分段导出」."
            )
        completed_outputs[seg.index] = fill
        passthrough_indices.append(seg.index)
        reports.append(
            f"Segment {seg.index + 1}/{len(all_segments)}: source passthrough "
            f"({fill.shape[0]} frames, not sampled — outside run selection)"
        )
        all_export_results[int(seg.index)] = (fill, {})

    if passthrough_indices:
        reports.append(
            "Passthrough (not sampled) segment(s) "
            f"{[i + 1 for i in passthrough_indices]} — run selection is honored; "
            "unselected gaps filled from cache/source for「全部导出」."
        )

    def _report_resolved_preview(seg, frames: torch.Tensor) -> None:
        if int(frames.shape[0]) <= 0:
            return
        try:
            frames_b64 = [
                tensor_frame_to_jpeg_b64(frames[i])
                for i in range(int(frames.shape[0]))
            ]
            height, width = int(frames.shape[1]), int(frames.shape[2])
            report_director_segment_preview(
                node_id,
                segment_index=int(seg.timeline_index),
                image_b64=frames_b64[0],
                width=width,
                height=height,
                frames=frames_b64,
                fps=float(plan.frame_rate or 24),
            )
        except Exception as exc:
            log.debug("Resolved Source Bridge preview skipped: %s", exc)

    def _nominal_for_bridge(seg) -> torch.Tensor:
        index = int(seg.index)
        frames, loaded_from_disk = resolve_nominal_segment_frames(
            nominal_generated_frames,
            segment_index=index,
            expected_frames=int(seg.frame_count),
            disk_loader=lambda: load_segment_cache(node_id, seg, plan),
        )
        if loaded_from_disk:
            reports.append(
                f"Segment {int(seg.timeline_index) + 1}: loaded validated nominal "
                "segment cache for Source Bridge."
            )
        return frames

    generated_bridges: list[GeneratedSourceBridge] = []
    for left, right in source_bridge_pairs:
        pair_indices = {int(left.index), int(right.index)}
        if plan.export_mode != "all" and not pair_indices.intersection(run_indices):
            continue

        window, skip_reason = resolve_source_bridge_window(plan, left, right)
        if window is None:
            reports.append(
                f"Boundary Segment {int(left.timeline_index) + 1} → "
                f"{int(right.timeline_index) + 1}: {skip_reason} "
                "Nominal hard cut retained."
            )
            continue
        if (
            "rv2v" in {left.task_key, right.task_key}
            and not reference_bundles_match(left, right)
        ):
            reports.append(
                f"Boundary Segment {int(left.timeline_index) + 1} → "
                f"{int(right.timeline_index) + 1}: Source Bridge skipped because "
                "the effective RV2V Picture/Audio reference bundles differ. "
                "Nominal hard cut retained."
            )
            continue

        left_frames = _nominal_for_bridge(left)
        right_frames = _nominal_for_bridge(right)
        first_anchor, last_anchor = bridge_anchors(
            left, left_frames, right, right_frames, window
        )
        bridge_raw = load_source_bridge_clip(plan, window)
        if plan.output_mode == "fixed":
            bridge_source = fit_canvas(bridge_raw, plan.width, plan.height)
        else:
            bridge_source = fit_video_long_edge(
                bridge_raw,
                plan.ref_max_size,
                stride=plan_spatial_stride,
            )
        bridge_height = int(bridge_source.shape[1])
        bridge_width = int(bridge_source.shape[2])

        bridge_prompt = right.prompt if right.prompt != left.prompt else left.prompt
        if right.task_key == "v2v":
            bridge_prompt = reinforce_v2v_prompt(bridge_prompt)
        else:
            ref_idxs = [
                int(getattr(ref, "index", 0))
                for ref in (right.refs or [])
                if ref is not None
            ]
            audio_idxs = [
                int(getattr(ref, "index", 0))
                for ref in (right.ref_audios or [])
                if ref is not None
            ]
            bridge_prompt = reinforce_rv2v_prompt(
                bridge_prompt,
                ref_indices=ref_idxs,
                audio_indices=audio_idxs,
            )

        (
            _unused_first,
            _unused_last,
            ref_images,
            ref_videos,
            ref_audios,
            ref_video_audios,
        ) = _build_minimax_inputs(
            plan,
            right,
            clip_frames=bridge_source,
            reference_clip_frames=bridge_source,
            ctx_w=bridge_width,
            ctx_h=bridge_height,
            prev_tail=None,
        )
        positive, negative, latent, _task_hint = run_minimax_conditioning(
            clip=clip,
            vae=vae,
            audio_vae=audio_vae,
            prompt=bridge_prompt,
            width=bridge_width,
            height=bridge_height,
            length=5,
            task_key=right.task_key,
            first_frame=None,
            last_frame=None,
            ref_images=ref_images,
            ref_videos=ref_videos,
            ref_video_audios=ref_video_audios,
            ref_audios=ref_audios,
        )
        positive = append_minimax_keyframe_anchors(
            positive,
            vae=vae,
            first_frame=first_anchor,
            last_frame=last_anchor,
            frame_count=5,
            width=bridge_width,
            height=bridge_height,
        )
        if clear_vram_between_segments:
            cleanup_segment_vram(enabled=True, unload_models=True)
        try:
            bridge_samples = sample_single_stage(
                model=model,
                positive=positive,
                negative=negative,
                latent=latent,
                seed=seed,
                cfg=cfg,
                steps=steps,
                sampler_name=sampler,
                scheduler=scheduler,
                shift_video=shift_video,
                shift_audio=shift_audio,
                external_sampler=external_sampler,
                external_sigmas=external_sigmas,
            )
        except torch.cuda.OutOfMemoryError as exc:
            raise RuntimeError(
                "Motion Director ran out of VRAM while sampling the five-frame "
                "Source Bridge. No source frame or nominal hard cut was silently "
                "substituted."
            ) from exc
        bridge_decoded, _ignored_audio = _decode_av_latent(
            bridge_samples, vae, audio_vae, decode_audio=False
        )
        if int(bridge_decoded.shape[0]) < 5:
            raise ValueError(
                "Source Bridge H3 decode returned fewer than 5 frames; refusing "
                "to expose source conditioning pixels or pad generated output."
            )
        bridge_frames = bridge_decoded[:5].detach().cpu().float()
        generated_bridges.append(
            GeneratedSourceBridge(
                left_segment_index=int(left.index),
                right_segment_index=int(right.index),
                window=window,
                frames=bridge_frames,
            )
        )
        reports.append(
            f"Boundary Segment {int(left.timeline_index) + 1} → "
            f"{int(right.timeline_index) + 1}:\n"
            f"source frames = {window.source_start}..{window.source_end - 1}\n"
            "length = 5\n"
            f"seed = {seed}\n"
            f"first anchor = Segment {int(left.timeline_index) + 1} source "
            f"frame {window.first_anchor_source_time}\n"
            f"last anchor = Segment {int(right.timeline_index) + 1} source "
            f"frame {window.last_anchor_source_time}\n"
            f"emitted bridge frames = {window.emitted_source_start}.."
            f"{window.emitted_source_end - 1} (decoded[1:4])\n"
            "visual Motion Context = skipped\n"
            "audio = unchanged nominal segment audio"
        )
        if clear_vram_between_segments:
            cleanup_segment_vram(enabled=True)

    if generated_bridges:
        resolved = assemble_source_bridges(
            all_segments,
            nominal_generated_frames,
            generated_bridges,
        )
        for index, frames in resolved.items():
            completed_outputs[index] = frames
            if index in selected_results:
                selected_results[index] = (frames, selected_results[index][1])
            if index in all_export_results:
                all_export_results[index] = (frames, all_export_results[index][1])

    # Bridge-mode previews always show the final contribution.  Internal
    # source conditioning and the two anchor endpoints are never exposed.
    for seg in all_segments:
        if (
            int(seg.index) in run_indices
            and source_bridge_enabled(seg.task_key, requested_source_bridge)
            and int(seg.index) in selected_results
        ):
            _report_resolved_preview(seg, selected_results[int(seg.index)][0])

    missing_selected = [index for index in run_list if index not in selected_results]
    if missing_selected:
        raise RuntimeError(
            "Motion Director internal error: selected segment result(s) missing after "
            f"Source Bridge resolution: {[i + 1 for i in missing_selected]}"
        )
    segment_outputs = [selected_results[index][0] for index in run_list]
    segment_audios = [selected_results[index][1] for index in run_list]

    if not segment_outputs:
        raise ValueError("Director plan produced no segments.")

    report_director_finish(node_id, seg_total)
    if plan.export_mode == "all":
        missing_all = [seg.index for seg in all_segments if seg.index not in all_export_results]
        if missing_all:
            raise RuntimeError(
                "Motion Director internal error: full export segment result(s) missing: "
                f"{[i + 1 for i in missing_all]}"
            )
        export_chunks = [all_export_results[int(seg.index)][0] for seg in all_segments]
        export_audios = [all_export_results[int(seg.index)][1] for seg in all_segments]
        export_segments = all_segments
    else:
        export_chunks = segment_outputs
        export_audios = segment_audios
        export_segments = [all_segments[i] for i in run_list]
    if context_pipeline_active or bridge_feature_active:
        # Legacy continuity also applies post-decode seam grading in concat.
        # Motion Context and Source Bridge each own their handoff, so
        # bypass every legacy post-decode seam rewrite.
        from ..lib.image_prep import cat_frames_variable_size

        combined = cat_frames_variable_size(export_chunks)
    else:
        combined = concat_continuous_chunks(export_chunks, export_segments, plan)
    return combined, segment_outputs, export_audios, "\n".join(reports)
