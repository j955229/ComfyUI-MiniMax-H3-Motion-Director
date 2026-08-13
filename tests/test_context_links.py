from __future__ import annotations

from types import SimpleNamespace

import pytest

from _minimax_h3_motion_director_testpkg.director.context_links import (
    ContextLink,
    parse_context_link,
    resolve_context_link,
)


def _segment(index: int, link=None, *, task="t2v", source_clip=None):
    return SimpleNamespace(
        index=index,
        timeline_index=index,
        task_key=task,
        source_clip=source_clip,
        context_link=link,
    )


@pytest.mark.parametrize(
    ("visual", "audio"),
    [(True, True), (True, False), (False, True), (False, False)],
)
def test_explicit_boundary_supports_independent_visual_and_audio(visual, audio):
    seg = _segment(1, ContextLink(visual or audio, visual, audio))
    resolved = resolve_context_link(
        seg,
        motion_context_enabled=False,
        audio_context_enabled=False,
        audio_generate=True,
        source_bridge_active=False,
    )
    assert (resolved.visual, resolved.audio) == (visual, audio)
    assert resolved.explicit is True


def test_segment_one_can_never_inherit_previous_context():
    link = parse_context_link(
        {"contextLink": {"enabled": True, "visual": True, "audio": True}},
        0,
    )
    assert link == ContextLink(False, False, False)
    resolved = resolve_context_link(
        _segment(0, link),
        motion_context_enabled=True,
        audio_context_enabled=True,
        audio_generate=True,
        source_bridge_active=False,
    )
    assert resolved.has_dependency is False


def test_missing_link_preserves_legacy_global_behaviour():
    resolved = resolve_context_link(
        _segment(1, None),
        motion_context_enabled=True,
        audio_context_enabled=True,
        audio_generate=True,
        source_bridge_active=False,
    )
    assert (resolved.visual, resolved.audio, resolved.explicit) == (True, True, False)
    assert (resolved.requested_visual, resolved.requested_audio) == (True, True)


def test_saved_string_false_values_do_not_turn_links_on():
    link = parse_context_link(
        {"contextLink": {"enabled": "false", "visual": "false", "audio": "false"}},
        1,
    )
    assert link == ContextLink(False, False, False)


def test_legacy_audio_remains_tied_to_legacy_visual_toggle():
    resolved = resolve_context_link(
        _segment(1, None),
        motion_context_enabled=False,
        audio_context_enabled=True,
        audio_generate=True,
        source_bridge_active=False,
    )
    assert (resolved.visual, resolved.audio) == (False, False)


def test_source_bridge_only_suppresses_visual_channel():
    seg = _segment(1, ContextLink(True, True, True), task="v2v")
    resolved = resolve_context_link(
        seg,
        motion_context_enabled=False,
        audio_context_enabled=False,
        audio_generate=True,
        source_bridge_active=True,
    )
    assert (resolved.visual, resolved.audio) == (False, True)


def test_explicit_i2v_image_resets_visual_but_not_explicit_audio():
    seg = _segment(1, ContextLink(True, True, True), task="i2v", source_clip=object())
    resolved = resolve_context_link(
        seg,
        motion_context_enabled=False,
        audio_context_enabled=False,
        audio_generate=True,
        source_bridge_active=False,
    )
    assert (resolved.visual, resolved.audio) == (False, True)
