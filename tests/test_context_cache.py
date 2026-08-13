from __future__ import annotations

from types import SimpleNamespace

import pytest
import torch

from _minimax_h3_motion_director_testpkg.director import context_cache


def _objects(frame_count: int = 362):
    seg = SimpleNamespace(index=0, timeline_index=0)
    plan = SimpleNamespace(frame_rate=24.0)
    frames = torch.arange(frame_count, dtype=torch.float32).reshape(frame_count, 1, 1, 1)
    sample_count = round(frame_count / plan.frame_rate * 48_000)
    audio = {
        "waveform": torch.arange(sample_count, dtype=torch.float32).reshape(1, 1, sample_count),
        "sample_rate": 48_000,
    }
    return seg, plan, frames, audio


def test_exported_context_cache_persists_only_maximum_39_frame_tail(monkeypatch, tmp_path):
    seg, plan, frames, audio = _objects()
    monkeypatch.setattr(context_cache, "_cache_root", lambda _node: tmp_path)
    monkeypatch.setattr(context_cache, "context_fingerprint", lambda *_a, **_k: {"fp": 1})

    assert context_cache.save_motion_context_cache(
        "node", seg, plan, frames=frames, audio=audio, settings={"seed": 1}
    )
    loaded = context_cache.load_motion_context_cache(
        "node", seg, plan, settings={"seed": 1}, strict=True
    )

    assert loaded is not None
    assert loaded.frames.shape == (39, 1, 1, 1)
    assert torch.equal(loaded.frames[:, 0, 0, 0], torch.arange(323, 362, dtype=torch.float32))
    assert loaded.metadata["stored_tail_frames"] == 39
    assert loaded.metadata["original_export_frames"] == 362
    assert "frame_count" not in loaded.metadata

    assert loaded.audio is not None
    expected_audio_samples = round(39 / 24.0 * 48_000)
    assert loaded.audio["waveform"].shape[-1] == expected_audio_samples
    assert torch.equal(
        loaded.audio["waveform"],
        audio["waveform"][..., -expected_audio_samples:],
    )
    assert loaded.metadata["stored_audio_samples"] == expected_audio_samples


def test_context_fingerprint_ignores_consumer_context_length():
    seg = SimpleNamespace(
        index=0,
        timeline_index=0,
        start_frame=0,
        end_frame=10,
        prompt="same result",
        negative_prompt="",
        task_key="t2v",
        task_type="t2v",
        source_clip=None,
        refs=[],
        ref_audios=[],
        ref_videos=[],
        ref_video_audios=[],
        reference_video_meta={},
        reference_video_start_frame=0,
        reference_tags={},
    )
    plan = SimpleNamespace(segments=[seg], raw={})

    short = context_cache.context_fingerprint(
        seg, plan, {"seed": 1, "context_length": 22, "steps": 8}
    )
    long = context_cache.context_fingerprint(
        seg, plan, {"seed": 1, "context_length": 39, "steps": 8}
    )

    assert short == long
    assert short["producer_digest"] == long["producer_digest"]


@pytest.mark.parametrize(
    ("version", "format_name"),
    [
        (1, "minimax_h3_motion_director_exported_context_v1"),
        (2, "minimax_h3_motion_director_exported_context_tail_v2"),
    ],
)
def test_old_exported_context_cache_is_invalid(monkeypatch, tmp_path, version, format_name):
    seg, plan, _frames, _audio = _objects(39)
    monkeypatch.setattr(context_cache, "_cache_root", lambda _node: tmp_path)
    torch.save(
        {
            "format": format_name,
            "version": version,
            "frames": torch.zeros((39, 1, 1, 3)),
        },
        tmp_path / "seg_0000.pt",
    )

    assert context_cache.load_motion_context_cache(
        "node", seg, plan, settings={"seed": 1}
    ) is None


def test_strict_selection_load_distinguishes_missing_context_cache(monkeypatch, tmp_path):
    seg, plan, _frames, _audio = _objects(39)
    monkeypatch.setattr(context_cache, "_cache_root", lambda _node: tmp_path)
    with pytest.raises(context_cache.MotionContextCacheError, match="cache file is missing"):
        context_cache.load_motion_context_cache(
            "node", seg, plan, settings={"seed": 1}, strict=True
        )


def test_strict_selection_load_reports_stale_context_cache(monkeypatch, tmp_path):
    seg, plan, frames, _audio = _objects(39)
    monkeypatch.setattr(context_cache, "_cache_root", lambda _node: tmp_path)
    monkeypatch.setattr(context_cache, "context_fingerprint", lambda *_a, **_k: {"fp": 1})
    assert context_cache.save_motion_context_cache(
        "node", seg, plan, frames=frames, audio=None, settings={"seed": 1}
    )
    monkeypatch.setattr(context_cache, "context_fingerprint", lambda *_a, **_k: {"fp": 2})
    with pytest.raises(context_cache.MotionContextCacheError, match="timeline or generation settings changed"):
        context_cache.load_motion_context_cache(
            "node", seg, plan, settings={"seed": 1}, strict=True
        )
