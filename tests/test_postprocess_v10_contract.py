from director.postprocess_config import (
    POSTPROCESS_CONFIG_VERSION,
    normalize_postprocess_config,
    postprocess_cache_fingerprint,
)


def test_postprocess_config_version_is_v10_and_migrates_v9_values():
    assert POSTPROCESS_CONFIG_VERSION == 10
    normalized = normalize_postprocess_config(
        {
            "version": 9,
            "face_refine": {
                "enabled": True,
                "mask_mode": "sam",
                "sam_model": "sam2_t.pt",
            },
            "global_refine": {"result_previews_enabled": True},
        }
    )
    assert normalized["version"] == 10
    assert normalized["face_refine"]["enabled"] is True
    assert normalized["face_refine"]["sam_model"] == "sam2_t.pt"
    assert normalized["global_refine"]["result_previews_enabled"] is True


def test_face_refine_changes_cache_identity_but_result_preview_does_not():
    base = {
        "version": 9,
        "global_refine": {"enabled": True, "result_previews_enabled": False},
        "face_refine": {"enabled": True, "base_denoise": 0.45},
    }
    preview = {
        **base,
        "global_refine": {"enabled": True, "result_previews_enabled": True},
    }
    changed_face = {
        **base,
        "face_refine": {"enabled": True, "base_denoise": 0.55},
    }
    assert postprocess_cache_fingerprint(base) == postprocess_cache_fingerprint(preview)
    assert postprocess_cache_fingerprint(base) != postprocess_cache_fingerprint(changed_face)
