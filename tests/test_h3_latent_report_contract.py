from pathlib import Path


def test_h3_latent_report_fields_and_seam_section_are_wired():
    report = Path("director/execution_report.py").read_text(encoding="utf-8")
    executor = Path("director/executor_core_legacy.py").read_text(encoding="utf-8")
    facade = Path("director/executor_core.py").read_text(encoding="utf-8")
    assert '"Seam Diagnostics"' in report
    for key in (
        "H3 Latent Model",
        "H3 Latent Architecture",
        "H3 Latent Precision",
        "H3 Latent Device",
        "H3 Noise Mask",
    ):
        assert key in report
        assert key in executor
    assert "build_seam_report_lines(" in executor
    assert "segment_slots=[int(seg.timeline_index) for seg in export_segments]" in executor
    assert "executor_core_legacy" in facade
