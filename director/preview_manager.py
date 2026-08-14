"""Non-blocking, node-scoped sampling preview encoder for Director Output."""

from __future__ import annotations

import base64
import io
import logging
import queue
import threading
from dataclasses import dataclass
from typing import Any, Callable

from PIL import Image

from .progress import report_director_segment_preview
from .tae_preview import x0_to_preview_pils

log = logging.getLogger("ComfyUI-MiniMax-H3-Motion-Director.director.preview")


@dataclass
class PreviewJob:
    segment_index: int
    stage: str
    step: int
    total_steps: int
    frames: tuple[Image.Image, ...]


def _encode_jpeg(frame: Image.Image, quality: int) -> tuple[str, str]:
    buffer = io.BytesIO()
    frame.save(buffer, "JPEG", quality=int(quality))
    return base64.b64encode(buffer.getvalue()).decode("ascii"), "image/jpeg"


def _encode_nvenc_fragmented_mp4(frames: list[Image.Image], fps: int) -> tuple[str, str]:
    """Try hardware fragmented MP4. Any error is handled by the caller."""
    import av
    import numpy as np

    buffer = io.BytesIO()
    container = av.open(
        buffer,
        mode="w",
        format="mp4",
        options={"movflags": "frag_keyframe+empty_moov+default_base_moof"},
    )
    stream = container.add_stream("h264_nvenc", rate=max(1, int(fps)))
    stream.width = frames[0].width
    stream.height = frames[0].height
    stream.pix_fmt = "yuv420p"
    for image in frames:
        frame = av.VideoFrame.from_ndarray(np.asarray(image.convert("RGB")), format="rgb24")
        for packet in stream.encode(frame):
            container.mux(packet)
    for packet in stream.encode():
        container.mux(packet)
    container.close()
    return base64.b64encode(buffer.getvalue()).decode("ascii"), "video/mp4"


def _encode_animated_webp(frames: list[Image.Image], fps: int, quality: int) -> tuple[str, str]:
    buffer = io.BytesIO()
    duration = max(1, round(1000 / max(1, int(fps))))
    frames[0].save(
        buffer,
        "WEBP",
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=0,
        quality=int(quality),
        method=3,
    )
    return base64.b64encode(buffer.getvalue()).decode("ascii"), "image/webp"


def encode_preview_job(job: PreviewJob, config: dict[str, Any]) -> dict[str, Any] | None:
    frames = list(job.frames)
    if not frames:
        return None
    quality = int(config.get("jpeg_quality") or 80)
    fps = int(config.get("preview_fps") or 12)
    if len(frames) == 1:
        encoded, media_type = _encode_jpeg(frames[0], quality)
    else:
        try:
            encoded, media_type = _encode_nvenc_fragmented_mp4(frames, fps)
        except Exception as exc:
            log.debug("NVENC preview unavailable; using animated WebP: %s", exc)
            try:
                encoded, media_type = _encode_animated_webp(
                    frames,
                    fps,
                    quality,
                )
            except Exception as webp_exc:
                log.warning(
                    "Animated WebP preview unavailable; using JPEG fallback: %s",
                    webp_exc,
                )
                encoded, media_type = _encode_jpeg(
                    frames[0],
                    quality,
                )
    return {
        "image_b64": encoded,
        "media_type": media_type,
        "width": frames[0].width,
        "height": frames[0].height,
        "fps": fps,
    }


class DirectorPreviewManager:
    """Bounded queue: a full encoder queue drops previews, never sampling."""

    def __init__(
        self,
        node_id: str | None,
        config: dict[str, Any],
        *,
        queue_size: int = 2,
        decoder: Callable[..., list[Image.Image]] = x0_to_preview_pils,
        encoder: Callable[[PreviewJob, dict[str, Any]], dict[str, Any] | None] = encode_preview_job,
        sender: Callable[..., None] = report_director_segment_preview,
    ):
        self.node_id = node_id
        self.config = dict(config)
        self.decoder = decoder
        self.encoder = encoder
        self.sender = sender
        self.queue: queue.Queue[PreviewJob | None] = queue.Queue(maxsize=max(1, int(queue_size)))
        self.dropped = 0
        self.failed = 0
        self._closed = False
        self._thread = threading.Thread(target=self._work, name=f"mmx-preview-{node_id}", daemon=True)
        self._thread.start()

    def submit(
        self,
        *,
        segment_index: int,
        stage: str,
        step: int,
        total_steps: int,
        x0: Any,
        latent_shapes: Any = None,
    ) -> bool:
        if self._closed or not self.node_id or not self.config.get("enabled", True):
            return False
        # Check before decode: when the bounded encoder is behind, drop this
        # side-channel update without adding work to the sampling callback.
        if self.queue.full():
            self.dropped += 1
            return False
        try:
            frames = self.decoder(
                x0,
                max_side=int(self.config.get("max_resolution") or 1024),
                frame_count=int(self.config.get("preview_frames") or 8),
                latent_shapes=latent_shapes,
            )
            if not frames:
                return False
            # Only small CPU/PIL frames enter the async encoder queue.  Never
            # detach/clone the full sampler latent: H3 AV latents are large and
            # the sampler may reuse their storage after this callback returns.
            cpu_frames = tuple(frame.copy() for frame in frames if isinstance(frame, Image.Image))
            if not cpu_frames:
                return False
            self.queue.put_nowait(
                PreviewJob(segment_index, stage, step, total_steps, cpu_frames)
            )
            return True
        except queue.Full:
            self.dropped += 1
            return False
        except Exception as exc:
            self.failed += 1
            log.warning("Director preview decode skipped; generation continues: %s", exc)
            return False

    def _work(self) -> None:
        while True:
            job = self.queue.get()
            try:
                if job is None:
                    return
                payload = self.encoder(job, self.config)
                if not payload:
                    continue
                self.sender(
                    self.node_id,
                    segment_index=job.segment_index,
                    image_b64=payload["image_b64"],
                    width=payload["width"],
                    height=payload["height"],
                    fps=payload.get("fps", self.config.get("preview_fps", 12)),
                    live=True,
                    step=job.step,
                    total_steps=job.total_steps,
                    stage=job.stage,
                    media_type=payload.get("media_type", "image/jpeg"),
                )
            except Exception as exc:
                self.failed += 1
                log.debug("Preview encoder failure ignored: %s", exc)
            finally:
                self.queue.task_done()

    def close(self) -> None:
        self._closed = True
        try:
            self.queue.put_nowait(None)
        except queue.Full:
            # Worker is daemonized; never block pipeline finalization.
            pass


__all__ = ["DirectorPreviewManager", "PreviewJob", "encode_preview_job"]
