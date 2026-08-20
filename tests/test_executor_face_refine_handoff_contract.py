from pathlib import Path


def _source() -> str:
    return Path("director/executor_core.py").read_text(encoding="utf-8")


def test_segment_final_face_refine_is_completed_before_latent_handoff():
    source = _source()
    trim_hook = source[source.index("def trim_hook"):source.index("def seam_hook")]
    seam_hook = source[source.index("def seam_hook"):source.index("def prepare_hook")]
    prepare_hook = source[source.index("def prepare_hook"):source.index("def context_hook")]
    assert "run_face(seg, images)" in trim_hook
    assert "run_face(seg, seamed)" in seam_hook
    assert 'updated_handoff["visual_latent_valid"] = valid' in prepare_hook
    assert 'tail_latent["visual_latent_valid"] = valid' in prepare_hook
    assert "latent handoff reached before final face pixels" in prepare_hook


def test_visual_invalidity_keeps_audio_candidate_independent():
    source = _source()
    context_hook = source[source.index("def context_hook"):source.index("def assembled_face_noop")]
    assert 'context_latent.get("visual_latent_valid") is False' in context_hook
    assert "audio_vae" in context_hook
    assert "video_vae" in context_hook
    assert "visual_source=\"pixels (fallback)\"" in context_hook


def test_source_bridge_delegates_to_preserved_assembled_face_refine_path():
    source = _source()
    assert "if not face_config[\"enabled\"] or source_bridge_pairs:" in source
    assert "return _legacy.execute_director_plan_core(plan, **call_kwargs)" in source
    legacy = Path("director/executor_core_legacy.py").read_text(encoding="utf-8")
    bridge_at = legacy.index("if generated_bridges:")
    face_at = legacy.index("face_outcome = apply_face_refine(", bridge_at)
    assert bridge_at < face_at


def test_runtime_validation_happens_before_legacy_generation_and_hooks_are_per_call():
    source = _source()
    validate_at = source.index("validate_face_refine_runtime(face_config)")
    delegate_at = source.index("if not face_config[\"enabled\"] or source_bridge_pairs:")
    assert validate_at < delegate_at
    assert "function_globals = dict(_legacy.execute_director_plan_core.__globals__)" in source
    assert "types.FunctionType(" in source
    assert "_legacy.trim_segment_av =" not in source
