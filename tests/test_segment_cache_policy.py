from __future__ import annotations

from types import SimpleNamespace

import pytest
import torch

from _minimax_h3_motion_director_testpkg.director import cache_policy
from _minimax_h3_motion_director_testpkg.director.plan import _run_selection_enabled


def _plan(*, selection=False, export_mode="all"):
    return SimpleNamespace(
        run_select_enabled=selection,
        export_mode=export_mode,
        segments=[SimpleNamespace(), SimpleNamespace()],
    )


def test_normal_multi_segment_run_persists_future_partial_rerun_cache():
    enabled = cache_policy.should_persist_segment_cache(
        _plan(selection=False, export_mode="all"),
        source_bridge_active=False,
    )
    calls = []
    assert cache_policy.write_segment_cache_if_required(enabled, lambda: calls.append(1))
    assert calls == [1]


def test_selection_mode_full_export_persists_even_when_every_segment_is_selected():
    plan = _plan(selection=True, export_mode="all")
    plan.run_indices = None  # planner may collapse an all-selected run to run-all
    enabled = cache_policy.should_persist_segment_cache(
        plan,
        source_bridge_active=False,
    )
    calls = []
    assert cache_policy.write_segment_cache_if_required(enabled, lambda: calls.append(1))
    assert calls == [1]


def test_multi_segment_segment_export_still_persists_for_future_partial_rerun():
    assert cache_policy.should_persist_segment_cache(
        _plan(selection=True, export_mode="segments"),
        source_bridge_active=False,
    )


@pytest.mark.parametrize("export_mode", ["all", "segments"])
def test_source_bridge_persists_nominal_segments_for_cross_queue_reuse(export_mode):
    assert cache_policy.should_persist_segment_cache(
        _plan(selection=False, export_mode=export_mode),
        source_bridge_active=True,
    )


def test_same_queue_source_bridge_prefers_memory_without_disk_reload():
    frames = torch.ones((5, 1, 1, 3))
    memory = {1: frames}

    def forbidden_loader():
        raise AssertionError("same-queue bridge must not reload the segment from disk")

    resolved, loaded_from_disk = cache_policy.resolve_nominal_segment_frames(
        memory,
        segment_index=1,
        expected_frames=5,
        disk_loader=forbidden_loader,
    )
    assert resolved is frames
    assert not loaded_from_disk


def test_cross_queue_source_bridge_loads_and_validates_nominal_disk_cache():
    frames = torch.ones((5, 1, 1, 3))
    memory = {}
    resolved, loaded_from_disk = cache_policy.resolve_nominal_segment_frames(
        memory,
        segment_index=1,
        expected_frames=5,
        disk_loader=lambda: frames,
    )
    assert loaded_from_disk
    assert torch.equal(resolved, frames)
    assert memory[1] is resolved


def test_missing_cross_queue_source_bridge_cache_fails_loudly():
    with pytest.raises(ValueError, match="requires both adjacent generated segments"):
        cache_policy.resolve_nominal_segment_frames(
            {},
            segment_index=1,
            expected_frames=5,
            disk_loader=lambda: None,
        )


def test_run_selection_enabled_remains_true_when_all_segments_are_selected():
    timeline = {"runSelectEnabled": True, "runSelection": [0, 1, 2]}
    assert _run_selection_enabled(timeline)
