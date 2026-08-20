import importlib.util
import sys
from pathlib import Path

import torch

PATH = Path(__file__).parents[1] / "director" / "segment_boundary.py"


def load_module():
    spec = importlib.util.spec_from_file_location("segment_boundary_under_test", PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_visible_slice_is_exact_for_supported_context_spans_and_overshoot():
    mod = load_module()
    for context in (0, 5, 22, 39):
        target = 240
        total = context + target + 7
        resolved = mod.resolve_visible_slice(total, context, target)
        assert resolved.start == context
        assert resolved.stop == context + target
        assert resolved.alignment_surplus == 7
        assert resolved.exported_frames == target


def test_visible_slice_rejects_short_decode():
    mod = load_module()
    try:
        mod.resolve_visible_slice(260, 22, 240)
    except ValueError as exc:
        assert "required" in str(exc).lower()
    else:
        raise AssertionError("expected short decode failure")


def test_validate_exported_frame_count_is_strict():
    mod = load_module()
    frames = torch.zeros((240, 2, 2, 3))
    mod.validate_exported_frame_count(frames, 240)
    try:
        mod.validate_exported_frame_count(frames[:239], 240)
    except RuntimeError as exc:
        assert "239" in str(exc) and "240" in str(exc)
    else:
        raise AssertionError("expected exact-frame-count failure")


def test_seam_diagnostics_are_non_destructive_and_report_visual_jump():
    mod = load_module()
    left = torch.zeros((4, 2, 2, 3))
    right = torch.ones((5, 2, 2, 3))
    left_before = left.clone()
    right_before = right.clone()
    diag = mod.seam_diagnostics(left, right, fps=24.0)
    assert diag["left_frames"] == 4
    assert diag["right_frames"] == 5
    assert abs(diag["mean_abs_rgb_jump"] - 1.0) < 1e-6
    assert abs(diag["luma_jump"] - 1.0) < 1e-6
    assert torch.equal(left, left_before)
    assert torch.equal(right, right_before)


def test_seam_diagnostics_include_audio_duration_without_mutation():
    mod = load_module()
    left = torch.zeros((24, 1, 1, 3))
    right = torch.zeros((24, 1, 1, 3))
    la = {"waveform": torch.zeros((1, 2, 32000)), "sample_rate": 32000}
    ra = {"waveform": torch.zeros((1, 2, 16000)), "sample_rate": 32000}
    diag = mod.seam_diagnostics(left, right, left_audio=la, right_audio=ra, fps=24.0)
    assert diag["audio_sample_rate"] == 32000
    assert diag["left_audio_samples"] == 32000
    assert diag["right_audio_samples"] == 16000
    assert diag["left_audio_seconds"] == 1.0
    assert diag["right_audio_seconds"] == 0.5
