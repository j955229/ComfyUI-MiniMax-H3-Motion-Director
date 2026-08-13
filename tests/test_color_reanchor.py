from __future__ import annotations

import importlib
from types import SimpleNamespace

import pytest
import torch

from conftest import PACKAGE


color = importlib.import_module(f"{PACKAGE}.director.color_reanchor")
segment_cache = importlib.import_module(f"{PACKAGE}.director.segment_cache")


def _anchor() -> torch.Tensor:
    return torch.tensor(
        [
            [
                [[0.10, 0.25, 0.70], [0.35, 0.60, 0.20]],
                [[0.80, 0.15, 0.45], [0.55, 0.90, 0.30]],
            ]
        ],
        dtype=torch.float32,
    )


def _statistics_distance(frames: torch.Tensor, anchor: torch.Tensor) -> float:
    frame_rgb = frames[..., :3].float()
    anchor_rgb = anchor[..., :3].float()
    frame_mean = frame_rgb.mean(dim=(1, 2))
    frame_std = frame_rgb.std(dim=(1, 2), unbiased=False)
    anchor_mean = anchor_rgb.mean(dim=(0, 1, 2))
    anchor_std = anchor_rgb.std(dim=(0, 1, 2), unbiased=False)
    return float(
        (frame_mean - anchor_mean).abs().mean()
        + (frame_std - anchor_std).abs().mean()
    )


@pytest.mark.parametrize(
    "scale,bias",
    [
        ((1.00, 0.65, 0.65), (0.20, 0.00, 0.00)),  # red-channel drift
        ((0.65, 0.65, 1.00), (0.00, 0.00, 0.20)),  # blue-channel drift
        ((0.65, 1.00, 0.65), (0.00, 0.20, 0.00)),  # green-channel drift
        ((0.75, 0.75, 0.75), (0.18, 0.18, 0.18)),  # exposure drift
        ((0.45, 1.25, 0.75), (0.20, -0.08, 0.08)),  # channel spread drift
    ],
)
def test_color_reanchor_moves_general_color_statistics_toward_anchor(scale, bias):
    anchor = _anchor()
    scale_t = torch.tensor(scale).view(1, 1, 1, 3)
    bias_t = torch.tensor(bias).view(1, 1, 1, 3)
    context = (anchor.repeat(2, 1, 1, 1) * scale_t + bias_t).clamp(0, 1)

    corrected = color.apply_color_reanchor(context, anchor)

    assert _statistics_distance(corrected, anchor) < _statistics_distance(context, anchor)
    assert corrected.shape == context.shape
    assert torch.all((corrected >= 0) & (corrected <= 1))


def test_strength_zero_is_exact_noop_and_half_strength_is_linear_midpoint():
    anchor = _anchor()
    context = (anchor * torch.tensor([1.0, 0.55, 1.25]) + 0.10).clamp(0, 1)

    unchanged = color.apply_color_reanchor(context, anchor, strength=0.0)
    half = color.apply_color_reanchor(context, anchor, strength=0.5)
    full = color.apply_color_reanchor(context, anchor, strength=1.0)

    assert torch.equal(unchanged, context)
    assert torch.allclose(half, (context + full) * 0.5, atol=1e-6, rtol=0)


def test_missing_anchor_is_safe_noop():
    context = _anchor().repeat(2, 1, 1, 1)
    assert torch.equal(color.apply_color_reanchor(context, None), context)


def _segment(index: int, task_key: str, *, source=None, picture=None):
    refs = []
    if picture is not None:
        refs.append(SimpleNamespace(index=0, tensor=picture))
    return SimpleNamespace(
        index=index,
        ui_index=None,
        timeline_index=index,
        task_key=task_key,
        source_clip=source,
        refs=refs,
    )


def test_i2v_anchor_uses_initial_image_until_explicit_reset_then_updates():
    image_a = torch.full((1, 2, 2, 3), 0.20)
    image_b = torch.full((1, 2, 2, 3), 0.80)
    segments = [
        _segment(0, "i2v", source=image_a),
        _segment(1, "i2v"),
        _segment(2, "i2v", source=image_b),
        _segment(3, "i2v"),
    ]
    plan = SimpleNamespace(segments=segments)

    assert torch.equal(color.resolve_color_anchor(plan, segments[0]), image_a)
    assert torch.equal(color.resolve_color_anchor(plan, segments[1]), image_a)
    assert torch.equal(color.resolve_color_anchor(plan, segments[2]), image_b)
    assert torch.equal(color.resolve_color_anchor(plan, segments[3]), image_b)


def test_r2v_picture_one_is_identity_only_and_never_a_color_anchor():
    picture = torch.full((1, 2, 2, 3), 0.35)
    inherited_segment = _segment(1, "r2v", picture=picture)
    plan = SimpleNamespace(segments=[inherited_segment])

    assert color.resolve_color_anchor(plan, inherited_segment) is None


def test_v2v_and_rv2v_use_source_video_even_when_rv2v_has_picture_one():
    source = torch.stack(
        [torch.full((2, 2, 3), 0.15), torch.full((2, 2, 3), 0.75)]
    )
    picture = torch.full((1, 2, 2, 3), 0.60)
    v2v = _segment(0, "v2v")
    rv2v_picture = _segment(1, "rv2v", picture=picture)
    rv2v_source = _segment(2, "rv2v")
    plan = SimpleNamespace(segments=[v2v, rv2v_picture, rv2v_source])

    assert torch.equal(color.resolve_color_anchor(plan, v2v, source_frames=source), source[:1])
    assert torch.equal(
        color.resolve_color_anchor(plan, rv2v_picture, source_frames=source), source[:1]
    )
    assert torch.equal(
        color.resolve_color_anchor(plan, rv2v_source, source_frames=source), source[:1]
    )


def test_source_bridge_and_unsupported_tasks_never_resolve_color_anchor():
    source = torch.full((2, 2, 2, 3), 0.5)
    v2v = _segment(0, "v2v")
    t2v = _segment(1, "t2v")
    plan = SimpleNamespace(segments=[v2v, t2v])

    assert color.resolve_color_anchor(
        plan, v2v, source_frames=source, source_bridge_active=True
    ) is None
    assert color.resolve_color_anchor(plan, t2v, source_frames=source) is None


def test_generated_chain_baselines_are_versioned_and_persistable_statistics():
    generated = torch.rand((5, 3, 4, 3), generator=torch.Generator().manual_seed(7))
    r2v = _segment(0, "r2v", picture=torch.full((1, 2, 2, 3), 0.99))
    baseline = color.establish_color_chain_baseline(
        r2v, generated_frames=generated, source_frames=None
    )
    assert baseline["policy"] == color.COLOR_ANCHOR_POLICY
    assert baseline["source"] == "R2V chain-root generated result"
    assert color.validate_color_anchor_statistics(baseline) == baseline
    assert baseline["mean"] != [0.99, 0.99, 0.99]


def test_rv2v_chain_baseline_uses_source_video_not_picture_reference():
    source = torch.full((4, 2, 2, 3), 0.2)
    picture = torch.full((1, 2, 2, 3), 0.9)
    segment = _segment(0, "rv2v", picture=picture)
    baseline = color.establish_color_chain_baseline(
        segment, generated_frames=torch.full_like(source, 0.6), source_frames=source
    )
    assert baseline["source"] == "RV2V chain-root source video"
    assert baseline["mean"] == pytest.approx([0.2, 0.2, 0.2])


def test_color_reanchor_accepts_persisted_chain_statistics():
    anchor = _anchor()
    stats = color.color_anchor_statistics(anchor, source="test root")
    context = (anchor * 0.5 + 0.2).clamp(0, 1)
    corrected = color.apply_color_reanchor(context, stats)
    assert _statistics_distance(corrected, anchor) < _statistics_distance(context, anchor)


def test_color_reanchor_cache_settings_distinguish_off_and_on():
    off = color.color_reanchor_cache_settings(False)
    on = color.color_reanchor_cache_settings(True)

    assert off != on
    assert off["color_reanchor_enabled"] is False
    assert on["color_reanchor_enabled"] is True
    assert on["color_reanchor_pipeline"] == color.COLOR_REANCHOR_PIPELINE


def test_segment_cache_fingerprint_tracks_i2v_and_r2v_color_anchor_content():
    plan = SimpleNamespace(
        width=640,
        height=864,
        output_mode="fixed",
        ref_max_size=864,
        continuity_enabled=False,
        continuity_overlap_frames=0,
        color_reanchor_enabled=True,
        spatial_stride=32,
        source_overlap_frames=0,
    )
    common = dict(
        index=0,
        start_frame=0,
        end_frame=22,
        prompt="test",
        negative_prompt="",
        ref_audios=[],
        ref_videos=[],
        reference_video_meta={},
        reference_video_start_frame=0,
    )

    i2v_a = SimpleNamespace(
        **common,
        task_key="i2v",
        source_clip=torch.full((1, 2, 2, 3), 0.2),
        refs=[],
    )
    i2v_b = SimpleNamespace(
        **common,
        task_key="i2v",
        source_clip=torch.full((1, 2, 2, 3), 0.8),
        refs=[],
    )
    assert segment_cache.segment_cache_fingerprint(
        i2v_a, plan
    ) != segment_cache.segment_cache_fingerprint(i2v_b, plan)

    r2v_a = SimpleNamespace(
        **common,
        task_key="r2v",
        source_clip=None,
        refs=[SimpleNamespace(index=0, tensor=torch.full((1, 2, 2, 3), 0.2))],
    )
    r2v_b = SimpleNamespace(
        **common,
        task_key="r2v",
        source_clip=None,
        refs=[SimpleNamespace(index=0, tensor=torch.full((1, 2, 2, 3), 0.8))],
    )
    assert segment_cache.segment_cache_fingerprint(
        r2v_a, plan
    ) != segment_cache.segment_cache_fingerprint(r2v_b, plan)
