from pathlib import Path


def test_capabilities_use_compatible_sam_filter_and_publish_folder():
    source = Path("director/http_routes.py").read_text(encoding="utf-8")
    assert "compatible_sam_models" in source
    assert '"sam_models": compatible_sam_models()' in source
    assert '"sam_model_folder"' in source


def test_ui_explains_empty_sam_model_selector():
    source = Path("web/js/minimax_sam_ui.js").read_text(encoding="utf-8")
    assert "No compatible SAM .pt model found" in source
    assert "未找到兼容的 SAM .pt 模型" in source
    assert "ComfyUI/models/sams" in source
    assert 'data-path="face_refine.sam_model"' in source
