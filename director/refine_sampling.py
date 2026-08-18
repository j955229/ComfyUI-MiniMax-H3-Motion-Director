# Portions adapted from AIMixer/ComfyUI_MiniMaxH3_Director commit 5b1c239.
# Copyright AIMixer and contributors. Apache License 2.0.
# This derivative is distributed under GPL-3.0; see NOTICE and
# LICENSES/Apache-2.0-AIMixer.txt.

"""Strict in-node H3 Global Refine / pixel-upscale processing."""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable

import torch

from .core_sampling import sample_single_stage
from .postprocess_config import (
    refine_pass_settings_for,
    refine_passes_for,
    refine_seed_for,
    refine_steps_for,
    resolve_upscale_target,
    resolve_vsr_quality_name,
)
from .rtx_deblur import RTXDeblurOutcome, apply_rtx_deblur

log = logging.getLogger("ComfyUI-MiniMax-H3-Motion-Director.director.refine")

RefinePassCallback = Callable[[int, int, dict], None]


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
        import comfy.nested_tensor

        out["samples"] = comfy.nested_tensor.NestedTensor((video, audio)) if audio is not None else video
        return out


def _resize_lanczos(images: torch.Tensor, width: int, height: int) -> torch.Tensor:
    from comfy.utils import common_upscale

    return common_upscale(
        images[..., :3].movedim(-1, 1), int(width), int(height), "lanczos", "disabled"
    ).movedim(1, -1)


def _upscale_model_exact(
    images: torch.Tensor,
    model_name: str,
    *,
    width: int,
    height: int,
    on_progress: Callable[[float], None] | None = None,
) -> torch.Tensor:
    if not model_name:
        raise ValueError("Upscale Model was selected but no internal model was selected.")

    import folder_paths
    import comfy.model_management as model_management
    import comfy.utils
    from comfy_extras.nodes_upscale_model import UpscaleModelLoader

    resolver = getattr(folder_paths, "get_full_path_or_raise", None)
    if resolver is not None:
        resolver("upscale_models", model_name)
    elif not getattr(folder_paths, "get_full_path", lambda *_: None)("upscale_models", model_name):
        raise FileNotFoundError(f"Upscale model not found: {model_name}")

    model = _unpack(UpscaleModelLoader().load_model(model_name))[0]
    device = model.patcher.load_device
    output_device = model_management.intermediate_device()
    total_frames = int(images.shape[0])
    batch_size = 4
    probe = images[: min(batch_size, total_frames)]
    memory_required = (
        (512 * 512 * 3) * probe.element_size() * max(model.scale, 1.0) * 384.0
    )
    memory_required += probe.nelement() * probe.element_size()
    model_management.load_models_gpu(
        [model.patcher], memory_required=memory_required, force_full_load=True,
    )

    output = None
    for index in range(0, total_frames, batch_size):
        model_management.throw_exception_if_processing_interrupted()
        end = min(index + batch_size, total_frames)
        chunk = images[index:end]
        in_img = chunk[..., :3].movedim(-1, -3).to(device)
        tile = 512
        overlap = 32
        while True:
            try:
                steps = (
                    in_img.shape[0]
                    * comfy.utils.get_tiled_scale_steps(
                        in_img.shape[3], in_img.shape[2],
                        tile_x=tile, tile_y=tile, overlap=overlap,
                    )
                )
                pbar = comfy.utils.ProgressBar(steps)
                upscaled = comfy.utils.tiled_scale(
                    in_img,
                    lambda tensor: model(tensor.float()),
                    tile_x=tile,
                    tile_y=tile,
                    overlap=overlap,
                    upscale_amount=model.scale,
                    pbar=pbar,
                    output_device=output_device,
                )
                break
            except Exception as exc:
                model_management.raise_non_oom(exc)
                tile //= 2
                if tile < 128:
                    raise

        upscaled = torch.clamp(
            upscaled.movedim(-3, -1), min=0, max=1.0,
        ).to(model_management.intermediate_dtype())
        if int(upscaled.shape[2]) != int(width) or int(upscaled.shape[1]) != int(height):
            upscaled = _resize_lanczos(upscaled, int(width), int(height))
        upscaled = upscaled.cpu()
        if output is None:
            output = torch.empty(
                (
                    total_frames,
                    int(height),
                    int(width),
                    int(upscaled.shape[-1]),
                ),
                dtype=upscaled.dtype,
                device="cpu",
            )
        output[index:end].copy_(upscaled)
        del in_img
        del upscaled
        if on_progress is not None:
            on_progress(end / max(1, total_frames))
        model_management.throw_exception_if_processing_interrupted()

    if output is None:
        raise RuntimeError("Upscale Model produced no frames.")
    return output


def _nvvfx_quality_level(nvvfx, enum_name: str):
    """Resolve the selected quality without silently downgrading it."""
    video_super_res = getattr(nvvfx, "VideoSuperRes", None)
    quality_enum = getattr(video_super_res, "QualityLevel", None)
    if quality_enum is None:
        quality_enum = getattr(nvvfx, "QualityLevel", None)
    if quality_enum is None:
        quality_enum = getattr(getattr(nvvfx, "effects", None), "QualityLevel", None)
    level = getattr(quality_enum, enum_name, None) if quality_enum is not None else None
    if level is None:
        raise RuntimeError(
            f"NVIDIA RTX VSR quality mode {enum_name} is unavailable in the installed nvvfx runtime."
        )
    return level


def _upscale_rtx_vsr_exact(
    images: torch.Tensor,
    width: int,
    height: int,
    *,
    quality_name: str = "high",
    on_progress: Callable[[float], None] | None = None,
) -> torch.Tensor:
    try:
        import nvvfx
    except ImportError as exc:
        raise ImportError(
            "NVIDIA RTX VSR requires the optional nvidia-vfx package and a compatible NVIDIA GPU."
        ) from exc

    enum_name = resolve_vsr_quality_name({"vsr_quality": quality_name})
    level = _nvvfx_quality_level(nvvfx, enum_name)
    context = nvvfx.VideoSuperRes(level)
    processor = context.__enter__()
    try:
        processor.output_width = max(8, round(int(width) / 8) * 8)
        processor.output_height = max(8, round(int(height) / 8) * 8)
        if hasattr(processor, "load"):
            processor.load()
        source = images[..., :3].movedim(-1, 1).float().contiguous()
        if source.device.type != "cuda":
            source = source.cuda()
        frames = []
        total = int(source.shape[0])
        for index, frame in enumerate(source):
            frames.append(torch.from_dlpack(processor.run(frame).image).clone())
            if on_progress is not None:
                on_progress((index + 1) / max(1, total))
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
    vsr_quality: str = "high",
    on_progress: Callable[[float], None] | None = None,
) -> torch.Tensor:
    """Run exactly the selected method; errors propagate to the stage fallback."""
    selected = str(method or "lanczos").strip().lower()
    if selected == "lanczos":
        result = _resize_lanczos(images, width, height)
    elif selected == "upscale_model":
        result = _upscale_model_exact(
            images,
            model_name,
            width=width,
            height=height,
            on_progress=on_progress,
        )
    elif selected == "nvidia_rtx_vsr":
        result = _upscale_rtx_vsr_exact(
            images,
            width,
            height,
            quality_name=vsr_quality,
            on_progress=on_progress,
        )
    else:
        raise ValueError(f"Unsupported Global Refine upscale method: {method}")
    if int(result.shape[2]) != int(width) or int(result.shape[1]) != int(height):
        result = _resize_lanczos(result, width, height)
    return result


def _deblur_report_lines(outcome: RTXDeblurOutcome | None) -> list[str]:
    if outcome is None:
        return ["RTX Deblur: OFF"]
    lines = [
        f"RTX Deblur: {outcome.status}",
        f"Quality: {str(outcome.quality).title()}",
        f"Strength: {float(outcome.strength):.2f}",
    ]
    if outcome.succeeded:
        lines.extend(
            [
                f"Mean Delta: {float(outcome.mean_delta):.6f}",
                f"P95 Delta: {float(outcome.p95_delta):.6f}",
                f"Max Delta: {float(outcome.max_delta):.6f}",
            ]
        )
    if outcome.error:
        lines.append(f"Deblur Error: {outcome.error}")
    return lines


def _selected_refine_model(config: dict[str, Any], fallback_model):
    """Load the dropdown-selected H3 diffusion model; empty means first-pass MODEL."""
    model_name = str(config.get("refine_model") or "").strip()
    if not model_name:
        return fallback_model, "Follow First Pass"

    import comfy.model_base
    import folder_paths
    from nodes import UNETLoader

    resolver = getattr(folder_paths, "get_full_path_or_raise", None)
    if resolver is not None:
        resolver("diffusion_models", model_name)
    elif not getattr(folder_paths, "get_full_path", lambda *_: None)("diffusion_models", model_name):
        raise FileNotFoundError(f"Refine model not found: {model_name}")

    loaded = _unpack(UNETLoader().load_unet(model_name, "default"))[0]
    base_model = getattr(loaded, "model", None)
    if not isinstance(base_model, comfy.model_base.MiniMaxH3):
        raise ValueError(
            f"Refine Model must be MiniMax H3; selected {model_name} loaded {type(base_model).__name__}."
        )
    return loaded, model_name


def _context_span_from_conditioning(conditioning) -> int:
    """Read the exact visual Motion Context prefix from H3 conditioning metadata."""
    try:
        from ..patches import MC_KEY
        from .motion_context import latent_step_offsets, pixel_frames_for_latent_steps

        if not isinstance(conditioning, (list, tuple)) or not conditioning:
            return 0
        entry = conditioning[0]
        if not isinstance(entry, (list, tuple)) or len(entry) < 2:
            return 0
        metadata = entry[1] if isinstance(entry[1], dict) else {}
        keyframes = list(metadata.get("minimax_keyframes") or [])
        count = 0
        for keyframe in keyframes:
            if not isinstance(keyframe, dict) or keyframe.get(MC_KEY) is None:
                break
            expected = latent_step_offsets(count + 1)[-1]
            if int(keyframe.get(MC_KEY)) != int(expected):
                break
            count += 1
        return pixel_frames_for_latent_steps(count) if count > 0 else 0
    except Exception:
        return 0


def _preview_target_context() -> tuple[str, int, int]:
    """Return (node_id, zero-based timeline segment, visible target frames)."""
    try:
        from .progress import current_director_progress_context

        context = current_director_progress_context()
        node_id = str(context.get("node_id") or "").strip()
        segment = max(0, int(context.get("timeline_segment") or context.get("segment") or 1) - 1)
        label = str(context.get("frames_label") or "")
        match = re.search(r"\((\d+)f\)", label)
        target = int(match.group(1)) if match else 0
        return node_id, segment, target
    except Exception:
        return "", 0, 0


def _visible_preview_frames(
    images: torch.Tensor,
    *,
    conditioning,
    target_frames: int,
    has_context: bool,
) -> torch.Tensor:
    target = max(0, int(target_frames))
    total = int(images.shape[0])
    if target <= 0 or total <= target:
        return images[:target] if target > 0 else images

    head = _context_span_from_conditioning(conditioning) if has_context else 0
    if has_context and head <= 0:
        try:
            from .frame_align import minimax_align_frame_count
            from .motion_context import VIDEO_CONTEXT_GRID

            matches = [
                int(span)
                for span in (*VIDEO_CONTEXT_GRID, 0)
                if minimax_align_frame_count(target + int(span)) == total
            ]
            if matches:
                head = max(matches)
        except Exception:
            head = 0
    head = max(0, min(int(head), max(0, total - target)))
    return images[head : head + target]


def _emit_refine_result_preview(
    latent: dict,
    *,
    vae,
    conditioning,
    variant: str,
    pass_index: int | None,
    pass_count: int,
    has_context: bool,
) -> None:
    """Decode a result variant for Results UI; preview failures never fail sampling."""
    node_id, segment_index, target_frames = _preview_target_context()
    if not node_id:
        return
    try:
        from .progress import report_director_segment_preview
        from .segment_runtime import tensor_frame_to_jpeg_b64

        video_latent, _audio_latent = _split_av(latent)
        images = _decode_video(vae, video_latent)
        images = _visible_preview_frames(
            images,
            conditioning=conditioning,
            target_frames=target_frames,
            has_context=has_context,
        )
        if not isinstance(images, torch.Tensor) or int(images.shape[0]) <= 0:
            return
        frames = [
            tensor_frame_to_jpeg_b64(images[index])
            for index in range(int(images.shape[0]))
        ]
        height = int(images.shape[1])
        width = int(images.shape[2])
        label = "First Pass" if variant == "first" else f"Pass {int(pass_index or 0)}"
        report_director_segment_preview(
            node_id,
            segment_index=segment_index,
            image_b64=frames[0],
            width=width,
            height=height,
            frames=frames,
            fps=24.0,
            stage=label,
            result_kind="refine_pass",
            result_variant=variant,
            pass_index=pass_index,
            pass_count=pass_count,
        )
    except Exception as exc:
        log.debug("Refine result preview %s skipped: %s", variant, exc)


@dataclass
class GlobalRefineOutcome:
    samples: dict
    status: str
    fallback: str = ""
    error: str = ""
    source_width: int = 0
    source_height: int = 0
    target_width: int = 0
    target_height: int = 0
    steps: int = 0
    seed: int = 0
    method: str = ""
    vsr_quality: str = ""
    passes: int = 0
    refine_model: str = ""
    pass_timings: list[float] = field(default_factory=list)
    pass_denoises: list[float] = field(default_factory=list)
    pass_steps: list[int] = field(default_factory=list)
    pass_seeds: list[int] = field(default_factory=list)
    timings: dict[str, float] = field(default_factory=dict)

    @property
    def succeeded(self) -> bool:
        return self.status.startswith("SUCCESS")


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
    on_step_preview: Callable[[int, int, Any, Any], None] | None = None,
    on_pass_result: RefinePassCallback | None = None,
    preview_every: int = 1,
    preserve_noise_mask: bool = False,
) -> GlobalRefineOutcome:
    """Run optional Deblur, upscale and one-or-more second-sampling passes."""
    if not config.get("enabled"):
        return GlobalRefineOutcome(samples=samples, status="DISABLED")
    if config.get("skip_fl2v") and task_key == "fl2v":
        return GlobalRefineOutcome(samples=samples, status="SKIPPED")

    second_sampling_enabled = bool(config.get("second_sampling_enabled", True))
    deblur_enabled = bool(config.get("rtx_deblur_enabled", False))
    upscale_enabled = config.get("mode") == "upscale"
    pass_count = refine_passes_for(config) if second_sampling_enabled else 0
    # Invalid/mismatched schedules are configuration errors. Resolve them before
    # entering the stage fallback so a bad schedule is never silently ignored.
    pass_settings = refine_pass_settings_for(config, first_steps) if second_sampling_enabled else []
    refine_steps = pass_settings[0][1] if pass_settings else refine_steps_for(config, first_steps)
    first_refine_seed = refine_seed_for(config, seed, 0)
    width, height = int(director_width), int(director_height)
    source_width, source_height = width, height
    method = str(config.get("upscale_method") or "lanczos")
    vsr_quality = str(config.get("vsr_quality") or "high")
    timings: dict[str, float] = {}
    pass_timings: list[float] = []
    pass_denoises: list[float] = []
    pass_steps: list[int] = []
    pass_seeds: list[int] = []
    stage_started = time.perf_counter()
    deblur_outcome: RTXDeblurOutcome | None = None
    selected_model_name = ""

    try:
        if not second_sampling_enabled and not deblur_enabled and not upscale_enabled:
            timings["total"] = time.perf_counter() - stage_started
            return GlobalRefineOutcome(
                samples=samples,
                status="SUCCESS\nSecond Sampling: OFF\nUpscale: OFF\nRTX Deblur: OFF",
                source_width=source_width,
                source_height=source_height,
                target_width=width,
                target_height=height,
                steps=0,
                seed=first_refine_seed,
                method=method,
                vsr_quality=vsr_quality,
                timings=timings,
            )

        if second_sampling_enabled:
            _emit_refine_result_preview(
                samples,
                vae=vae,
                conditioning=positive,
                variant="first",
                pass_index=None,
                pass_count=pass_count,
                has_context=bool(preserve_noise_mask),
            )

        work = dict(samples)
        if not preserve_noise_mask or upscale_enabled or deblur_enabled:
            work.pop("noise_mask", None)
        refine_positive = positive

        decoded = None
        audio_latent = None
        if upscale_enabled or deblur_enabled:
            decode_started = time.perf_counter()
            video_latent, audio_latent = _split_av(work)
            decoded = _decode_video(vae, video_latent)
            timings["decode"] = time.perf_counter() - decode_started
            source_height = int(decoded.shape[1])
            source_width = int(decoded.shape[2])

        if deblur_enabled and decoded is not None:
            if on_phase:
                on_phase("rtx_deblur", 0)
            deblur_started = time.perf_counter()
            deblur_outcome = apply_rtx_deblur(
                config,
                images=decoded,
                stage="presample",
                on_progress=(
                    (lambda done, total: on_phase("rtx_deblur", done / max(1, total)))
                    if on_phase is not None else None
                ),
            )
            timings["deblur"] = time.perf_counter() - deblur_started
            decoded = deblur_outcome.images
            if on_phase:
                on_phase("rtx_deblur", 1)

        if upscale_enabled and decoded is not None:
            width, height = resolve_upscale_target(config, director_width, director_height)
            if on_phase:
                on_phase("global_upscale", 0)
            upscale_started = time.perf_counter()
            decoded = upscale_image_batch_strict(
                decoded,
                width=width,
                height=height,
                method=config.get("upscale_method") or "lanczos",
                model_name=config.get("upscale_model") or "",
                vsr_quality=config.get("vsr_quality") or "high",
                on_progress=(
                    (lambda value: on_phase("global_upscale", value))
                    if on_phase is not None else None
                ),
            )
            timings["upscale"] = time.perf_counter() - upscale_started
            if on_phase:
                on_phase("global_upscale", 1)

        if decoded is not None:
            encode_started = time.perf_counter()
            work = _join_av(_encode_video(vae, decoded), audio_latent, work)
            timings["encode"] = time.perf_counter() - encode_started
            if repin is not None:
                refine_positive = repin(refine_positive, work)

        if not second_sampling_enabled:
            timings["total"] = time.perf_counter() - stage_started
            status_lines = [
                "SUCCESS",
                "Second Sampling: OFF",
                f"Upscale: {'ON' if upscale_enabled else 'OFF'}",
                *_deblur_report_lines(deblur_outcome),
            ]
            return GlobalRefineOutcome(
                samples=work,
                status="\n".join(status_lines),
                source_width=source_width,
                source_height=source_height,
                target_width=width,
                target_height=height,
                steps=0,
                seed=first_refine_seed,
                method=method,
                vsr_quality=vsr_quality,
                timings=timings,
            )

        refine_model, selected_model_name = _selected_refine_model(config, model)
        refined = work
        if on_phase:
            on_phase("global_refine", 0)

        for pass_index, (pass_denoise, pass_step_count) in enumerate(pass_settings):
            pass_started = time.perf_counter()
            pass_seed = refine_seed_for(config, seed, pass_index)

            def _pass_phase(_phase: str, value: float, *, _index=pass_index) -> None:
                if on_phase is not None:
                    on_phase(
                        "global_refine",
                        (float(_index) + max(0.0, min(1.0, float(value)))) / max(1, pass_count),
                    )

            refined = sample_single_stage(
                model=refine_model,
                positive=refine_positive,
                negative=negative,
                latent=refined,
                seed=pass_seed,
                cfg=cfg,
                steps=pass_step_count,
                sampler_name=sampler_name,
                scheduler=scheduler,
                shift_video=shift_video,
                shift_audio=shift_audio,
                denoise=pass_denoise,
                phase_name="global_refine",
                on_phase=_pass_phase,
                on_step_preview=on_step_preview,
                preview_every=preview_every,
            )
            elapsed = time.perf_counter() - pass_started
            pass_timings.append(elapsed)
            pass_denoises.append(float(pass_denoise))
            pass_steps.append(int(pass_step_count))
            pass_seeds.append(int(pass_seed))
            timings[f"refine_pass_{pass_index + 1}"] = elapsed
            _emit_refine_result_preview(
                refined,
                vae=vae,
                conditioning=refine_positive,
                variant=f"pass:{pass_index + 1}",
                pass_index=pass_index + 1,
                pass_count=pass_count,
                has_context=bool(preserve_noise_mask),
            )
            if on_pass_result is not None:
                on_pass_result(pass_index + 1, pass_count, refined)

        timings["refine_sampling"] = sum(pass_timings)
        timings["total"] = time.perf_counter() - stage_started
        if on_phase:
            on_phase("global_refine", 1)
        status_lines = [
            "SUCCESS",
            "Second Sampling: ON",
            f"Refine Model: {selected_model_name}",
            f"Passes: {pass_count}",
            f"Upscale: {'ON' if upscale_enabled else 'OFF'}",
            *_deblur_report_lines(deblur_outcome),
        ]
        for index, (pass_denoise, pass_step_count, pass_seed, elapsed) in enumerate(
            zip(pass_denoises, pass_steps, pass_seeds, pass_timings),
            start=1,
        ):
            status_lines.append(
                f"Pass {index}: SUCCESS | Denoise={pass_denoise:g} | "
                f"Steps={pass_step_count} | Seed={pass_seed} | Timing={elapsed:.2f}s"
            )
        return GlobalRefineOutcome(
            samples=refined,
            status="\n".join(status_lines),
            source_width=source_width,
            source_height=source_height,
            target_width=width,
            target_height=height,
            steps=refine_steps,
            seed=first_refine_seed,
            method=method,
            vsr_quality=vsr_quality,
            passes=pass_count,
            refine_model=selected_model_name,
            pass_timings=pass_timings,
            pass_denoises=pass_denoises,
            pass_steps=pass_steps,
            pass_seeds=pass_seeds,
            timings=timings,
        )
    except Exception as exc:
        log.warning("Global Refine failed; keeping first-pass result: %s", exc)
        timings["total"] = time.perf_counter() - stage_started
        return GlobalRefineOutcome(
            samples=samples,
            status="FAILED",
            fallback="FIRST_PASS_RESULT",
            error=f"{type(exc).__name__}: {exc}",
            source_width=source_width,
            source_height=source_height,
            target_width=width,
            target_height=height,
            steps=refine_steps if second_sampling_enabled else 0,
            seed=first_refine_seed,
            method=method,
            vsr_quality=vsr_quality,
            passes=pass_count,
            refine_model=selected_model_name,
            pass_timings=pass_timings,
            pass_denoises=pass_denoises,
            pass_steps=pass_steps,
            pass_seeds=pass_seeds,
            timings=timings,
        )


__all__ = ["GlobalRefineOutcome", "apply_global_refine", "upscale_image_batch_strict"]
