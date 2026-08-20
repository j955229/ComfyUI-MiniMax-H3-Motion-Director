from director.postprocess_config import (
    POSTPROCESS_CONFIG_VERSION,
    normalize_postprocess_config,
    postprocess_cache_fingerprint,
)


def test_learned_latent_config_normalizes_and_is_cache_relevant():
    cfg = normalize_postprocess_config(
        {
            "global_refine": {
                "enabled": True,
                "mode": "upscale",
                "upscale_method": "h3_learned_latent",
                "latent_upscale_model": "h3_upscale.safetensors",
                "latent_upscale_variant": "3D",  # legacy value must be discarded
                "latent_upscale_precision": "BF16",
                "latent_upscale_device": "CPU",
            }
        }
    )
    g = cfg["global_refine"]
    assert POSTPROCESS_CONFIG_VERSION >= 9
    assert g["upscale_method"] == "h3_learned_latent"
    assert g["latent_upscale_model"] == "h3_upscale.safetensors"
    assert "latent_upscale_variant" not in g
    assert g["latent_upscale_precision"] == "bf16"
    assert g["latent_upscale_device"] == "cpu"
    fingerprint = postprocess_cache_fingerprint(cfg)
    assert fingerprint["global_refine"]["latent_upscale_model"] == "h3_upscale.safetensors"
    assert "latent_upscale_variant" not in fingerprint["global_refine"]


def test_old_config_keeps_existing_pixel_default_without_manual_latent_variant():
    cfg = normalize_postprocess_config(
        {"version": 1, "global_refine": {"enabled": True, "latent_upscale_variant": "2d"}}
    )
    assert cfg["global_refine"]["upscale_method"] == "lanczos"
    assert "latent_upscale_variant" not in cfg["global_refine"]
    assert cfg["global_refine"]["latent_upscale_precision"] == "fp16"
    assert cfg["global_refine"]["latent_upscale_device"] == "cuda"
