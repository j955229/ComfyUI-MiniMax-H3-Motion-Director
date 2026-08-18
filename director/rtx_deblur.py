"""Native NVIDIA RTX Deblur RGB post-processing for Motion Director."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Callable

import torch

log = logging.getLogger("ComfyUI-MiniMax-H3-Motion-Director.director.rtx_deblur")


@dataclass
class RTXDeblurOutcome:
    images: torch.Tensor
    status: str
    quality: str = "medium"
    strength: float = 1.0
    frames: int = 0
    width: int = 0
    height: int = 0
    seconds: float = 0.0
    mean_delta: float = 0.0
    p95_delta: float = 0.0
    max_delta: float = 0.0
    error: str = ""

    @property
    def succeeded(self) -> bool:
        return self.status == "SUCCESS"


def _quality_level(nvvfx, quality: str):
    enum_name = f"DEBLUR_{str(quality or 'medium').strip().upper()}"
    candidates = (
        getattr(getattr(nvvfx, "effects", None), "QualityLevel", None),
        getattr(getattr(nvvfx, "VideoSuperRes", None), "QualityLevel", None),
        getattr(nvvfx, "QualityLevel", None),
    )
    for enum in candidates:
        if enum is None:
            continue
        level = getattr(enum, enum_name, None)
        if level is not None:
            return level
    raise RuntimeError(
        f"NVIDIA RTX Deblur quality mode {enum_name} is unavailable in the installed nvvfx runtime."
    )


def _histogram_percentile(histogram: torch.Tensor, percentile: float) -> float:
    total = int(histogram.sum().item())
    if total <= 0:
        return 0.0
    target = max(1, int(round(total * float(percentile))))
    index = int(torch.searchsorted(histogram.cumsum(0), torch.tensor(target)).item())
    bins = int(histogram.numel())
    index = max(0, min(bins - 1, index))
    return (index + 0.5) / bins


def apply_rtx_deblur(
    config: dict,
    *,
    images: torch.Tensor,
    on_progress: Callable[[int, int], None] | None = None,
    stage: str = "final",
) -> RTXDeblurOutcome:
    """Deblur a BHWC IMAGE batch at the original resolution.

    The active Deblur pass now runs before Global Refine upscale / second
    sampling.  The legacy final-stage call is retained as a no-op marker so old
    Director call sites do not apply Deblur twice.
    """
    enabled = bool(config.get("enabled", False)) and bool(
        config.get("rtx_deblur_enabled", False)
    )
    quality = str(config.get("rtx_deblur_quality") or "medium").strip().lower()
    if quality not in {"low", "medium", "high", "ultra"}:
        quality = "medium"
    try:
        strength = float(config.get("rtx_deblur_strength", 1.0))
    except (TypeError, ValueError):
        strength = 1.0
    if not torch.isfinite(torch.tensor(strength)):
        strength = 1.0
    strength = max(0.0, min(3.0, strength))

    frames = int(images.shape[0]) if isinstance(images, torch.Tensor) and images.ndim == 4 else 0
    height = int(images.shape[1]) if frames else 0
    width = int(images.shape[2]) if frames else 0
    base = dict(
        images=images,
        quality=quality,
        strength=strength,
        frames=frames,
        width=width,
        height=height,
    )
    if not enabled:
        return RTXDeblurOutcome(status="DISABLED", **base)
    if str(stage or "final").strip().lower() != "presample":
        return RTXDeblurOutcome(status="PRESAMPLE", **base)
    if not isinstance(images, torch.Tensor) or images.ndim != 4 or frames <= 0:
        return RTXDeblurOutcome(
            status="FAILED",
            error="RTX Deblur requires a non-empty BHWC IMAGE tensor.",
            **base,
        )

    started = time.perf_counter()
    try:
        import nvvfx
    except ImportError:
        return RTXDeblurOutcome(
            status="UNAVAILABLE",
            seconds=time.perf_counter() - started,
            error="NVIDIA RTX Deblur requires the optional nvidia-vfx package.",
            **base,
        )

    try:
        level = _quality_level(nvvfx, quality)
        context = nvvfx.VideoSuperRes(level)
        processor = context.__enter__()
        try:
            processor.output_width = width
            processor.output_height = height
            if hasattr(processor, "load"):
                processor.load()

            channels = int(images.shape[3])
            result = torch.empty_like(images)
            if channels > 3:
                result[..., 3:] = images[..., 3:]

            histogram = torch.zeros(2048, dtype=torch.int64)
            delta_sum = 0.0
            delta_count = 0
            delta_max = 0.0

            for index in range(frames):
                source = images[index, ..., :3].movedim(-1, 0).float().contiguous()
                if source.device.type != "cuda":
                    source = source.cuda()
                deblurred = torch.from_dlpack(processor.run(source).image)
                if deblurred.ndim != 3:
                    raise RuntimeError(
                        f"Unexpected NVIDIA RTX Deblur output shape: {tuple(deblurred.shape)}"
                    )
                if int(deblurred.shape[0]) in {3, 4}:
                    deblurred = deblurred[:3].movedim(0, -1)
                elif int(deblurred.shape[-1]) >= 3:
                    deblurred = deblurred[..., :3]
                else:
                    raise RuntimeError(
                        f"Unexpected NVIDIA RTX Deblur channel layout: {tuple(deblurred.shape)}"
                    )

                original = source.movedim(0, -1)
                deblurred = deblurred.to(device=original.device, dtype=original.dtype)
                final = torch.clamp(
                    original + (deblurred - original) * strength,
                    min=0.0,
                    max=1.0,
                )
                delta = (final - original).abs()
                delta_sum += float(delta.sum().item())
                delta_count += int(delta.numel())
                delta_max = max(delta_max, float(delta.max().item()))
                histogram += torch.histc(
                    delta.float(), bins=2048, min=0.0, max=1.0
                ).to(dtype=torch.int64, device="cpu")

                result[index, ..., :3] = final.to(
                    device=images.device,
                    dtype=images.dtype,
                )
                if on_progress is not None:
                    on_progress(index + 1, frames)
        finally:
            context.__exit__(None, None, None)

        return RTXDeblurOutcome(
            images=result,
            status="SUCCESS",
            quality=quality,
            strength=strength,
            frames=frames,
            width=width,
            height=height,
            seconds=time.perf_counter() - started,
            mean_delta=(delta_sum / max(1, delta_count)),
            p95_delta=_histogram_percentile(histogram, 0.95),
            max_delta=delta_max,
        )
    except Exception as exc:
        log.warning("RTX Deblur failed; keeping pre-Deblur frames: %s", exc)
        return RTXDeblurOutcome(
            images=images,
            status="FAILED",
            quality=quality,
            strength=strength,
            frames=frames,
            width=width,
            height=height,
            seconds=time.perf_counter() - started,
            error=f"{type(exc).__name__}: {exc}",
        )


__all__ = ["RTXDeblurOutcome", "apply_rtx_deblur"]
