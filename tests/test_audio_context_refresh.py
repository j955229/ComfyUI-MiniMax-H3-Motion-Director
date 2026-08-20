from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

import torch


MODULE_PATH = Path("director/audio_context_refresh.py")


def _load_module(monkeypatch):
    root = types.ModuleType("audio_refresh_testpkg")
    root.__path__ = []
    director = types.ModuleType("audio_refresh_testpkg.director")
    director.__path__ = []
    monkeypatch.setitem(sys.modules, "audio_refresh_testpkg", root)
    monkeypatch.setitem(sys.modules, "audio_refresh_testpkg.director", director)

    spec = importlib.util.spec_from_file_location(
        "audio_refresh_testpkg.director.audio_context_refresh", MODULE_PATH
    )
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, module)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_refresh_removes_only_hidden_audio_latent_when_waveform_is_valid(monkeypatch):
    mod = _load_module(monkeypatch)
    video = torch.zeros((1, 24, 6, 2, 4))
    hidden_audio = torch.ones((1, 8, 2, 40))
    waveform = torch.zeros((1, 2, 32000))
    latent = {
        "samples": (video, hidden_audio),
        "noise_mask": "keep",
        "token": "keep",
    }

    out, refreshed = mod.prepare_context_latent_for_audio_refresh(
        latent,
        context_audio={"waveform": waveform, "sample_rate": 32000},
        audio_vae=object(),
        context_span=22,
        audio_enabled=True,
    )

    assert refreshed is True
    assert out is not latent
    assert out["samples"] == (video,)
    assert out["noise_mask"] == "keep"
    assert out["token"] == "keep"
    assert latent["samples"] == (video, hidden_audio)


def test_refresh_keeps_latent_fallback_when_waveform_cannot_cover_context(monkeypatch):
    mod = _load_module(monkeypatch)
    video = torch.zeros((1, 24, 6, 2, 4))
    hidden_audio = torch.ones((1, 8, 2, 40))
    latent = {"samples": (video, hidden_audio)}

    out, refreshed = mod.prepare_context_latent_for_audio_refresh(
        latent,
        context_audio={"waveform": torch.zeros((1, 2, 100)), "sample_rate": 32000},
        audio_vae=object(),
        context_span=22,
        audio_enabled=True,
    )

    assert refreshed is False
    assert out is latent


def test_refresh_keeps_latent_fallback_without_audio_vae(monkeypatch):
    mod = _load_module(monkeypatch)
    video = torch.zeros((1, 24, 6, 2, 4))
    hidden_audio = torch.ones((1, 8, 2, 40))
    latent = {"samples": (video, hidden_audio)}

    out, refreshed = mod.prepare_context_latent_for_audio_refresh(
        latent,
        context_audio={"waveform": torch.zeros((1, 2, 32000)), "sample_rate": 32000},
        audio_vae=None,
        context_span=22,
        audio_enabled=True,
    )

    assert refreshed is False
    assert out is latent


def test_installer_forces_waveform_refresh_before_executor_binds_function(monkeypatch):
    mod = _load_module(monkeypatch)
    fake_motion = types.ModuleType("audio_refresh_testpkg.director.motion_context")
    calls = []

    class Info:
        audio_source = "latent"

    def original(conditioning, **kwargs):
        calls.append(kwargs["context_latent"])
        return conditioning, Info()

    fake_motion.apply_exported_motion_context = original
    monkeypatch.setitem(
        sys.modules, "audio_refresh_testpkg.director.motion_context", fake_motion
    )
    parent = sys.modules["audio_refresh_testpkg.director"]
    parent.motion_context = fake_motion

    mod.install_audio_context_refresh()
    wrapped = fake_motion.apply_exported_motion_context
    video = torch.zeros((1, 24, 6, 2, 4))
    hidden_audio = torch.ones((1, 8, 2, 40))
    conditioning = [[torch.zeros(1), {}]]

    result, _info = wrapped(
        conditioning,
        context_latent={"samples": (video, hidden_audio)},
        context_audio={
            "waveform": torch.zeros((1, 2, 32000)),
            "sample_rate": 32000,
        },
        audio_vae=object(),
        context_span=22,
        audio_enabled=True,
    )

    assert result is conditioning
    assert calls[0]["samples"] == (video,)
    assert getattr(wrapped, "_motion_director_audio_refresh", False) is True


def test_root_package_installs_refresh_before_public_nodes_bind_executor():
    source = Path("__init__.py").read_text(encoding="utf-8")
    install_at = source.index("install_audio_context_refresh()")
    nodes_at = source.index("from .nodes.director_output")
    assert install_at < nodes_at


def test_top_level_director_package_remains_import_safe():
    source = Path("director/__init__.py").read_text(encoding="utf-8")
    assert "install_audio_context_refresh" not in source
