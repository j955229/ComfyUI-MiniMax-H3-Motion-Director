from pathlib import Path


def _source() -> str:
    return Path("director/face_refine_pipeline.py").read_text(encoding="utf-8")


def test_pipeline_tracks_with_history_but_samples_only_current_segment():
    source = _source()
    assert "tracking_history: torch.Tensor | None = None" in source
    assert "select_tracking_history(tracking_history, images, config)" in source
    assert "torch.cat((history, images), dim=0)" in source
    assert "slice_tracking_result(tracked_all, history_count)" in source
    assert "stitch_faces(images, refined_crops, tracked.transform" in source


def test_pipeline_aggregates_adaptive_denoise_statistics_across_chunks():
    source = _source()
    assert "denoise_statistics" in source
    assert "aggregate_denoise_statistics(denoise_statistics)" in source
    assert "tracked.statistics.update(denoise_stats)" not in source
