from __future__ import annotations

import os
import tempfile
import time
import weakref
from pathlib import Path
from typing import Iterable

import torch

DEFAULT_MMAP_THRESHOLD_BYTES = 1 << 30  # 1 GiB
ASSEMBLY_FILE_PREFIX = "minimax_h3_assembly_"
ASSEMBLY_FILE_SUFFIX = ".bin"
STALE_ASSEMBLY_SECONDS = 24 * 60 * 60


def _validate_clips(clips: list[torch.Tensor]) -> None:
    if not clips:
        raise ValueError("No clips to assemble.")
    first = clips[0]
    if not isinstance(first, torch.Tensor) or first.ndim != 4:
        raise ValueError("Frame clips must be IMAGE tensors [F,H,W,C].")
    channels = int(first.shape[3])
    dtype = first.dtype
    for clip in clips:
        if not isinstance(clip, torch.Tensor) or clip.ndim != 4:
            raise ValueError("Frame clips must be IMAGE tensors [F,H,W,C].")
        if int(clip.shape[3]) != channels:
            raise ValueError("All frame clips must have the same channel count.")
        if clip.dtype != dtype:
            raise ValueError("All frame clips must have the same dtype.")


def estimate_assembly_bytes(
    clips: Iterable[torch.Tensor],
    *,
    total_frames_override: int | None = None,
) -> int:
    items = list(clips)
    _validate_clips(items)
    total_frames = (
        int(total_frames_override)
        if total_frames_override is not None
        else sum(int(clip.shape[0]) for clip in items)
    )
    max_h = max(int(clip.shape[1]) for clip in items)
    max_w = max(int(clip.shape[2]) for clip in items)
    channels = int(items[0].shape[3])
    return total_frames * max_h * max_w * channels * items[0].element_size()


def _center_copy(dst: torch.Tensor, src: torch.Tensor, *, fill: float) -> None:
    if dst.shape[1:] == src.shape[1:]:
        dst.copy_(src)
        return
    dst.fill_(float(fill))
    height = int(dst.shape[1])
    width = int(dst.shape[2])
    src_h = int(src.shape[1])
    src_w = int(src.shape[2])
    y0 = max(0, (height - src_h) // 2)
    x0 = max(0, (width - src_w) // 2)
    copy_h = min(src_h, height - y0)
    copy_w = min(src_w, width - x0)
    dst[:, y0 : y0 + copy_h, x0 : x0 + copy_w, :].copy_(
        src[:, :copy_h, :copy_w, :]
    )


def _remove_assembly_file(path: str) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError:
        # Windows may still have the mapping open while Tensor destruction is
        # finishing. A later assembly run removes stale files best-effort.
        pass


def _cleanup_stale_assembly_files(temp_dir: Path) -> None:
    cutoff = time.time() - STALE_ASSEMBLY_SECONDS
    try:
        for path in temp_dir.glob(f"{ASSEMBLY_FILE_PREFIX}*{ASSEMBLY_FILE_SUFFIX}"):
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink()
            except OSError:
                pass
    except OSError:
        pass


def _default_temp_dir() -> Path:
    try:
        import folder_paths

        return Path(folder_paths.get_temp_directory())
    except Exception:
        return Path(tempfile.gettempdir())


def _file_backed_output(
    shape: tuple[int, int, int, int],
    *,
    dtype: torch.dtype,
    temp_dir: Path,
) -> torch.Tensor:
    temp_dir.mkdir(parents=True, exist_ok=True)
    _cleanup_stale_assembly_files(temp_dir)
    fd, raw_path = tempfile.mkstemp(
        prefix=ASSEMBLY_FILE_PREFIX,
        suffix=ASSEMBLY_FILE_SUFFIX,
        dir=str(temp_dir),
    )
    os.close(fd)
    numel = 1
    for value in shape:
        numel *= int(value)
    base = torch.from_file(
        raw_path,
        shared=True,
        size=numel,
        dtype=dtype,
    )
    out = base.view(shape)
    weakref.finalize(out, _remove_assembly_file, raw_path)
    return out


def assemble_frame_chunks(
    clips: list[torch.Tensor],
    *,
    fill: float = 0.5,
    mmap_threshold_bytes: int = DEFAULT_MMAP_THRESHOLD_BYTES,
    temp_dir: str | os.PathLike[str] | None = None,
) -> torch.Tensor:
    """Assemble IMAGE clips without a multi-GiB malloc for large final videos.

    Small outputs keep the normal in-memory torch.cat path. Large outputs use a
    file-backed CPU tensor and copy one segment at a time, so PyTorch does not
    ask DefaultCPUAllocator for one full contiguous final buffer.
    """
    _validate_clips(clips)
    if len(clips) == 1:
        return clips[0]

    total_frames = sum(int(clip.shape[0]) for clip in clips)
    max_h = max(int(clip.shape[1]) for clip in clips)
    max_w = max(int(clip.shape[2]) for clip in clips)
    channels = int(clips[0].shape[3])
    same_shape = all(
        int(clip.shape[1]) == max_h and int(clip.shape[2]) == max_w
        for clip in clips
    )
    estimated_bytes = estimate_assembly_bytes(clips)

    if estimated_bytes < max(0, int(mmap_threshold_bytes)):
        if same_shape:
            return torch.cat(clips, dim=0)
        padded: list[torch.Tensor] = []
        for clip in clips:
            canvas = torch.full(
                (int(clip.shape[0]), max_h, max_w, channels),
                float(fill),
                dtype=clip.dtype,
                device=clip.device,
            )
            _center_copy(canvas, clip, fill=fill)
            padded.append(canvas)
        return torch.cat(padded, dim=0)

    output = _file_backed_output(
        (total_frames, max_h, max_w, channels),
        dtype=clips[0].dtype,
        temp_dir=Path(temp_dir) if temp_dir is not None else _default_temp_dir(),
    )
    cursor = 0
    with torch.no_grad():
        for clip in clips:
            source = clip.detach()
            if source.device.type != "cpu":
                source = source.cpu()
            end = cursor + int(source.shape[0])
            _center_copy(output[cursor:end], source, fill=fill)
            cursor = end
    return output


__all__ = [
    "ASSEMBLY_FILE_PREFIX",
    "DEFAULT_MMAP_THRESHOLD_BYTES",
    "assemble_frame_chunks",
    "estimate_assembly_bytes",
]
