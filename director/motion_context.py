# Portions derived from ComfyUI-H3-Motion-Context
# Copyright (C) 2026 NikoDemon80 and contributors
# Modified for MiniMax H3 Motion Director, 2026-08-09
# Licensed under GNU GPL v3.0. See LICENSE and NOTICE.

"""Exported-frame MiniMax H3 Motion/Audio Context conditioning."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import torch

from ..lib.image_prep import preflight_h3_visual_conditioning
from ..patches import MC_AUDIO_KEY, MC_KEY, motion_context_patch_status
from .color_reanchor import apply_color_reanchor

log = logging.getLogger("ComfyUI-MiniMax-H3-Motion-Director.motion_context")

FPS = 24.0
AUDIO_LATENT_HZ = 40.0
FRAME_PER_TOKEN = (1, 4, 4, 4, 4)
VIDEO_CONTEXT_GRID = (39, 22, 5, 1)


@dataclass(frozen=True)
class MotionContextInfo:
    context_frames: int
    conditioning_blocks: int
    audio_steps: int
    audio_seconds: float
    removed_start_anchors: int
    preserved_last_anchors: int
    color_reanchor_status: str = "OFF"
    visual_source: str = "pixels (fallback)"
    audio_source: str = "off"
    context_end_frame: int = 0
    pin_renorm_baseline_std: float | None = None
    pin_renorm_input_std: float | None = None
    pin_renorm_scale: float = 1.0
    pin_renorm_status: str = "OFF"


def pixel_frames_for_latent_steps(latent_t: int) -> int:
    return sum(FRAME_PER_TOKEN[i % len(FRAME_PER_TOKEN)] for i in range(int(latent_t)))


def latent_step_offsets(latent_t: int) -> list[int]:
    out: list[int] = []
    cursor = 0
    for i in range(int(latent_t)):
        out.append(cursor)
        cursor += FRAME_PER_TOKEN[i % len(FRAME_PER_TOKEN)]
    return out


def _steps_for_context_span(span: int) -> int:
    wanted = int(span)
    for steps in range(1, 256):
        covered = pixel_frames_for_latent_steps(steps)
        if covered == wanted:
            return steps
        if covered > wanted:
            break
    raise ValueError(
        "Motion Director: %d context frames do not map to whole H3 latent blocks."
        % wanted
    )


def video_context_from_latent(
    context_latent: dict[str, Any],
    *,
    span: int,
    context_end_frame: int | None = None,
) -> tuple[list[torch.Tensor], list[int], int]:
    """Select latent blocks ending at/before the real exported endpoint.

    ``context_end_frame`` is exclusive on the sampled pixel timeline.  Aligned
    H3 sampling may extend beyond it; those overshoot blocks are never selected.
    Returns blocks, destination offsets, and the selected source endpoint.
    """
    video = _latent_video_stream(context_latent)
    total_steps = int(video.shape[2])
    needed_steps = _steps_for_context_span(span)
    sample_frames = pixel_frames_for_latent_steps(total_steps)
    end_limit = sample_frames if context_end_frame is None else min(
        sample_frames, max(0, int(context_end_frame))
    )
    end_step = 0
    selected_end = 0
    for steps in range(1, total_steps + 1):
        endpoint = pixel_frames_for_latent_steps(steps)
        if endpoint > end_limit:
            break
        end_step = steps
        selected_end = endpoint
    if end_step < needed_steps:
        raise ValueError(
            "Motion Director: previous AV latent has no %d-frame context window "
            "ending at/before exported frame %d." % (int(span), end_limit)
        )
    start_step = end_step - needed_steps
    blocks = [
        video[:1, :, step : step + 1].clone()
        for step in range(start_step, end_step)
    ]
    return blocks, latent_step_offsets(needed_steps), selected_end


def _latent_audio_stream(latent: dict[str, Any]) -> torch.Tensor:
    samples = latent.get("samples") if isinstance(latent, dict) else None
    if hasattr(samples, "unbind"):
        streams = list(samples.unbind())
    elif isinstance(samples, (tuple, list)):
        streams = list(samples)
    else:
        streams = []
    if len(streams) < 2:
        raise ValueError("Motion Director: previous AV latent has no audio stream.")
    audio = streams[1]
    if audio.ndim != 4:
        raise ValueError(
            "Motion Director: H3 audio latent must be [B,C,2,T], got %s."
            % (tuple(audio.shape),)
        )
    return audio


def _audio_context_from_latent(
    context_latent: dict[str, Any],
    *,
    span: int,
    context_end_frame: int | None,
) -> tuple[dict[str, Any], int]:
    audio = _latent_audio_stream(context_latent)
    total_steps = int(audio.shape[-1])
    end_step = total_steps if context_end_frame is None else min(
        total_steps,
        max(0, int(round(float(context_end_frame) / FPS * AUDIO_LATENT_HZ))),
    )
    wanted_steps = max(1, int(round(float(span) / FPS * AUDIO_LATENT_HZ)))
    if end_step < wanted_steps:
        raise ValueError(
            "Motion Director: previous AV latent audio is shorter than the requested context."
        )
    encoded = audio[..., end_step - wanted_steps : end_step].clone()
    return {
        "kind": "audio",
        "ref_audio_t": wanted_steps,
        "audio_latent": encoded,
        MC_AUDIO_KEY: float(span),
    }, wanted_steps


def select_context_span(requested: int, available: int) -> int:
    n = min(max(1, int(requested)), max(0, int(available)))
    for run in VIDEO_CONTEXT_GRID:
        if run <= n:
            return run
    raise ValueError("Motion Director: previous segment has no frames for Motion Context.")


def _resize_frames(images: torch.Tensor, width: int, height: int) -> torch.Tensor:
    import comfy.utils

    # Avoid a no-op Lanczos pass.  Besides wasting time, some backends slightly
    # change even constant edge pixels when source and target sizes are equal;
    # Motion Context should encode the exact exported endpoint in that case.
    if int(images.shape[1]) == int(height) and int(images.shape[2]) == int(width):
        return images[..., :3].contiguous()
    samples = images[..., :3].movedim(-1, 1)
    samples = comfy.utils.common_upscale(
        samples, int(width), int(height), "lanczos", "disabled"
    )
    return samples.movedim(1, -1)


def _latent_video_stream(latent: dict[str, Any]) -> torch.Tensor:
    samples = latent.get("samples") if isinstance(latent, dict) else None
    if samples is None:
        raise ValueError("Motion Director: H3 conditioning returned no latent samples.")
    if hasattr(samples, "unbind"):
        streams = list(samples.unbind())
    elif isinstance(samples, (tuple, list)):
        streams = list(samples)
    else:
        raise ValueError(
            "Motion Director: expected a MiniMax H3 nested video/audio latent, got %r."
            % type(samples)
        )
    if not streams:
        raise ValueError("Motion Director: H3 AV latent contains no video stream.")
    video = streams[0]
    if video.ndim == 4:
        video = video.unsqueeze(0)
    if video.ndim != 5:
        raise ValueError(
            "Motion Director: H3 video latent must be [B,C,T,H,W], got %s."
            % (tuple(video.shape),)
        )
    return video


def renorm_context_video_latent(
    context_latent: dict[str, Any],
    baseline_std: float | None,
    *,
    epsilon: float = 1e-6,
) -> tuple[dict[str, Any], float, float, float]:
    """Match only the cached VIDEO latent scale to a chain-local baseline.

    The global mean is retained, so this changes statistical scale without
    substituting pose/content. Audio and every non-video stream are returned
    unchanged.
    """
    video = _latent_video_stream(context_latent)
    current_std = float(video.float().std(unbiased=False).item())
    target_std = current_std if baseline_std is None else float(baseline_std)
    if not torch.isfinite(torch.tensor(current_std)) or current_std <= epsilon:
        raise ValueError("Motion Director: pin_renorm received a zero/invalid video latent std.")
    if not torch.isfinite(torch.tensor(target_std)) or target_std <= epsilon:
        raise ValueError("Motion Director: pin_renorm baseline std is zero or invalid.")
    scale = target_std / current_std
    mean = video.float().mean()
    adjusted = ((video.float() - mean) * scale + mean).to(dtype=video.dtype)
    samples = context_latent.get("samples")
    if hasattr(samples, "unbind"):
        streams = list(samples.unbind())
    elif isinstance(samples, (tuple, list)):
        streams = list(samples)
    else:
        streams = [samples]
    streams[0] = adjusted
    result = dict(context_latent)
    result["samples"] = tuple(streams)
    return result, target_std, current_std, scale


def _encode_video_context(
    vae,
    frames: torch.Tensor,
    *,
    width: int,
    height: int,
    span: int,
    color_reanchor_enabled: bool = False,
    color_anchor: torch.Tensor | None = None,
    task_key: str = "unknown",
) -> tuple[list[dict[str, Any]], int, str]:
    if int(frames.shape[0]) < span:
        raise ValueError(
            "Motion Director: previous segment has %d frames; %d context frames are required."
            % (int(frames.shape[0]), span)
        )
    tail = _resize_frames(frames[-span:], width, height)
    color_status = "OFF"
    if color_reanchor_enabled:
        if color_anchor is None or not isinstance(color_anchor, torch.Tensor) or int(color_anchor.numel()) == 0:
            color_status = "skipped (no anchor)"
        else:
            anchor = _resize_frames(color_anchor[:1], width, height)
            tail = apply_color_reanchor(tail, anchor)
            color_status = "ON"
    preflight_h3_visual_conditioning(
        tail,
        task_key=task_key,
        path="motion_context",
    )
    try:
        encoded = vae.encode(tail)
    except torch.cuda.OutOfMemoryError as exc:
        raise RuntimeError(
            "Motion Director ran out of VRAM while encoding Motion Context. "
            "Context rows increase memory use; reduce output resolution or enable "
            "clear_vram_between_segments. Context was not silently reduced."
        ) from exc
    if not isinstance(encoded, torch.Tensor) or encoded.ndim != 5:
        raise ValueError(
            "Motion Director: video VAE returned %r for Motion Context; expected "
            "[B,C,T,H,W]." % (getattr(encoded, "shape", type(encoded)),)
        )
    latent_t = int(encoded.shape[2])
    covered = pixel_frames_for_latent_steps(latent_t)
    if covered != span:
        raise RuntimeError(
            "Motion Director: %d exported frames encoded to %d H3 steps covering "
            "%d frames. The H3 VAE temporal grid changed; Motion Context is disabled."
            % (span, latent_t, covered)
        )
    keyframes = []
    for step, pixel_index in enumerate(latent_step_offsets(latent_t)):
        keyframes.append(
            {
                "resolved_frame_index": 0,
                MC_KEY: int(pixel_index),
                "latent": encoded[:, :, step : step + 1],
            }
        )
    return keyframes, latent_t, color_status


def _encode_audio_context(
    audio_vae,
    audio: dict[str, Any],
    *,
    span: int,
) -> tuple[dict[str, Any], int]:
    try:
        import torchaudio
    except ImportError as exc:  # pragma: no cover - shipped with ComfyUI
        raise RuntimeError("Motion Director: torchaudio is required for audio context.") from exc

    waveform = audio.get("waveform") if isinstance(audio, dict) else None
    if not isinstance(waveform, torch.Tensor) or waveform.numel() <= 0:
        raise ValueError(
            "Motion Director: Continue Generated Audio is enabled, but the previous "
            "segment has no exported generated audio."
        )
    sr = int(audio.get("sample_rate") or 0)
    vae_sr = int(getattr(audio_vae, "audio_sample_rate", 32000))
    if sr <= 0:
        raise ValueError("Motion Director: previous audio has an invalid sample rate.")
    if sr != vae_sr:
        waveform = torchaudio.functional.resample(waveform, sr, vae_sr)
    wanted = int(round(span / FPS * vae_sr))
    have = int(waveform.shape[-1])
    if have < wanted:
        raise ValueError(
            "Motion Director: previous exported audio is %.3fs, shorter than the "
            "%.3fs Motion Context window."
            % (have / vae_sr, span / FPS)
        )
    tail = waveform[:1, ..., have - wanted :]
    try:
        encoded = audio_vae.encode(tail.movedim(1, -1))
    except torch.cuda.OutOfMemoryError as exc:
        raise RuntimeError(
            "Motion Director ran out of VRAM while encoding Motion Audio Context. "
            "Generated audio continuation was not silently disabled."
        ) from exc
    if not isinstance(encoded, torch.Tensor) or encoded.ndim != 4:
        raise ValueError(
            "Motion Director: audio VAE returned an unexpected Motion Audio latent."
        )
    steps = int(encoded.shape[-1])
    if steps <= 0:
        raise ValueError("Motion Director: Motion Audio Context encoded to zero steps.")
    return {
        "kind": "audio",
        "ref_audio_t": steps,
        "audio_latent": encoded,
        MC_AUDIO_KEY: float(span),
    }, steps


def _merge_one_metadata(
    metadata: dict[str, Any],
    *,
    motion_keyframes: list[dict[str, Any]],
    motion_audio_ref: dict[str, Any] | None,
    generation_frame_count: int,
    visible_last_index: int,
    visible_start_index: int = 0,
    visual_context_enabled: bool = True,
) -> tuple[dict[str, Any], int, int]:
    out = dict(metadata)
    existing_keyframes = list(out.get("minimax_keyframes") or [])
    existing_refs = list(out.get("minimax_refs") or [])
    if any(kf.get(MC_KEY) is not None for kf in existing_keyframes):
        raise ValueError("Motion Director: conditioning already contains Motion Context keyframes.")
    if any(ref.get(MC_AUDIO_KEY) is not None for ref in existing_refs):
        raise ValueError("Motion Director: conditioning already contains Motion Audio Context.")

    kept: list[dict[str, Any]] = []
    removed_start = 0
    preserved_last = 0
    old_frame_count = int(
        out.get("minimax_frame_count") or generation_frame_count
    )
    for keyframe in existing_keyframes:
        resolved = int(keyframe.get("resolved_frame_index", 0))
        if resolved == 0:
            if visual_context_enabled:
                removed_start += 1
                continue
            merged = dict(keyframe)
            merged[MC_KEY] = int(visible_start_index)
            merged["resolved_frame_index"] = 0
            kept.append(merged)
            continue
        merged = dict(keyframe)
        if resolved == old_frame_count - 1:
            merged[MC_KEY] = int(visible_last_index)
            preserved_last += 1
        else:
            merged[MC_KEY] = resolved
        # Stock PackedLayout accepts frame 0; the guarded layout patch applies
        # the real interior/end coordinate from MC_KEY after construction.
        merged["resolved_frame_index"] = 0
        kept.append(merged)

    out["minimax_keyframes"] = [dict(kf) for kf in motion_keyframes] + kept
    out["minimax_frame_count"] = int(generation_frame_count)
    if motion_audio_ref is not None:
        out["minimax_refs"] = existing_refs + [dict(motion_audio_ref)]
    elif existing_refs:
        out["minimax_refs"] = existing_refs
    return out, removed_start, preserved_last


def merge_motion_conditioning(
    conditioning,
    *,
    motion_keyframes: list[dict[str, Any]],
    motion_audio_ref: dict[str, Any] | None,
    generation_frame_count: int,
    visible_last_index: int,
    visible_start_index: int = 0,
    visual_context_enabled: bool = True,
) -> tuple[list, int, int]:
    if not isinstance(conditioning, (list, tuple)) or not conditioning:
        raise ValueError("Motion Director: positive conditioning is empty.")
    merged_conditioning = []
    removed_total = 0
    preserved_total = 0
    for entry in conditioning:
        if not isinstance(entry, (list, tuple)) or len(entry) < 2:
            raise ValueError("Motion Director: unsupported CONDITIONING structure.")
        metadata, removed, preserved = _merge_one_metadata(
            entry[1],
            motion_keyframes=motion_keyframes,
            motion_audio_ref=motion_audio_ref,
            generation_frame_count=generation_frame_count,
            visible_last_index=visible_last_index,
            visible_start_index=visible_start_index,
            visual_context_enabled=visual_context_enabled,
        )
        new_entry = list(entry)
        new_entry[1] = metadata
        merged_conditioning.append(new_entry)
        removed_total += removed
        preserved_total += preserved
    return merged_conditioning, removed_total, preserved_total


def apply_exported_motion_context(
    conditioning,
    *,
    video_vae,
    audio_vae,
    latent: dict[str, Any],
    context_frames: torch.Tensor | None,
    context_audio: dict[str, Any] | None,
    context_latent: dict[str, Any] | None = None,
    context_end_frame: int | None = None,
    context_span: int,
    target_frame_count: int,
    generation_frame_count: int,
    audio_enabled: bool,
    visual_enabled: bool = True,
    fps: float,
    color_reanchor_enabled: bool = False,
    color_anchor: torch.Tensor | None = None,
    task_key: str = "unknown",
    pin_renorm_enabled: bool = False,
    pin_renorm_baseline_std: float | None = None,
) -> tuple[list, MotionContextInfo]:
    ready, reason = motion_context_patch_status()
    if not ready:
        raise RuntimeError(
            "Motion Director: Motion Context cannot run because the startup "
            "compatibility self-test failed: %s" % reason
        )
    if abs(float(fps) - FPS) > 1e-6:
        raise ValueError(
            "Motion Director: Motion Context requires H3's native 24 fps; got %s."
            % fps
        )

    video = _latent_video_stream(latent)
    width = int(video.shape[-1]) * 16
    height = int(video.shape[-2]) * 16
    actual_generation_frames = pixel_frames_for_latent_steps(int(video.shape[2]))
    if actual_generation_frames != int(generation_frame_count):
        raise RuntimeError(
            "Motion Director: H3 latent covers %d frames but the generation plan "
            "expects %d. Refusing misaligned Motion Context."
            % (actual_generation_frames, generation_frame_count)
        )
    visible_last = int(context_span) + int(target_frame_count) - 1
    if visible_last >= int(generation_frame_count):
        raise ValueError(
            "Motion Director: requested output end is outside the aligned H3 timeline."
        )

    selected_context_end = int(context_end_frame or 0)
    pin_baseline = None
    pin_input_std = None
    pin_scale = 1.0
    pin_status = "OFF"
    if visual_enabled and context_latent is not None and not color_reanchor_enabled:
        visual_latent = context_latent
        if pin_renorm_enabled:
            visual_latent, pin_baseline, pin_input_std, pin_scale = renorm_context_video_latent(
                context_latent,
                pin_renorm_baseline_std,
            )
            pin_status = "BASELINE" if pin_renorm_baseline_std is None else "APPLIED"
        source_video = _latent_video_stream(visual_latent)
        source_width = int(source_video.shape[-1]) * 16
        source_height = int(source_video.shape[-2]) * 16
        if (source_width, source_height) != (width, height):
            raise ValueError(
                "Motion Director: cached context latent is %dx%d but the current "
                "segment is %dx%d. Regenerate the previous segment at this canvas."
                % (source_width, source_height, width, height)
            )
        blocks, offsets, selected_context_end = video_context_from_latent(
            visual_latent,
            span=int(context_span),
            context_end_frame=context_end_frame,
        )
        motion_keyframes = [
            {
                "resolved_frame_index": 0,
                MC_KEY: int(offset),
                "latent": block,
            }
            for block, offset in zip(blocks, offsets)
        ]
        block_count = len(blocks)
        color_status = "OFF"
        visual_source = "latent"
    elif visual_enabled:
        if not isinstance(context_frames, torch.Tensor) or int(context_frames.shape[0]) <= 0:
            reason = "Color Re-anchor" if color_reanchor_enabled else "pixel fallback"
            raise ValueError(
                f"Motion Director: {reason} requires cached exported RGB frames."
            )
        motion_keyframes, block_count, color_status = _encode_video_context(
            video_vae,
            context_frames,
            width=width,
            height=height,
            span=int(context_span),
            color_reanchor_enabled=bool(color_reanchor_enabled),
            color_anchor=color_anchor,
            task_key=task_key,
        )
        visual_source = (
            "pixels (Color Re-anchor)" if color_reanchor_enabled else "pixels (fallback)"
        )
        selected_context_end = int(context_end_frame or int(context_frames.shape[0]))
        if pin_renorm_enabled:
            pin_status = "SKIPPED (pixel visual context)"
    else:
        motion_keyframes = []
        block_count = 0
        color_status = "OFF"
        visual_source = "off"
    motion_audio_ref = None
    audio_steps = 0
    audio_source = "off"
    if audio_enabled:
        if context_latent is not None:
            try:
                motion_audio_ref, audio_steps = _audio_context_from_latent(
                    context_latent,
                    span=int(context_span),
                    context_end_frame=selected_context_end or context_end_frame,
                )
                audio_source = "latent"
            except ValueError:
                if context_audio is None:
                    raise
        if motion_audio_ref is None:
            if audio_vae is None:
                raise ValueError("Motion Director: Motion Audio Context requires audio_vae.")
            motion_audio_ref, audio_steps = _encode_audio_context(
                audio_vae, context_audio, span=int(context_span)
            )
            audio_source = "waveform (fallback)"

    merged, removed, preserved = merge_motion_conditioning(
        conditioning,
        motion_keyframes=motion_keyframes,
        motion_audio_ref=motion_audio_ref,
        generation_frame_count=int(generation_frame_count),
        visible_last_index=visible_last,
        visible_start_index=int(context_span),
        visual_context_enabled=bool(visual_enabled),
    )
    info = MotionContextInfo(
        context_frames=int(context_span) if visual_enabled else 0,
        conditioning_blocks=block_count,
        audio_steps=audio_steps,
        audio_seconds=audio_steps / AUDIO_LATENT_HZ if audio_steps else 0.0,
        removed_start_anchors=removed,
        preserved_last_anchors=preserved,
        color_reanchor_status=color_status,
        visual_source=visual_source,
        audio_source=audio_source,
        context_end_frame=selected_context_end,
        pin_renorm_baseline_std=pin_baseline,
        pin_renorm_input_std=pin_input_std,
        pin_renorm_scale=pin_scale,
        pin_renorm_status=pin_status,
    )
    return merged, info


__all__ = [
    "MotionContextInfo",
    "apply_exported_motion_context",
    "latent_step_offsets",
    "merge_motion_conditioning",
    "pixel_frames_for_latent_steps",
    "renorm_context_video_latent",
    "select_context_span",
    "video_context_from_latent",
]
