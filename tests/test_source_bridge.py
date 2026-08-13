from __future__ import annotations

from types import SimpleNamespace

import pytest
import torch

from _minimax_h3_motion_director_testpkg.director.source_bridge import (
    GeneratedSourceBridge,
    assemble_source_bridges,
    bridge_anchors,
    bridge_window_for_boundary,
    reference_bundles_match,
    should_apply_visual_motion_context,
    source_bridge_boundary_enabled,
    source_bridge_enabled,
    validate_source_bridge_frames,
)
from _minimax_h3_motion_director_testpkg.director.context_links import ContextLink


def _segment(index: int, start: int, end: int, task: str = "v2v", **kwargs):
    values = {
        "index": index,
        "start_frame": start,
        "end_frame": end,
        "frame_count": end - start,
        "task_key": task,
        "timeline_index": index,
        "context_link": None,
        "refs": [],
        "ref_audios": [],
        "ref_videos": [],
        "ref_video_audios": [],
    }
    values.update(kwargs)
    return SimpleNamespace(**values)


def _frames(values) -> torch.Tensor:
    tensor = torch.as_tensor(values, dtype=torch.float32)
    return tensor.reshape(-1, 1, 1, 1).repeat(1, 2, 2, 3)


def test_bridge_window_and_anchors_use_generated_boundary_frames():
    window = bridge_window_for_boundary(10)
    left = _segment(0, 0, 10)
    right = _segment(1, 10, 20)
    left_generated = _frames(range(100, 110))
    right_generated = _frames(range(200, 210))

    first, last = bridge_anchors(
        left, left_generated, right, right_generated, window
    )

    assert (window.source_start, window.source_end) == (8, 13)
    assert window.frame_count == 5
    assert (window.first_anchor_source_time, window.last_anchor_source_time) == (8, 12)
    assert (window.emitted_source_start, window.emitted_source_end) == (9, 12)
    assert first[0, 0, 0, 0].item() == 108.0
    assert last[0, 0, 0, 0].item() == 202.0


def test_bridge_replaces_only_three_middle_frames_and_preserves_total_length():
    left = _segment(0, 0, 10)
    right = _segment(1, 10, 20)
    nominal = {0: _frames(range(0, 10)), 1: _frames(range(10, 20))}
    bridge = GeneratedSourceBridge(
        left_segment_index=0,
        right_segment_index=1,
        window=bridge_window_for_boundary(10),
        frames=_frames(range(100, 105)),
    )

    contributions = assemble_source_bridges([left, right], nominal, [bridge])
    combined = torch.cat([contributions[0], contributions[1]], dim=0)

    assert combined.shape[0] == 20
    assert combined[:, 0, 0, 0].tolist() == [
        0, 1, 2, 3, 4, 5, 6, 7, 8,
        101, 102, 103,
        12, 13, 14, 15, 16, 17, 18, 19,
    ]
    assert contributions[0].shape[0] == 10
    assert contributions[1].shape[0] == 10


def test_assembly_cannot_expose_source_conditioning_pixels():
    left = _segment(0, 0, 10)
    right = _segment(1, 10, 20)
    nominal = {0: _frames(range(20, 30)), 1: _frames(range(30, 40))}
    source_conditioning = _frames([999, 999, 999, 999, 999])
    bridge = GeneratedSourceBridge(
        left_segment_index=0,
        right_segment_index=1,
        window=bridge_window_for_boundary(10),
        frames=_frames([100, 101, 102, 103, 104]),
    )

    result = assemble_source_bridges([left, right], nominal, [bridge])
    combined = torch.cat(list(result.values()), dim=0)

    assert 999.0 not in combined[:, 0, 0, 0].tolist()
    assert source_conditioning.shape[0] == 5


def test_reference_bundles_must_match_for_rv2v_bridge():
    left = _segment(0, 0, 10, "rv2v", refs=["a"], ref_audios=["sound"])
    same = _segment(1, 10, 20, "rv2v", refs=["a"], ref_audios=["sound"])
    changed = _segment(1, 10, 20, "rv2v", refs=["b"], ref_audios=["sound"])

    assert reference_bundles_match(left, same)
    assert not reference_bundles_match(left, changed)


def test_bridge_setting_and_task_scope_are_strict():
    assert validate_source_bridge_frames(0) == 0
    assert validate_source_bridge_frames(5) == 5
    with pytest.raises(ValueError, match="supports only 0 or 5"):
        validate_source_bridge_frames(1)

    assert source_bridge_enabled("v2v", 5)
    assert source_bridge_enabled("rv2v", 5)
    assert not source_bridge_enabled("r2v", 5)
    assert not source_bridge_enabled("v2v", 0)


def test_visual_motion_context_is_skipped_only_for_active_source_bridge():
    assert not should_apply_visual_motion_context(True, "v2v", 1, 5, False)
    assert not should_apply_visual_motion_context(True, "rv2v", 1, 5, False)
    assert should_apply_visual_motion_context(True, "r2v", 1, 5, False)
    assert should_apply_visual_motion_context(True, "v2v", 1, 0, False)
    assert not should_apply_visual_motion_context(False, "v2v", 1, 5, False)


def test_source_bridge_respects_each_consumer_visual_link():
    left = _segment(0, 0, 10)
    connected = _segment(
        1, 10, 20, context_link=ContextLink(True, True, False)
    )
    disconnected = _segment(
        1, 10, 20, context_link=ContextLink(False, False, False)
    )
    audio_only = _segment(
        1, 10, 20, context_link=ContextLink(True, False, True)
    )
    assert source_bridge_boundary_enabled(left, connected, 5)
    assert not source_bridge_boundary_enabled(left, disconnected, 5)
    assert not source_bridge_boundary_enabled(left, audio_only, 5)
    assert source_bridge_boundary_enabled(left, _segment(1, 10, 20), 5)
