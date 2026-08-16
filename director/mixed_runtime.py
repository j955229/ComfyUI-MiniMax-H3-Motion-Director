"""Runtime materialization of Mixed Segment Result still references."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import torch


_ROLE_INDEX = {
    "i2v_start": 0,
    "fl2v_first": 0,
    "fl2v_last": 1,
}


def select_result_frame(frames: torch.Tensor, selector: str | int) -> torch.Tensor:
    if not isinstance(frames, torch.Tensor) or frames.ndim != 4 or int(frames.shape[0]) <= 0:
        raise ValueError("Mixed result reference source has no generated IMAGE frames.")
    if selector == "last":
        index = int(frames.shape[0]) - 1
    else:
        index = int(selector)
    if index < 0 or index >= int(frames.shape[0]):
        raise ValueError(
            f"Mixed result reference frame {index} is outside source result "
            f"0..{int(frames.shape[0]) - 1}."
        )
    return frames[index : index + 1]


def _load_matching_cache_any_node(producer, plan) -> torch.Tensor | None:
    """Find an exact producer cache when planning did not receive the runtime node id."""
    try:
        import folder_paths

        from .segment_cache import segment_cache_fingerprint

        expected = segment_cache_fingerprint(producer, plan)
        base = Path(folder_paths.get_output_directory()) / "minimax_seg_cache"
        if not base.is_dir():
            return None
        index = int(producer.index)
        meta_name = f"seg_{index:04d}.meta.json"
        tensor_name = f"seg_{index:04d}.pt"
        for node_root in base.iterdir():
            if not node_root.is_dir():
                continue
            meta_path = node_root / meta_name
            tensor_path = node_root / tensor_name
            if not meta_path.is_file() or not tensor_path.is_file():
                continue
            try:
                stored = json.loads(meta_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if stored != expected:
                continue
            try:
                tensor = torch.load(tensor_path, map_location="cpu", weights_only=True)
            except Exception:
                continue
            if isinstance(tensor, torch.Tensor) and tensor.ndim == 4 and int(tensor.shape[0]) > 0:
                return tensor
    except Exception:
        return None
    return None


class MixedResultRef:
    """SegmentRef-compatible object whose tensor resolves only when conditioning needs it."""

    def __init__(
        self,
        *,
        index: int,
        role: str,
        source_segment_id: str,
        frame: str | int,
        plan,
        node_id: str | None,
    ) -> None:
        self.index = int(index)
        self.role = str(role)
        self.source_segment_id = str(source_segment_id)
        self.frame = frame
        self.asset_id = f"mixed-result:{self.source_segment_id}:{self.frame}:{self.role}"
        self._plan = plan
        self._node_id = str(node_id) if node_id is not None else None
        self._resolved: torch.Tensor | None = None

    def bind_node_id(self, node_id: str | None) -> None:
        if node_id not in (None, ""):
            self._node_id = str(node_id)

    def _source_segment(self):
        for segment in self._plan.segments:
            if str(getattr(segment, "stable_id", "")) == self.source_segment_id:
                return segment
        raise ValueError(
            f"Missing Reference: Mixed source segment {self.source_segment_id!r} no longer exists."
        )

    @property
    def tensor(self) -> torch.Tensor:
        if self._resolved is not None:
            return self._resolved

        from .segment_cache import load_segment_cache

        producer = self._source_segment()
        cached = (
            load_segment_cache(self._node_id, producer, self._plan)
            if self._node_id
            else _load_matching_cache_any_node(producer, self._plan)
        )
        if cached is None:
            raise ValueError(
                f"Mixed dependency unavailable: Segment {getattr(producer, 'timeline_index', producer.index) + 1} "
                f"({self.source_segment_id}) must be generated before it can provide frame {self.frame!r}."
            )
        self._resolved = select_result_frame(cached, self.frame).detach().cpu().float().contiguous()
        return self._resolved


def _source_id_for_ref(plan, consumer_index: int, ref: dict[str, Any]) -> str:
    # Legacy Previous/Earlier compatibility is deliberately handled only by
    # mixed_schema.normalize_mixed_segments(). Runtime receives one stable-ID
    # representation so reorder/delete/selective-run cannot diverge by origin.
    if str(ref.get("origin") or "") != "segment":
        raise ValueError("Invalid Mixed result reference: non-canonical origin reached runtime.")
    source_id = str(ref.get("segmentId") or "").strip()
    if not source_id:
        raise ValueError("Missing Reference: Segment Result has no stable segment id.")

    source_index = next(
        (
            index
            for index, segment in enumerate(plan.segments)
            if str(getattr(segment, "stable_id", "")) == source_id
        ),
        None,
    )
    if source_index is None:
        raise ValueError(f"Missing Reference: Mixed source segment {source_id!r} no longer exists.")
    if source_index >= int(consumer_index):
        raise ValueError(
            f"Invalid Reference: Mixed Segment Result {source_id!r} is not earlier than its consumer."
        )
    return source_id


def _next_identity_slot(refs) -> int:
    used = {int(getattr(ref, "index", -1)) for ref in refs or []}
    for index in range(9):
        if index not in used:
            return index
    raise ValueError("Mixed identity references exceed MiniMax H3 Picture limit (9).")


def attach_mixed_result_refs(plan, *, node_id: str | None) -> None:
    """Attach SegmentRef-compatible lazy stills to compiled Mixed segments."""
    if not bool(getattr(plan, "mixed_mode", False)):
        return

    for consumer_index, seg in enumerate(plan.segments):
        descriptors = list(getattr(seg, "mixed_result_refs", None) or [])
        if not descriptors:
            continue
        for descriptor in descriptors:
            role = str(descriptor.get("role") or "identity")
            source_id = _source_id_for_ref(plan, consumer_index, descriptor)
            frame = descriptor.get("frame", "last")

            if role == "identity":
                if str(getattr(seg, "mixed_mode", "")) not in {"r2v", "source_video"}:
                    raise ValueError(
                        f"Invalid Mixed identity reference on {getattr(seg, 'mixed_mode', '') or seg.task_key}."
                    )
                slot = _next_identity_slot(seg.refs)
            elif role in _ROLE_INDEX:
                slot = _ROLE_INDEX[role]
                expected = {
                    "i2v_start": "i2v",
                    "fl2v_first": "fl2v",
                    "fl2v_last": "fl2v",
                }[role]
                if str(getattr(seg, "mixed_mode", "")) != expected:
                    raise ValueError(f"Invalid Mixed {role} reference on {getattr(seg, 'mixed_mode', '')} segment.")
                seg.refs = [
                    ref
                    for ref in (seg.refs or [])
                    if int(getattr(ref, "index", -1)) != slot
                ]
                if role == "i2v_start":
                    seg.source_clip = None
            else:
                raise ValueError(f"Unsupported Mixed result reference role: {role}.")

            seg.refs.append(
                MixedResultRef(
                    index=slot,
                    role=role,
                    source_segment_id=source_id,
                    frame=frame,
                    plan=plan,
                    node_id=node_id,
                )
            )
        seg.refs = sorted(seg.refs, key=lambda ref: int(getattr(ref, "index", 0)))


def bind_mixed_runtime_node(plan, node_id: str | None) -> None:
    """Bind the actual Comfy execution node id after planning but before sampling."""
    if not bool(getattr(plan, "mixed_mode", False)) or node_id in (None, ""):
        return
    value = str(node_id)
    plan.mixed_node_id = value
    run_selection = getattr(plan, "run_indices", None)
    if hasattr(run_selection, "node_id"):
        run_selection.node_id = value
    for seg in plan.segments:
        for ref in getattr(seg, "refs", None) or []:
            if isinstance(ref, MixedResultRef):
                ref.bind_node_id(value)


__all__ = [
    "MixedResultRef",
    "attach_mixed_result_refs",
    "bind_mixed_runtime_node",
    "select_result_frame",
]
