import ast
import unittest
from pathlib import Path


def _function_source(name: str) -> str:
    path = Path(__file__).parents[1] / "nodes" / "director_common.py"
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return ast.get_source_segment(source, node) or ""
    raise AssertionError(f"{name} not found")


class MixedSourceImagesPolicyTests(unittest.TestCase):
    def test_build_source_images_dispatches_mixed_away_from_global_timeline(self):
        source = _function_source("build_source_images_output")
        self.assertIn("mixed_mode", source)
        self.assertIn("_mixed_source_images_output", source)
        self.assertIn("load_timeline_segment", source)

    def test_mixed_source_images_use_segment_local_source_clip(self):
        source = _function_source("_mixed_source_images_output")
        self.assertIn("source_clip", source)
        self.assertNotIn("load_timeline_segment", source)
        self.assertIn("torch.full", source)


if __name__ == "__main__":
    unittest.main()
