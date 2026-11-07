from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path


MODULE_PATH = Path("patches/h3_payload.py")


class LegacyMiniMaxH3:
    """ComfyUI <= 0.43: cond_video_latents is assigned inside extra_conds."""

    def extra_conds(self, **kwargs):
        payload = {}
        keyframes = kwargs.get("minimax_keyframes", None)
        refs = kwargs.get("minimax_refs", None)
        payload["cond_video_latents"] = [k["latent"] for k in keyframes or []]
        payload["cond_video_latents"] += [r["latent"] for r in refs or []]
        return {"minimax_payload": payload}


class HelperMiniMaxH3:
    """ComfyUI 0.44: extra_conds delegates to the _cond_latents helper."""

    def extra_conds(self, **kwargs):
        payload = {}
        keyframes = kwargs.get("minimax_keyframes", None)
        refs = kwargs.get("minimax_refs", None)
        payload.update(self._cond_latents(keyframes, refs))
        return {"minimax_payload": payload}

    @staticmethod
    def _cond_latents(keyframes, refs):
        keyframes, refs = keyframes or [], refs or []
        return {"cond_video_latents": [k["latent"] for k in keyframes] + [r["latent"] for r in refs]}


class ChangedMiniMaxH3:
    """A future layout the patch does not know: the self-test must refuse it."""

    def extra_conds(self, **kwargs):
        return {"minimax_payload": {"keyframes": kwargs.get("minimax_keyframes", None)}}


def _load_module(monkeypatch, model_cls):
    comfy = types.ModuleType("comfy")
    comfy.__path__ = []
    model_base = types.ModuleType("comfy.model_base")
    model_base.MiniMaxH3 = type("MiniMaxH3", (model_cls,), {})
    comfy.model_base = model_base
    monkeypatch.setitem(sys.modules, "comfy", comfy)
    monkeypatch.setitem(sys.modules, "comfy.model_base", model_base)

    spec = importlib.util.spec_from_file_location("h3_payload_selftest_module", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, module)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module, model_base.MiniMaxH3


def test_payload_patch_applies_on_legacy_extra_conds(monkeypatch):
    mod, cls = _load_module(monkeypatch, LegacyMiniMaxH3)
    assert mod.apply_patch() is True
    assert mod.is_applied()
    assert cls.extra_conds is mod._patched_extra_conds


def test_payload_patch_applies_when_cond_latents_moved_to_helper(monkeypatch):
    mod, cls = _load_module(monkeypatch, HelperMiniMaxH3)
    assert mod.apply_patch() is True, mod.failure_reason()
    assert mod.failure_reason() is None
    assert cls.extra_conds is mod._patched_extra_conds


def test_payload_patch_refuses_unknown_layout(monkeypatch):
    mod, cls = _load_module(monkeypatch, ChangedMiniMaxH3)
    assert mod.apply_patch() is False
    assert "cond_video_latents" in mod.failure_reason()
    assert cls.extra_conds is not mod._patched_extra_conds
