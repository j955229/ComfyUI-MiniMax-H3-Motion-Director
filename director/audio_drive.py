"""Per-reference-audio roles for MiniMax H3 R2V / RV2V.

Three roles share the existing reference-audio upload path:
- reference: ordinary H3 reference audio.
- dialogue_drive: timed ``partially_copy`` dialogue conditioning while H3 keeps
  the target soundtrack generative.
- audio_drive: timed exact PCM drive.  The selected source PCM is injected into
  the H3 joint AV latent only for its configured interval and the same original
  samples replace that interval in the exported soundtrack.

All trims are runtime tensor views/copies.  Uploaded source files are never
rewritten.
"""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

import torch

AUDIO_MODE_GENERATE = "generate"
AUDIO_ROLE_REFERENCE = "reference"
AUDIO_ROLE_AUDIO_DRIVE = "audio_drive"
AUDIO_ROLE_DIALOGUE_DRIVE = "dialogue_drive"
AUDIO_ROLE_TASKS = frozenset({"r2v", "rv2v"})
DIALOGUE_DRIVE_TASKS = AUDIO_ROLE_TASKS
_BASE_PROMPT_ATTR = "_mmx_audio_role_base_prompt"
_BASE_AUDIO_ATTR = "_mmx_audio_role_base_audio"
_ACTIVE_ATTR = "_mmx_audio_role_active"
_INSTALLED = False


def _round_ms(value: Any) -> float:
    return round(float(value or 0.0), 3)


def _role(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw in {AUDIO_ROLE_AUDIO_DRIVE, AUDIO_ROLE_DIALOGUE_DRIVE}:
        return raw
    return AUDIO_ROLE_REFERENCE


def _raw_segment(plan: Any, segment: Any) -> dict[str, Any]:
    raw = getattr(plan, "raw", None) or {}
    rows = raw.get("segments") or []
    index = int(getattr(segment, "timeline_index", getattr(segment, "index", 0)))
    if 0 <= index < len(rows) and isinstance(rows[index], dict):
        return rows[index]
    return {}


def _scope_key(plan: Any, segment: Any) -> str:
    row = _raw_segment(plan, segment)
    return str(row.get("id") or getattr(segment, "timeline_index", getattr(segment, "index", 0))).strip()


def _audio_roles_root(plan: Any) -> dict[str, Any]:
    raw = getattr(plan, "raw", None) or {}
    root = raw.get("audioRoles") or raw.get("audio_roles") or {}
    return root if isinstance(root, dict) else {}


def _legacy_dialogue_asset(plan: Any, segment: Any) -> str:
    raw = getattr(plan, "raw", None) or {}
    legacy = raw.get("dialogueDrive") or raw.get("dialogue_drive") or {}
    if not isinstance(legacy, dict):
        return ""
    if str(getattr(plan, "edit_mode", "") or "").strip().lower() == "global":
        return str(legacy.get("globalAssetId") or legacy.get("global_asset_id") or "").strip()
    assignments = legacy.get("segmentAssetIds") or legacy.get("segment_asset_ids") or {}
    if not isinstance(assignments, dict):
        return ""
    key = _scope_key(plan, segment)
    return str(assignments.get(key) or assignments.get(str(getattr(segment, "timeline_index", 0))) or "").strip()


def _role_bucket(plan: Any, segment: Any) -> dict[str, Any]:
    root = _audio_roles_root(plan)
    use_global = str(getattr(plan, "edit_mode", "") or "").strip().lower() == "global"
    if use_global:
        bucket = root.get("global") or {}
    else:
        segments = root.get("segments") or {}
        bucket = segments.get(_scope_key(plan, segment)) or {}
    return bucket if isinstance(bucket, dict) else {}


def _audio_asset_id(item: Any) -> str:
    return str(getattr(item, "asset_id", "") or "").strip()


def _audio_duration(audio: Any) -> float:
    if not isinstance(audio, dict):
        return 0.0
    wave = audio.get("waveform")
    sr = int(audio.get("sample_rate") or 0)
    if not isinstance(wave, torch.Tensor) or wave.ndim != 3 or sr <= 0:
        return 0.0
    return float(wave.shape[-1]) / float(sr)


def _raw_config_for(plan: Any, segment: Any, asset_id: str) -> dict[str, Any]:
    bucket = _role_bucket(plan, segment)
    value = bucket.get(asset_id) or {}
    if isinstance(value, dict) and value:
        return value
    if asset_id and asset_id == _legacy_dialogue_asset(plan, segment):
        return {"role": AUDIO_ROLE_DIALOGUE_DRIVE}
    return {}


def _normalize_config(raw: dict[str, Any], audio: dict | None = None) -> dict[str, Any]:
    actual_duration = _audio_duration(audio)
    source_duration = float(raw.get("sourceDuration", raw.get("source_duration", 0.0)) or 0.0)
    if source_duration <= 0:
        source_duration = actual_duration
    source_duration = max(0.0, source_duration)
    trim_start = max(0.0, float(raw.get("trimStart", raw.get("trim_start", 0.0)) or 0.0))
    trim_start = min(trim_start, source_duration) if source_duration > 0 else trim_start
    has_end = "trimEnd" in raw or "trim_end" in raw
    trim_end_raw = raw.get("trimEnd", raw.get("trim_end"))
    if not has_end or trim_end_raw is None:
        trim_end = source_duration
    else:
        trim_end = max(trim_start, float(trim_end_raw or 0.0))
        if source_duration > 0:
            trim_end = min(trim_end, source_duration)
    timeline_start = max(0.0, float(raw.get("timelineStart", raw.get("timeline_start", 0.0)) or 0.0))
    return {
        "role": _role(raw.get("role")),
        "sourceDuration": _round_ms(source_duration),
        "trimStart": _round_ms(trim_start),
        "trimEnd": _round_ms(trim_end),
        "timelineStart": _round_ms(timeline_start),
    }


def _format_time(seconds: float) -> str:
    total_ms = max(0, int(round(float(seconds) * 1000.0)))
    minutes, rem = divmod(total_ms, 60_000)
    sec, ms = divmod(rem, 1000)
    return f"{minutes:02d}:{sec:02d}.{ms:03d}"


def _tag_for(segment: Any, item: Any) -> str:
    asset_id = _audio_asset_id(item)
    tags = getattr(segment, "reference_tags", None) or {}
    if isinstance(tags, dict):
        tag = tags.get(("audio", asset_id))
        if tag:
            return str(tag)
    index = int(getattr(item, "index", -1))
    return f"<Audio {index + 1}>" if index >= 0 else ""


def _trim_audio_runtime(item: Any, cfg: dict[str, Any]) -> None:
    base = getattr(item, _BASE_AUDIO_ATTR, None)
    if base is None:
        source = getattr(item, "audio", None)
        if not isinstance(source, dict):
            return
        base = {**source}
        wave = source.get("waveform")
        if isinstance(wave, torch.Tensor):
            base["waveform"] = wave
        setattr(item, _BASE_AUDIO_ATTR, base)
    item.audio = {**base}
    wave = item.audio.get("waveform")
    sr = int(item.audio.get("sample_rate") or 0)
    if not isinstance(wave, torch.Tensor) or wave.ndim != 3 or sr <= 0:
        return
    start = max(0, min(int(round(cfg["trimStart"] * sr)), int(wave.shape[-1])))
    end = max(start, min(int(round(cfg["trimEnd"] * sr)), int(wave.shape[-1])))
    item.audio["waveform"] = wave[..., start:end].contiguous()


def dialogue_drive_instruction(tag: str, start: float = 0.0, end: float | None = None) -> str:
    audio_tag = str(tag or "").strip()
    if not audio_tag:
        raise ValueError("Dialogue Drive requires a valid MiniMax <Audio N> tag.")
    end = float(start if end is None else end)
    window = f"{_format_time(start)}–{_format_time(end)}"
    return (
        f"{audio_tag}: partially_copy - During {window}, treat the spoken dialogue in {audio_tag} "
        "as the foreground speech performance. The speaking on-screen subject described by the "
        "prompt physically says it with mouth and jaw motion synchronized to the source timing. "
        "Preserve spoken content, original language, voice identity, pauses, cadence, emotion and "
        "delivery; do not paraphrase, translate, omit, reorder or duplicate it. Copy only the "
        "dialogue/performance layer; keep the target H3 soundtrack generative so ambience, Foley/SFX "
        "and non-diegetic background music may be generated outside and around that dialogue."
    )


def audio_drive_instruction(tag: str, start: float, end: float, segment_duration: float) -> str:
    audio_tag = str(tag or "").strip()
    if not audio_tag:
        raise ValueError("Audio Drive requires a valid MiniMax <Audio N> tag.")
    full = start <= 0.0005 and end >= segment_duration - 0.0005
    relation = "fully_copy" if full else "partially_copy"
    window = f"{_format_time(start)}–{_format_time(end)}"
    return (
        f"{audio_tag}: {relation} - During {window}, the exact uploaded audio performance is the "
        "authoritative soundtrack and timing source. The on-screen speaker/performer follows it with "
        "synchronized mouth, jaw and performance timing. Do not reinterpret, paraphrase or replace "
        "that driven interval; Motion Director locks the source PCM for this interval."
    )


@dataclass
class ActiveAudioRole:
    segment_index: int
    asset_id: str
    role: str
    tag: str
    start: float
    end: float
    item: Any


@dataclass
class _RuntimeState:
    plan: Any
    audio_vae: Any
    segment: Any | None = None
    exact_by_segment: dict[int, list[ActiveAudioRole]] = field(default_factory=dict)


_STATE: ContextVar[_RuntimeState | None] = ContextVar("mmx_audio_roles", default=None)


def _segment_duration(plan: Any, segment: Any) -> float:
    fps = float(getattr(plan, "frame_rate", 0.0) or 24.0)
    frames = int(getattr(segment, "frame_count", 0) or 0)
    if frames <= 0:
        frames = max(0, int(getattr(segment, "end_frame", 0)) - int(getattr(segment, "start_frame", 0)))
    return float(frames) / fps if fps > 0 else 0.0


def prepare_audio_role_plan(plan: Any, *, audio_mode: str = AUDIO_MODE_GENERATE) -> list[ActiveAudioRole]:
    active: list[ActiveAudioRole] = []
    exact_rates: set[int] = set()
    exact_channels: set[int] = set()

    for segment in getattr(plan, "segments", None) or []:
        base_prompt = getattr(segment, _BASE_PROMPT_ATTR, None)
        if base_prompt is None:
            base_prompt = str(getattr(segment, "prompt", "") or "")
            setattr(segment, _BASE_PROMPT_ATTR, base_prompt)
        else:
            segment.prompt = base_prompt

        # Restore runtime audio before applying a new non-destructive trim.
        for item in getattr(segment, "ref_audios", None) or []:
            base_audio = getattr(item, _BASE_AUDIO_ATTR, None)
            if isinstance(base_audio, dict):
                item.audio = {**base_audio}

        if str(getattr(segment, "task_key", "") or "").strip().lower() not in AUDIO_ROLE_TASKS:
            setattr(segment, _ACTIVE_ATTR, [])
            continue

        duration = _segment_duration(plan, segment)
        segment_active: list[ActiveAudioRole] = []
        for item in getattr(segment, "ref_audios", None) or []:
            asset_id = _audio_asset_id(item)
            if not asset_id:
                continue
            raw_cfg = _raw_config_for(plan, segment, asset_id)
            cfg = _normalize_config(raw_cfg, getattr(item, "audio", None))
            # The editor is available for every uploaded reference audio. Apply its
            # trim to the runtime AUDIO object even when the role remains ordinary
            # reference; the original uploaded waveform is retained in _BASE_AUDIO_ATTR.
            has_editor_trim = bool(raw_cfg) and (
                cfg["trimStart"] > 0.0005
                or (cfg["sourceDuration"] > 0 and cfg["trimEnd"] < cfg["sourceDuration"] - 0.0005)
            )
            if has_editor_trim:
                _trim_audio_runtime(item, cfg)
            if cfg["role"] == AUDIO_ROLE_REFERENCE:
                continue
            effective = max(0.0, cfg["trimEnd"] - cfg["trimStart"])
            if effective <= 0.0005:
                raise ValueError(f"Motion Director audio role for {asset_id!r} has an empty trim range.")
            start = cfg["timelineStart"]
            end = start + effective
            if duration > 0 and end > duration + 0.0005:
                raise ValueError(
                    f"Motion Director audio role {asset_id!r} overruns segment by {end - duration:.3f}s. "
                    "Move the drive block earlier or shorten it in the audio editor."
                )
            tag = _tag_for(segment, item)
            if not tag:
                raise ValueError(f"Motion Director could not resolve the effective <Audio N> tag for {asset_id!r}.")
            if not has_editor_trim:
                _trim_audio_runtime(item, cfg)
            role = ActiveAudioRole(
                segment_index=int(getattr(segment, "timeline_index", getattr(segment, "index", 0))),
                asset_id=asset_id,
                role=cfg["role"],
                tag=tag,
                start=_round_ms(start),
                end=_round_ms(end),
                item=item,
            )
            segment_active.append(role)
            active.append(role)
            if role.role == AUDIO_ROLE_AUDIO_DRIVE:
                audio = getattr(item, "audio", None) or {}
                wave = audio.get("waveform")
                sr = int(audio.get("sample_rate") or 0)
                if sr > 0:
                    exact_rates.add(sr)
                if isinstance(wave, torch.Tensor) and wave.ndim == 3:
                    exact_channels.add(int(wave.shape[1]))

        ordered = sorted(segment_active, key=lambda x: (x.start, x.end, x.asset_id))
        for left, right in zip(ordered, ordered[1:]):
            if right.start < left.end - 0.0005:
                raise ValueError(
                    "Motion Director drive intervals overlap: "
                    f"{left.asset_id!r} ({left.start:.3f}-{left.end:.3f}s) and "
                    f"{right.asset_id!r} ({right.start:.3f}-{right.end:.3f}s)."
                )

        instructions: list[str] = []
        for role in ordered:
            if role.role == AUDIO_ROLE_DIALOGUE_DRIVE:
                instructions.append(dialogue_drive_instruction(role.tag, role.start, role.end))
            else:
                instructions.append(audio_drive_instruction(role.tag, role.start, role.end, duration))
        if instructions:
            segment.prompt = f"{base_prompt.rstrip()}\n\n" + "\n".join(instructions)
        setattr(segment, _ACTIVE_ATTR, ordered)

    if active and str(audio_mode or "").strip().lower() != AUDIO_MODE_GENERATE:
        raise ValueError(
            "Motion Director reference-audio drive roles require audio output mode Generate. "
            "Generated audio remains the base soundtrack; exact Audio Drive intervals are replaced "
            "with their original PCM after sampling."
        )
    if len(exact_rates) > 1:
        raise ValueError(
            "Motion Director Audio Drive exact PCM clips must use the same sample rate so every "
            "driven interval can remain sample-exact in one output soundtrack."
        )
    if len(exact_channels) > 1:
        raise ValueError(
            "Motion Director Audio Drive exact PCM clips must use the same channel count so every "
            "driven interval can remain sample-exact in one output soundtrack."
        )
    return active


# Backward-compatible name used by older tests/integrations.
def prepare_dialogue_drive_plan(plan: Any, *, audio_mode: str = AUDIO_MODE_GENERATE):
    return prepare_audio_role_plan(plan, audio_mode=audio_mode)


def dialogue_drive_asset_id(plan: Any, segment: Any) -> str:
    for role in getattr(segment, _ACTIVE_ATTR, []) or []:
        if role.role == AUDIO_ROLE_DIALOGUE_DRIVE:
            return role.asset_id
    legacy = _legacy_dialogue_asset(plan, segment)
    return legacy


def dialogue_drive_tag(segment: Any, asset_id: str) -> str:
    for item in getattr(segment, "ref_audios", None) or []:
        if _audio_asset_id(item) == str(asset_id or ""):
            return _tag_for(segment, item)
    return ""


def build_audio_drive_latent_mask(
    latent_steps: int,
    intervals: list[tuple[float, float]],
    *,
    total_seconds: float,
    prefix_seconds: float = 0.0,
    like: torch.Tensor | None = None,
) -> torch.Tensor:
    steps = max(1, int(latent_steps))
    if like is None:
        mask = torch.ones((1, 1, 1, steps), dtype=torch.float32)
    else:
        mask = torch.ones_like(like)
    total = max(1e-6, float(total_seconds))
    prefix = max(0.0, float(prefix_seconds))
    for start, end in intervals:
        a = max(0.0, min(total, prefix + float(start)))
        b = max(a, min(total, prefix + float(end)))
        i0 = max(0, min(steps, int(round(a / total * steps))))
        i1 = max(i0, min(steps, int(round(b / total * steps))))
        if i1 <= i0 and b > a:
            i1 = min(steps, i0 + 1)
        mask[..., i0:i1] = 0
    return mask


def _nested_parts(value: Any) -> list[torch.Tensor]:
    if value is None:
        return []
    if not isinstance(value, torch.Tensor) and hasattr(value, "unbind"):
        return list(value.unbind())
    if isinstance(value, (list, tuple)):
        return list(value)
    return [value]


def _fit_audio_latent(encoded: torch.Tensor, template: torch.Tensor) -> torch.Tensor:
    if not isinstance(encoded, torch.Tensor) or encoded.ndim != 4:
        raise ValueError("Motion Director Audio Drive audio VAE must return [B,C,2,T] latent.")
    if not isinstance(template, torch.Tensor) or template.ndim != 4:
        raise ValueError("Motion Director Audio Drive expected H3 audio latent [B,C,2,T].")
    if tuple(encoded.shape[1:-1]) != tuple(template.shape[1:-1]):
        raise ValueError(
            "Motion Director Audio Drive audio latent layout mismatch: "
            f"got {tuple(encoded.shape)}, expected middle dims {tuple(template.shape[1:-1])}."
        )
    target_batch = int(template.shape[0])
    if int(encoded.shape[0]) == 1 and target_batch > 1:
        encoded = encoded.repeat(target_batch, 1, 1, 1)
    elif int(encoded.shape[0]) != target_batch:
        encoded = encoded[:target_batch]
        if int(encoded.shape[0]) != target_batch:
            raise ValueError("Motion Director Audio Drive audio latent batch mismatch.")
    target_t = int(template.shape[-1])
    if int(encoded.shape[-1]) > target_t:
        encoded = encoded[..., :target_t]
    elif int(encoded.shape[-1]) < target_t:
        encoded = torch.cat(
            [encoded, encoded.new_zeros((*encoded.shape[:-1], target_t - int(encoded.shape[-1])))],
            dim=-1,
        )
    return encoded.to(device=template.device, dtype=template.dtype)


def _align_channels(wave: torch.Tensor, channels: int) -> torch.Tensor:
    if int(wave.shape[1]) == channels:
        return wave
    if int(wave.shape[1]) == 1 and channels > 1:
        return wave.expand(1, channels, -1).contiguous()
    if int(wave.shape[1]) > channels:
        return wave[:, :channels, :].contiguous()
    pad = wave.new_zeros((1, channels - int(wave.shape[1]), int(wave.shape[-1])))
    return torch.cat([wave, pad], dim=1)


def _resample(wave: torch.Tensor, source_sr: int, target_sr: int) -> torch.Tensor:
    if int(source_sr) == int(target_sr):
        return wave
    try:
        import torchaudio
    except ImportError as exc:  # pragma: no cover - ComfyUI bundles torchaudio
        raise RuntimeError("Motion Director Audio Drive requires torchaudio for resampling.") from exc
    return torchaudio.functional.resample(wave, int(source_sr), int(target_sr))


def _context_span(conditioning: Any) -> int:
    try:
        from .refine_sampling import _context_span_from_conditioning
        return max(0, int(_context_span_from_conditioning(conditioning)))
    except Exception:
        return 0


def _video_pixel_frames(video: torch.Tensor) -> int:
    try:
        from .motion_context import pixel_frames_for_latent_steps
        temporal = int(video.shape[2]) if video.ndim == 5 else int(video.unsqueeze(0).shape[2])
        return int(pixel_frames_for_latent_steps(temporal))
    except Exception:
        return max(1, int(video.shape[2]) if video.ndim >= 3 else 1)


def _exact_roles(segment: Any) -> list[ActiveAudioRole]:
    return [r for r in (getattr(segment, _ACTIVE_ATTR, []) or []) if r.role == AUDIO_ROLE_AUDIO_DRIVE]


def _inject_audio_drive(latent: dict[str, Any], conditioning: Any, state: _RuntimeState) -> None:
    segment = state.segment
    if segment is None or not _exact_roles(segment):
        return
    if state.audio_vae is None:
        raise ValueError("Motion Director Audio Drive requires the MiniMax H3 audio_vae input.")
    if not isinstance(latent, dict) or "samples" not in latent:
        raise ValueError("Motion Director Audio Drive expected a joint H3 AV latent.")
    marker = int(getattr(segment, "timeline_index", getattr(segment, "index", 0)))
    if latent.get("_mmx_audio_drive_segment") == marker:
        return

    streams = _nested_parts(latent.get("samples"))
    if len(streams) < 2:
        raise ValueError("Motion Director Audio Drive could not find the H3 audio latent stream.")
    video, template_audio = streams[0], streams[1]
    fps = float(getattr(state.plan, "frame_rate", 0.0) or 24.0)
    context_frames = _context_span(conditioning)
    prefix_seconds = float(context_frames) / fps
    total_frames = max(_video_pixel_frames(video), context_frames + int(getattr(segment, "frame_count", 0) or 1))
    total_seconds = float(total_frames) / fps
    vae_sr = int(getattr(state.audio_vae, "audio_sample_rate", 32000) or 32000)
    total_samples = max(1, int(round(total_seconds * vae_sr)))
    roles = _exact_roles(segment)
    first_wave = roles[0].item.audio["waveform"]
    channels = int(first_wave.shape[1])
    bus = first_wave.new_zeros((1, channels, total_samples))
    for role in roles:
        audio = role.item.audio
        wave = audio["waveform"][:1]
        wave = _align_channels(wave, channels)
        wave = _resample(wave, int(audio["sample_rate"]), vae_sr)
        pos = int(round((prefix_seconds + role.start) * vae_sr))
        end = min(total_samples, pos + int(wave.shape[-1]))
        if end > pos:
            bus[..., pos:end] = wave[..., : end - pos]

    encoded = state.audio_vae.encode(bus.movedim(1, -1))
    if isinstance(encoded, dict):
        encoded = encoded.get("samples")
    encoded = _fit_audio_latent(encoded, template_audio)
    intervals = [(r.start, r.end) for r in roles]
    drive_mask = build_audio_drive_latent_mask(
        int(template_audio.shape[-1]), intervals,
        total_seconds=total_seconds,
        prefix_seconds=prefix_seconds,
        like=template_audio,
    ).to(device=template_audio.device, dtype=template_audio.dtype)
    mixed_audio = template_audio * drive_mask + encoded * (1 - drive_mask)

    existing_masks = _nested_parts(latent.get("noise_mask"))
    video_mask = existing_masks[0] if existing_masks and isinstance(existing_masks[0], torch.Tensor) else torch.ones_like(video)
    if len(existing_masks) > 1 and isinstance(existing_masks[1], torch.Tensor):
        audio_mask = existing_masks[1].to(device=drive_mask.device, dtype=drive_mask.dtype) * drive_mask
    else:
        audio_mask = drive_mask

    import comfy.nested_tensor
    latent["samples"] = comfy.nested_tensor.NestedTensor((video, mixed_audio))
    latent["noise_mask"] = comfy.nested_tensor.NestedTensor((video_mask, audio_mask))
    latent["_mmx_audio_drive_segment"] = marker


def _audio_has_samples(audio: Any) -> bool:
    return isinstance(audio, dict) and isinstance(audio.get("waveform"), torch.Tensor) and audio["waveform"].numel() > 0


def _fit_base_audio(audio: dict | None, *, samples: int, sample_rate: int, channels: int) -> torch.Tensor:
    if _audio_has_samples(audio):
        wave = audio["waveform"][:1]
        wave = _resample(wave, int(audio.get("sample_rate") or sample_rate), sample_rate)
        wave = _align_channels(wave, channels)
    else:
        wave = torch.zeros((1, channels, 0), dtype=torch.float32)
    have = int(wave.shape[-1])
    if have > samples:
        return wave[..., :samples].contiguous()
    if have < samples:
        return torch.cat([wave, wave.new_zeros((1, channels, samples - have))], dim=-1)
    return wave


def _all_exact_roles(plan: Any) -> list[ActiveAudioRole]:
    out: list[ActiveAudioRole] = []
    for segment in getattr(plan, "segments", None) or []:
        out.extend(_exact_roles(segment))
    return out


def apply_exact_audio_drive_outputs(
    plan: Any,
    outputs: list[dict[str, Any]],
    images_out: list[Any],
    *,
    export_segments: bool,
) -> list[dict[str, Any]]:
    exact_all = _all_exact_roles(plan)
    if not exact_all:
        return outputs
    first_audio = exact_all[0].item.audio
    target_sr = int(first_audio.get("sample_rate") or 0)
    first_wave = first_audio.get("waveform")
    if target_sr <= 0 or not isinstance(first_wave, torch.Tensor) or first_wave.ndim != 3:
        return outputs
    channels = int(first_wave.shape[1])
    fps = float(getattr(plan, "frame_rate", 0.0) or 24.0)

    def compose(base: dict | None, frame_count: int, placements: list[tuple[float, ActiveAudioRole]]) -> dict[str, Any]:
        wanted = max(1, int(round(float(frame_count) / fps * target_sr)))
        wave = _fit_base_audio(base, samples=wanted, sample_rate=target_sr, channels=channels)
        for offset_seconds, role in placements:
            src = role.item.audio
            src_wave = src["waveform"][:1]
            # prepare_audio_role_plan validates exact clips share SR/channels.
            if int(src.get("sample_rate") or 0) != target_sr or int(src_wave.shape[1]) != channels:
                raise ValueError("Motion Director Audio Drive exact PCM format changed after validation.")
            pos = max(0, int(round(float(offset_seconds) * target_sr)))
            end = min(int(wave.shape[-1]), pos + int(src_wave.shape[-1]))
            if end > pos:
                wave[..., pos:end] = src_wave[..., : end - pos]
        return {"waveform": wave, "sample_rate": target_sr}

    result = list(outputs)
    if export_segments:
        indices = sorted(getattr(plan, "run_indices", None)) if getattr(plan, "run_indices", None) is not None else list(range(len(getattr(plan, "segments", []) or [])))
        for out_idx, seg_idx in enumerate(indices[: len(result)]):
            segment = plan.segments[seg_idx]
            roles = _exact_roles(segment)
            if not roles:
                continue
            frames = int(getattr(images_out[out_idx], "shape", [getattr(segment, "frame_count", 1)])[0] or getattr(segment, "frame_count", 1))
            result[out_idx] = compose(result[out_idx], frames, [(r.start, r) for r in roles])
        return result

    if not result:
        return result
    frame_count = int(getattr(images_out[0], "shape", [getattr(plan, "total_frames", 1)])[0] or getattr(plan, "total_frames", 1))
    placements: list[tuple[float, ActiveAudioRole]] = []
    for segment in getattr(plan, "segments", None) or []:
        segment_offset = float(getattr(segment, "start_frame", 0) or 0) / fps
        placements.extend((segment_offset + r.start, r) for r in _exact_roles(segment))
    result[0] = compose(result[0], frame_count, placements)
    return result


def _append_report(result: Any, active: list[ActiveAudioRole]) -> Any:
    if not active or not isinstance(result, tuple) or len(result) < 4 or not isinstance(result[3], str):
        return result
    lines = ["", "[Reference Audio Roles]"]
    for role in active:
        label = "Dialogue Drive" if role.role == AUDIO_ROLE_DIALOGUE_DRIVE else "Audio Drive (exact PCM)"
        lines.append(
            f"- Segment {role.segment_index + 1}: {role.tag} {label} "
            f"{_format_time(role.start)}–{_format_time(role.end)}"
        )
    return (*result[:3], result[3] + "\n" + "\n".join(lines), *result[4:])


def install_audio_drive_support() -> None:
    """Install role preparation, timed exact-latent drive and exact PCM export."""
    global _INSTALLED
    if _INSTALLED:
        return

    from . import audio_export, executor_core

    original_execute = executor_core.execute_director_plan_core
    original_build_inputs = executor_core._build_minimax_inputs
    original_sample = executor_core.sample_single_stage
    original_build_audio = audio_export.build_director_audio_outputs
    original_note = audio_export.source_audio_report_note

    def build_inputs(plan, seg, *args, **kwargs):
        state = _STATE.get()
        if state is not None and state.plan is plan:
            state.segment = seg
        return original_build_inputs(plan, seg, *args, **kwargs)

    def sample_with_drive(original, *args, **kwargs):
        state = _STATE.get()
        if state is not None and state.segment is not None and _exact_roles(state.segment):
            latent = kwargs.get("latent")
            positive = kwargs.get("positive")
            if latent is None and len(args) >= 4:
                latent = args[3]
            if positive is None and len(args) >= 2:
                positive = args[1]
            if latent is not None:
                _inject_audio_drive(latent, positive, state)
        return original(*args, **kwargs)

    def first_sample(*args, **kwargs):
        return sample_with_drive(original_sample, *args, **kwargs)

    def execute(plan, *args, **kwargs):
        audio_mode = audio_export.resolve_audio_mode(plan)
        active = prepare_audio_role_plan(plan, audio_mode=audio_mode)
        exact = any(r.role == AUDIO_ROLE_AUDIO_DRIVE for r in active)
        if not exact:
            return _append_report(original_execute(plan, *args, **kwargs), active)
        audio_vae = kwargs.get("audio_vae")
        if audio_vae is None:
            raise ValueError("Motion Director Audio Drive requires the MiniMax H3 audio_vae input.")
        state = _RuntimeState(plan=plan, audio_vae=audio_vae)
        token = _STATE.set(state)
        try:
            result = original_execute(plan, *args, **kwargs)
        finally:
            _STATE.reset(token)
        return _append_report(result, active)

    def build_audio(plan, images_out, *args, **kwargs):
        outputs, fallback = original_build_audio(plan, images_out, *args, **kwargs)
        outputs = apply_exact_audio_drive_outputs(
            plan,
            outputs,
            images_out,
            export_segments=bool(kwargs.get("export_segments", False)),
        )
        return outputs, fallback

    def source_note(plan, audio_out, *args, **kwargs):
        text = original_note(plan, audio_out, *args, **kwargs)
        exact = _all_exact_roles(plan)
        if exact:
            text += "\n\nAudio Drive: configured intervals use the untouched uploaded PCM; non-driven intervals retain H3 generated audio."
        return text

    executor_core._build_minimax_inputs = build_inputs
    executor_core.sample_single_stage = first_sample
    executor_core.execute_director_plan_core = execute
    audio_export.build_director_audio_outputs = build_audio
    audio_export.source_audio_report_note = source_note
    _INSTALLED = True


__all__ = [
    "AUDIO_MODE_GENERATE",
    "AUDIO_ROLE_REFERENCE",
    "AUDIO_ROLE_AUDIO_DRIVE",
    "AUDIO_ROLE_DIALOGUE_DRIVE",
    "AUDIO_ROLE_TASKS",
    "DIALOGUE_DRIVE_TASKS",
    "ActiveAudioRole",
    "apply_exact_audio_drive_outputs",
    "audio_drive_instruction",
    "build_audio_drive_latent_mask",
    "dialogue_drive_asset_id",
    "dialogue_drive_instruction",
    "dialogue_drive_tag",
    "install_audio_drive_support",
    "prepare_audio_role_plan",
    "prepare_dialogue_drive_plan",
]
