from pathlib import Path


def test_postprocess_capabilities_exposes_comfyui_scanned_h3_latent_models():
    source = Path("director/http_routes.py").read_text(encoding="utf-8")
    assert 'filenames("latent_upscale_models")' in source


def test_postprocess_ui_uses_scanned_h3_latent_model_dropdown():
    source = Path("web/js/minimax_postprocess_ui.mjs").read_text(encoding="utf-8")
    assert 'field("H3 Latent Model", "global_refine.latent_upscale_model", "select"' in source
    assert 'fill("global_refine.latent_upscale_model", caps.latent_upscale_models)' in source
    assert 'h3LatentModels.length === 1' in source
    assert "select or enter its filename" not in source
    assert "选择或填写文件名" not in source


def test_postprocess_ui_does_not_expose_manual_2d_3d_variant_selector():
    source = Path("web/js/minimax_postprocess_ui.mjs").read_text(encoding="utf-8")
    assert 'field("Latent Variant", "global_refine.latent_upscale_variant"' not in source
    assert '"global_refine.latent_upscale_variant":' not in source
    assert "2D + Temporal (recommended)" not in source
    assert "2D + Temporal（推荐）" not in source
    assert "String(global.latent_upscale_variant" not in source
