from _minimax_h3_motion_director_testpkg.director.execution_report import (
    context_shortfall_warning,
    DirectorExecutionReport,
    format_audio_context,
    format_effective_references,
    format_pin_handoff,
    format_previous_context,
    normalize_seed_mode,
    segment_list,
)


def test_context_warning_only_exists_for_a_real_shortfall():
    assert context_shortfall_warning(1, 22, 22) is None
    assert context_shortfall_warning(1, 22, 39) is None
    assert context_shortfall_warning(1, 22, 5) == (
        "S2: requested 22 context frames but only 5 were usable"
    )


def test_seed_mode_reports_only_real_comfyui_modes():
    assert normalize_seed_mode("fixed") == "fixed"
    assert normalize_seed_mode("increment") == "increment"
    assert normalize_seed_mode("decrement") == "decrement"
    assert normalize_seed_mode("randomize") == "randomize"
    assert normalize_seed_mode(None) == "unknown"
    assert normalize_seed_mode("unexpected") == "unknown"


def test_effective_reference_counts_use_final_conditioning_mappings():
    assert format_effective_references(
        1,
        ref_images={"ref_image_0": object(), "ref_image_1": object()},
        ref_videos={"ref_video_0": object()},
        ref_audios={"ref_audio_0": object()},
        ref_video_audios={"ref_video_audio_0": object()},
    ) == "S2: Picture x2 / Video x1 / Audio x2"


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
    assert "Visual requested: OFF" in previous
    assert "Visual actual: OFF" in previous
    assert "Visual reason: Context Link visual disabled" in previous
    assert "Audio requested: ON" in previous
    assert "Audio actual: ON" in previous
    assert "Audio reason: per-boundary link" in previous
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
    assert "Visual requested: ON" in previous
    assert "Visual actual: ON" in previous
    assert "Visual source: AV latent" in previous
    assert "Audio requested: ON" in previous
    assert "Audio actual: OFF" in previous
    assert "Audio reason: output audio mode is not generate" in previous
    assert "requested: ON" in audio and "actual: OFF" in audio
    assert "reason: output audio mode is not generate" in audio


def test_source_bridge_is_reported_as_actual_visual_continuity():
    text = format_previous_context(0, 1, {
        "requested_visual": True,
        "requested_audio": False,
        "visual": False,
        "audio": False,
        "visual_reason": "Source Bridge owns visual continuity",
        "audio_reason": "Context Link audio disabled",
        "visual_source": "Source Bridge",
        "audio_source": "none",
        "requested_frames": 22,
        "actual_frames": 0,
    })
    assert "Visual requested: ON" in text
    assert "Visual actual: ON" in text
    assert "Visual source: Source Bridge" in text
