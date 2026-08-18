"""Source-audio driven sampling for MiniMax H3 video-edit tasks.

Audio Drive is deliberately an audio policy, not a new Director task.  For
V2V/RV2V it extracts the frame-aligned source PCM for the active segment,
encodes that PCM with the H3 audio VAE, replaces the audio half of the joint AV
latent, and locks that half with a zero denoise mask.  The original PCM remains
the exported soundtrack; the encoded copy exists only to drive H3 sampling.
"""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

import torch

from ..lib.audio_io import diagnose_source_audio_failure, extract_timeline_audio

AUDIO_MODE_DRIVE = "drive"
_VIDEO_EDIT_AUDIO_TASKS = frozenset({"v2v", "rv2v"})


@dataclass
class _DriveState:
    plan: Any
    audio_vae: Any
    segment: Any | None = None
    source_audio: dict[int, dict[str, Any]] = field(default_factory=dict)


_STATE: ContextVar[_DriveState | None] = ContextVar("minimax_h3_audio_drive", default=None)
_INSTALLED = False


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() not in {"", "0", "false", "off", "no", "none"}


def _raw_output(plan) -> dict[str, Any]:
    raw = getattr(plan, "raw", None) or {}
    output = raw.get("output") or {}
    return output if isinstance(output, dict) else {}


def _drive_requested(plan) -> bool:
    task_key = str(getattr(plan, "global_task_key", "") or "").strip().lower()
    if task_key not in _VIDEO_EDIT_AUDIO_TASKS:
        return False
    output = _raw_output(plan)
    if _truthy(output.get("audioDrive") if "audioDrive" in output else output.get("audio_drive")):
        return True
    raw_mode = str(output.get("audioMode") or output.get("audio_mode") or "").strip().lower()
    return raw_mode in {"drive", "audio_drive", "source_drive", "driven"}


def _has_audio(audio: Any) -> bool:
    return (
        isinstance(audio, dict)
        and isinstance(audio.get("waveform"), torch.Tensor)
        and int(audio["waveform"].numel()) > 0
        and int(audio.get("sample_rate") or 0) > 0
    )


def _nested_parts(value: Any) -> list[torch.Tensor]:
    if value is None:
        return []
    if not isinstance(value, torch.Tensor) and hasattr(value, "unbind"):
        return list(value.unbind())
    if isinstance(value, (tuple, list)):
        return list(value)
    return [value]


def _fit_audio_latent(encoded: torch.Tensor, template: torch.Tensor) -> torch.Tensor:
    if not isinstance(encoded, torch.Tensor) or encoded.ndim != 4:
        raise ValueError(
            "Motion Director Audio Drive: audio VAE must return [B,C,2,T] latent, "
            f"got {getattr(encoded, 'shape', type(encoded))}."
        )
    if not isinstance(template, torch.Tensor) or template.ndim != 4:
        raise ValueError(
            "Motion Director Audio Drive: H3 template audio latent must be [B,C,2,T]."
        )
    if tuple(encoded.shape[1:-1]) != tuple(template.shape[1:-1]):
        raise ValueError(
            "Motion Director Audio Drive: source audio latent layout does not match H3: "
            f"got {tuple(encoded.shape)}, expected middle dims {tuple(template.shape[1:-1])}."
        )

    target_batch = int(template.shape[0])
    if int(encoded.shape[0]) == 1 and target_batch > 1:
        encoded = encoded.repeat(target_batch, 1, 1, 1)
    elif int(encoded.shape[0]) != target_batch:
        encoded = encoded[:target_batch]
        if int(encoded.shape[0]) != target_batch:
            raise ValueError(
                "Motion Director Audio Drive: source audio batch cannot match H3 latent batch."
            )

    target_t = int(template.shape[-1])
    have_t = int(encoded.shape[-1])
    if have_t > target_t:
        encoded = encoded[..., :target_t]
    elif have_t < target_t:
        encoded = torch.cat(
            [
                encoded,
                encoded.new_zeros((*encoded.shape[:-1], target_t - have_t)),
            ],
            dim=-1,
        )
    return encoded.to(device=template.device, dtype=template.dtype)


def _fit_wave_samples(wave: torch.Tensor, wanted: int) -> torch.Tensor:
    wanted = max(0, int(wanted))
    have = int(wave.shape[-1])
    if have == wanted:
        return wave
    if have > wanted:
        return wave[..., :wanted].contiguous()
    return torch.cat(
        [wave, wave.new_zeros((*wave.shape[:-1], wanted - have))], dim=-1
    )


def _source_audio_for_segment(state: _DriveState, segment) -> dict[str, Any]:
    key = int(getattr(segment, "timeline_index", getattr(segment, "index", 0)))
    cached = state.source_audio.get(key)
    if cached is not None:
        return cached

    fps = float(getattr(state.plan, "frame_rate", 0.0) or 24.0)
    start = int(getattr(segment, "start_frame", 0) or 0)
    end = int(getattr(segment, "end_frame", 0) or 0)
    audio = extract_timeline_audio(getattr(state.plan, "raw", None) or {}, start, end, fps)
    if not _has_audio(audio):
        hint = diagnose_source_audio_failure(
            getattr(state.plan, "raw", None) or {}, start, end, fps
        )
        raise ValueError(
            "Motion Director Audio Drive requires source-video audio for "
            f"segment #{key + 1}; no usable source track was found ({hint})."
        )
    state.source_audio[key] = audio
    return audio


def _context_span(conditioning) -> int:
    try:
        from .refine_sampling import _context_span_from_conditioning

        return max(0, int(_context_span_from_conditioning(conditioning)))
    except Exception:
        return 0


def _video_pixel_frames(video: torch.Tensor) -> int:
    from .motion_context import pixel_frames_for_latent_steps

    if video.ndim == 4:
        temporal = int(video.unsqueeze(0).shape[2])
    elif video.ndim == 5:
        temporal = int(video.shape[2])
    else:
        raise ValueError(
            "Motion Director Audio Drive: H3 video latent must be [B,C,T,H,W]."
        )
    return int(pixel_frames_for_latent_steps(temporal))


def _prepare_drive_waveform(
    source_audio: dict[str, Any],
    *,
    audio_vae,
    context_frames: int,
    target_frames: int,
    total_frames: int,
    fps: float,
) -> torch.Tensor:
    try:
        import torchaudio
    except ImportError as exc:  # pragma: no cover - bundled by ComfyUI
        raise RuntimeError("Motion Director Audio Drive requires torchaudio.") from exc

    wave = source_audio["waveform"]
    source_sr = int(source_audio["sample_rate"])
    vae_sr = int(getattr(audio_vae, "audio_sample_rate", 32000) or 32000)
    if source_sr != vae_sr:
        wave = torchaudio.functional.resample(wave, source_sr, vae_sr)

    target_samples = max(0, int(round(float(target_frames) / fps * vae_sr)))
    source_part = _fit_wave_samples(wave[:1], target_samples)
    prefix_samples = max(0, int(round(float(context_frames) / fps * vae_sr)))
    total_samples = max(
        prefix_samples + target_samples,
        int(round(float(total_frames) / fps * vae_sr)),
    )
    suffix_samples = max(0, total_samples - prefix_samples - target_samples)
    channels = int(source_part.shape[1])
    prefix = source_part.new_zeros((1, channels, prefix_samples))
    suffix = source_part.new_zeros((1, channels, suffix_samples))
    return torch.cat([prefix, source_part, suffix], dim=-1)


def _inject_audio_drive(latent: dict[str, Any], conditioning, state: _DriveState) -> None:
    segment = state.segment
    if segment is None:
        raise RuntimeError("Motion Director Audio Drive lost the active source segment.")
    if state.audio_vae is None:
        raise ValueError("Motion Director Audio Drive requires the MiniMax H3 audio_vae input.")
    if not isinstance(latent, dict) or "samples" not in latent:
        raise ValueError("Motion Director Audio Drive expected a joint H3 AV latent.")

    streams = _nested_parts(latent.get("samples"))
    if len(streams) < 2:
        raise ValueError("Motion Director Audio Drive could not find the H3 audio latent stream.")
    video, template_audio = streams[0], streams[1]
    source_audio = _source_audio_for_segment(state, segment)
    fps = float(getattr(state.plan, "frame_rate", 0.0) or 24.0)
    target_frames = max(1, int(getattr(segment, "frame_count", 0) or 1))
    context_frames = _context_span(conditioning)
    total_frames = _video_pixel_frames(video)
    drive_wave = _prepare_drive_waveform(
        source_audio,
        audio_vae=state.audio_vae,
        context_frames=context_frames,
        target_frames=target_frames,
        total_frames=total_frames,
        fps=fps,
    )

    encoded = state.audio_vae.encode(drive_wave.movedim(1, -1))
    if isinstance(encoded, dict):
        encoded = encoded.get("samples")
    encoded = _fit_audio_latent(encoded, template_audio)

    existing_masks = _nested_parts(latent.get("noise_mask"))
    if existing_masks and isinstance(existing_masks[0], torch.Tensor):
        video_mask = existing_masks[0]
    else:
        video_mask = torch.ones_like(video)
    audio_mask = torch.zeros_like(encoded)

    import comfy.nested_tensor

    latent["samples"] = comfy.nested_tensor.NestedTensor((video, encoded))
    latent["noise_mask"] = comfy.nested_tensor.NestedTensor((video_mask, audio_mask))


def _drive_report_note(audio_out: list | None) -> str:
    if audio_out and any(_has_audio(audio) for audio in audio_out):
        return (
            "\n\nAudio Drive: frame-aligned source PCM drove the H3 AV latent; "
            "the final soundtrack is the untouched source PCM."
        )
    return "\n\nAudio Drive: source audio unavailable."


def install_audio_drive_support() -> None:
    """Install the fourth Director audio policy without changing legacy workflows."""
    global _INSTALLED
    if _INSTALLED:
        return

    from . import audio_export, executor_core, refine_sampling

    original_resolve_audio_mode = audio_export.resolve_audio_mode
    original_source_note = audio_export.source_audio_report_note
    original_execute = executor_core.execute_director_plan_core
    original_resolve_segment_raw_clip = executor_core.resolve_segment_raw_clip
    original_first_sample = executor_core.sample_single_stage
    original_refine_sample = refine_sampling.sample_single_stage

    def resolve_audio_mode(plan) -> str:
        if _drive_requested(plan):
            return AUDIO_MODE_DRIVE
        return original_resolve_audio_mode(plan)

    def source_audio_report_note(plan, audio_out, **kwargs):
        mode = kwargs.get("audio_mode") or resolve_audio_mode(plan)
        if mode == AUDIO_MODE_DRIVE:
            return _drive_report_note(audio_out)
        return original_source_note(plan, audio_out, **kwargs)

    def resolve_segment_raw_clip(plan, segment):
        state = _STATE.get()
        if state is not None and state.plan is plan:
            state.segment = segment
        return original_resolve_segment_raw_clip(plan, segment)

    def _sample_with_drive(original, *args, **kwargs):
        state = _STATE.get()
        latent = kwargs.get("latent")
        positive = kwargs.get("positive")
        if latent is None and len(args) >= 4:
            latent = args[3]
        if positive is None and len(args) >= 2:
            positive = args[1]
        if state is not None and latent is not None:
            _inject_audio_drive(latent, positive, state)
        return original(*args, **kwargs)

    def first_sample(*args, **kwargs):
        return _sample_with_drive(original_first_sample, *args, **kwargs)

    def refine_sample(*args, **kwargs):
        return _sample_with_drive(original_refine_sample, *args, **kwargs)

    def execute_director_plan_core(plan, *args, **kwargs):
        if not _drive_requested(plan):
            return original_execute(plan, *args, **kwargs)
        audio_vae = kwargs.get("audio_vae")
        if audio_vae is None:
            raise ValueError("Motion Director Audio Drive requires the MiniMax H3 audio_vae input.")
        state = _DriveState(plan=plan, audio_vae=audio_vae)
        token = _STATE.set(state)
        try:
            result = original_execute(plan, *args, **kwargs)
        finally:
            _STATE.reset(token)
        if isinstance(result, tuple) and len(result) >= 4 and isinstance(result[3], str):
            report = result[3].replace(
                "Audio: generate — decode MiniMax H3 AV latent audio.",
                "Audio: drive — source PCM locked in H3 AV latent; final output keeps source PCM.",
            )
            result = (*result[:3], report, *result[4:])
        return result

    audio_export.resolve_audio_mode = resolve_audio_mode
    audio_export.source_audio_report_note = source_audio_report_note
    executor_core.resolve_audio_mode = resolve_audio_mode
    executor_core.resolve_segment_raw_clip = resolve_segment_raw_clip
    executor_core.sample_single_stage = first_sample
    executor_core.execute_director_plan_core = execute_director_plan_core
    refine_sampling.sample_single_stage = refine_sample

    _INSTALLED = True


__all__ = ["AUDIO_MODE_DRIVE", "install_audio_drive_support"]
