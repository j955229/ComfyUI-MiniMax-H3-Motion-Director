from unittest.mock import patch

import torch

from _minimax_h3_motion_director_testpkg.director.refine_sampling import (
    apply_global_refine,
    upscale_image_batch_strict,
)


BASE = dict(
    enabled=True,
    mode="refine",
    denoise=0.25,
    steps=8,
    seed_mode="inherit",
    seed_offset=1,
    skip_fl2v=False,
)


def _call(config):
    first = {"samples": object()}
    outcome = apply_global_refine(
        config,
        task_key="t2v",
        samples=first,
        model=object(), vae=object(), positive=[], negative=[], seed=1, cfg=1,
        first_steps=25, sampler_name="res_multistep", scheduler="simple",
        shift_video=12, shift_audio=3, director_width=864, director_height=480,
    )
    return first, outcome


def test_refine_exception_preserves_exact_first_pass_object():
    with patch(
        "_minimax_h3_motion_director_testpkg.director.refine_sampling.sample_single_stage",
        side_effect=RuntimeError("boom"),
    ):
        first, outcome = _call(dict(BASE))
    assert outcome.samples is first
    assert outcome.status == "FAILED"
    assert outcome.fallback == "FIRST_PASS_RESULT"
    assert "boom" in outcome.error


def test_refine_oom_preserves_exact_first_pass_object():
    with patch(
        "_minimax_h3_motion_director_testpkg.director.refine_sampling.sample_single_stage",
        side_effect=torch.cuda.OutOfMemoryError("CUDA out of memory"),
    ):
        first, outcome = _call(dict(BASE))
    assert outcome.samples is first
    assert outcome.status == "FAILED"
    assert "OutOfMemoryError" in outcome.error


def test_upscale_model_failure_never_calls_lanczos_as_fallback():
    images = torch.zeros((1, 8, 8, 3))
    with patch(
        "_minimax_h3_motion_director_testpkg.director.refine_sampling._upscale_model_exact",
        side_effect=RuntimeError("model failed"),
    ), patch(
        "_minimax_h3_motion_director_testpkg.director.refine_sampling._resize_lanczos"
    ) as lanczos:
        try:
            upscale_image_batch_strict(images, width=16, height=16, method="upscale_model", model_name="x")
        except RuntimeError:
            pass
        else:
            raise AssertionError("chosen method failure must propagate")
    lanczos.assert_not_called()


def test_rtx_failure_never_calls_lanczos_as_fallback():
    images = torch.zeros((1, 8, 8, 3))
    with patch(
        "_minimax_h3_motion_director_testpkg.director.refine_sampling._upscale_rtx_vsr_exact",
        side_effect=RuntimeError("vsr failed"),
    ), patch(
        "_minimax_h3_motion_director_testpkg.director.refine_sampling._resize_lanczos"
    ) as lanczos:
        try:
            upscale_image_batch_strict(images, width=16, height=16, method="nvidia_rtx_vsr")
        except RuntimeError:
            pass
        else:
            raise AssertionError("chosen method failure must propagate")
    lanczos.assert_not_called()


def test_skip_fl2v_does_not_sample():
    first = {"samples": object()}
    with patch(
        "_minimax_h3_motion_director_testpkg.director.refine_sampling.sample_single_stage"
    ) as sample:
        outcome = apply_global_refine(
            {**BASE, "skip_fl2v": True}, task_key="fl2v", samples=first,
            model=object(), vae=object(), positive=[], negative=[], seed=1, cfg=1,
            first_steps=25, sampler_name="x", scheduler="simple", shift_video=12,
            shift_audio=3, director_width=864, director_height=480,
        )
    assert outcome.status == "SKIPPED" and outcome.samples is first
    sample.assert_not_called()
