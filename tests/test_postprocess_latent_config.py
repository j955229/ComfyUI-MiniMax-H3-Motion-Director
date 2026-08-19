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
                "latent_upscale_variant": "3D",
                "latent_upscale_precision": "BF16",
                "latent_upscale_device": "CPU",
            }
        }
    )
    g = cfg["global_refine"]
    assert POSTPROCESS_CONFIG_VERSION >= 8
    assert g["upscale_method"] == "h3_learned_latent"
    assert g["latent_upscale_model"] == "h3_upscale.safetensors"
    assert g["latent_upscale_variant"] == "3d"
    assert g["latent_upscale_precision"] == "bf16"
    assert g["latent_upscale_device"] == "cpu"
    fingerprint = postprocess_cache_fingerprint(cfg)
    assert fingerprint["global_refine"]["latent_upscale_model"] == "h3_upscale.safetensors"


def test_old_config_keeps_existing_pixel_default():
    cfg = normalize_postprocess_config({"version": 1, "global_refine": {"enabled": True}})
    assert cfg["global_refine"]["upscale_method"] == "lanczos"
    assert cfg["global_refine"]["latent_upscale_variant"] == "2d"
    assert cfg["global_refine"]["latent_upscale_precision"] == "fp16"
    assert cfg["global_refine"]["latent_upscale_device"] == "cuda"
