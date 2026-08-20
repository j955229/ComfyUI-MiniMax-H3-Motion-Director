from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

import pytest
import torch


MC_KEY = "motion_context_index"
MC_AUDIO_KEY = "motion_audio_context_index"
CTX_COUNT_KEY = "_motion_director_context_keyframe_count"
NATIVE_ORIGINS_KEY = "_motion_director_native_keyframe_origins"
BASE_REF_COUNT_KEY = "_motion_director_base_ref_count"


def _load_motion_context_module(monkeypatch):
    root = types.ModuleType("motion_director_testpkg")
    root.__path__ = []
    director_pkg = types.ModuleType("motion_director_testpkg.director")
    director_pkg.__path__ = []
    lib_pkg = types.ModuleType("motion_director_testpkg.lib")
    lib_pkg.__path__ = []

    image_prep = types.ModuleType("motion_director_testpkg.lib.image_prep")
    image_prep.preflight_h3_visual_conditioning = lambda *args, **kwargs: None

    patches = types.ModuleType("motion_director_testpkg.patches")
    patches.MC_KEY = MC_KEY
    patches.MC_AUDIO_KEY = MC_AUDIO_KEY
    patches.motion_context_patch_status = lambda: (True, "ok")

    color = types.ModuleType("motion_director_testpkg.director.color_reanchor")
    color.apply_color_reanchor = lambda frames, anchor: frames

    for name, module in {
        "motion_director_testpkg": root,
        "motion_director_testpkg.director": director_pkg,
        "motion_director_testpkg.lib": lib_pkg,
        "motion_director_testpkg.lib.image_prep": image_prep,
        "motion_director_testpkg.patches": patches,
        "motion_director_testpkg.director.color_reanchor": color,
    }.items():
        monkeypatch.setitem(sys.modules, name, module)

    path = Path("director/motion_context.py")
    spec = importlib.util.spec_from_file_location(
        "motion_director_testpkg.director.motion_context", path
    )
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, module)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_motion_context_repin_replaces_previous_context_instead_of_rejecting(monkeypatch):
    mod = _load_motion_context_module(monkeypatch)
    base_ref = {"kind": "image", "token": "base"}
    native_last = {
        "resolved_frame_index": 123,
        "latent": torch.zeros((1, 24, 1, 2, 4)),
    }
    base = {
        "minimax_frame_count": 124,
        "minimax_keyframes": [native_last],
        "minimax_refs": [base_ref],
    }
    first_motion = [{
        "resolved_frame_index": 0,
        MC_KEY: 0,
        "latent": torch.zeros((1, 24, 1, 2, 4)),
    }]
    first_audio = {
        "kind": "audio",
        "ref_audio_t": 8,
        MC_AUDIO_KEY: 5.0,
        "token": "old-motion-audio",
    }

    first, _, _ = mod._merge_one_metadata(
        base,
        motion_keyframes=first_motion,
        motion_audio_ref=first_audio,
        generation_frame_count=124,
        visible_last_index=100,
        visual_context_enabled=True,
    )

    # Emulate the high-resolution keyframe synchronization that happens between
    # first-pass generation and Global Refine repin.
    context_count = int(first[CTX_COUNT_KEY])
    native = dict(first["minimax_keyframes"][context_count])
    native["latent"] = torch.ones((1, 24, 1, 4, 8))
    first["minimax_keyframes"][context_count] = native

    second_motion = [{
        "resolved_frame_index": 0,
        MC_KEY: 0,
        "latent": torch.ones((1, 24, 1, 4, 8)),
    }]
    second_audio = {
        "kind": "audio",
        "ref_audio_t": 8,
        MC_AUDIO_KEY: 5.0,
        "token": "fresh-motion-audio",
    }

    second, _, _ = mod._merge_one_metadata(
        first,
        motion_keyframes=second_motion,
        motion_audio_ref=second_audio,
        generation_frame_count=124,
        visible_last_index=100,
        visual_context_enabled=True,
    )

    assert second[CTX_COUNT_KEY] == 1
    assert second[NATIVE_ORIGINS_KEY] == [123]
    assert second[BASE_REF_COUNT_KEY] == 1
    assert len(second["minimax_keyframes"]) == 2
    assert second["minimax_keyframes"][0]["latent"].shape[-2:] == (4, 8)
    assert second["minimax_keyframes"][1]["latent"].shape[-2:] == (4, 8)
    assert second["minimax_keyframes"][1][MC_KEY] == 100
    assert [ref["token"] for ref in second["minimax_refs"]] == [
        "base",
        "fresh-motion-audio",
    ]


def test_foreign_premarked_conditioning_is_still_rejected(monkeypatch):
    mod = _load_motion_context_module(monkeypatch)
    foreign = {
        "minimax_keyframes": [{
            "resolved_frame_index": 0,
            MC_KEY: 7,
            "latent": torch.zeros((1, 24, 1, 2, 4)),
        }]
    }
    with pytest.raises(ValueError, match="already contains Motion Context keyframes"):
        mod._merge_one_metadata(
            foreign,
            motion_keyframes=[],
            motion_audio_ref=None,
            generation_frame_count=124,
            visible_last_index=100,
            visual_context_enabled=True,
        )


def test_high_res_sync_skips_context_prefix_but_resizes_relocated_native_keyframe(monkeypatch):
    import director.refine_latent_stage as stage

    class FakeVAE:
        def decode(self, latent):
            t = int(latent.shape[-3])
            return torch.zeros(
                (t, int(latent.shape[-2]) * 16, int(latent.shape[-1]) * 16, 3)
            )

        def encode(self, images):
            return torch.zeros(
                (1, 24, 1, int(images.shape[1]) // 16, int(images.shape[2]) // 16)
            )

    nodes = types.ModuleType("nodes")

    class Decode:
        def decode(self, vae, latent):
            return (vae.decode(latent["samples"]),)

    class Encode:
        def encode(self, vae, images):
            return ({"samples": vae.encode(images)},)

    nodes.VAEDecode = Decode
    nodes.VAEEncode = Encode
    monkeypatch.setitem(sys.modules, "nodes", nodes)

    context = torch.zeros((1, 24, 1, 2, 4))
    native_last = torch.ones((1, 24, 1, 2, 4))
    conditioning = [[
        torch.zeros(1),
        {
            "minimax_frame_count": 124,
            CTX_COUNT_KEY: 1,
            NATIVE_ORIGINS_KEY: [123],
            BASE_REF_COUNT_KEY: 0,
            "minimax_keyframes": [
                {"resolved_frame_index": 0, MC_KEY: 0, "latent": context},
                {"resolved_frame_index": 0, MC_KEY: 100, "latent": native_last},
            ],
        },
    ]]

    out = stage.sync_h3_keyframe_conditioning(
        conditioning, FakeVAE(), width=128, height=64
    )
    keyframes = out[0][1]["minimax_keyframes"]
    assert keyframes[0]["latent"] is context
    assert keyframes[1]["latent"].shape[-2:] == (4, 8)
