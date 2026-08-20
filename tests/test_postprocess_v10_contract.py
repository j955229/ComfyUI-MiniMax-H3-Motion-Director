from pathlib import Path

from director.postprocess_config import POSTPROCESS_CONFIG_VERSION, normalize_postprocess_config


def test_postprocess_config_version_is_v10_and_migrates_v9_values():
    assert POSTPROCESS_CONFIG_VERSION == 10
    normalized = normalize_postprocess_config(
        {
            "version": 9,
            "face_refine": {"enabled": True, "mask_mode": "sam", "sam_model": "sam2_t.pt"},
            "global_refine": {"result_previews_enabled": True},
        }
    )
    assert normalized["version"] == 10
    assert normalized["face_refine"]["enabled"] is True
    assert normalized["face_refine"]["sam_model"] == "sam2_t.pt"
    assert normalized["global_refine"]["result_previews_enabled"] is True


def test_frontend_config_and_boot_token_are_v10():
    modal = Path("web/js/minimax_postprocess_ui.mjs").read_text(encoding="utf-8")
    timeline = Path("web/js/minimax_timeline.js").read_text(encoding="utf-8")
    assert "version: 10" in modal
    assert "minimax_postprocess_ui.mjs?boot=postprocess_output_v10" in timeline
