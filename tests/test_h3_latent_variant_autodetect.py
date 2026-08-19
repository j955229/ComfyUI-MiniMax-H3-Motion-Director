import importlib.util
from pathlib import Path

import torch


def _runtime_module():
    path = Path(__file__).resolve().parents[1] / "director" / "h3_latent_upscaler_runtime.py"
    spec = importlib.util.spec_from_file_location("director_h3_latent_runtime_variant_test", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_runtime_autodetects_3d_checkpoint_even_if_legacy_ui_says_2d(monkeypatch):
    runtime = _runtime_module()
    model = runtime._Compat3DResizer(
        in_channels=24,
        channels=32,
        in_layout=["res"],
        out_layout=["res"],
        temporal_kernel=3,
    )
    state = model.state_dict()
    monkeypatch.setattr(runtime, "_checkpoint_path", lambda _name: "/tmp/model.safetensors")
    monkeypatch.setattr(runtime, "_load_checkpoint", lambda _path: state)

    x = torch.randn(1, 24, 2, 2, 3)
    y = runtime.run_h3_latent_upscaler(
        x,
        model_name="model.safetensors",
        variant="2d",  # stale/legacy UI value must not override checkpoint architecture
        target_h=4,
        target_w=6,
        precision="fp32",
        device="cpu",
    )
    assert y.shape == (1, 24, 2, 4, 6)


def test_runtime_autodetects_2d_checkpoint_even_if_legacy_ui_says_3d(monkeypatch):
    runtime = _runtime_module()
    model = runtime._Compat2DTemporalResizer(
        in_channels=24,
        channels=32,
        in_blocks=1,
        out_blocks=1,
        temporal_kernel=3,
        temporal_every=1,
        use_temporal=False,
    )
    state = model.state_dict()
    monkeypatch.setattr(runtime, "_checkpoint_path", lambda _name: "/tmp/model.safetensors")
    monkeypatch.setattr(runtime, "_load_checkpoint", lambda _path: state)

    x = torch.randn(1, 24, 2, 2, 3)
    y = runtime.run_h3_latent_upscaler(
        x,
        model_name="model.safetensors",
        variant="3d",  # stale/legacy UI value must not override checkpoint architecture
        target_h=4,
        target_w=6,
        precision="fp32",
        device="cpu",
    )
    assert y.shape == (1, 24, 2, 4, 6)
