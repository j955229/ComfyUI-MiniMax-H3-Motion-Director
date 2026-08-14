# Portions adapted from AIMixer/ComfyUI_MiniMaxH3_Director commit 5b1c239.
# Copyright AIMixer and contributors. Apache License 2.0.
# This derivative is distributed under GPL-3.0; see NOTICE and
# LICENSES/Apache-2.0-AIMixer.txt.

"""Strict in-node H3 Global Refine / pixel-upscale second sampling."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Callable

import torch

from .core_sampling import sample_single_stage
from .postprocess_config import refine_seed_for, refine_steps_for, resolve_upscale_target

log = logging.getLogger("ComfyUI-MiniMax-H3-Motion-Director.director.refine")


def _unpack(out):
    if hasattr(out, "args") and out.args:
        return out.args
    if isinstance(out, (tuple, list)):
        return out
    return (out,)


def _split_av(samples: dict):
    from comfy_extras.nodes_lt import LTXVSeparateAVLatent

    video_latent, audio_latent = _unpack(LTXVSeparateAVLatent.execute(samples))[:2]
    return video_latent, audio_latent


def _decode_video(vae, video_latent):
    from nodes import VAEDecode

    return _unpack(VAEDecode().decode(vae, video_latent))[0]


def _encode_video(vae, images: torch.Tensor) -> dict:
    from nodes import VAEEncode

    latent = _unpack(VAEEncode().encode(vae, images))[0]
    return latent if isinstance(latent, dict) else {"samples": latent}


def _join_av(video_latent: dict, audio_latent, template: dict) -> dict:
    video = video_latent.get("samples") if isinstance(video_latent, dict) else video_latent
    audio = audio_latent.get("samples") if isinstance(audio_latent, dict) else audio_latent
    out = dict(template)
    out.pop("noise_mask", None)
    try:
        from comfy_extras.nodes_lt import LTXVConcatAVLatent

        joined = _unpack(LTXVConcatAVLatent.execute(video_latent, audio_latent))[0]
        if isinstance(joined, dict) and "samples" in joined:
            return joined
        out["samples"] = joined
        return out
    except (ImportError, AttributeError):
        # Older ComfyUI builds do not expose the concat node.
        import comfy.nested_tensor

        out["samples"] = comfy.nested_tensor.NestedTensor((video, audio)) if audio is not None else video
        return out


def _resize_lanczos(images: torch.Tensor, width: int, height: int) -> torch.Tensor:
    from comfy.utils import common_upscale

    return common_upscale(
        images[..., :3].movedim(-1, 1), int(width), int(height), "lanczos", "disabled"
    ).movedim(1, -1)


def _upscale_model_exact(images: torch.Tensor, model_name: str) -> torch.Tensor:
    if not model_name:
        raise ValueError("Upscale Model was selected but no internal model was selected.")
    import folder_paths
    from comfy_extras.nodes_upscale_model import ImageUpscaleWithModel, UpscaleModelLoader

    # get_full_path_or_raise is intentionally used when available: a missing
    # model is a failed chosen method, never permission to switch algorithms.
    resolver = getattr(folder_paths, "get_full_path_or_raise", None)
    if resolver is not None:
        resolver("upscale_models", model_name)
    elif not getattr(folder_paths, "get_full_path", lambda *_: None)("upscale_models", model_name):
        raise FileNotFoundError(f"Upscale model not found: {model_name}")
    model = _unpack(UpscaleModelLoader().load_model(model_name))[0]
    node = ImageUpscaleWithModel()
    parts = []
    for index in range(0, int(images.shape[0]), 4):
        parts.append(_unpack(node.upscale(model, images[index : index + 4]))[0])
    return torch.cat(parts, dim=0)


def _upscale_rtx_vsr_exact(images: torch.Tensor, width: int, height: int) -> torch.Tensor:
    try:
        import nvvfx
    except ImportError as exc:
        raise ImportError(
            "NVIDIA RTX VSR requires the optional nvidia-vfx package and a compatible NVIDIA GPU."
        ) from exc

    quality = getattr(getattr(nvvfx, "effects", None), "QualityLevel", None)
    level = getattr(quality, "ULTRA", None) if quality is not None else None
    context = nvvfx.VideoSuperRes(level) if level is not None else nvvfx.VideoSuperRes()
    processor = context.__enter__()
    try:
        processor.output_width = max(8, round(int(width) / 8) * 8)
        processor.output_height = max(8, round(int(height) / 8) * 8)
        if hasattr(processor, "load"):
            processor.load()
        source = images[..., :3].movedim(-1, 1).contiguous()
        if source.device.type != "cuda":
            source = source.cuda()
        frames = [torch.from_dlpack(processor.run(frame).image).clone() for frame in source]
        return torch.stack(frames).movedim(1, -1)
    finally:
        context.__exit__(None, None, None)


def upscale_image_batch_strict(
    images: torch.Tensor,
    *,
    width: int,
    height: int,
    method: str,
    model_name: str = "",
) -> torch.Tensor:
    """Run exactly the selected method; errors propagate to the stage fallback."""
    selected = str(method or "lanczos").strip().lower()
    if selected == "lanczos":
        result = _resize_lanczos(images, width, height)
    elif selected == "upscale_model":
        result = _upscale_model_exact(images, model_name)
    elif selected == "nvidia_rtx_vsr":
        result = _upscale_rtx_vsr_exact(images, width, height)
    else:
        raise ValueError(f"Unsupported Global Refine upscale method: {method}")
    if int(result.shape[2]) != int(width) or int(result.shape[1]) != int(height):
        # Exact target fitting after a successful chosen algorithm is not a
        # failure fallback and never hides an exception from that algorithm.
        result = _resize_lanczos(result, width, height)
    return result


@dataclass
class GlobalRefineOutcome:
    samples: dict
    status: str
    fallback: str = ""
    error: str = ""
    target_width: int = 0
    target_height: int = 0
    steps: int = 0
    seed: int = 0

    @property
    def succeeded(self) -> bool:
        return self.status == "SUCCESS"


def apply_global_refine(
    config: dict[str, Any],
    *,
    task_key: str,
    samples: dict,
    model,
    vae,
    positive,
    negative,
    seed: int,
    cfg: float,
    first_steps: int,
    sampler_name: str,
    scheduler: str,
    shift_video: float,
    shift_audio: float,
    director_width: int,
    director_height: int,
    repin: Callable[[Any, dict], Any] | None = None,
    on_phase: Callable[[str, float], None] | None = None,
    on_step_preview: Callable[[int, int, Any], None] | None = None,
    preview_every: int = 1,
    preserve_noise_mask: bool = False,
) -> GlobalRefineOutcome:
    """Second sample with stage-local failure containment.

    Any exception, including CUDA OOM, returns the exact first-pass object.
    There is deliberately no method, resolution, or mode downgrade.
    """
    if not config.get("enabled"):
        return GlobalRefineOutcome(samples=samples, status="DISABLED")
    if config.get("skip_fl2v") and task_key == "fl2v":
        return GlobalRefineOutcome(samples=samples, status="SKIPPED")

    refine_steps = refine_steps_for(config, first_steps)
    refine_seed = refine_seed_for(config, seed)
    width, height = int(director_width), int(director_height)
    try:
        work = dict(samples)
        if not preserve_noise_mask or config.get("mode") == "upscale":
            work.pop("noise_mask", None)
        refine_positive = positive
        if config.get("mode") == "upscale":
            width, height = resolve_upscale_target(config, director_width, director_height)
            if on_phase:
                on_phase("global_upscale", 0)
            video_latent, audio_latent = _split_av(work)
            decoded = _decode_video(vae, video_latent)
            upscaled = upscale_image_batch_strict(
                decoded,
                width=width,
                height=height,
                method=config.get("upscale_method") or "lanczos",
                model_name=config.get("upscale_model") or "",
            )
            work = _join_av(_encode_video(vae, upscaled), audio_latent, work)
            if repin is not None:
                refine_positive = repin(refine_positive, work)
            if on_phase:
                on_phase("global_upscale", 1)
        if on_phase:
            on_phase("global_refine", 0)
        refined = sample_single_stage(
            model=model,
            positive=refine_positive,
            negative=negative,
            latent=work,
            seed=refine_seed,
            cfg=cfg,
            steps=refine_steps,
            sampler_name=sampler_name,
            scheduler=scheduler,
            shift_video=shift_video,
            shift_audio=shift_audio,
            denoise=float(config.get("denoise") or 0.25),
            phase_name="global_refine",
            on_step_preview=on_step_preview,
            preview_every=preview_every,
        )
        if on_phase:
            on_phase("global_refine", 1)
        return GlobalRefineOutcome(
            samples=refined,
            status="SUCCESS",
            target_width=width,
            target_height=height,
            steps=refine_steps,
            seed=refine_seed,
        )
    except Exception as exc:
        log.warning("Global Refine failed; keeping first-pass result: %s", exc)
        return GlobalRefineOutcome(
            samples=samples,
            status="FAILED",
            fallback="FIRST_PASS_RESULT",
            error=f"{type(exc).__name__}: {exc}",
            target_width=width,
            target_height=height,
            steps=refine_steps,
            seed=refine_seed,
        )


__all__ = ["GlobalRefineOutcome", "apply_global_refine", "upscale_image_batch_strict"]
