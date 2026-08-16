from __future__ import annotations

SOURCE_FREE_GENERATION_TASKS = frozenset({"t2v", "r2v"})


def is_source_free_generation_task(task_key: str) -> bool:
    """Return True when H3 generation does not consume pixel source frames."""
    return str(task_key or "").strip().lower() in SOURCE_FREE_GENERATION_TASKS


__all__ = ["SOURCE_FREE_GENERATION_TASKS", "is_source_free_generation_task"]
