import importlib.util
import sys
import types
from pathlib import Path

import torch

PATH = Path(__file__).parents[1] / "director" / "h3_noise_mask.py"


def load_module():
    spec = importlib.util.spec_from_file_location("h3_noise_mask_under_test", PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


class Nested:
    def __init__(self, parts):
        self.parts = tuple(parts)
        self.is_nested = True

    def unbind(self):
        return self.parts


def install_fake_comfy():
    comfy = types.ModuleType("comfy")
    nested_mod = types.ModuleType("comfy.nested_tensor")
    nested_mod.NestedTensor = Nested
    comfy.nested_tensor = nested_mod
    sys.modules["comfy"] = comfy
    sys.modules["comfy.nested_tensor"] = nested_mod


def test_nested_video_mask_resizes_spatially_and_audio_is_preserved():
    install_fake_comfy()
    mod = load_module()
    video = torch.tensor([[[[[0.0, 1.0], [1.0, 0.0]]]]])
    audio = torch.tensor([[[[0.0, 1.0, 0.5]]]])
    mask = Nested((video, audio))

    remapped = mod.remap_h3_noise_mask(mask, target_h=4, target_w=4)
    out_video, out_audio, nested = mod.split_h3_mask(remapped)

    assert nested is True
    assert out_video.shape == (1, 1, 1, 4, 4)
    assert torch.equal(out_audio, audio)
    assert torch.equal(out_video[..., :2, :2], torch.zeros_like(out_video[..., :2, :2]))
    assert torch.equal(out_video[..., :2, 2:], torch.ones_like(out_video[..., :2, 2:]))


def test_none_mask_remains_absent():
    mod = load_module()
    assert mod.remap_h3_noise_mask(None, target_h=8, target_w=8) is None
    latent = {"samples": torch.zeros(1), "noise_mask": torch.ones(1)}
    out = mod.with_noise_mask(latent, None)
    assert "noise_mask" not in out
    assert "noise_mask" in latent


def test_plain_video_mask_is_nearest_resized_without_temporal_change():
    mod = load_module()
    video = torch.arange(12, dtype=torch.float32).reshape(1, 1, 3, 2, 2)
    out = mod.remap_h3_noise_mask(video, target_h=4, target_w=6)
    assert out.shape == (1, 1, 3, 4, 6)
    assert torch.equal(out[:, :, 1, 0, 0], video[:, :, 1, 0, 0])
    assert torch.equal(out[:, :, 2, -1, -1], video[:, :, 2, -1, -1])


def test_boolean_mask_stays_boolean():
    mod = load_module()
    mask = torch.tensor([[[[[False, True]]]]])
    out = mod.resize_video_mask(mask, target_h=2, target_w=4)
    assert out.dtype == torch.bool
    assert out.shape[-2:] == (2, 4)
