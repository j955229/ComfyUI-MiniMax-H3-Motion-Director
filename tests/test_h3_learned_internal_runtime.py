import importlib
import sys
import types

import torch


class Nested:
    def __init__(self, parts):
        self.parts = tuple(parts)
        self.is_nested = True

    def unbind(self):
        return self.parts


def _install_comfy_stubs():
    for name in [
        "nodes", "folder_paths", "comfy", "comfy.nested_tensor", "comfy.model_management",
        "comfy_extras", "comfy_extras.nodes_lt",
    ]:
        sys.modules.pop(name, None)

    nodes = types.ModuleType("nodes")
    nodes.NODE_CLASS_MAPPINGS = {}
    sys.modules["nodes"] = nodes

    folder_paths = types.ModuleType("folder_paths")
    folder_paths.models_dir = "/tmp/models"
    folder_paths.folder_names_and_paths = {}
    folder_paths.add_model_folder_path = lambda *args, **kwargs: None
    folder_paths.get_folder_paths = lambda name: ["/tmp/models/latent_upscale_models"]
    folder_paths.get_full_path = lambda name, model: f"/tmp/models/latent_upscale_models/{model}"
    sys.modules["folder_paths"] = folder_paths

    comfy = types.ModuleType("comfy")
    nested_mod = types.ModuleType("comfy.nested_tensor")
    nested_mod.NestedTensor = Nested
    mm = types.ModuleType("comfy.model_management")
    mm.cleanup_models_gc = lambda: None
    mm.unload_all_models = lambda: None
    mm.cleanup_models = lambda: None
    mm.soft_empty_cache = lambda: None
    comfy.nested_tensor = nested_mod
    comfy.model_management = mm
    sys.modules["comfy"] = comfy
    sys.modules["comfy.nested_tensor"] = nested_mod
    sys.modules["comfy.model_management"] = mm

    extras = types.ModuleType("comfy_extras")
    lt = types.ModuleType("comfy_extras.nodes_lt")

    class Sep:
        @staticmethod
        def execute(latent):
            video, audio = latent["samples"].unbind()
            return ({"samples": video}, {"samples": audio})

    class Cat:
        @staticmethod
        def execute(video, audio):
            return ({"samples": Nested((video["samples"], audio["samples"]))},)

    lt.LTXVSeparateAVLatent = Sep
    lt.LTXVConcatAVLatent = Cat
    extras.nodes_lt = lt
    sys.modules["comfy_extras"] = extras
    sys.modules["comfy_extras.nodes_lt"] = lt


def _reload():
    sys.modules.pop("director.h3_learned_latent", None)
    sys.modules.pop("director.h3_latent_upscaler_runtime", None)
    runtime = importlib.import_module("director.h3_latent_upscaler_runtime")
    adapter = importlib.import_module("director.h3_learned_latent")
    return runtime, adapter


def _latent():
    video = torch.randn(1, 24, 2, 2, 4)
    audio = torch.randn(1, 32, 2, 7)
    video_mask = torch.ones(1, 1, 2, 2, 4)
    audio_mask = torch.linspace(0, 1, 7).reshape(1, 1, 1, 7)
    return {
        "samples": Nested((video, audio)),
        "noise_mask": Nested((video_mask, audio_mask)),
    }, audio, audio_mask


def test_adapter_does_not_require_external_lbh_node_registry(monkeypatch):
    _install_comfy_stubs()
    runtime, adapter = _reload()

    calls = []

    def fake_run(video, **kwargs):
        calls.append(kwargs)
        return torch.nn.functional.interpolate(
            video,
            size=(video.shape[-3], kwargs["target_h"], kwargs["target_w"]),
            mode="trilinear",
            align_corners=False,
        )

    monkeypatch.setattr(runtime, "run_h3_latent_upscaler", fake_run)
    source, audio, audio_mask = _latent()
    out = adapter.upscale_h3_av_latent(
        source,
        width=128,
        height=64,
        model_name="model.safetensors",
        precision="fp16",
        device="cpu",
    )
    video_out, audio_out = out["samples"].unbind()
    _, audio_mask_out = out["noise_mask"].unbind()
    assert video_out.shape[-2:] == (4, 8)
    assert torch.equal(audio_out, audio)
    assert torch.equal(audio_mask_out, audio_mask)
    assert calls[0]["variant"] == "auto"


def test_runtime_model_variant_detection_uses_checkpoint_layout_only():
    _install_comfy_stubs()
    runtime, _ = _reload()
    assert runtime.detect_checkpoint_variant({"resizer.conv_in.weight": torch.empty(32, 24, 3, 3)}) == "2d"
    assert runtime.detect_checkpoint_variant({"conv_in.weight": torch.empty(32, 24, 3, 3, 3)}) == "3d"


def test_internal_3d_model_can_round_trip_a_small_compatible_state_dict():
    _install_comfy_stubs()
    runtime, _ = _reload()
    model = runtime._Compat3DResizer(
        in_channels=24,
        channels=32,
        in_layout=["res"],
        out_layout=["res"],
        temporal_kernel=3,
    )
    state = model.state_dict()
    rebuilt = runtime.build_model_for_checkpoint(state, variant="3d")
    missing, unexpected = rebuilt.load_state_dict(state, strict=False)
    assert missing == []
    assert unexpected == []
    x = torch.randn(1, 24, 2, 2, 3)
    y = rebuilt(x, scale=2.0, target_size=(2, 4, 6))
    assert y.shape == (1, 24, 2, 4, 6)


def test_internal_2d_temporal_model_can_round_trip_a_small_compatible_state_dict():
    _install_comfy_stubs()
    runtime, _ = _reload()
    model = runtime._Compat2DTemporalResizer(
        in_channels=24,
        channels=32,
        in_blocks=1,
        out_blocks=1,
        temporal_kernel=3,
        temporal_every=1,
        use_temporal=True,
    )
    state = model.state_dict()
    rebuilt = runtime.build_model_for_checkpoint(state, variant="2d")
    missing, unexpected = rebuilt.load_state_dict(state, strict=False)
    assert missing == []
    assert unexpected == []
    x = torch.randn(1, 24, 2, 2, 3)
    y = rebuilt(x, scale=2.0, target_hw=(4, 6))
    assert y.shape == (1, 24, 2, 4, 6)


def test_2d_runtime_accepts_one_latent_cell_rounding_from_uniform_scale(monkeypatch):
    """A normal snapped 16:9 target must not be mistaken for aspect-ratio conversion."""
    _install_comfy_stubs()
    runtime, _ = _reload()
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

    # Pixel 768x432 -> 1376x768 corresponds to latent 48x27 -> 86x48.
    # Independent integer-grid rounding changes the ratio slightly even though
    # both dimensions can still come from one common uniform scale.
    x = torch.randn(1, 24, 1, 27, 48)
    y = runtime.run_h3_latent_upscaler(
        x,
        model_name="model.safetensors",
        variant="auto",
        target_h=48,
        target_w=86,
        precision="fp32",
        device="cpu",
    )
    assert y.shape == (1, 24, 1, 48, 86)


def test_2d_runtime_still_rejects_real_aspect_ratio_change():
    _install_comfy_stubs()
    runtime, _ = _reload()
    x = torch.randn(1, 24, 1, 27, 48)
    try:
        runtime.run_h3_latent_upscaler(
            x,
            model_name="model.safetensors",
            variant="auto",
            target_h=64,
            target_w=64,
            precision="fp32",
            device="cpu",
        )
    except ValueError as exc:
        assert "aspect-ratio" in str(exc)
    else:
        raise AssertionError("2D runtime must reject a real aspect-ratio change")
