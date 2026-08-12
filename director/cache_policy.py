"""Persistence policy and memory-first access for full decoded segment caches."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import torch


def should_persist_segment_cache(
    plan: Any,
    *,
    source_bridge_active: bool,
) -> bool:
    """Return whether complete decoded segments should be persisted.

    Multi-segment generation must keep full RGB segment caches so a later
    selection run can regenerate only selected segments while reusing the
    previous generated results for unselected segments.

    Motion Context has its own endpoint-tail caches and is independent from
    these full decoded segment caches.
    """
    segments = getattr(plan, "segments", None) or []
    multi_segment = len(segments) > 1

    return multi_segment or bool(source_bridge_active)


def resolve_nominal_segment_frames(
    in_memory: dict[int, torch.Tensor],
    *,
    segment_index: int,
    expected_frames: int,
    disk_loader: Callable[[], torch.Tensor | None],
) -> tuple[torch.Tensor, bool]:
    """Resolve Source Bridge anchors, always preferring this Queue's result."""
    index = int(segment_index)
    frames = in_memory.get(index)
    loaded_from_disk = False
    if frames is None:
        frames = disk_loader()
        loaded_from_disk = True
    if frames is None or int(frames.shape[0]) != int(expected_frames):
        raise ValueError(
            "Source Bridge requires both adjacent generated segments. Run the "
            "complete sequence once or generate the missing adjacent segment first."
        )
    if loaded_from_disk:
        frames = frames.detach().cpu().float()
        in_memory[index] = frames
    return frames, loaded_from_disk


def write_segment_cache_if_required(
    enabled: bool,
    writer: Callable[[], Any],
) -> bool:
    """Execute one best-effort cache writer only when the run policy needs it."""
    if not enabled:
        return False
    writer()
    return True


__all__ = [
    "resolve_nominal_segment_frames",
    "should_persist_segment_cache",
    "write_segment_cache_if_required",
]
