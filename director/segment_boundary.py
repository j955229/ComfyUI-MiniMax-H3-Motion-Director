"""Strict exported-segment boundaries and non-destructive seam diagnostics."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import torch


@dataclass(frozen=True)
class BoundarySlice:
    total_frames: int
    context_frames: int
    target_frames: int
    start: int
    stop: int
    alignment_surplus: int

    @property
    def exported_frames(self) -> int:
        return self.stop - self.start


def resolve_visible_slice(
    total_frames: int,
    context_frames: int,
    target_frames: int,
) -> BoundarySlice:
    """Resolve the one authoritative visible slice from a decoded H3 batch."""
    total = max(0, int(total_frames))
    context = max(0, int(context_frames))
    target = max(1, int(target_frames))
    required = context + target
    if total < required:
        raise ValueError(
            "Motion Director: H3 decoded %d frames, but %d are required "
            "(%d Motion Context head + %d requested output)."
            % (total, required, context, target)
        )
    start = context
    stop = required
    return BoundarySlice(
        total_frames=total,
        context_frames=context,
        target_frames=target,
        start=start,
        stop=stop,
        alignment_surplus=total - stop,
    )


def validate_exported_frame_count(images: torch.Tensor, target_frames: int) -> None:
    if not isinstance(images, torch.Tensor) or images.ndim != 4:
        raise ValueError("Motion Director: exported video is not a valid IMAGE batch.")
    target = max(1, int(target_frames))
    actual = int(images.shape[0])
    if actual != target:
        raise RuntimeError(
            "Motion Director: exported segment frame contract failed (%d != %d frames)."
            % (actual, target)
        )


def slice_visible_frames(
    images: torch.Tensor,
    *,
    context_frames: int,
    target_frames: int,
) -> tuple[torch.Tensor, BoundarySlice]:
    if not isinstance(images, torch.Tensor) or images.ndim != 4:
        raise ValueError("Motion Director: decoded video is not a valid IMAGE batch.")
    resolved = resolve_visible_slice(
        int(images.shape[0]), context_frames, target_frames
    )
    out = images[resolved.start : resolved.stop]
    validate_exported_frame_count(out, target_frames)
    return out, resolved


def _audio_summary(audio: dict[str, Any] | None) -> tuple[int, int, float]:
    if not isinstance(audio, dict):
        return 0, 0, 0.0
    waveform = audio.get("waveform")
    sr = int(audio.get("sample_rate") or 0)
    if not isinstance(waveform, torch.Tensor) or waveform.ndim != 3 or sr <= 0:
        return 0, 0, 0.0
    samples = int(waveform.shape[-1])
    return sr, samples, samples / float(sr)


def seam_diagnostics(
    left: torch.Tensor,
    right: torch.Tensor,
    *,
    left_audio: dict[str, Any] | None = None,
    right_audio: dict[str, Any] | None = None,
    fps: float = 24.0,
) -> dict[str, Any]:
    """Measure a boundary without changing either side or deciding to trim it."""
    if not isinstance(left, torch.Tensor) or left.ndim != 4:
        raise ValueError("Motion Director: left seam input is not an IMAGE batch.")
    if not isinstance(right, torch.Tensor) or right.ndim != 4:
        raise ValueError("Motion Director: right seam input is not an IMAGE batch.")
    if int(left.shape[0]) <= 0 or int(right.shape[0]) <= 0:
        raise ValueError("Motion Director: seam diagnostics require non-empty segments.")
    if float(fps) <= 0:
        raise ValueError("Motion Director: seam diagnostics fps must be positive.")

    left_edge = left[-1, ..., :3].detach().float()
    right_edge = right[0, ..., :3].detach().float()
    if tuple(left_edge.shape) != tuple(right_edge.shape):
        raise ValueError(
            "Motion Director: seam diagnostic frames have different canvases: "
            f"{tuple(left_edge.shape)} vs {tuple(right_edge.shape)}."
        )
    delta = (right_edge - left_edge).abs()
    rgb_jump = float(delta.mean().cpu())
    weights = torch.tensor(
        [0.2126, 0.7152, 0.0722],
        dtype=left_edge.dtype,
        device=left_edge.device,
    )
    left_luma = (left_edge * weights).sum(dim=-1)
    right_luma = (right_edge * weights).sum(dim=-1)
    luma_jump = float((right_luma - left_luma).abs().mean().cpu())

    left_sr, left_samples, left_seconds = _audio_summary(left_audio)
    right_sr, right_samples, right_seconds = _audio_summary(right_audio)
    shared_sr = left_sr if left_sr > 0 and left_sr == right_sr else 0

    return {
        "left_frames": int(left.shape[0]),
        "right_frames": int(right.shape[0]),
        "fps": float(fps),
        "mean_abs_rgb_jump": rgb_jump,
        "luma_jump": luma_jump,
        "audio_sample_rate": shared_sr,
        "left_audio_sample_rate": left_sr,
        "right_audio_sample_rate": right_sr,
        "left_audio_samples": left_samples,
        "right_audio_samples": right_samples,
        "left_audio_seconds": left_seconds,
        "right_audio_seconds": right_seconds,
    }


__all__ = [
    "BoundarySlice",
    "resolve_visible_slice",
    "seam_diagnostics",
    "slice_visible_frames",
    "validate_exported_frame_count",
]
