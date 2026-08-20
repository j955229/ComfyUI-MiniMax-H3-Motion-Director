from __future__ import annotations

import sys
import types

import torch


MC_KEY = "motion_context_index"
MC_AUDIO_KEY = "motion_audio_context_index"


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


def _install_fake_nodes(monkeypatch):
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


def test_sync_removes_old_visual_context_and_resizes_native_keyframe(monkeypatch):
    import director.refine_latent_stage as stage

    _install_fake_nodes(monkeypatch)
    context_0 = torch.zeros((1, 24, 1, 2, 4))
    context_1 = torch.zeros((1, 24, 1, 2, 4))
    native_last = torch.ones((1, 24, 1, 2, 4))
    base_ref = {"kind": "image", "token": "base"}
    motion_audio = {
        "kind": "audio",
        "ref_audio_t": 8,
        MC_AUDIO_KEY: 5.0,
        "token": "old-motion-audio",
    }
    conditioning = [[
        torch.zeros(1),
        {
            "minimax_frame_count": 124,
            "minimax_keyframes": [
                {"resolved_frame_index": 0, MC_KEY: 0, "latent": context_0},
                {"resolved_frame_index": 0, MC_KEY: 1, "latent": context_1},
                {"resolved_frame_index": 0, MC_KEY: 100, "latent": native_last},
            ],
            "minimax_refs": [base_ref, motion_audio],
            "other": "keep",
        },
    ]]

    out = stage.sync_h3_keyframe_conditioning(
        conditioning, FakeVAE(), width=128, height=64
    )
    metadata = out[0][1]
    keyframes = metadata["minimax_keyframes"]

    assert len(keyframes) == 1
    assert MC_KEY not in keyframes[0]
    assert keyframes[0]["resolved_frame_index"] == 100
    assert keyframes[0]["latent"].shape[-2:] == (4, 8)
    assert metadata["minimax_refs"] == [base_ref]
    assert metadata["other"] == "keep"


def test_sync_preserves_audio_only_context(monkeypatch):
    import director.refine_latent_stage as stage

    _install_fake_nodes(monkeypatch)
    motion_audio = {
        "kind": "audio",
        "ref_audio_t": 8,
        MC_AUDIO_KEY: 5.0,
    }
    conditioning = [[
        torch.zeros(1),
        {
            "minimax_frame_count": 124,
            "minimax_refs": [motion_audio],
        },
    ]]

    out = stage.sync_h3_keyframe_conditioning(
        conditioning, FakeVAE(), width=128, height=64
    )
    assert out[0][1]["minimax_refs"] == [motion_audio]


def test_sync_does_not_strip_source_bridge_anchors(monkeypatch):
    import director.refine_latent_stage as stage

    _install_fake_nodes(monkeypatch)
    first = torch.zeros((1, 24, 1, 2, 4))
    last = torch.ones((1, 24, 1, 2, 4))
    conditioning = [[
        torch.zeros(1),
        {
            "minimax_frame_count": 5,
            "minimax_keyframes": [
                {"resolved_frame_index": 0, MC_KEY: 0, "latent": first},
                {"resolved_frame_index": 0, MC_KEY: 4, "latent": last},
            ],
        },
    ]]

    out = stage.sync_h3_keyframe_conditioning(
        conditioning, FakeVAE(), width=128, height=64
    )
    keyframes = out[0][1]["minimax_keyframes"]
    assert len(keyframes) == 2
    assert keyframes[0][MC_KEY] == 0
    assert keyframes[1][MC_KEY] == 4
    assert keyframes[0]["latent"].shape[-2:] == (4, 8)
    assert keyframes[1]["latent"].shape[-2:] == (4, 8)
