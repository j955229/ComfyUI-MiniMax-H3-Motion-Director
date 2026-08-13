from __future__ import annotations

from types import SimpleNamespace

from _minimax_h3_motion_director_testpkg.director.context_links import ContextLink
from _minimax_h3_motion_director_testpkg.director.segment_cache import (
    segment_cache_fingerprint,
)


def _segment(index, prompt, link=None):
    return SimpleNamespace(
        index=index,
        timeline_index=index,
        start_frame=index * 10,
        end_frame=(index + 1) * 10,
        prompt=prompt,
        negative_prompt="",
        task_key="t2v",
        task_type="t2v",
        use_global=False,
        source_clip=None,
        refs=[],
        ref_audios=[],
        ref_videos=[],
        ref_video_audios=[],
        reference_video_meta={},
        reference_video_start_frame=0,
        reference_tags={},
        context_link=link,
    )


def _plan(*segments):
    return SimpleNamespace(
        segments=list(segments),
        frame_rate=24.0,
        width=64,
        height=64,
        ref_max_size=64,
        output_mode="fixed",
        edit_mode="prompt_batch",
        spatial_stride=32,
        continuity_enabled=False,
        continuity_overlap_frames=0,
        source_overlap_frames=0,
        color_reanchor_enabled=False,
        raw={"video": {}},
        cache_settings={
            "motion_context_enabled": False,
            "audio_context_enabled": False,
            "audio_mode": "generate",
            "context_link_pipeline": "previous_context_link_v1",
        },
    )


def test_segment_cache_stales_downstream_until_explicit_break():
    s1 = _segment(0, "one", ContextLink(False, False, False))
    s2 = _segment(1, "two", ContextLink(True, True, True))
    s3 = _segment(2, "three", ContextLink(True, True, True))
    s4 = _segment(3, "four", ContextLink(False, False, False))
    s5 = _segment(4, "five", ContextLink(True, True, True))
    plan = _plan(s1, s2, s3, s4, s5)
    s3_before = segment_cache_fingerprint(s3, plan)
    s5_before = segment_cache_fingerprint(s5, plan)

    s2.prompt = "regenerated producer settings"

    assert segment_cache_fingerprint(s3, plan) != s3_before
    assert segment_cache_fingerprint(s5, plan) == s5_before


def test_audio_only_dependency_stales_child_segment_cache():
    s1 = _segment(0, "one", ContextLink(False, False, False))
    s2 = _segment(1, "two", ContextLink(True, False, True))
    plan = _plan(s1, s2)
    before = segment_cache_fingerprint(s2, plan)
    s1.prompt = "new audio producer"
    assert segment_cache_fingerprint(s2, plan) != before


def test_visual_and_audio_off_has_no_parent_dependency():
    s1 = _segment(0, "one", ContextLink(False, False, False))
    s2 = _segment(1, "two", ContextLink(False, False, False))
    plan = _plan(s1, s2)
    before = segment_cache_fingerprint(s2, plan)
    s1.prompt = "unrelated old chain"
    assert segment_cache_fingerprint(s2, plan) == before
