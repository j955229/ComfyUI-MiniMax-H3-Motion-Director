import importlib.util
import os
from pathlib import Path
import sys
import types

PATH = Path(__file__).parents[1] / "director" / "model_paths.py"


def _load_with_fake_folder_paths(monkeypatch, models_dir):
    fake = types.ModuleType("folder_paths")
    fake.models_dir = str(models_dir)
    fake.folder_names_and_paths = {}

    def add_model_folder_path(name, path, is_default=False):
        paths, _exts = fake.folder_names_and_paths.setdefault(name, ([], set()))
        if path not in paths:
            paths.append(path)

    def get_filename_list(name):
        entry = fake.folder_names_and_paths.get(name)
        if not entry:
            return []
        found = []
        for root in entry[0]:
            if not os.path.isdir(root):
                continue
            for dirpath, _, filenames in os.walk(root):
                for filename in filenames:
                    found.append(os.path.relpath(os.path.join(dirpath, filename), root))
        return sorted(found)

    fake.add_model_folder_path = add_model_folder_path
    fake.get_filename_list = get_filename_list
    monkeypatch.setitem(sys.modules, "folder_paths", fake)

    spec = importlib.util.spec_from_file_location("model_paths_under_test", PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod, fake


def test_registers_director_owned_model_folders_and_discovers_models(tmp_path, monkeypatch):
    models_dir = tmp_path / "custom_models"
    bbox_dir = models_dir / "ultralytics" / "bbox"
    bbox_dir.mkdir(parents=True)
    (bbox_dir / "face_yolov8m.pt").write_bytes(b"test")
    latent_dir = models_dir / "latent_upscale_models"
    latent_dir.mkdir(parents=True)
    (latent_dir / "h3_latent_2d.safetensors").write_bytes(b"test")
    sam_dir = models_dir / "sams"
    sam_dir.mkdir(parents=True)
    (sam_dir / "sam2_t.pt").write_bytes(b"test")

    mod, fake = _load_with_fake_folder_paths(monkeypatch, models_dir)
    registered = mod.register_director_model_paths()

    assert registered["ultralytics_bbox"] == str(bbox_dir)
    assert registered["ultralytics_segm"] == str(models_dir / "ultralytics" / "segm")
    assert registered["latent_upscale_models"] == str(latent_dir)
    assert registered["sams"] == str(sam_dir)
    assert "face_yolov8m.pt" in fake.get_filename_list("ultralytics_bbox")
    assert "h3_latent_2d.safetensors" in fake.get_filename_list("latent_upscale_models")
    assert "sam2_t.pt" in fake.get_filename_list("sams")
    assert (models_dir / "ultralytics" / "segm").is_dir()
