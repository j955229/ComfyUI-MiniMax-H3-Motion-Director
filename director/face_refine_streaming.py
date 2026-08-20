"""Helpers for segment-final Face Refine with bounded tracking history."""

from __future__ import annotations

from typing import Any

import torch


_TRACK_LIST_FIELDS = ("boxes", "weights", "detected", "face_rect", "face_heights")


def _odd_window(value: Any, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = int(default)
    return max(1, parsed) | 1


def tracking_history_frames(config: dict[str, Any]) -> int:
    """Return the preceding-frame count needed by current symmetric smoothers."""
    centre = _odd_window((config or {}).get("smooth_window"), 21)
    size = _odd_window((config or {}).get("size_smooth_window"), 51)
    # face_track also uses fixed/default Y and width windows of 9 and 13.
    return max(centre // 2, size // 2, 9 // 2, 13 // 2)


def select_tracking_history(
    history: torch.Tensor | None,
    current: torch.Tensor,
    config: dict[str, Any],
) -> torch.Tensor | None:
    """Select only compatible previous final RGB frames needed for tracking."""
    if not isinstance(history, torch.Tensor) or history.ndim != 4 or int(history.shape[0]) <= 0:
        return None
    if not isinstance(current, torch.Tensor) or current.ndim != 4 or int(current.shape[0]) <= 0:
        return None
    if tuple(history.shape[1:]) != tuple(current.shape[1:]):
        return None
    wanted = min(int(history.shape[0]), tracking_history_frames(config))
    if wanted <= 0:
        return None
    return history[-wanted:].detach()


def slice_tracking_result(result, start: int, end: int | None = None):
    """Drop history frames from a FaceTrackResult-like object without re-tracking."""
    total = int(result.crops.shape[0])
    start_i = max(0, min(total, int(start)))
    end_i = total if end is None else max(start_i, min(total, int(end)))
    crops = result.crops[start_i:end_i]

    transform = dict(result.transform)
    for key in _TRACK_LIST_FIELDS:
        value = transform.get(key)
        if isinstance(value, (list, tuple)):
            transform[key] = list(value[start_i:end_i])
    count = int(crops.shape[0])
    transform["frames"] = count

    detected_values = list(transform.get("detected") or [])
    face_heights = [float(value) for value in (transform.get("face_heights") or [])]
    detected = sum(bool(value) for value in detected_values)
    statistics = dict(getattr(result, "statistics", {}) or {})
    statistics["frames"] = count
    statistics["detected"] = int(detected)
    statistics["interpolated"] = max(0, count - int(detected))
    if face_heights:
        statistics["face_px_min"] = min(face_heights)
        statistics["face_px_mean"] = sum(face_heights) / len(face_heights)
        statistics["face_px_max"] = max(face_heights)

    return result.__class__(crops=crops, transform=transform, statistics=statistics)


def aggregate_denoise_statistics(
    chunks: list[tuple[dict[str, float], int]],
) -> dict[str, float]:
    """Aggregate adaptive-denoise stats across chunks using frame weighting."""
    valid = [
        (stats, max(0, int(frames)))
        for stats, frames in chunks
        if isinstance(stats, dict) and int(frames) > 0
    ]
    if not valid:
        return {}
    total_frames = sum(frames for _stats, frames in valid)
    return {
        "denoise_min": min(float(stats["denoise_min"]) for stats, _frames in valid),
        "denoise_mean": sum(
            float(stats["denoise_mean"]) * frames for stats, frames in valid
        ) / total_frames,
        "denoise_max": max(float(stats["denoise_max"]) for stats, _frames in valid),
    }


__all__ = [
    "aggregate_denoise_statistics",
    "select_tracking_history",
    "slice_tracking_result",
    "tracking_history_frames",
]
