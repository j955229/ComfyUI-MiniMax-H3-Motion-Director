from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
import torch

from _minimax_h3_motion_director_testpkg.director.frame_align import (
    H3_SOURCE_BRIDGE_PIPELINE,
)
from _minimax_h3_motion_director_testpkg.director import segment_cache


def _segment(task="v2v"):
    return SimpleNamespace(
        index=0,
        start_frame=0,
        end_frame=10,
        prompt="edit",
        negative_prompt="",
        task_key=task,
        refs=[],
        ref_audios=[],
        ref_videos=[],
        reference_video_meta={},
        reference_video_start_frame=0,
    )


def _plan(frames=5):
    return SimpleNamespace(
        width=32,
        height=32,
        output_mode="fixed",
        ref_max_size=32,
        continuity_enabled=False,
        continuity_overlap_frames=0,
        source_overlap_frames=frames,
    )


def test_cache_fingerprint_uses_bridge_v3_and_compatibility_setting_name():
    fingerprint = segment_cache.segment_cache_fingerprint(_segment(), _plan(5))

    assert H3_SOURCE_BRIDGE_PIPELINE == "v2v_rv2v_source_bridge_v4_boundary_links"
    assert fingerprint["source_bridge_pipeline"] == H3_SOURCE_BRIDGE_PIPELINE
    assert fingerprint["source_overlap_frames"] == 5
    assert "source_overlap_pipeline" not in fingerprint


def test_bridge_setting_change_invalidates_nominal_segment_cache():
    enabled = segment_cache.segment_cache_fingerprint(_segment(), _plan(5))
    disabled = segment_cache.segment_cache_fingerprint(_segment(), _plan(0))

    assert enabled != disabled


@pytest.mark.parametrize(
    "old_pipeline",
    ["v2v_rv2v_source_overlap_v1", "v2v_rv2v_bidirectional_best_cut_v2"],
)
def test_old_v1_or_v2_metadata_is_rejected(monkeypatch, tmp_path, old_pipeline):
    seg = _segment()
    plan = _plan(5)
    expected = segment_cache.segment_cache_fingerprint(seg, plan)
    old = dict(expected)
    old.pop("source_bridge_pipeline")
    old["source_overlap_pipeline"] = old_pipeline
    (tmp_path / "seg_0000.meta.json").write_text(
        json.dumps(old), encoding="utf-8"
    )
    torch.save(torch.zeros(10, 2, 2, 3), tmp_path / "seg_0000.pt")
    monkeypatch.setattr(segment_cache, "_cache_root", lambda _node_id: tmp_path)

    assert segment_cache.load_segment_cache("node", seg, plan) is None
