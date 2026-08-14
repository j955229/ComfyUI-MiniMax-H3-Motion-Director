from __future__ import annotations

import torch

from _minimax_h3_motion_director_testpkg.director import tae_preview


def test_flat_and_temporal_tae_checkpoints_are_distinguished():
    flat = {"1.weight": torch.zeros((3, 24, 3, 3))}
    temporal = {
        "decoder.1.weight": torch.zeros((64, 24, 3, 3)),
        "decoder.22.bias": torch.zeros((12,)),
    }
    assert tae_preview.is_temporal_taehv_state_dict(flat) is False
    assert tae_preview.is_temporal_taehv_state_dict(temporal) is True


def test_temporal_taeh3_loader_selects_taehv_decoder(monkeypatch):
    temporal = {
        "decoder.1.weight": torch.zeros((64, 24, 3, 3)),
        "decoder.22.bias": torch.zeros((12,)),
    }
    sentinel = object()
    monkeypatch.setattr(tae_preview, "_TAEHVDecoder", lambda state: sentinel)
    assert tae_preview._decoder_from_state_dict(temporal) is sentinel


def test_packed_h3_latent_reaches_true_rgb_preview_decoder(monkeypatch):
    calls = []

    class Decoder:
        latent_channels = 24

        def decode_video(self, latent, frame_indices):
            calls.append((tuple(latent.shape), list(frame_indices)))
            return torch.full((len(frame_indices), 16, 16, 3), 0.5)

    monkeypatch.setattr(tae_preview, "get_tae_decoder", lambda: Decoder())
    shape = (1, 24, 5, 2, 2)
    packed = torch.randn(1, 1, 24 * 5 * 2 * 2 + 32)
    frames = tae_preview.x0_to_preview_pils(
        packed, latent_shapes=[shape, (1, 32)], frame_count=3, max_side=128
    )
    assert calls == [(shape, [0, 2, 4])]
    assert len(frames) == 3
    assert all(frame.mode == "RGB" for frame in frames)
