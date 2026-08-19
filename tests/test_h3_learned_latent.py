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


def install_runtime():
    for name in ["nodes", "comfy", "comfy.nested_tensor", "comfy.model_management", "comfy_extras", "comfy_extras.nodes_lt"]:
        sys.modules.pop(name, None)

    registry = types.ModuleType("nodes")
    registry.NODE_CLASS_MAPPINGS = {}
    sys.modules["nodes"] = registry

    events = []
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
    return events


def reload_mod():
    sys.modules.pop("director.h3_learned_latent", None)
    return importlib.import_module("director.h3_learned_latent")


def make_latent():
    video = torch.arange(1 * 24 * 2 * 2 * 4, dtype=torch.float32).reshape(1, 24, 2, 2, 4)
    audio = torch.arange(1 * 32 * 2 * 7, dtype=torch.float32).reshape(1, 32, 2, 7)
    video_mask = torch.tensor([[[[[0.0, 1.0, 1.0, 0.0], [1.0, 1.0, 0.0, 0.0]], [[1.0, 0.0, 0.0, 1.0], [0.0, 0.0, 1.0, 1.0]]]]])
    audio_mask = torch.linspace(0, 1, 7).reshape(1, 1, 1, 7)
    return {"samples": Nested((video, audio)), "noise_mask": Nested((video_mask, audio_mask))}, audio, audio_mask


def test_native_runtime_preserves_audio_and_remaps_video_mask(monkeypatch):
    install_runtime()
    mod = reload_mod()

    def fake_run(source, **kwargs):
        return torch.nn.functional.interpolate(
            source,
            size=(source.shape[-3], kwargs["target_h"], kwargs["target_w"]),
            mode="trilinear",
            align_corners=False,
        )

    monkeypatch.setattr(mod._runtime, "run_h3_latent_upscaler", fake_run)
    latent, audio, audio_mask = make_latent()
    out = mod.upscale_h3_av_latent(latent, width=128, height=64, model_name="x.safetensors", variant="2d", precision="fp16", device="cpu")
    video_out, audio_out = out["samples"].unbind()
    video_mask, audio_mask_out = out["noise_mask"].unbind()
    assert video_out.shape == (1, 24, 2, 4, 8)
    assert torch.equal(audio_out, audio)
    assert video_mask.shape[-2:] == (4, 8)
    assert torch.equal(audio_mask_out, audio_mask)


def test_cuda_unloads_first_pass_stack_before_native_runtime(monkeypatch):
    events = install_runtime()
    mod = reload_mod()

    def fake_run(source, **kwargs):
        events.append("native_runtime")
        return torch.nn.functional.interpolate(
            source,
            size=(source.shape[-3], kwargs["target_h"], kwargs["target_w"]),
            mode="trilinear",
            align_corners=False,
        )

    monkeypatch.setattr(mod._runtime, "run_h3_latent_upscaler", fake_run)
    mod.upscale_h3_av_latent(make_latent()[0], width=128, height=64, model_name="x.safetensors", variant="2d", precision="fp16", device="cuda")
    assert events.index("unload_all_models") < events.index("native_runtime")


def test_cpu_path_does_not_unload_first_pass_stack(monkeypatch):
    events = install_runtime()
    mod = reload_mod()
    monkeypatch.setattr(
        mod._runtime,
        "run_h3_latent_upscaler",
        lambda source, **kwargs: torch.nn.functional.interpolate(
            source,
            size=(source.shape[-3], kwargs["target_h"], kwargs["target_w"]),
            mode="trilinear",
            align_corners=False,
        ),
    )
    mod.upscale_h3_av_latent(make_latent()[0], width=128, height=64, model_name="x.safetensors", variant="2d", precision="fp16", device="cpu")
    assert "unload_all_models" not in events


def test_native_runtime_error_is_not_replaced_by_pixel_fallback(monkeypatch):
    install_runtime()
    mod = reload_mod()

    def fail(*args, **kwargs):
        raise FileNotFoundError("checkpoint missing")

    monkeypatch.setattr(mod._runtime, "run_h3_latent_upscaler", fail)
    try:
        mod.upscale_h3_av_latent(make_latent()[0], width=128, height=64, model_name="missing.safetensors", variant="2d", precision="fp16", device="cpu")
    except FileNotFoundError as exc:
        assert "checkpoint missing" in str(exc)
    else:
        raise AssertionError("expected checkpoint failure")
