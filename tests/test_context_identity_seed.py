import ast
from pathlib import Path


def _consumer_only_settings() -> set[str]:
    source = Path(__file__).parents[1] / "director" / "context_identity.py"
    tree = ast.parse(source.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "_CONSUMER_ONLY_SETTINGS"
            for target in node.targets
        ):
            return set(ast.literal_eval(node.value))
    raise AssertionError("_CONSUMER_ONLY_SETTINGS not found")


def test_seed_changes_do_not_invalidate_persisted_cache_identity():
    assert "seed" in _consumer_only_settings()


def test_generation_parameters_still_invalidate_cache_identity():
    settings = _consumer_only_settings()
    assert "cfg" not in settings
    assert "steps" not in settings
    assert "sampler" not in settings
