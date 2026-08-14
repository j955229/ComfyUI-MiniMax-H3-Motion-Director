"""Native ComfyUI VIDEO construction, saving, and node-scoped final-result registry."""

from __future__ import annotations

import logging
import os
import re
import threading
import uuid
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable

import torch

from .postprocess_config import normalize_postprocess_config

log = logging.getLogger("ComfyUI-MiniMax-H3-Motion-Director.video_export")


class FinalVideoUnavailable(RuntimeError):
    pass


class StaleFinalVideoRun(FinalVideoUnavailable):
    pass


def normalize_save_config(raw: Any) -> dict[str, Any]:
    return normalize_postprocess_config({"save": raw or {}})["save"]


def _safe_filename_prefix(value: str) -> str:
    prefix = str(value or "").strip()

    if not prefix:
        raise ValueError("filename_prefix cannot be empty")

    if any(ord(char) < 32 for char in prefix):
        raise ValueError("filename_prefix contains control characters")

    if "/" in prefix or "\\" in prefix or ":" in prefix:
        raise ValueError(
            "filename_prefix must be a file name, not a path"
        )

    if prefix in {".", ".."}:
        raise ValueError("invalid filename_prefix")

    return prefix
    
    
def _resolve_output_path(value: str) -> Path:
    import folder_paths

    raw = os.path.expandvars(
        os.path.expanduser(
            str(value or "").strip()
        )
    )

    if raw:
        folder = Path(raw)
    else:
        folder = (
            Path(folder_paths.get_output_directory())
            / "video"
        )

    folder.mkdir(
        parents=True,
        exist_ok=True,
    )

    if not folder.is_dir():
        raise ValueError(
            f"Video output path is not a directory: {folder}"
        )

    return folder.resolve()    


def _combine_images(images: Any) -> torch.Tensor:
    if isinstance(images, torch.Tensor):
        return images.detach().cpu()
    valid = [item.detach().cpu() for item in (images or []) if isinstance(item, torch.Tensor)]
    if not valid:
        raise FinalVideoUnavailable("Final Result has no image frames to save")
    return valid[0] if len(valid) == 1 else torch.cat(valid, dim=0)


def _combine_audio(audio: Any) -> dict[str, Any] | None:
    if isinstance(audio, dict) and isinstance(audio.get("waveform"), torch.Tensor):
        return {**audio, "waveform": audio["waveform"].detach().cpu()}
    valid = [item for item in (audio or []) if isinstance(item, dict) and isinstance(item.get("waveform"), torch.Tensor)]
    if not valid:
        return None
    sample_rate = int(valid[0].get("sample_rate") or 0)
    if any(int(item.get("sample_rate") or 0) != sample_rate for item in valid):
        raise FinalVideoUnavailable("Final Result audio segments have different sample rates")
    waveforms = [item["waveform"].detach().cpu() for item in valid]
    waveform = waveforms[0] if len(waveforms) == 1 else torch.cat(waveforms, dim=-1)
    return {**valid[0], "waveform": waveform, "sample_rate": sample_rate}


def construct_final_video(images: Any, audio: Any, fps: float):
    """Create the exact same VIDEO abstraction as ComfyUI's Create Video node."""
    from comfy_api.latest import InputImpl, Types

    final_images = _combine_images(images)
    final_audio = _combine_audio(audio)
    frame_rate = Fraction(str(max(0.001, float(fps))))
    return InputImpl.VideoFromComponents(
        Types.VideoComponents(images=final_images, audio=final_audio, frame_rate=frame_rate),
        bit_depth=8,
    )


def video_save_capabilities() -> dict[str, Any]:
    try:
        from comfy_api.latest import Types

        formats = list(Types.VideoContainer.as_input())
        codecs = list(Types.VideoCodec.as_input()) if hasattr(Types, "VideoCodec") else ["auto", "h264"]
    except Exception:
        formats, codecs = ["auto", "mp4"], ["auto", "h264"]
    return {"formats": formats, "codecs": codecs, "encodings": ["auto", "re-encode"], "crf": [0, 51]}


@dataclass
class FinalVideoRecord:
    node_id: str
    run_id: str
    video: Any
    fps: float
    frame_count: int
    prompt: Any = None
    extra_pnginfo: dict[str, Any] | None = None
    auto_save_attempted: bool = False
    auto_save_result: dict[str, Any] | None = None
    auto_save_error: str = ""
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def info(self) -> dict[str, Any]:
        width, height = self.video.get_dimensions()
        return {
            "node_id": self.node_id,
            "run_id": self.run_id,
            "fps": self.fps,
            "frame_count": self.frame_count,
            "width": int(width),
            "height": int(height),
            "auto_save_attempted": self.auto_save_attempted,
            "auto_save_result": self.auto_save_result,
            "auto_save_error": self.auto_save_error,
        }


def save_final_video(record: FinalVideoRecord, raw_config: Any) -> dict[str, Any]:
    """Mirror current ComfyUI Save Video filename, metadata, and save_to behavior."""
    import folder_paths
    from comfy_api.latest import Types

    config = normalize_save_config(raw_config)
    capabilities = video_save_capabilities()
    if config["format"] not in capabilities["formats"]:
        raise ValueError(f"Unsupported video format: {config['format']}")
    if config["codec"] not in capabilities["codecs"]:
        raise ValueError(f"Unsupported video codec: {config['codec']}")
    prefix = _safe_filename_prefix(
        config["filename_prefix"]
    )

    output_folder = _resolve_output_path(
        config.get("output_path", "")
    )

    width, height = record.video.get_dimensions()

    full_folder, filename, counter, subfolder, _ = (
        folder_paths.get_save_image_path(
            prefix,
            str(output_folder),
            width,
            height,
        )
    )
    extension = Types.VideoContainer.get_extension(config["format"])
    file = f"{filename}_{counter:05}_.{extension}"
    full_path = os.path.join(full_folder, file)

    metadata = None
    try:
        from comfy.cli_args import args

        if not args.disable_metadata:
            metadata = dict(record.extra_pnginfo or {})
            if record.prompt is not None:
                metadata["prompt"] = record.prompt
            metadata = metadata or None
    except Exception:
        metadata = dict(record.extra_pnginfo or {})
        if record.prompt is not None:
            metadata["prompt"] = record.prompt
        metadata = metadata or None

    crf = config["crf"] if config["encoding"] == "re-encode" else None
    record.video.save_to(
        full_path,
        format=Types.VideoContainer(config["format"]),
        codec=config["codec"],
        metadata=metadata,
        crf=crf,
    )
    return {
        "ok": True,
        "node_id": record.node_id,
        "run_id": record.run_id,
        "filename": file,
        "subfolder": subfolder,
        "type": "output",
        "path": os.path.normpath(full_path),
    }


class FinalVideoRegistry:
    """Keep only the latest completed VIDEO for each Director node."""

    def __init__(
        self,
        *,
        video_factory: Callable[[Any, Any, float], Any] = construct_final_video,
        saver: Callable[[FinalVideoRecord, Any], dict[str, Any]] = save_final_video,
    ):
        self.video_factory = video_factory
        self.saver = saver
        self._lock = threading.RLock()
        self._current_runs: dict[str, str] = {}
        self._records: dict[str, FinalVideoRecord] = {}

    def begin_run(self, node_id: Any) -> str:
        node = str(node_id)
        run_id = uuid.uuid4().hex
        with self._lock:
            self._current_runs[node] = run_id
            self._records.pop(node, None)
        return run_id

    def release(self, node_id: Any) -> None:
        node = str(node_id)
        with self._lock:
            self._records.pop(node, None)
            self._current_runs.pop(node, None)

    def _require_current(self, node_id: Any, run_id: Any) -> str:
        node, requested = str(node_id), str(run_id)
        current = self._current_runs.get(node)
        if current is None:
            raise FinalVideoUnavailable("Final Result is not ready or has already been released")
        if current is not None and current != requested:
            raise StaleFinalVideoRun("This Final Result was replaced by a newer Director run")
        return node

    def register_final(
        self,
        node_id: Any,
        run_id: str,
        *,
        images: Any,
        audio: Any,
        fps: float,
        frame_count: int,
        save_config: Any,
        prompt: Any = None,
        extra_pnginfo: dict[str, Any] | None = None,
    ) -> tuple[FinalVideoRecord, dict[str, Any] | None]:
        node = str(node_id)
        with self._lock:
            self._require_current(node, run_id)
            existing = self._records.get(node)
            if existing is not None and existing.run_id == run_id:
                return existing, existing.auto_save_result
            video = self.video_factory(images, audio, float(fps))
            record = FinalVideoRecord(
                node, run_id, video, float(fps), int(frame_count), prompt, extra_pnginfo
            )
            self._records[node] = record

        config = normalize_save_config(save_config)
        auto_result = None
        if config["auto_save"]:
            with record.lock:
                if not record.auto_save_attempted:
                    record.auto_save_attempted = True
                    try:
                        auto_result = self.saver(record, config)
                        record.auto_save_result = auto_result
                    except Exception as exc:
                        record.auto_save_error = str(exc)
                        auto_result = {"ok": False, "run_id": run_id, "error": str(exc)}
                        log.warning("Director Final Result auto-save failed: %s", exc)
        return record, auto_result

    def get(self, node_id: Any, run_id: Any) -> FinalVideoRecord:
        node = str(node_id)
        with self._lock:
            self._require_current(node, run_id)
            record = self._records.get(node)
            if record is None or record.run_id != str(run_id):
                raise FinalVideoUnavailable("Final Result is not ready or has already been released")
            return record

    def save(self, node_id: Any, run_id: Any, config: Any) -> dict[str, Any]:
        record = self.get(node_id, run_id)
        with record.lock:
            return self.saver(record, normalize_save_config(config))


FINAL_VIDEO_REGISTRY = FinalVideoRegistry()


__all__ = [
    "FINAL_VIDEO_REGISTRY",
    "FinalVideoRecord",
    "FinalVideoRegistry",
    "FinalVideoUnavailable",
    "StaleFinalVideoRun",
    "construct_final_video",
    "normalize_save_config",
    "save_final_video",
    "video_save_capabilities",
]
