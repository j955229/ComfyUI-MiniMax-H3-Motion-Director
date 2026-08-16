"""Planner for the Director Mixed meta-mode.

Mixed is deliberately not an H3 task. This planner validates the versioned
Mixed timeline and compiles each user-facing segment into the existing
SegmentPlan task keys used by the normal executor.
"""

from __future__ import annotations

import copy
from typing import Any, Mapping

import torch

from .mixed_schema import (
    backend_task_key,
    dependency_identity,
    effective_mixed_continuity,
    expand_run_selection,
    mixed_visible_frame_count,
    normalize_mixed_segments,
)


def is_mixed_timeline(timeline: Mapping[str, Any] | None, task_key: str = "") -> bool:
    if str(task_key or "").strip().lower() == "mixed":
        return True
    if not isinstance(timeline, Mapping):
        return False
    if str(timeline.get("timelineMode") or "").strip().lower() == "mixed":
        return True
    nested = timeline.get("mixedTimeline")
    return isinstance(nested, Mapping) and str(nested.get("timelineMode") or "mixed").lower() == "mixed"


def _mixed_root(timeline: Mapping[str, Any]) -> dict[str, Any]:
    nested = timeline.get("mixedTimeline")
    if isinstance(nested, Mapping):
        merged = copy.deepcopy(dict(timeline))
        mixed = copy.deepcopy(dict(nested))
        for key in (
            "output",
            "frameRate",
            "width",
            "height",
            "refMaxSize",
            "runSelectEnabled",
            "runSelection",
            "nodeId",
        ):
            if key not in mixed and key in merged:
                mixed[key] = copy.deepcopy(merged[key])
        return mixed
    return copy.deepcopy(dict(timeline))


def _duration_frames(segment: Mapping[str, Any], fps: float) -> int:
    return mixed_visible_frame_count(segment, fps)


def _static_image_ref(raw: Any, index: int):
    if not isinstance(raw, Mapping):
        return None
    from .plan import SegmentRef, load_reference_tensor

    tensor = load_reference_tensor(dict(raw))
    if tensor is None or int(tensor.shape[0]) <= 0:
        return None
    return SegmentRef(
        index=int(index),
        tensor=tensor[:1],
        asset_id=str(
            raw.get("assetId")
            or raw.get("asset_id")
            or raw.get("id")
            or f"mixed-picture-{index}"
        ),
    )


def _load_source_clip(
    source: Mapping[str, Any],
    timeline: dict,
    frame_count: int,
    fps: float,
) -> torch.Tensor:
    from ..lib.video_io import load_reference_video_clip

    source_range = source.get("range") or {}
    start_sec = max(0.0, float(source_range.get("startSec") or 0.0))
    start_frame = max(0, int(round(start_sec * fps)))
    clip = load_reference_video_clip(
        dict(source),
        timeline,
        frame_count,
        start_frame=start_frame,
    )
    if clip is None or int(clip.shape[0]) <= 0:
        raise ValueError("Source Video required: selected source range could not be decoded.")
    return clip


def build_mixed_director_plan(
    timeline: Mapping[str, Any],
    *,
    global_task_type: str,
    global_prompt: str,
    total_frames: int,
    frame_rate: float,
    width: int,
    height: int,
    ref_max_size: int,
    node_id: str | None = None,
):
    """Validate Mixed state and compile it to the existing DirectorPlan model."""
    from ..lib.image_prep import resolve_output_dimensions
    from .context_links import ContextLink
    from .plan import (
        DirectorPlan,
        SegmentPlan,
        _load_ref_audios,
        _load_ref_videos,
        _load_refs,
        _parse_run_selection,
        _resolve_export_mode,
        _run_selection_enabled,
    )

    mixed = _mixed_root(timeline)
    effective_node_id = (
        str(node_id).strip()
        if node_id not in (None, "")
        else str(mixed.get("nodeId") or mixed.get("node_id") or "").strip()
    ) or None
    normalized = normalize_mixed_segments(mixed.get("segments") or [])
    fps = float(mixed.get("frameRate") or frame_rate or 24.0)

    output = mixed.get("output") or {}
    output_mode = str(output.get("mode") or "fixed").strip().lower()
    if output_mode not in {"fixed", "long_edge"}:
        output_mode = "fixed"
    requested_w = int(output.get("width") or mixed.get("width") or width or 864)
    requested_h = int(output.get("height") or mixed.get("height") or height or 480)
    long_edge = int(
        output.get("longEdge")
        or output.get("long_edge")
        or mixed.get("refMaxSize")
        or ref_max_size
        or 864
    )
    out_w, out_h, resolved_ref_max, output_mode = resolve_output_dimensions(
        requested_w,
        requested_h,
        mode=output_mode,
        long_edge=long_edge,
        fixed_width=requested_w,
        fixed_height=requested_h,
    )

    segments: list[SegmentPlan] = []
    cursor = 0
    for index, spec in enumerate(normalized):
        mode = str(spec["mode"])
        inputs = spec.get("inputs") or {}
        result_refs = list(inputs.get("resultRefs") or [])
        frame_count = _duration_frames(spec, fps)
        start = cursor
        end = start + frame_count
        cursor = end

        task_key = str(spec.get("backendTask") or backend_task_key(mode))
        prompt = str(spec.get("prompt") or global_prompt or "")
        refs = []
        ref_videos = []
        ref_audios = []
        source_clip = None

        if mode == "i2v":
            start_ref = _static_image_ref(
                inputs.get("startFrame") or inputs.get("start_frame"),
                0,
            )
            if start_ref is not None:
                source_clip = start_ref.tensor[:1].clone()

        elif mode == "fl2v":
            first = _static_image_ref(
                inputs.get("firstFrame") or inputs.get("first_frame"),
                0,
            )
            last = _static_image_ref(
                inputs.get("lastFrame") or inputs.get("last_frame"),
                1,
            )
            refs = [item for item in (first, last) if item is not None]

        elif mode == "r2v":
            refs = _load_refs(inputs.get("pictures") or inputs.get("refs") or [])
            ref_videos = _load_ref_videos(
                inputs.get("referenceVideos")
                or inputs.get("refVideos")
                or inputs.get("ref_videos")
                or [],
                mixed,
                max(5, frame_count),
            )
            ref_audios = _load_ref_audios(
                inputs.get("referenceAudios")
                or inputs.get("refAudios")
                or inputs.get("ref_audios")
                or []
            )

        elif mode == "source_video":
            source = inputs.get("sourceVideo") or {}
            source_clip = _load_source_clip(source, mixed, frame_count, fps)
            refs = _load_refs(
                inputs.get("identityPictures")
                or inputs.get("identity_pictures")
                or []
            )
            ref_audios = _load_ref_audios(
                inputs.get("referenceAudios")
                or inputs.get("refAudios")
                or inputs.get("ref_audios")
                or []
            )

        continuity = effective_mixed_continuity(spec, index)
        context_link = ContextLink(
            enabled=bool(continuity["visual"] or continuity["audio"]),
            visual=bool(continuity["visual"]),
            audio=bool(continuity["audio"]),
            explicit=True,
        )

        seg = SegmentPlan(
            index=index,
            start_frame=start,
            end_frame=end,
            prompt=prompt,
            task_type=task_key,
            task_key=task_key,
            use_global=False,
            refs=refs,
            ref_audios=ref_audios,
            ref_videos=ref_videos,
            source_clip=source_clip,
            context_link=context_link,
        )
        seg.stable_id = str(spec["id"])
        seg.mixed_mode = mode
        seg.mixed_result_refs = copy.deepcopy(result_refs)
        seg.mixed_dependency_identity = dependency_identity(normalized, index)
        segments.append(seg)

    raw = copy.deepcopy(dict(timeline))
    raw["timelineMode"] = "mixed"
    raw["segments"] = copy.deepcopy(normalized)
    raw["totalFrames"] = cursor
    raw["frameRate"] = fps
    raw["output"] = copy.deepcopy(output)
    if effective_node_id:
        raw["nodeId"] = effective_node_id

    parsed_run_indices = _parse_run_selection(raw, len(segments))
    selected = (
        set(parsed_run_indices)
        if parsed_run_indices is not None
        else set(range(len(segments)))
    )
    dependency_closure = expand_run_selection(normalized, selected)

    plan = DirectorPlan(
        frame_rate=fps,
        total_frames=cursor or int(total_frames or 1),
        width=out_w,
        height=out_h,
        ref_max_size=resolved_ref_max,
        output_mode=output_mode,
        source_width=out_w,
        source_height=out_h,
        global_task_type=global_task_type,
        global_task_key="mixed",
        global_prompt=global_prompt or "",
        global_refs=[],
        source_video=torch.zeros((0, 16, 16, 3), dtype=torch.float32),
        segments=segments,
        edit_mode="segment",
        raw=raw,
        export_mode=_resolve_export_mode(output),
        run_indices=parsed_run_indices,
        run_select_enabled=_run_selection_enabled(raw),
    )
    plan.mixed_mode = True
    plan.mixed_schema_version = 1
    plan.mixed_segments = normalized
    plan.mixed_dependency_closure = frozenset(dependency_closure)
    plan.mixed_requested_run_indices = parsed_run_indices
    plan.mixed_node_id = effective_node_id
    plan.source_overlap_frames = 0

    if parsed_run_indices is not None:
        from .mixed_selection import MixedRunSelection

        plan.run_indices = MixedRunSelection(
            plan=plan,
            segments=normalized,
            requested=set(parsed_run_indices),
            node_id=effective_node_id,
        )

    from .mixed_runtime import attach_mixed_result_refs

    attach_mixed_result_refs(plan, node_id=effective_node_id)
    return plan


__all__ = ["build_mixed_director_plan", "is_mixed_timeline"]
