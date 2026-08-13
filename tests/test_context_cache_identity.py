from __future__ import annotations

from types import SimpleNamespace

import pytest
import torch

from _minimax_h3_motion_director_testpkg.director import context_cache
from _minimax_h3_motion_director_testpkg.director import latent_context_cache
from _minimax_h3_motion_director_testpkg.director.context_links import ContextLink


def _segment(index: int, prompt: str, *, source_clip=None, refs=None, context_link=None):
    return SimpleNamespace(
        index=index,
        timeline_index=index,
        start_frame=index * 10,
        end_frame=(index + 1) * 10,
        prompt=prompt,
        negative_prompt="",
        task_key="i2v",
        task_type="i2v",
        source_clip=source_clip,
        refs=list(refs or []),
        ref_audios=[],
        ref_videos=[],
        ref_video_audios=[],
        reference_video_meta={},
        reference_video_start_frame=0,
        reference_tags={},
        context_link=context_link,
    )


def _plan(*segments, run_indices=None):
    return SimpleNamespace(
        segments=list(segments),
        frame_rate=24.0,
        width=64,
        height=64,
        ref_max_size=64,
        output_mode="fixed",
        edit_mode="prompt_batch",
        spatial_stride=32,
        total_frames=sum(seg.end_frame - seg.start_frame for seg in segments),
        run_indices=run_indices,
        raw={"version": 1, "video": {}},
    )


def _settings(**updates):
    return {
        "seed": 7,
        "cfg": 1.0,
        "steps": 8,
        "sampler": "euler",
        "scheduler": "simple",
        "motion_context_enabled": True,
        "audio_context_enabled": True,
        "audio_mode": "generate",
        "source_overlap_frames": 0,
        **updates,
    }


def _save_rgb(monkeypatch, tmp_path, seg, plan, settings=None):
    monkeypatch.setattr(context_cache, "_cache_root", lambda _node: tmp_path)
    assert context_cache.save_motion_context_cache(
        "node",
        seg,
        plan,
        frames=torch.zeros((10, 2, 2, 3)),
        audio=None,
        settings=settings or _settings(),
    )


def test_appending_future_segment_keeps_previous_context_cache_valid(monkeypatch, tmp_path):
    s1 = _segment(0, "one", source_clip=torch.ones((1, 2, 2, 3)))
    s2 = _segment(1, "two")
    s3 = _segment(2, "three")
    plan = _plan(s1, s2, s3)
    _save_rgb(monkeypatch, tmp_path, s3, plan)

    plan.segments.append(_segment(3, "four"))
    plan.total_frames += 10

    assert context_cache.load_motion_context_cache(
        "node", s3, plan, settings=_settings(), strict=True
    ) is not None


def test_editing_future_segment_keeps_previous_context_cache_valid(monkeypatch, tmp_path):
    s1 = _segment(0, "one", source_clip=torch.ones((1, 2, 2, 3)))
    s2 = _segment(1, "two")
    s3 = _segment(2, "three")
    s4 = _segment(3, "four")
    plan = _plan(s1, s2, s3, s4)
    _save_rgb(monkeypatch, tmp_path, s3, plan)

    s4.prompt = "changed future prompt"
    s4.refs = [SimpleNamespace(index=0, asset_id="future", tensor=torch.ones((1, 2, 2, 3)))]

    assert context_cache.load_motion_context_cache(
        "node", s3, plan, settings=_settings(), strict=True
    ) is not None


def test_deleting_future_segment_keeps_previous_context_cache_valid(monkeypatch, tmp_path):
    s1 = _segment(0, "one", source_clip=torch.ones((1, 2, 2, 3)))
    s2 = _segment(1, "two")
    s3 = _segment(2, "three")
    s4 = _segment(3, "four")
    plan = _plan(s1, s2, s3, s4)
    _save_rgb(monkeypatch, tmp_path, s3, plan)

    plan.segments.pop()
    plan.total_frames -= 10

    assert context_cache.load_motion_context_cache(
        "node", s3, plan, settings=_settings(), strict=True
    ) is not None


def test_editing_current_segment_invalidates_context_cache(monkeypatch, tmp_path):
    s1 = _segment(0, "one", source_clip=torch.ones((1, 2, 2, 3)))
    s2 = _segment(1, "two")
    s3 = _segment(2, "three")
    plan = _plan(s1, s2, s3)
    _save_rgb(monkeypatch, tmp_path, s3, plan)

    s3.prompt = "changed current prompt"

    assert context_cache.load_motion_context_cache(
        "node", s3, plan, settings=_settings()
    ) is None


def test_editing_upstream_mc_segment_invalidates_downstream_cache(monkeypatch, tmp_path):
    s1 = _segment(0, "one", source_clip=torch.ones((1, 2, 2, 3)))
    s2 = _segment(1, "two")
    s3 = _segment(2, "three")
    plan = _plan(s1, s2, s3)
    _save_rgb(monkeypatch, tmp_path, s3, plan)

    s2.prompt = "changed upstream prompt"

    assert context_cache.load_motion_context_cache(
        "node", s3, plan, settings=_settings()
    ) is None


def test_editing_first_mc_segment_invalidates_entire_downstream_chain(monkeypatch, tmp_path):
    s1 = _segment(0, "one", source_clip=torch.ones((1, 2, 2, 3)))
    s2 = _segment(1, "two")
    s3 = _segment(2, "three")
    plan = _plan(s1, s2, s3)
    _save_rgb(monkeypatch, tmp_path, s3, plan)

    s1.prompt = "changed chain root"

    assert context_cache.load_motion_context_cache(
        "node", s3, plan, settings=_settings()
    ) is None


@pytest.mark.parametrize("mutation", ["duration", "source", "settings", "seed", "context_length"])
def test_current_segment_producer_changes_invalidate_cache(monkeypatch, tmp_path, mutation):
    s1 = _segment(0, "one", source_clip=torch.ones((1, 2, 2, 3)))
    s2 = _segment(1, "two")
    s3 = _segment(2, "three")
    plan = _plan(s1, s2, s3)
    _save_rgb(monkeypatch, tmp_path, s3, plan)
    changed_settings = _settings()
    if mutation == "duration":
        s3.end_frame += 1
    elif mutation == "source":
        s3.source_clip = torch.ones((1, 2, 2, 3))
    elif mutation == "seed":
        changed_settings["seed"] = 8
    elif mutation == "context_length":
        changed_settings["context_length"] = 5
    else:
        changed_settings["steps"] = 9

    assert context_cache.load_motion_context_cache(
        "node", s3, plan, settings=changed_settings
    ) is None


def test_mc_off_segment_has_no_upstream_cache_dependency(monkeypatch, tmp_path):
    s1 = _segment(0, "one", source_clip=torch.ones((1, 2, 2, 3)))
    s2 = _segment(1, "two")
    plan = _plan(s1, s2)
    settings = _settings(motion_context_enabled=False)
    _save_rgb(monkeypatch, tmp_path, s2, plan, settings)

    s1.prompt = "changed unused upstream"

    assert context_cache.load_motion_context_cache(
        "node", s2, plan, settings=settings, strict=True
    ) is not None


def test_i2v_explicit_reset_breaks_upstream_cache_dependency(monkeypatch, tmp_path):
    s1 = _segment(0, "one", source_clip=torch.ones((1, 2, 2, 3)))
    s2 = _segment(1, "two")
    s3 = _segment(2, "three reset", source_clip=torch.full((1, 2, 2, 3), 0.5))
    plan = _plan(s1, s2, s3)
    _save_rgb(monkeypatch, tmp_path, s3, plan)

    s2.prompt = "changed before reset"

    assert context_cache.load_motion_context_cache(
        "node", s3, plan, settings=_settings(), strict=True
    ) is not None


def test_explicit_link_off_breaks_upstream_dependency_chain(monkeypatch, tmp_path):
    s1 = _segment(0, "one", source_clip=torch.ones((1, 2, 2, 3)))
    s2 = _segment(1, "two", context_link=ContextLink(True, True, True))
    s3 = _segment(2, "three", context_link=ContextLink(False, False, False))
    s4 = _segment(3, "four", context_link=ContextLink(True, True, True))
    plan = _plan(s1, s2, s3, s4)
    _save_rgb(monkeypatch, tmp_path, s4, plan)

    s2.prompt = "changed before explicit break"

    assert context_cache.load_motion_context_cache(
        "node", s4, plan, settings=_settings(), strict=True
    ) is not None


def test_audio_only_link_keeps_upstream_dependency(monkeypatch, tmp_path):
    s1 = _segment(0, "one", source_clip=torch.ones((1, 2, 2, 3)))
    s2 = _segment(1, "two", context_link=ContextLink(True, False, True))
    plan = _plan(s1, s2)
    _save_rgb(monkeypatch, tmp_path, s2, plan)

    s1.prompt = "changed audio producer"

    assert context_cache.load_motion_context_cache(
        "node", s2, plan, settings=_settings()
    ) is None


def test_selection_run_new_i2v_segment_uses_previous_cached_tail(monkeypatch, tmp_path):
    s1 = _segment(0, "one", source_clip=torch.ones((1, 2, 2, 3)))
    s2 = _segment(1, "two")
    s3 = _segment(2, "three")
    initial = _plan(s1, s2, s3)
    _save_rgb(monkeypatch, tmp_path, s3, initial)

    monkeypatch.setattr(latent_context_cache, "_cache_root", lambda _node: tmp_path)
    latent = {
        "samples": (
            torch.zeros((1, 1, 12, 1, 1)),
            torch.zeros((1, 1, 2, 65)),
        )
    }
    handoff = {
        "context_end_frame": 39,
        "trim_frames": 0,
        "export_frames": 39,
        "sample_frames": 39,
    }
    stored_handoff = {
        **handoff,
        "stored_tail_frames": 39,
        "original_context_end_frame": 39,
        "original_trim_frames": 0,
        "original_export_frames": 39,
        "original_sample_frames": 39,
        "selected_source_end_frame": 39,
    }
    monkeypatch.setattr(
        latent_context_cache,
        "prepare_latent_context_tail",
        lambda value, _handoff: (value, stored_handoff),
    )
    assert latent_context_cache.save_latent_context_cache(
        "node", s3, initial, latent=latent, handoff=handoff, settings=_settings()
    )

    s4 = _segment(3, "four continuation")
    selected = _plan(s1, s2, s3, s4, run_indices=frozenset({3}))

    assert context_cache.load_motion_context_cache(
        "node", s3, selected, settings=_settings(), strict=True
    ) is not None
    latent_payload = torch.load(tmp_path / "seg_0002.av.pt", weights_only=True)
    expected_latent_fingerprint = context_cache.context_fingerprint(
        s3,
        selected,
        {
            **_settings(),
            "latent_handoff_pipeline": latent_context_cache.LATENT_HANDOFF_PIPELINE,
        },
    )
    assert latent_payload["metadata"]["fingerprint"] == expected_latent_fingerprint
    assert [seg.timeline_index for seg in selected.segments if seg.timeline_index in selected.run_indices] == [3]
