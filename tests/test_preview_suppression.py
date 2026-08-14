from pathlib import Path


def test_director_sampling_does_not_install_comfy_native_preview_callback():
    source = (Path(__file__).resolve().parents[1] / "director" / "core_sampling.py").read_text(encoding="utf-8")
    assert "latent_preview.prepare_callback" not in source
    assert "callback=callback" in source
