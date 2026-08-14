from unittest.mock import patch

import torch

from _minimax_h3_motion_director_testpkg.director.face_refine_pipeline import apply_face_refine
from _minimax_h3_motion_director_testpkg.director.face_track import NoFaceDetected


def _call():
    assembled = torch.zeros((5, 32, 32, 3))
    outcome = apply_face_refine(
        {"enabled": True}, images=assembled, model=object(), vae=object(), audio_vae=object(),
        clip=object(), prompt="face", seed=1, cfg=1, sampler_name="x", scheduler="simple",
        shift_video=12, shift_audio=3,
    )
    return assembled, outcome


def test_face_refine_exception_preserves_assembled_result():
    with patch(
        "_minimax_h3_motion_director_testpkg.director.face_refine_pipeline.track_and_crop",
        side_effect=RuntimeError("CUDA out of memory"),
    ):
        assembled, outcome = _call()
    assert outcome.images is assembled
    assert outcome.status == "FAILED"
    assert outcome.fallback == "ASSEMBLED_RESULT"


def test_no_face_preserves_assembled_result_without_queue_failure():
    with patch(
        "_minimax_h3_motion_director_testpkg.director.face_refine_pipeline.track_and_crop",
        side_effect=NoFaceDetected("No face detected"),
    ):
        assembled, outcome = _call()
    assert outcome.images is assembled
    assert outcome.status == "NO_FACE"
    assert outcome.fallback == "ASSEMBLED_RESULT"
