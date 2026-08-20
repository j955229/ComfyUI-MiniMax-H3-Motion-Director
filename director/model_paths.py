"""Model-folder registration owned by MiniMax H3 Motion Director."""

from __future__ import annotations

import os

import folder_paths


_DIRECTOR_MODEL_FOLDERS = (
    ("ultralytics_bbox", ("ultralytics", "bbox")),
    ("ultralytics_segm", ("ultralytics", "segm")),
    ("latent_upscale_models", ("latent_upscale_models",)),
    ("sams", ("sams",)),
)


def register_director_model_paths() -> dict[str, str]:
    """Register Director-owned model directories with ComfyUI's folder registry."""
    registered: dict[str, str] = {}
    for category, parts in _DIRECTOR_MODEL_FOLDERS:
        path = os.path.join(folder_paths.models_dir, *parts)
        os.makedirs(path, exist_ok=True)
        folder_paths.add_model_folder_path(category, path)
        registered[category] = path
    return registered
