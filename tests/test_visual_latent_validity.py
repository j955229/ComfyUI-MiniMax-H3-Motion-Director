from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

import torch


MODULE_PATH = Path("director/latent_context_cache.py")


def _load_module(monkeypatch):
    root = types.ModuleType("visual_valid_testpkg")
    root.__path__ = []
    director = types.ModuleType("visual_valid_testpkg.director")
    director.__path__ = []
    monkeypatch.setitem(sys.modules, "visual_valid_testpkg", root)
    monkeypatch.setitem(sys.modules, "visual_valid_testpkg.director", director)

    folder_paths = types.ModuleType("folder_paths")
    monkeypatch.setitem(sys.modules, "folder_paths", folder_paths)

    cache_path = types.ModuleType("visual_valid_testpkg.director.cache_path")
    cache_path.cache_root = lambda *args, **kwargs: None
    monkeypatch.setitem(sys.modules, cache_path.__name__, cache_path)

    context_cache = types.ModuleType("visual_valid_testpkg.director.context_cache")
    context_cache.context_fingerprint = lambda *args, **kwargs: {}
    monkeypatch.setitem(sys.modules, context_cache.__name__, context_cache)

    segment_cache = types.ModuleType("visual_valid_testpkg.director.segment_cache")
    segment_cache._write_via_temp = lambda *args, **kwargs: None
    monkeypatch.setitem(sys.modules, segment_cache.__name__, segment_cache)

    motion_context = types.ModuleType("visual_valid_testpkg.director.motion_context")
    motion_context.select_context_span = lambda requested, available: min(5, int(available))

    def video_context_from_latent(latent, *, span, context_end_frame):
        video = latent["samples"][0]
        return [video[:, :, :1]], [0], int(context_end_frame)

    motion_context.video_context_from_latent = video_context_from_latent
    motion_context._audio_context_from_latent = lambda *args, **kwargs: ({}, 0)
    monkeypatch.setitem(sys.modules, motion_context.__name__, motion_context)

    color = types.ModuleType("visual_valid_testpkg.director.color_reanchor")
    color.validate_color_anchor_statistics = lambda value: None
    monkeypatch.setitem(sys.modules, color.__name__, color)

    spec = importlib.util.spec_from_file_location(
        "visual_valid_testpkg.director.latent_context_cache", MODULE_PATH
    )
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, module)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_prepare_latent_tail_preserves_visual_invalidity(monkeypatch):
    mod = _load_module(monkeypatch)
    latent = {"samples": (torch.zeros((1, 24, 2, 2, 3)),)}
    handoff = {
        "context_end_frame": 5,
        "trim_frames": 0,
        "export_frames": 5,
        "sample_frames": 5,
        "visual_latent_valid": False,
    }

    _tail, tail_handoff = mod.prepare_latent_context_tail(latent, handoff)

    assert tail_handoff["visual_latent_valid"] is False


def test_prepare_latent_tail_defaults_visual_validity_true_for_old_handoffs(monkeypatch):
    mod = _load_module(monkeypatch)
    latent = {"samples": (torch.zeros((1, 24, 2, 2, 3)),)}
    handoff = {
        "context_end_frame": 5,
        "trim_frames": 0,
        "export_frames": 5,
        "sample_frames": 5,
    }

    _tail, tail_handoff = mod.prepare_latent_context_tail(latent, handoff)

    assert tail_handoff["visual_latent_valid"] is True


def test_executor_facade_marks_and_consumes_visual_invalidity():
    source = Path("director/executor_core.py").read_text(encoding="utf-8")
    assert 'updated_handoff["visual_latent_valid"] = valid' in source
    assert 'tail_latent["visual_latent_valid"] = valid' in source
    assert 'context_latent.get("visual_latent_valid") is False' in source
    assert 'call["context_audio_latent"] = context_latent' in source
    assert 'call["context_latent"] = None' in source
