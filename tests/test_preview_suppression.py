from pathlib import Path

import torch

from _minimax_h3_motion_director_testpkg.director.core_sampling import _DirectorPreviewOuterSample


def test_director_sampling_does_not_install_comfy_native_preview_callback():
    source = (Path(__file__).resolve().parents[1] / "director" / "core_sampling.py").read_text(encoding="utf-8")
    assert "latent_preview.prepare_callback" not in source
    assert "callback=callback" in source
    assert "WrappersMP.OUTER_SAMPLE" in source
    assert "latent_shapes" in source


def test_outer_sample_observer_receives_packed_x0_and_authoritative_shapes_without_mutation():
    packed = torch.arange(12, dtype=torch.float32).reshape(1, 1, 12)
    shapes = [(1, 3, 2, 2), (1, 2)]
    observed = []
    original = []

    wrapper = _DirectorPreviewOuterSample(
        lambda step, total, x0, latent_shapes: observed.append((step, total, x0, latent_shapes)),
        every=1,
    )

    def executor(_noise, _latent, _sampler, _sigmas, _mask, callback, _pbar, _seed, *, latent_shapes):
        callback(0, packed, packed + 1, 8)
        return "sampled"

    result = wrapper(
        executor, None, None, None, None, None,
        lambda step, x0, _x, total: original.append((step, x0, total)),
        False, 1, shapes,
    )
    assert result == "sampled"
    assert len(observed) == 1 and observed[0][:2] == (0, 8)
    assert observed[0][2] is packed and observed[0][3] is shapes
    assert len(original) == 1 and original[0][0] == 0 and original[0][1] is packed and original[0][2] == 8
    assert torch.equal(packed, torch.arange(12, dtype=torch.float32).reshape(1, 1, 12))
