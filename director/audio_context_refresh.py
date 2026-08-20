"""Long-chain Audio Previous Context stabilization for MiniMax H3.

The generated AV latent contains hidden audio state that is useful for a single
handoff but can recursively feed its own distribution drift into every later
segment. Director already persists the exact exported waveform tail, so normal
Audio Previous Context refreshes from that audible result on every boundary.
The cached audio latent remains available as a strict fallback when waveform
refresh cannot be performed.
"""

from __future__ import annotations

from dataclasses import replace
from functools import wraps
from typing import Any

import torch


FPS = 24.0


def _waveform_can_refresh(
    context_audio: Any,
    *,
    audio_vae: Any,
    context_span: int,
    audio_enabled: bool,
) -> bool:
    if not bool(audio_enabled) or audio_vae is None or not isinstance(context_audio, dict):
        return False
    waveform = context_audio.get("waveform")
    if not isinstance(waveform, torch.Tensor) or waveform.ndim != 3 or int(waveform.numel()) <= 0:
        return False
    sample_rate = int(context_audio.get("sample_rate") or 0)
    if sample_rate <= 0:
        return False
    wanted_seconds = max(0, int(context_span)) / FPS
    have_seconds = int(waveform.shape[-1]) / float(sample_rate)
    return have_seconds + (1.0 / sample_rate) >= wanted_seconds


def _without_audio_stream(context_latent: Any) -> tuple[Any, bool]:
    if not isinstance(context_latent, dict):
        return context_latent, False
    samples = context_latent.get("samples")
    if hasattr(samples, "unbind"):
        streams = tuple(samples.unbind())
    elif isinstance(samples, (tuple, list)):
        streams = tuple(samples)
    else:
        return context_latent, False
    if len(streams) < 2:
        return context_latent, False

    out = dict(context_latent)
    # Keep the video latent and all non-sample metadata. With no hidden audio
    # stream available, motion_context's existing logic falls through to its
    # exported-waveform Audio VAE encode path.
    out["samples"] = (streams[0],)
    return out, True


def prepare_context_latent_for_audio_refresh(
    context_latent: Any,
    *,
    context_audio: Any,
    audio_vae: Any,
    context_span: int,
    audio_enabled: bool,
) -> tuple[Any, bool]:
    """Hide recursive audio latent only when an exact waveform refresh is safe."""
    if not _waveform_can_refresh(
        context_audio,
        audio_vae=audio_vae,
        context_span=context_span,
        audio_enabled=audio_enabled,
    ):
        return context_latent, False
    return _without_audio_stream(context_latent)


def install_audio_context_refresh() -> bool:
    """Patch Motion Context before executor_core binds its function reference."""
    from . import motion_context

    current = motion_context.apply_exported_motion_context
    if bool(getattr(current, "_motion_director_audio_refresh", False)):
        return True

    @wraps(current)
    def wrapped(conditioning, **kwargs):
        prepared_latent, refreshed = prepare_context_latent_for_audio_refresh(
            kwargs.get("context_latent"),
            context_audio=kwargs.get("context_audio"),
            audio_vae=kwargs.get("audio_vae"),
            context_span=int(kwargs.get("context_span") or 0),
            audio_enabled=bool(kwargs.get("audio_enabled", False)),
        )
        call_kwargs = kwargs
        if refreshed:
            call_kwargs = dict(kwargs)
            call_kwargs["context_latent"] = prepared_latent

        result = current(conditioning, **call_kwargs)
        if refreshed and isinstance(result, tuple) and len(result) == 2:
            merged, info = result
            try:
                info = replace(info, audio_source="waveform (refresh)")
            except (TypeError, ValueError):
                pass
            return merged, info
        return result

    wrapped._motion_director_audio_refresh = True
    motion_context.apply_exported_motion_context = wrapped
    return True


__all__ = [
    "install_audio_context_refresh",
    "prepare_context_latent_for_audio_refresh",
]
