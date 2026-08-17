"""Native NVIDIA RTX Deblur final RGB post-processing for Motion Director."""

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
    frames: int = 0
    width: int = 0
    height: int = 0
    seconds: float = 0.0
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


def apply_rtx_deblur(
    config: dict,
    *,
    images: torch.Tensor,
    on_progress: Callable[[int, int], None] | None = None,
) -> RTXDeblurOutcome:
    """Deblur a BHWC IMAGE batch at the original resolution.

    Failure containment is strict: the exact input tensor is returned when the
    optional NVIDIA runtime is unavailable or processing fails.
    """
    enabled = bool(config.get("rtx_deblur_enabled", False))
    quality = str(config.get("rtx_deblur_quality") or "medium").strip().lower()
    if quality not in {"low", "medium", "high", "ultra"}:
        quality = "medium"

    frames = int(images.shape[0]) if isinstance(images, torch.Tensor) and images.ndim == 4 else 0
    height = int(images.shape[1]) if frames else 0
    width = int(images.shape[2]) if frames else 0
    if not enabled:
        return RTXDeblurOutcome(
            images=images,
            status="DISABLED",
            quality=quality,
            frames=frames,
            width=width,
            height=height,
        )
    if not isinstance(images, torch.Tensor) or images.ndim != 4 or frames <= 0:
        return RTXDeblurOutcome(
            images=images,
            status="FAILED",
            quality=quality,
            frames=frames,
            width=width,
            height=height,
            error="RTX Deblur requires a non-empty BHWC IMAGE tensor.",
        )

    started = time.perf_counter()
    try:
        import nvvfx
    except ImportError as exc:
        return RTXDeblurOutcome(
            images=images,
            status="UNAVAILABLE",
            quality=quality,
            frames=frames,
            width=width,
            height=height,
            seconds=time.perf_counter() - started,
            error="NVIDIA RTX Deblur requires the optional nvidia-vfx package.",
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
                result[index, ..., :3] = deblurred.to(
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
            frames=frames,
            width=width,
            height=height,
            seconds=time.perf_counter() - started,
        )
    except Exception as exc:
        log.warning("RTX Deblur failed; keeping pre-Deblur frames: %s", exc)
        return RTXDeblurOutcome(
            images=images,
            status="FAILED",
            quality=quality,
            frames=frames,
            width=width,
            height=height,
            seconds=time.perf_counter() - started,
            error=f"{type(exc).__name__}: {exc}",
        )


__all__ = ["RTXDeblurOutcome", "apply_rtx_deblur"]
