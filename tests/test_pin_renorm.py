from __future__ import annotations

import sys
import types

import torch

_PATCHES = "_minimax_h3_motion_director_testpkg.patches"
if _PATCHES not in sys.modules:
    patches = types.ModuleType(_PATCHES)
    patches.MC_AUDIO_KEY = "_motion_context_audio_end"
    patches.MC_KEY = "_motion_context_frame_index"
    patches.motion_context_patch_status = lambda: (True, "test")
    sys.modules[_PATCHES] = patches

from _minimax_h3_motion_director_testpkg.director.latent_context_cache import (
    prepare_latent_context_tail,
)
from _minimax_h3_motion_director_testpkg.director.motion_context import (
    renorm_context_video_latent,
)


def _latent(video_scale: float = 1.0):
    video = torch.arange(12, dtype=torch.float32).reshape(1, 1, 12, 1, 1) * video_scale
    audio = torch.arange(65, dtype=torch.float32).reshape(1, 1, 1, 65)
    return {"samples": (video, audio)}


def test_pin_renorm_matches_video_std_and_leaves_audio_exactly_unchanged():
    latent = _latent(video_scale=3.0)
    audio_before = latent["samples"][1].clone()
    adjusted, baseline, current, scale = renorm_context_video_latent(latent, 2.5)

    assert abs(float(adjusted["samples"][0].std(unbiased=False)) - 2.5) < 1e-5
    assert baseline == 2.5
    assert current > baseline
    assert scale < 1.0
    assert torch.equal(adjusted["samples"][1], audio_before)
    assert torch.equal(latent["samples"][1], audio_before)


def test_first_visual_handoff_establishes_its_own_baseline_without_scale_change():
    latent = _latent(video_scale=2.0)
    adjusted, baseline, current, scale = renorm_context_video_latent(latent, None)
    assert abs(baseline - current) < 1e-9
    assert abs(scale - 1.0) < 1e-9
    assert torch.allclose(adjusted["samples"][0], latent["samples"][0])


def test_chain_baseline_is_persisted_in_versioned_handoff_metadata():
    latent = _latent()
    handoff = {
        "context_end_frame": 39,
        "trim_frames": 0,
        "export_frames": 39,
        "sample_frames": 39,
        "pin_renorm_baseline_std": 1.2345,
    }
    _tail, stored = prepare_latent_context_tail(latent, handoff)
    assert stored["pin_renorm_baseline_std"] == 1.2345


def test_visual_chain_break_drops_old_baseline_and_next_handoff_starts_fresh():
    old_chain = {
        "context_end_frame": 39,
        "trim_frames": 0,
        "export_frames": 39,
        "sample_frames": 39,
        "pin_renorm_baseline_std": 1.2345,
    }
    _tail, stored_old = prepare_latent_context_tail(_latent(), old_chain)
    assert stored_old["pin_renorm_baseline_std"] == 1.2345

    # A segment generated across a Visual OFF boundary does not copy the old
    # baseline into its handoff. The next Visual ON boundary therefore passes
    # None and establishes a new chain-local baseline from this producer.
    broken_chain = {
        "context_end_frame": 39,
        "trim_frames": 0,
        "export_frames": 39,
        "sample_frames": 39,
    }
    _tail, stored_after_break = prepare_latent_context_tail(_latent(video_scale=4.0), broken_chain)
    assert "pin_renorm_baseline_std" not in stored_after_break
    _adjusted, new_baseline, current, scale = renorm_context_video_latent(
        _latent(video_scale=4.0),
        stored_after_break.get("pin_renorm_baseline_std"),
    )
    assert new_baseline == current
    assert new_baseline != stored_old["pin_renorm_baseline_std"]
    assert scale == 1.0
