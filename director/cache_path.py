"""Shared filesystem-safe cache path helpers for ComfyUI node IDs."""

from __future__ import annotations

from pathlib import Path


def cache_node_dir_name(node_id: object) -> str:
    """Convert ComfyUI compound node IDs into Windows-safe directory names."""
    return str(node_id).replace(":", "_")


def cache_root(output_directory: str | Path, cache_name: str, node_id: object) -> Path:
    """Create and return the cache directory for one Director node."""
    root = Path(output_directory) / cache_name / cache_node_dir_name(node_id)
    root.mkdir(parents=True, exist_ok=True)
    return root
