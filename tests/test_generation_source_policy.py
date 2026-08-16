from lib.generation_source_policy import is_source_free_generation_task


def test_t2v_and_r2v_do_not_require_pixel_source_canvases():
    assert is_source_free_generation_task("t2v") is True
    assert is_source_free_generation_task("r2v") is True


def test_keyframe_and_source_driven_tasks_keep_visual_source_semantics():
    assert is_source_free_generation_task("i2v") is False
    assert is_source_free_generation_task("fl2v") is False
    assert is_source_free_generation_task("v2v") is False
    assert is_source_free_generation_task("rv2v") is False
