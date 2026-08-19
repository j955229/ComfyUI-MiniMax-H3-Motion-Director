from pathlib import Path


def test_learned_latent_adapter_has_no_external_node_registry_dependency():
    source = Path("director/h3_learned_latent.py").read_text(encoding="utf-8")
    assert "NODE_CLASS_MAPPINGS" not in source
    assert "MinimaxH3LatentUpscalerNode2D" not in source
    assert "MinimaxH3LatentUpscaler3D" not in source
    assert "separately installed" not in source
    assert "run_h3_latent_upscaler" in source


def test_director_owns_learned_latent_runtime_module():
    source = Path("director/h3_latent_upscaler_runtime.py").read_text(encoding="utf-8")
    assert "def run_h3_latent_upscaler" in source
    assert "latent_upscale_models" in source
    assert "NODE_CLASS_MAPPINGS" not in source
