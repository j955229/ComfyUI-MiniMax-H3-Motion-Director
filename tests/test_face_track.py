import torch

from _minimax_h3_motion_director_testpkg.director.face_track import (
    NoFaceDetected,
    _resolve_canvas,
    track_and_crop,
)


def test_track_and_crop_tracks_one_subject_across_full_visible_batch():
    images = torch.zeros((6, 64, 96, 3))
    boxes = [[[10 + i * 2, 12, 30 + i * 2, 36]] for i in range(6)]
    cursor = iter(boxes)
    result = track_and_crop(
        images,
        {"crop_factor": 2, "canvas_mode": "manual", "canvas_size": 256,
         "smooth_method": "gaussian", "smooth_window": 3, "size_smooth_window": 3,
         "size_mode": "adaptive", "select": "largest"},
        detector=lambda _frame: next(cursor),
    )
    assert result.crops.shape == (6, 256, 256, 3)
    assert result.statistics["detected"] == 6
    assert len(result.transform["boxes"]) == 6


def test_no_face_is_explicit_and_safe_for_pipeline_fallback():
    images = torch.zeros((3, 32, 32, 3))
    try:
        track_and_crop(images, {}, detector=lambda _frame: [])
    except NoFaceDetected as exc:
        assert "No face" in str(exc)
    else:
        raise AssertionError("no-face clips must be classified explicitly")


def test_auto_no_downscale_never_silently_applies_manual_canvas_cap():
    assert _resolve_canvas(1600, "auto_no_downscale", 768) == 1600
    assert _resolve_canvas(1600, "auto_capped_768", 768) == 768
    assert _resolve_canvas(1600, "manual", 1024) == 1024
