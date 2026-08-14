from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_director_keeps_exact_public_outputs_and_has_no_postprocess_sockets():
    source = (ROOT / "nodes" / "director.py").read_text(encoding="utf-8")
    assert 'RETURN_NAMES = ("images", "audio", "fps", "frame_count", "source_images", "report")' in source
    for forbidden in ('"refine": (', '"face_refine": (', '"upscale_model": (', '"UPSCALE_MODEL"'):
        assert forbidden not in source


def test_postprocess_json_is_append_only_after_pin_renorm():
    source = (ROOT / "nodes" / "director.py").read_text(encoding="utf-8")
    assert source.index('"pin_renorm_enabled"') < source.index('"postprocess_config"')
