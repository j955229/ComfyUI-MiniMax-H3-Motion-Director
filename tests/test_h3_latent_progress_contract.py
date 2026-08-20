from pathlib import Path


def test_learned_latent_progress_reaches_director_global_upscale_phase():
    runtime = Path("director/h3_latent_upscaler_runtime.py").read_text(encoding="utf-8")
    adapter = Path("director/h3_learned_latent.py").read_text(encoding="utf-8")
    refine = Path("director/refine_sampling.py").read_text(encoding="utf-8")

    assert "on_progress: Callable[[float], None] | None = None" in runtime
    assert "on_progress(0.10)" in runtime
    assert "on_progress(0.20)" in runtime
    assert "on_progress(0.25)" in runtime
    assert "0.25 + 0.65" in runtime
    assert "on_progress(0.98)" in runtime
    assert "on_progress(1.0)" in runtime

    assert "on_progress=on_progress" in adapter
    assert 'lambda value: on_phase("global_upscale", value)' in refine


def test_learned_latent_forward_reports_block_level_progress():
    runtime = Path("director/h3_latent_upscaler_runtime.py").read_text(encoding="utf-8")
    assert runtime.count("advance()") >= 8
    assert "done += 1" in runtime
