from __future__ import annotations

from types import SimpleNamespace
import sys
import types

import pytest
import torch

_PATCHES = "_minimax_h3_motion_director_testpkg.patches"
if _PATCHES not in sys.modules:
    patches = types.ModuleType(_PATCHES)
    patches.MC_AUDIO_KEY = "_motion_context_audio_end"
    patches.MC_KEY = "_motion_context_frame_index"
    patches.motion_context_patch_status = lambda: (True, "test")
    sys.modules[_PATCHES] = patches

from _minimax_h3_motion_director_testpkg.director import latent_context_cache, motion_context


def _objects():
    seg = SimpleNamespace(index=0, timeline_index=0)
    plan = SimpleNamespace(frame_rate=24.0)
    latent = {
        "samples": (
            torch.arange(42, dtype=torch.float32).reshape(1, 1, 42, 1, 1),
            torch.arange(480, dtype=torch.float32).reshape(1, 1, 2, 240),
        )
    }
    handoff = {
        "context_end_frame": 121,
        "trim_frames": 0,
        "export_frames": 121,
        "sample_frames": 141,
    }
    return seg, plan, latent, handoff


def test_versioned_av_latent_cache_persists_only_maximum_39_frame_tail(monkeypatch, tmp_path):
    seg, plan, latent, handoff = _objects()
    monkeypatch.setattr(latent_context_cache, "_cache_root", lambda _node: tmp_path)
    monkeypatch.setattr(latent_context_cache, "context_fingerprint", lambda *_a, **_k: {"fp": 1})

    assert latent_context_cache.save_latent_context_cache(
        "node", seg, plan, latent=latent, handoff=handoff, settings={"seed": 1}
    )
    loaded = latent_context_cache.load_latent_context_cache(
        "node", seg, plan, settings={"seed": 1}
    )
    assert loaded is not None
    assert loaded.handoff["context_end_frame"] == 39
    assert loaded.handoff["export_frames"] == 39
    assert loaded.handoff["stored_tail_frames"] == 39
    assert loaded.handoff["original_export_frames"] == 121
    assert loaded.latent["samples"][0].shape[2] == 12
    assert loaded.latent["samples"][0].shape[2] < latent["samples"][0].shape[2]
    assert loaded.latent["samples"][1].shape[-1] == 65
    assert loaded.latent["samples"][1].shape[-1] < latent["samples"][1].shape[-1]
    assert float(loaded.latent["samples"][0][..., -1, :, :].flatten()[0]) <= 35
    assert loaded.metadata["pipeline"] == latent_context_cache.LATENT_HANDOFF_PIPELINE


@pytest.mark.parametrize(("span", "video_steps"), [(1, 1), (5, 2), (22, 7), (39, 12)])
def test_persisted_latent_tail_can_serve_every_supported_context_length(
    monkeypatch, tmp_path, span, video_steps
):
    seg, plan, latent, handoff = _objects()
    monkeypatch.setattr(latent_context_cache, "_cache_root", lambda _node: tmp_path)
    monkeypatch.setattr(latent_context_cache, "context_fingerprint", lambda *_a, **_k: {"fp": 1})
    assert latent_context_cache.save_latent_context_cache(
        "node", seg, plan, latent=latent, handoff=handoff, settings={"seed": 1}
    )
    loaded = latent_context_cache.load_latent_context_cache(
        "node", seg, plan, settings={"seed": 1}
    )
    assert loaded is not None

    blocks, _offsets, endpoint = motion_context.video_context_from_latent(
        loaded.latent,
        span=span,
        context_end_frame=loaded.handoff["context_end_frame"],
    )
    audio_ref, audio_steps = motion_context._audio_context_from_latent(
        loaded.latent,
        span=span,
        context_end_frame=endpoint,
    )
    assert len(blocks) == video_steps
    assert audio_steps == round(span / 24.0 * 40.0)
    assert audio_ref["audio_latent"].shape[-1] == audio_steps


@pytest.mark.parametrize(
    ("version", "format_name"),
    [
        (1, "minimax_h3_motion_director_av_latent_handoff_v1"),
        (2, "minimax_h3_motion_director_av_latent_tail_v2"),
    ],
)
def test_old_or_stale_latent_cache_is_not_mistaken_for_current_handoff(
    monkeypatch, tmp_path, version, format_name
):
    seg, plan, _latent, _handoff = _objects()
    monkeypatch.setattr(latent_context_cache, "_cache_root", lambda _node: tmp_path)
    monkeypatch.setattr(latent_context_cache, "context_fingerprint", lambda *_a, **_k: {"fp": 2})
    torch.save(
        {
            "format": format_name,
            "version": version,
            "latent": {"samples": (torch.zeros(1),)},
        },
        tmp_path / "seg_0000.av.pt",
    )
    assert latent_context_cache.load_latent_context_cache(
        "node", seg, plan, settings={"seed": 1}
    ) is None


def test_pin_renorm_baseline_survives_disk_cache_round_trip(monkeypatch, tmp_path):
    seg, plan, latent, handoff = _objects()
    handoff["pin_renorm_baseline_std"] = 1.125
    monkeypatch.setattr(latent_context_cache, "_cache_root", lambda _node: tmp_path)
    monkeypatch.setattr(latent_context_cache, "context_fingerprint", lambda *_a, **_k: {"fp": 1})
    assert latent_context_cache.save_latent_context_cache(
        "node", seg, plan, latent=latent, handoff=handoff, settings={"pin_renorm_enabled": True}
    )
    loaded = latent_context_cache.load_latent_context_cache(
        "node", seg, plan, settings={"pin_renorm_enabled": True}
    )
    assert loaded is not None
    assert loaded.handoff["pin_renorm_baseline_std"] == 1.125
