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

from _minimax_h3_motion_director_testpkg.director import motion_context


def _video_latent(steps: int, *, with_audio: bool = True):
    video = torch.arange(steps, dtype=torch.float32).reshape(1, 1, steps, 1, 1)
    streams = [video]
    if with_audio:
        audio = torch.arange(240, dtype=torch.float32).reshape(1, 1, 2, 120)
        streams.append(audio)
    return {"samples": tuple(streams)}


@pytest.mark.parametrize(("span", "expected_steps"), [(1, 1), (5, 2), (22, 7), (39, 12)])
def test_latent_tail_uses_supported_context_blocks_without_sample_overshoot(span, expected_steps):
    blocks, offsets, endpoint = motion_context.video_context_from_latent(
        _video_latent(42),
        span=span,
        context_end_frame=121,
    )
    assert len(blocks) == expected_steps
    assert offsets == motion_context.latent_step_offsets(expected_steps)
    # 121 is not a latent boundary. The selected endpoint must stay at/before
    # the exported endpoint instead of consuming aligned sample overshoot.
    assert endpoint <= 121
    assert float(blocks[-1].flatten()[0]) <= 35


class _VideoVae:
    def __init__(self):
        self.calls = 0

    def encode(self, frames):
        self.calls += 1
        steps = {1: 1, 5: 2, 22: 7, 39: 12}[int(frames.shape[0])]
        return torch.zeros((1, 1, steps, 2, 2))


def _apply(monkeypatch, *, context_latent, color=False, audio=True, visual=True, conditioning=None):
    monkeypatch.setattr(motion_context, "motion_context_patch_status", lambda: (True, "ok"))
    vae = _VideoVae()
    color_calls = []
    monkeypatch.setattr(
        motion_context,
        "apply_color_reanchor",
        lambda frames, anchor: color_calls.append((frames, anchor)) or frames,
    )
    target = _video_latent(12, with_audio=True)  # 39 target frames
    conditioning = conditioning or [[torch.zeros(1), {"minimax_frame_count": 39, "minimax_keyframes": []}]]
    merged, info = motion_context.apply_exported_motion_context(
        conditioning,
        video_vae=vae,
        audio_vae=SimpleNamespace(),
        latent=target,
        context_latent=context_latent,
        context_end_frame=121,
        context_frames=torch.zeros((39, 32, 32, 3)),
        context_audio=None,
        context_span=22,
        target_frame_count=5,
        generation_frame_count=39,
        audio_enabled=audio,
        visual_enabled=visual,
        fps=24,
        color_reanchor_enabled=color,
        color_anchor=torch.ones((1, 32, 32, 3)),
        task_key="r2v",
    )
    return vae, color_calls, merged, info


def test_in_memory_av_latent_is_visual_first_and_skips_rgb_vae_encode(monkeypatch):
    vae, color_calls, merged, info = _apply(
        monkeypatch, context_latent=_video_latent(42), color=False, audio=True
    )
    assert vae.calls == 0
    assert color_calls == []
    assert info.visual_source == "latent"
    assert info.audio_source == "latent"
    assert merged[0][1]["minimax_keyframes"]
    assert info.pin_renorm_status == "OFF"
    assert info.pin_renorm_baseline_std is None


def test_missing_av_latent_uses_exported_pixel_fallback(monkeypatch):
    vae, color_calls, _merged, info = _apply(
        monkeypatch, context_latent=None, color=False, audio=False
    )
    assert vae.calls == 1
    assert color_calls == []
    assert info.visual_source == "pixels (fallback)"


def test_color_reanchor_forces_pixel_visual_but_audio_remains_latent_first(monkeypatch):
    vae, color_calls, _merged, info = _apply(
        monkeypatch, context_latent=_video_latent(42), color=True, audio=True
    )
    assert vae.calls == 1
    assert len(color_calls) == 1
    assert info.visual_source == "pixels (Color Re-anchor)"
    assert info.audio_source == "latent"


def test_audio_only_context_skips_video_path_and_preserves_visible_start_anchor(monkeypatch):
    conditioning = [[
        torch.zeros(1),
        {
            "minimax_frame_count": 5,
            "minimax_keyframes": [{"resolved_frame_index": 0, "latent": torch.ones(1)}],
        },
    ]]
    vae, color_calls, merged, info = _apply(
        monkeypatch,
        context_latent=_video_latent(42),
        color=False,
        audio=True,
        visual=False,
        conditioning=conditioning,
    )
    metadata = merged[0][1]
    assert vae.calls == 0
    assert color_calls == []
    assert info.visual_source == "off"
    assert info.context_frames == 0
    assert info.audio_source == "latent"
    assert metadata["minimax_keyframes"][0][motion_context.MC_KEY] == 22
    assert metadata["minimax_refs"][-1][motion_context.MC_AUDIO_KEY] == 22.0


def test_visual_only_context_never_injects_audio_reference(monkeypatch):
    _vae, _color_calls, merged, info = _apply(
        monkeypatch,
        context_latent=_video_latent(42),
        color=False,
        audio=False,
        visual=True,
    )
    assert info.visual_source == "latent"
    assert info.audio_source == "off"
    assert not merged[0][1].get("minimax_refs")
