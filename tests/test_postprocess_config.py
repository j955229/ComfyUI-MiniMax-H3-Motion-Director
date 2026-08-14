from _minimax_h3_motion_director_testpkg.director.postprocess_config import (
    normalize_postprocess_config,
    refine_seed_for,
    refine_steps_for,
    resolve_upscale_target,
    serialize_postprocess_config,
)


def test_old_workflow_defaults_keep_postprocessing_disabled():
    config = normalize_postprocess_config("")
    assert config["global_refine"]["enabled"] is False
    assert config["face_refine"]["enabled"] is False
    assert config["preview"]["enabled"] is True
    assert config["save"] == {
        "auto_save": False,
        "filename_prefix": "video/MiniMaxH3_Director",
        "format": "auto",
        "codec": "auto",
        "encoding": "auto",
        "crf": 23,
    }


def test_save_config_is_normalized_without_affecting_existing_sections():
    config = normalize_postprocess_config({
        "global_refine": {"enabled": True},
        "save": {
            "auto_save": "yes",
            "filename_prefix": "  video/My_Director  ",
            "format": "MP4",
            "codec": "H264",
            "encoding": "re-encode",
            "crf": 999,
        },
    })
    assert config["global_refine"]["enabled"] is True
    assert config["save"] == {
        "auto_save": True,
        "filename_prefix": "video/My_Director",
        "format": "mp4",
        "codec": "h264",
        "encoding": "re-encode",
        "crf": 51,
    }


def test_config_round_trip_and_legacy_live_preview_migration():
    raw = {"globalRefine": {"enabled": True, "mode": "upscale"}, "liveTaePreview": False}
    restored = normalize_postprocess_config(serialize_postprocess_config(raw))
    assert restored["global_refine"]["enabled"] is True
    assert restored["global_refine"]["mode"] == "upscale"
    assert restored["preview"]["enabled"] is False


def test_refine_auto_steps_and_seed_are_upstream_compatible():
    assert refine_steps_for({"steps": 0}, 10) == 8
    assert refine_steps_for({"steps": 0}, 25) == 10
    assert refine_steps_for({"steps": 12}, 25) == 12
    assert refine_seed_for({"seed_mode": "inherit"}, 44) == 44
    assert refine_seed_for({"seed_mode": "offset", "seed_offset": 3}, 44) == 47


def test_aspect_megapixels_and_custom_targets_snap_to_h3_canvas():
    assert resolve_upscale_target({"resolution_mode": "custom", "width": 1370, "height": 770}, 864, 480) == (1376, 768)
    width, height = resolve_upscale_target(
        {"resolution_mode": "aspect_megapixels", "aspect": "16:9", "megapixels": 1.0}, 864, 480
    )
    assert width % 32 == 0 and height % 32 == 0
    assert width > height
