from _minimax_h3_motion_director_testpkg.director.execution_report import (
    DirectorExecutionReport,
    format_audio_context,
    format_pin_handoff,
    format_previous_context,
    segment_list,
)


def test_report_has_stable_sections_and_omits_empty_warnings():
    report = DirectorExecutionReport()
    report.add("Run", "Segments generated: S1,S2")
    report.add("Cache", "S1: generated")
    text = report.render()
    assert text.startswith("Director Report\n\n[Run]")
    assert text.index("[Run]") < text.index("[Cache]")
    assert "[Warnings]" not in text


def test_pin_off_report_is_compact():
    report = DirectorExecutionReport()
    report.add("Latent Scale Lock", "OFF")
    assert "[Latent Scale Lock]\nOFF" in report.render()


def test_first_pin_handoff_reports_created_baseline_and_zero_delta():
    text = format_pin_handoff(
        from_segment=0,
        to_segment=1,
        requested_frames=22,
        actual_frames=22,
        status="APPLIED",
        baseline_source="created",
        baseline_std=1.0,
        before_std=1.0,
        scale=1.0,
        after_std=1.0,
        mean_abs_delta=0.0,
        max_abs_delta=0.0,
    )
    assert "baseline: created" in text
    assert "scale: 1.000000" in text
    assert "mean_abs_delta: 0.000000" in text


def test_later_pin_handoff_reports_inherited_non_unit_scale():
    text = format_pin_handoff(
        from_segment=1,
        to_segment=2,
        requested_frames=22,
        actual_frames=22,
        status="APPLIED",
        baseline_source="inherited",
        baseline_std=1.0,
        before_std=2.0,
        scale=0.5,
        after_std=1.0,
        mean_abs_delta=0.2,
        max_abs_delta=0.7,
    )
    assert "baseline: inherited" in text
    assert "scale: 0.500000" in text
    assert "max_abs_delta: 0.700000" in text


def test_pin_skip_has_explicit_reason_and_segment_lists_are_readable():
    text = format_pin_handoff(
        from_segment=2,
        to_segment=3,
        requested_frames=22,
        actual_frames=0,
        status="SKIPPED",
        reason="visual context used RGB fallback",
    )
    assert "Pin Renorm: SKIPPED" in text
    assert "Reason: visual context used RGB fallback" in text
    assert segment_list({2, 0, 1}) == "S1,S2,S3"


def test_visual_off_audio_on_report_keeps_paths_independent():
    diag = {
        "requested_visual": False,
        "requested_audio": True,
        "visual": False,
        "audio": True,
        "visual_reason": "Context Link visual disabled",
        "audio_reason": "per-boundary link",
        "visual_source": "none",
        "audio_source": "audio latent",
        "requested_frames": 22,
        "actual_frames": 0,
    }
    previous = format_previous_context(0, 1, diag)
    audio = format_audio_context(0, 1, diag)
    assert "Visual: OFF (Context Link visual disabled)" in previous
    assert "Audio: ON" in previous
    assert "requested: ON" in audio and "actual: ON" in audio
    assert "source: audio latent" in audio


def test_visual_on_audio_off_and_non_generate_audio_reason_are_explicit():
    diag = {
        "requested_visual": True,
        "requested_audio": True,
        "visual": True,
        "audio": False,
        "visual_reason": "per-boundary link",
        "audio_reason": "output audio mode is not generate",
        "visual_source": "AV latent",
        "audio_source": "none",
        "requested_frames": 22,
        "actual_frames": 22,
    }
    previous = format_previous_context(1, 2, diag)
    audio = format_audio_context(1, 2, diag)
    assert "Visual: ON" in previous and "Visual source: AV latent" in previous
    assert "Audio: OFF (output audio mode is not generate)" in previous
    assert "requested: ON" in audio and "actual: OFF" in audio
    assert "reason: output audio mode is not generate" in audio
