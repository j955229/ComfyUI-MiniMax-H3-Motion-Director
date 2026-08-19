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


class Out:
    def __init__(self, *args):
        self.args = args


def install_runtime(*, include_2d=True, include_3d=True):
    for name in ["nodes", "comfy", "comfy.nested_tensor", "comfy.model_management", "comfy_extras", "comfy_extras.nodes_lt"]:
        sys.modules.pop(name, None)

    events = []
    registry = types.ModuleType("nodes")
    registry.NODE_CLASS_MAPPINGS = {}
    sys.modules["nodes"] = registry

    comfy = types.ModuleType("comfy")
    nested_mod = types.ModuleType("comfy.nested_tensor")
    nested_mod.NestedTensor = Nested
    mm = types.ModuleType("comfy.model_management")
    mm.cleanup_models_gc = lambda: events.append("cleanup_models_gc")
    mm.unload_all_models = lambda: events.append("unload_all_models")
    mm.cleanup_models = lambda: events.append("cleanup_models")
    mm.soft_empty_cache = lambda: events.append("soft_empty_cache")
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
            v, a = latent["samples"].unbind()
            return ({"samples": v}, {"samples": a})

    class Cat:
        @staticmethod
        def execute(video, audio):
            return ({"samples": Nested((video["samples"], audio["samples"]))},)

    lt.LTXVSeparateAVLatent = Sep
    lt.LTXVConcatAVLatent = Cat
    extras.nodes_lt = lt
    sys.modules["comfy_extras"] = extras
    sys.modules["comfy_extras.nodes_lt"] = lt

    fake2d = types.ModuleType("fake_lbh_2d")
    fake2d.MODEL_CACHE = {"resident": object()}
    if include_2d:
        class Node2D:
            def run(self, latent, model_name, scale, device, precision):
                events.append("node2d")
                x = latent["samples"]
                h = int(round(x.shape[-2] * scale))
                w = int(round(x.shape[-1] * scale))
                out = torch.nn.functional.interpolate(
                    x, size=(x.shape[-3], h, w), mode="trilinear", align_corners=False
                )
                return ({"samples": out},)

        Node2D.__module__ = fake2d.__name__
        fake2d.MinimaxH3LatentUpscalerNode2D = Node2D
        registry.NODE_CLASS_MAPPINGS["MinimaxH3LatentUpscalerNode2D"] = Node2D
    sys.modules[fake2d.__name__] = fake2d

    fake3d = types.ModuleType("fake_lbh_3d")
    fake3d.MODEL_CACHE = {"resident": object()}

    class UpscaleMode:
        TARGET_DIMENSIONS = "target dimensions"

    fake3d.UpscaleMode = UpscaleMode
    if include_3d:
        class Node3D:
            @classmethod
            def execute(cls, latent, model_name, mode, align, keep_proportion, device, precision):
                events.append("node3d")
                assert mode["mode"] == "target dimensions"
                x = latent["samples"]
                h = mode["height"] // 16
                w = mode["width"] // 16
                out = torch.nn.functional.interpolate(
                    x, size=(x.shape[-3], h, w), mode="trilinear", align_corners=False
                )
                return Out({"samples": out})

        Node3D.__module__ = fake3d.__name__
        fake3d.MinimaxH3LatentUpscaler3D = Node3D
        registry.NODE_CLASS_MAPPINGS["MinimaxH3LatentUpscaler3D"] = Node3D
    sys.modules[fake3d.__name__] = fake3d
    return registry, fake2d, fake3d, events


def reload_mod():
    sys.modules.pop("director.h3_learned_latent", None)
    return importlib.import_module("director.h3_learned_latent")


def make_latent():
    video = torch.arange(1 * 24 * 2 * 2 * 4, dtype=torch.float32).reshape(1, 24, 2, 2, 4)
    audio = torch.arange(1 * 32 * 2 * 7, dtype=torch.float32).reshape(1, 32, 2, 7)
    video_mask = torch.tensor([[[[[0.0, 1.0, 1.0, 0.0], [1.0, 1.0, 0.0, 0.0]], [[1.0, 0.0, 0.0, 1.0], [0.0, 0.0, 1.0, 1.0]]]]])
    audio_mask = torch.linspace(0, 1, 7).reshape(1, 1, 1, 7)
    return {"samples": Nested((video, audio)), "noise_mask": Nested((video_mask, audio_mask))}, audio, audio_mask


def test_missing_lbh_dependency_is_explicit():
    install_runtime(include_2d=False, include_3d=False)
    mod = reload_mod()
    try:
        mod.upscale_h3_av_latent(make_latent()[0], width=128, height=64, model_name="x.safetensors", variant="2d", precision="fp16", device="cuda")
    except RuntimeError as exc:
        assert "LBH" in str(exc)
    else:
        raise AssertionError("expected missing dependency error")


def test_2d_upscale_preserves_audio_and_remaps_video_mask():
    _, fake2d, _, events = install_runtime()
    mod = reload_mod()
    latent, audio, audio_mask = make_latent()
    out = mod.upscale_h3_av_latent(latent, width=128, height=64, model_name="x.safetensors", variant="2d", precision="fp16", device="cuda")
    video_out, audio_out = out["samples"].unbind()
    video_mask, audio_mask_out = out["noise_mask"].unbind()
    assert video_out.shape == (1, 24, 2, 4, 8)
    assert torch.equal(audio_out, audio)
    assert video_mask.shape[-2:] == (4, 8)
    assert torch.equal(audio_mask_out, audio_mask)
    assert fake2d.MODEL_CACHE == {}
    assert events.index("unload_all_models") < events.index("node2d")


def test_cpu_2d_does_not_unload_gpu_model_stack():
    _, _, _, events = install_runtime()
    mod = reload_mod()
    latent = make_latent()[0]
    mod.upscale_h3_av_latent(latent, width=128, height=64, model_name="x.safetensors", variant="2d", precision="fp16", device="cpu")
    assert "node2d" in events
    assert "unload_all_models" not in events


def test_2d_rejects_aspect_ratio_change_instead_of_silent_size_drift():
    install_runtime()
    mod = reload_mod()
    latent = make_latent()[0]
    try:
        mod.upscale_h3_av_latent(latent, width=144, height=64, model_name="x.safetensors", variant="2d", precision="fp16", device="cuda")
    except ValueError as exc:
        assert "3D" in str(exc)
    else:
        raise AssertionError("expected 2D aspect-ratio validation")


def test_3d_uses_exact_director_target_and_clears_cache():
    _, _, fake3d, events = install_runtime()
    mod = reload_mod()
    latent, audio, _ = make_latent()
    out = mod.upscale_h3_av_latent(latent, width=144, height=64, model_name="x.safetensors", variant="3d", precision="bf16", device="cuda")
    video_out, audio_out = out["samples"].unbind()
    assert video_out.shape[-2:] == (4, 9)
    assert torch.equal(audio_out, audio)
    assert fake3d.MODEL_CACHE == {}
    assert events.index("unload_all_models") < events.index("node3d")
