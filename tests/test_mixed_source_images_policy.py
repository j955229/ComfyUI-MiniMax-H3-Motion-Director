import ast
from pathlib import Path


def _function_source(name: str) -> str:
    path = Path(__file__).parents[1] / "nodes" / "director_common.py"
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return ast.get_source_segment(source, node) or ""
    raise AssertionError(f"{name} not found")


def test_mixed_source_images_use_segment_local_source_clip_not_global_timeline():
    source = _function_source("build_source_images_output")
    assert "mixed_mode" in source
    assert "source_clip" in source
    assert "_mixed_source_images" in source


def test_legacy_source_image_path_still_uses_global_timeline_loader():
    source = _function_source("build_source_images_output")
    assert "load_timeline_segment" in source
