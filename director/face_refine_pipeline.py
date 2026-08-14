# Algorithms adapted from Carasibana/ComfyUI-H3-FaceRefine commit 79a97ce.
# Copyright Carasibana. MIT License; see LICENSES/MIT-H3-FaceRefine.txt.

"""Integrated H3 Face Refine pipeline with assembled-result fallback."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np
import torch
import torch.nn.functional as F

from .core_sampling import sample_single_stage
from .face_stitch import build_sam_masks, stitch_faces
from .face_track import NoFaceDetected, track_and_crop
from .frame_align import minimax_align_frame_count, prepare_h3_reference_video_clip
from .refine_sampling import _decode_video, _encode_video, _join_av, _split_av

log = logging.getLogger("ComfyUI-MiniMax-H3-Motion-Director.director.face_refine")


@dataclass
class FaceRefineOutcome:
    images: torch.Tensor
    status: str
    fallback: str = ""
    error: str = ""
    statistics: dict[str, Any] = field(default_factory=dict)
    canvas: str = ""

    @property
    def succeeded(self) -> bool:
        return self.status == "SUCCESS"


def _nested_members(samples: Any) -> list[torch.Tensor]:
    if not isinstance(samples, torch.Tensor) and hasattr(samples, "unbind"):
        return list(samples.unbind())
    if isinstance(samples, (tuple, list)):
        return list(samples)
    return [samples]


def inject_video_latent(av_latent: dict, crops: torch.Tensor, vae) -> dict:
    """Replace only the H3 video stream; preserve its generated audio stream."""
    _old_video, audio = _split_av(av_latent)
    return _join_av(_encode_video(vae, crops), audio, av_latent)


def apply_per_frame_denoise(
    av_latent: dict,
    face_heights: list[float],
    config: dict[str, Any],
) -> tuple[dict, dict[str, float]]:
    members = _nested_members(av_latent.get("samples"))
    if not members or not isinstance(members[0], torch.Tensor):
        raise ValueError("Face Refine expected a MiniMax H3 AV latent.")
    video = members[0]
    values = np.asarray(face_heights, dtype=np.float64)
    if not len(values):
        raise ValueError("Face Refine transform has no face sizes.")
    if config.get("adaptive", True):
        low = float(config.get("face_px_small") or 96)
        high = float(config.get("face_px_large") or 320)
        ratio = np.zeros_like(values) if high <= low else np.clip((values - low) / (high - low), 0, 1)
        ratio = ratio ** float(config.get("gamma") or 1.0)
        small = float(config.get("strength_small_face") or 0.35)
        large = float(config.get("strength_large_face") or 0.16)
        strengths = small + (large - small) * ratio
        window = max(1, int(config.get("denoise_smooth") or 5) | 1)
        if window > 1 and len(strengths) > 1:
            radius = window // 2
            kernel = np.exp(-(np.arange(-radius, radius + 1) ** 2) / (2 * max(0.5, window / 6) ** 2))
            kernel /= kernel.sum()
            strengths = np.convolve(np.pad(strengths, (radius, radius), mode="edge"), kernel, mode="valid")[: len(strengths)]
    else:
        strengths = np.ones_like(values)
    temporal = int(video.shape[-3])
    mask = torch.from_numpy(strengths).float().view(1, 1, -1)
    mask = F.interpolate(mask, size=temporal, mode="linear", align_corners=True)
    mask = mask.view(1, 1, temporal, 1, 1).to(device=video.device, dtype=video.dtype)
    video_mask = mask.expand(video.shape[0], video.shape[1], temporal, video.shape[-2], video.shape[-1]).contiguous()
    try:
        import comfy.nested_tensor

        audio_mask = torch.zeros_like(members[1]) if len(members) > 1 else None
        nested = comfy.nested_tensor.NestedTensor((video_mask,) + ((audio_mask,) if audio_mask is not None else ()))
    except (ImportError, AttributeError):
        nested = (video_mask,) + ((torch.zeros_like(members[1]),) if len(members) > 1 else ())
    result = dict(av_latent)
    result["noise_mask"] = nested
    return result, {
        "denoise_min": float(strengths.min()),
        "denoise_mean": float(strengths.mean()),
        "denoise_max": float(strengths.max()),
    }


def _chunk_ranges(total: int, preferred: list[int] | None = None) -> list[tuple[int, int]]:
    if preferred and sum(int(value) for value in preferred) == total:
        ranges = []
        start = 0
        for value in preferred:
            end = start + int(value)
            ranges.append((start, end))
            start = end
        return ranges
    ranges = []
    start = 0
    while start < total:
        end = min(total, start + 124)
        ranges.append((start, end))
        start = end
    return ranges


def apply_face_refine(
    config: dict[str, Any],
    *,
    images: torch.Tensor,
    model,
    vae,
    audio_vae,
    clip,
    prompt: str,
    seed: int,
    cfg: float,
    sampler_name: str,
    scheduler: str,
    shift_video: float,
    shift_audio: float,
    chunk_lengths: list[int] | None = None,
    on_phase: Callable[[str, float], None] | None = None,
    on_step_preview: Callable[[int, int, Any, Any], None] | None = None,
    preview_every: int = 1,
) -> FaceRefineOutcome:
    """Track once across the assembled video, then H3-regenerate crop chunks."""
    if not config.get("enabled"):
        return FaceRefineOutcome(images=images, status="DISABLED")
    try:
        if on_phase:
            on_phase("face_refine", 0)
        tracked = track_and_crop(images, config)
        masks = build_sam_masks(tracked.crops, tracked.transform, config) if config.get("mask_mode") == "sam" else None
        refined_parts = []
        ranges = _chunk_ranges(int(tracked.crops.shape[0]), chunk_lengths)
        for part_index, (start, end) in enumerate(ranges):
            from ..nodes.conditioning import run_minimax_conditioning

            visible = tracked.crops[start:end]
            aligned_length = minimax_align_frame_count(int(visible.shape[0]))
            prepared, _ = prepare_h3_reference_video_clip(visible, aligned_length)
            canvas_w, canvas_h = tracked.transform["canvas"]
            positive, negative, latent, _ = run_minimax_conditioning(
                clip=clip,
                vae=vae,
                audio_vae=audio_vae,
                prompt=prompt,
                width=canvas_w,
                height=canvas_h,
                length=aligned_length,
                task_key="v2v",
                ref_videos={"ref_video_0": prepared},
            )
            latent = inject_video_latent(latent, prepared, vae)
            latent, denoise_stats = apply_per_frame_denoise(
                latent,
                tracked.transform["face_heights"][start:end] + [tracked.transform["face_heights"][end - 1]] * max(0, aligned_length - (end - start)),
                config,
            )
            sampled = sample_single_stage(
                model=model,
                positive=positive,
                negative=negative,
                latent=latent,
                seed=int(seed) + part_index,
                cfg=cfg,
                steps=max(8, round(25 * 0.4)),
                sampler_name=sampler_name,
                scheduler=scheduler,
                shift_video=shift_video,
                shift_audio=shift_audio,
                denoise=float(config.get("base_denoise") or 0.22),
                phase_name="face_refine",
                on_step_preview=on_step_preview,
                preview_every=preview_every,
            )
            video_latent, _audio = _split_av(sampled)
            decoded = _decode_video(vae, video_latent)
            refined_parts.append(decoded[: end - start])
            tracked.statistics.update(denoise_stats)
            if on_phase:
                on_phase("face_refine", (part_index + 1) / len(ranges))
        refined_crops = torch.cat(refined_parts, dim=0)
        final = stitch_faces(images, refined_crops, tracked.transform, config, masks=masks)
        return FaceRefineOutcome(
            images=final.detach().cpu().float(),
            status="SUCCESS",
            statistics=tracked.statistics,
            canvas=tracked.statistics["canvas"],
        )
    except NoFaceDetected as exc:
        log.warning("Face Refine found no face; keeping assembled result: %s", exc)
        return FaceRefineOutcome(
            images=images,
            status="NO_FACE",
            fallback="ASSEMBLED_RESULT",
            error=str(exc),
        )
    except Exception as exc:
        log.warning("Face Refine failed; keeping assembled result: %s", exc)
        return FaceRefineOutcome(
            images=images,
            status="FAILED",
            fallback="ASSEMBLED_RESULT",
            error=f"{type(exc).__name__}: {exc}",
        )


__all__ = [
    "FaceRefineOutcome", "apply_face_refine", "apply_per_frame_denoise", "inject_video_latent"
]
