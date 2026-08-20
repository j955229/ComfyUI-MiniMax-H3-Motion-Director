from pathlib import Path


def _source() -> str:
    return Path("director/executor_core.py").read_text(encoding="utf-8")


def test_non_bridge_face_refine_runs_before_context_cache_and_next_segment_state():
    source = _source()
    run_start = source.index("def _run_one_segment")
    run_end = source.index("\n    for seg in all_segments:", run_start)
    body = source[run_start:run_end]
    face_at = body.index("segment_face_outcome = apply_face_refine(")
    motion_cache_at = body.index("save_motion_context_cache(")
    completed_context_at = body.index("completed_contexts[timeline_slot] = CachedMotionContext(")
    assert face_at < motion_cache_at
    assert face_at < completed_context_at
    assert 'handoff["visual_latent_valid"] = not segment_face_outcome.succeeded' in body


def test_next_segment_ignores_video_latent_marked_invalid_by_final_pixel_edit():
    source = _source()
    assert 'get("visual_latent_valid", True)' in source
    assert "context_visual_latent" in source
    assert "context_latent=context_visual_latent" in source


def test_source_bridge_keeps_assembled_face_refine_after_bridge_resolution():
    source = _source()
    bridge_resolution = source.index("if generated_bridges:")
    assembled_face = source.index("assembled_face_outcome = apply_face_refine(", bridge_resolution)
    assert bridge_resolution < assembled_face
    assert "if source_bridge_pairs and face_refine_config.get(\"enabled\")" in source


def test_face_refine_is_validated_before_expensive_segment_generation():
    source = _source()
    validate_at = source.index("validate_face_refine_runtime(face_refine_config)")
    loop_at = source.index("\n    for seg in all_segments:")
    assert validate_at < loop_at
