from __future__ import annotations

import importlib.util
import os
import sys
import types
from pathlib import Path

import pytest


PATH = Path("director/face_refine_validation.py")


def _load(monkeypatch, root: Path, filenames: list[str]):
    folder_paths = types.ModuleType("folder_paths")
    folder_paths.models_dir = str(root)
    folder_paths.get_full_path = lambda category, name: (
        str(root / "sams" / name) if category == "sams" and name in filenames else None
    )
    folder_paths.get_filename_list = lambda category: list(filenames) if category == "sams" else []
    monkeypatch.setitem(sys.modules, "folder_paths", folder_paths)

    spec = importlib.util.spec_from_file_location("face_refine_validation_test", PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_sam_preflight_rejects_missing_selection(tmp_path, monkeypatch):
    mod = _load(monkeypatch, tmp_path, [])
    with pytest.raises(ValueError, match="SAM model"):
        mod.validate_face_refine_runtime({"enabled": True, "mask_mode": "sam", "sam_model": ""})


def test_sam_preflight_rejects_non_pt_checkpoint(tmp_path, monkeypatch):
    sams = tmp_path / "sams"
    sams.mkdir()
    (sams / "sam_vit_b.pth").write_bytes(b"x")
    mod = _load(monkeypatch, tmp_path, ["sam_vit_b.pth"])
    with pytest.raises(ValueError, match=r"\.pt"):
        mod.validate_face_refine_runtime(
            {"enabled": True, "mask_mode": "sam", "sam_model": "sam_vit_b.pth"},
            check_runtime=False,
        )


def test_resolve_sam_model_path_accepts_director_ultralytics_pt(tmp_path, monkeypatch):
    sams = tmp_path / "sams"
    sams.mkdir()
    (sams / "sam2_t.pt").write_bytes(b"x")
    mod = _load(monkeypatch, tmp_path, ["sam2_t.pt"])
    assert mod.resolve_sam_model_path("sam2_t.pt") == os.fspath(sams / "sam2_t.pt")
