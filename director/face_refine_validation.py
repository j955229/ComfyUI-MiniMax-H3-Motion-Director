"""Fail-fast dependency/model validation for Face Refine."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

import folder_paths


def compatible_sam_models() -> list[str]:
    """Return only checkpoints compatible with Director's Ultralytics SAM backend."""
    try:
        values = folder_paths.get_filename_list("sams") or []
    except Exception:
        values = []
    return sorted(
        dict.fromkeys(
            str(value)
            for value in values
            if str(value).strip().lower().endswith(".pt")
        )
    )


def resolve_sam_model_path(name: str) -> str:
    selected = str(name or "").strip()
    if not selected:
        raise ValueError(
            "Face Refine SAM model is not selected. Put a compatible Ultralytics "
            "SAM/SAM2 .pt checkpoint in ComfyUI/models/sams and select it."
        )
    if not selected.lower().endswith(".pt"):
        raise ValueError(
            "Face Refine integrated SAM accepts Ultralytics .pt checkpoints only; "
            f"got {selected!r}. Meta/Impact-Pack .pth checkpoints are not silently compatible."
        )
    resolver = getattr(folder_paths, "get_full_path", None)
    path = resolver("sams", selected) if resolver else None
    if not path:
        direct = Path(selected)
        if direct.is_file():
            path = str(direct)
    if not path:
        raise FileNotFoundError(
            f"Face Refine SAM model not found: {selected}. Expected under ComfyUI/models/sams."
        )
    return str(path)


def validate_face_refine_runtime(
    config: dict[str, Any],
    *,
    check_runtime: bool = True,
) -> None:
    """Validate expensive Face Refine prerequisites before generation starts."""
    if not bool((config or {}).get("enabled")):
        return
    if str((config or {}).get("mask_mode") or "rect").lower() != "sam":
        return
    resolve_sam_model_path(str((config or {}).get("sam_model") or ""))
    if check_runtime and importlib.util.find_spec("ultralytics") is None:
        raise ImportError(
            "Face Refine SAM requires the optional 'ultralytics' Python package."
        )


__all__ = [
    "compatible_sam_models",
    "resolve_sam_model_path",
    "validate_face_refine_runtime",
]
