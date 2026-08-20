from __future__ import annotations

from dataclasses import dataclass

import torch

from director.face_refine_streaming import (
    aggregate_denoise_statistics,
    select_tracking_history,
    slice_tracking_result,
    tracking_history_frames,
)


@dataclass
class FakeTrackResult:
    crops: torch.Tensor
    transform: dict
    statistics: dict


def _track_result(frames: int = 7) -> FakeTrackResult:
    return FakeTrackResult(
        crops=torch.arange(frames, dtype=torch.float32).view(frames, 1, 1, 1),
        transform={
            "boxes": [(float(i), 0.0, 4.0, 4.0) for i in range(frames)],
            "canvas": (32, 32),
            "src_size": (64, 64),
            "frames": frames,
            "weights": [1.0] * frames,
            "detected": [True, False, True, True, False, True, True][:frames],
            "face_rect": [(1.0, 1.0, 2.0, 2.0)] * frames,
            "face_heights": [10.0 + i for i in range(frames)],
            "crop_factor": 2.5,
        },
        statistics={"frames": frames},
    )


def test_tracking_history_uses_smoothing_radius_not_full_window():
    config = {"smooth_window": 21, "size_smooth_window": 51}
    assert tracking_history_frames(config) == 25


def test_select_tracking_history_keeps_only_required_tail_and_requires_same_canvas():
    history = torch.zeros((40, 64, 96, 3))
    current = torch.ones((12, 64, 96, 3))
    selected = select_tracking_history(
        history,
        current,
        {"smooth_window": 21, "size_smooth_window": 51},
    )
    assert selected is not None
    assert selected.shape == (25, 64, 96, 3)

    mismatched = torch.zeros((40, 32, 96, 3))
    assert select_tracking_history(mismatched, current, {}) is None


def test_slice_tracking_result_drops_history_from_crops_and_transform_statistics():
    result = _track_result(7)
    sliced = slice_tracking_result(result, 3)

    assert sliced.crops[:, 0, 0, 0].tolist() == [3.0, 4.0, 5.0, 6.0]
    assert sliced.transform["frames"] == 4
    assert len(sliced.transform["boxes"]) == 4
    assert len(sliced.transform["face_rect"]) == 4
    assert len(sliced.transform["weights"]) == 4
    assert len(sliced.transform["detected"]) == 4
    assert sliced.statistics["frames"] == 4
    assert sliced.statistics["detected"] == 3
    assert sliced.statistics["interpolated"] == 1
    assert sliced.statistics["face_px_min"] == 13.0
    assert sliced.statistics["face_px_max"] == 16.0


def test_aggregate_denoise_statistics_is_frame_weighted_across_chunks():
    stats = aggregate_denoise_statistics(
        [
            ({"denoise_min": 0.2, "denoise_mean": 0.4, "denoise_max": 0.7}, 2),
            ({"denoise_min": 0.1, "denoise_mean": 0.8, "denoise_max": 0.9}, 6),
        ]
    )
    assert stats["denoise_min"] == 0.1
    assert stats["denoise_max"] == 0.9
    assert abs(stats["denoise_mean"] - 0.7) < 1e-9
