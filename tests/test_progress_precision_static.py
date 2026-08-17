from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def text(path):
    return (ROOT / path).read_text(encoding="utf-8")

def test_progress_uses_weighted_phases_and_elapsed_time():
    src = text("director/progress.py")
    assert "SEGMENT_PHASES" in src
    assert "GLOBAL_PHASES" in src
    assert "PHASE_WEIGHTS" in src
    assert '"elapsed_seconds"' in src
    assert '"phase_elapsed_seconds"' in src

def test_sampler_reports_every_real_step_even_without_preview():
    src = text("director/core_sampling.py")
    assert "notify(phase_name" in src
    assert "total_steps" in src
    assert "int(step) + 1" in src

def test_reports_include_stage_timings_and_postprocess_diagnostics():
    executor = text("director/executor_core.py")
    refine = text("director/refine_sampling.py")
    face = text("director/face_refine_pipeline.py")
    node = text("nodes/director.py")
    assert "segment_stage_timings" in executor
    assert "VSR Quality:" in executor
    assert "Detection Rate:" in executor
    assert "Source Resolution:" in executor
    assert "Adaptive Strength min/mean/max:" in executor
    assert "sampling_chunks" in face
    assert 'timings["upscale"]' in refine
    assert "Pipeline Total:" in node
    assert "Video Encode / Auto Save:" in node
    assert "End-to-end Total:" in node
