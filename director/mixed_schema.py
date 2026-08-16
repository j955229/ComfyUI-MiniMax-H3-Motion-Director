"""Pure schema and dependency rules for the Director Mixed meta-mode.

This module intentionally has no ComfyUI imports so validation can run in tests
and in frontend-adjacent tooling without loading model/runtime code.
"""

from __future__ import annotations

import copy
import math
from typing import Iterable, Mapping, Sequence

MIXED_SCHEMA_VERSION = 1
MIXED_USER_MODES = ("t2v", "i2v", "fl2v", "r2v", "source_video")
_RESULT_REF_ROLES = frozenset({"identity", "i2v_start", "fl2v_first", "fl2v_last"})


class MixedSchemaError(ValueError):
    """Raised when persisted Mixed state would have ambiguous runtime semantics."""


def normalize_mixed_mode(value: object) -> str:
    raw = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "text_to_video": "t2v",
        "image_to_video": "i2v",
        "first_last": "fl2v",
        "first_last_frame": "fl2v",
        "reference_to_video": "r2v",
        "source": "source_video",
        "sourcevideo": "source_video",
        "v2v": "source_video",
        "rv2v": "source_video",
    }
    mode = aliases.get(raw, raw)
    if mode not in MIXED_USER_MODES:
        raise MixedSchemaError(
            f"Unsupported Mixed segment mode {value!r}; expected one of "
            f"{', '.join(MIXED_USER_MODES)}."
        )
    return mode


def backend_task_key(mode: object, *, identity_count: int = 0) -> str:
    """Compile a user-facing Mixed mode to an existing H3 backend task key."""
    normalized = normalize_mixed_mode(mode)
    if normalized == "source_video":
        return "rv2v" if max(0, int(identity_count or 0)) > 0 else "v2v"
    return normalized


def _align_minimax_visible_frames(frame_count: int) -> int:
    """Small pure copy of H3's 17k+5 visible-generation grid."""
    count = max(1, int(frame_count))
    if count <= 5:
        return 5
    return 5 + 17 * int(math.ceil((count - 5) / 17.0))


def mixed_visible_frame_count(segment: Mapping[str, object], fps: float) -> int:
    """Compile user duration/range to visible output frames.

    Source Video is intentionally *not* stretched onto the H3 grid: its selected
    source range defines the visible segment duration. The executor may
    internally over-generate/pad to a legal H3 length and trims back to this
    visible count, matching standalone source-video behavior.
    """
    mode = normalize_mixed_mode(segment.get("mode"))
    rate = max(0.001, float(fps or 24.0))
    if mode == "source_video":
        source = (segment.get("inputs") or {}).get("sourceVideo") or {}
        source_range = source.get("range") or {}
        try:
            start = float(source_range.get("startSec", 0.0))
            end = float(source_range.get("endSec", 0.0))
        except (TypeError, ValueError) as exc:
            raise MixedSchemaError("Source Video range must contain numeric startSec/endSec.") from exc
        if start < 0 or end <= start:
            raise MixedSchemaError("Source Video range must satisfy 0 <= startSec < endSec.")
        return max(4, int(round((end - start) * rate)))

    explicit = int(segment.get("frameCount") or segment.get("frame_count") or 0)
    if explicit > 0:
        return explicit
    seconds = max(0.1, float(segment.get("duration") or 5.0))
    return _align_minimax_visible_frames(max(5, int(round(seconds * rate))))


def effective_mixed_continuity(segment: Mapping[str, object], segment_index: int) -> dict[str, bool]:
    """Compile per-segment continuity before global runtime masters are applied."""
    if int(segment_index) <= 0:
        return {"visual": False, "audio": False}
    continuity = segment.get("continuity") or {}
    visual = bool(continuity.get("visual", False))
    audio = bool(continuity.get("audio", False))

    if normalize_mixed_mode(segment.get("mode")) == "i2v":
        inputs = segment.get("inputs") or {}
        has_static_start = bool(inputs.get("startFrame") or inputs.get("start_frame"))
        has_result_start = any(
            str(ref.get("role") or "") == "i2v_start"
            for ref in (inputs.get("resultRefs") or inputs.get("result_refs") or [])
            if isinstance(ref, Mapping)
        )
        if has_static_start or has_result_start:
            visual = False
    return {"visual": visual, "audio": audio}


def _normalize_frame(value: object) -> str | int:
    if value is None or value == "":
        return "last"
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"last", "end", "last_frame"}:
            return "last"
        try:
            value = int(text)
        except ValueError as exc:
            raise MixedSchemaError(f"Invalid result frame selector: {value!r}.") from exc
    try:
        index = int(value)
    except (TypeError, ValueError) as exc:
        raise MixedSchemaError(f"Invalid result frame selector: {value!r}.") from exc
    if index < 0:
        raise MixedSchemaError("Result frame index must be >= 0 or 'last'.")
    return index


def normalize_result_reference(value: Mapping[str, object]) -> dict:
    if not isinstance(value, Mapping):
        raise MixedSchemaError("Result reference must be an object.")

    role = str(value.get("role") or "identity").strip().lower().replace("-", "_")
    if role not in _RESULT_REF_ROLES:
        raise MixedSchemaError(f"Unsupported result reference role: {role!r}.")

    origin_raw = str(value.get("origin") or "").strip().lower().replace("-", "_").replace(" ", "_")
    origin_aliases = {
        "previous_segment": "previous",
        "prev": "previous",
        "earlier_segment": "earlier",
        "segment": "earlier",
        "specific_segment": "earlier",
    }
    origin = origin_aliases.get(origin_raw, origin_raw)
    if origin not in {"previous", "earlier"}:
        raise MixedSchemaError(
            f"Invalid result reference origin {origin_raw!r}; expected previous or earlier."
        )

    out = {
        "role": role,
        "origin": origin,
        "frame": _normalize_frame(value.get("frame", value.get("frameIndex", "last"))),
    }
    if origin == "earlier":
        segment_id = str(
            value.get("segmentId") or value.get("segment_id") or value.get("sourceSegmentId") or ""
        ).strip()
        if not segment_id:
            raise MixedSchemaError("Earlier Segment result reference requires segmentId.")
        out["segmentId"] = segment_id
    return out


def _normalize_source_video(inputs: dict) -> None:
    source = inputs.get("sourceVideo") or inputs.get("source_video")
    if not isinstance(source, Mapping):
        raise MixedSchemaError("Source Video required for Mixed Source Video segment.")
    source = copy.deepcopy(dict(source))

    # The material library deliberately owns Reference Video assets only. Even
    # if a library item has already been materialized into ComfyUI input, its
    # stable asset/library identity must not silently change its semantics into
    # a Mixed Source Video.
    if any(
        source.get(key) not in (None, "")
        for key in ("assetId", "asset_id", "libraryId", "library_id", "materialId", "material_id")
    ):
        raise MixedSchemaError(
            "Material Library Video cannot be used as Mixed Source Video; "
            "upload/select a segment-local Source Video instead."
        )

    has_source = bool(
        str(
            source.get("videoFile")
            or source.get("fileName")
            or source.get("path")
            or source.get("sourceId")
            or ""
        ).strip()
    )
    if not has_source:
        raise MixedSchemaError("Source Video required for Mixed Source Video segment.")

    raw_range = source.get("range") or inputs.get("sourceRange") or inputs.get("source_range")
    if not isinstance(raw_range, Mapping):
        raise MixedSchemaError("Source Video range required for Mixed Source Video segment.")
    try:
        start = float(raw_range.get("startSec", raw_range.get("start", 0.0)))
        end = float(raw_range.get("endSec", raw_range.get("end")))
    except (TypeError, ValueError) as exc:
        raise MixedSchemaError("Source Video range must contain numeric startSec/endSec.") from exc
    if start < 0 or end <= start:
        raise MixedSchemaError("Source Video range must satisfy 0 <= startSec < endSec.")
    source["range"] = {"startSec": start, "endSec": end}
    inputs["sourceVideo"] = source
    inputs.pop("source_video", None)
    inputs.pop("sourceRange", None)
    inputs.pop("source_range", None)


def _identity_count(inputs: Mapping[str, object], result_refs: Sequence[Mapping[str, object]]) -> int:
    static = inputs.get("identityPictures") or inputs.get("identity_pictures") or []
    if not isinstance(static, Sequence) or isinstance(static, (str, bytes, bytearray)):
        static_count = 0
    else:
        static_count = len(static)
    dynamic_count = sum(1 for ref in result_refs if ref.get("role") == "identity")
    return static_count + dynamic_count


def normalize_mixed_segments(values: Sequence[Mapping[str, object]]) -> list[dict]:
    if not isinstance(values, Sequence) or isinstance(values, (str, bytes, bytearray)):
        raise MixedSchemaError("Mixed segments must be an ordered list.")
    if not values:
        raise MixedSchemaError("Mixed timeline requires at least one segment.")

    normalized: list[dict] = []
    seen: set[str] = set()

    for index, raw in enumerate(values):
        if not isinstance(raw, Mapping):
            raise MixedSchemaError(f"Mixed Segment {index + 1} must be an object.")
        segment_id = str(raw.get("id") or raw.get("segmentId") or "").strip()
        if not segment_id:
            raise MixedSchemaError(f"Mixed Segment {index + 1} requires a stable segment id.")
        if segment_id in seen:
            raise MixedSchemaError(f"Duplicate segment id: {segment_id}.")
        seen.add(segment_id)

        mode = normalize_mixed_mode(raw.get("mode"))
        inputs_raw = raw.get("inputs") or {}
        if not isinstance(inputs_raw, Mapping):
            raise MixedSchemaError(f"Mixed Segment {index + 1} inputs must be an object.")
        inputs = copy.deepcopy(dict(inputs_raw))

        refs_raw = inputs.get("resultRefs") or inputs.get("result_refs") or []
        if not isinstance(refs_raw, Sequence) or isinstance(refs_raw, (str, bytes, bytearray)):
            raise MixedSchemaError(f"Mixed Segment {index + 1} resultRefs must be a list.")
        result_refs = [normalize_result_reference(ref) for ref in refs_raw]
        inputs["resultRefs"] = result_refs
        inputs.pop("result_refs", None)

        if mode == "source_video":
            _normalize_source_video(inputs)

        continuity_raw = raw.get("continuity") or {}
        if not isinstance(continuity_raw, Mapping):
            raise MixedSchemaError(f"Mixed Segment {index + 1} continuity must be an object.")
        continuity = {
            "visual": bool(continuity_raw.get("visual", False)),
            "audio": bool(continuity_raw.get("audio", False)),
        }
        if index == 0:
            continuity = {"visual": False, "audio": False}

        identity_count = _identity_count(inputs, result_refs)
        normalized.append(
            {
                **copy.deepcopy(dict(raw)),
                "id": segment_id,
                "mode": mode,
                "inputs": inputs,
                "continuity": continuity,
                "backendTask": backend_task_key(mode, identity_count=identity_count),
            }
        )
    return normalized


def _id_index(segments: Sequence[Mapping[str, object]]) -> dict[str, int]:
    return {str(segment["id"]): index for index, segment in enumerate(segments)}


def collect_dependency_indices(
    segments: Sequence[Mapping[str, object]],
    consumer_index: int,
) -> tuple[int, ...]:
    """Return direct result/continuity producers for one consumer segment."""
    if consumer_index < 0 or consumer_index >= len(segments):
        raise MixedSchemaError(f"Mixed consumer index out of range: {consumer_index}.")

    consumer = segments[consumer_index]
    dependencies: set[int] = set()
    id_to_index = _id_index(segments)

    inputs = consumer.get("inputs") or {}
    refs = inputs.get("resultRefs") or []
    for ref in refs:
        origin = ref.get("origin")
        if origin == "previous":
            if consumer_index <= 0:
                raise MixedSchemaError(
                    f"Missing Reference: Segment {consumer.get('id')} has no previous segment."
                )
            dependencies.add(consumer_index - 1)
            continue

        source_id = str(ref.get("segmentId") or "").strip()
        source_index = id_to_index.get(source_id)
        if source_index is None:
            raise MixedSchemaError(
                f"Missing Reference: Segment {consumer.get('id')} references deleted/unknown "
                f"segment {source_id!r}."
            )
        if source_index >= consumer_index:
            raise MixedSchemaError(
                f"Invalid Reference: Segment {consumer.get('id')} can only reference an "
                f"Earlier Segment; {source_id!r} is not earlier after reorder."
            )
        dependencies.add(source_index)

    continuity = consumer.get("continuity") or {}
    if consumer_index > 0 and (bool(continuity.get("visual")) or bool(continuity.get("audio"))):
        dependencies.add(consumer_index - 1)

    return tuple(sorted(dependencies))


def expand_run_selection(
    segments: Sequence[Mapping[str, object]],
    selected_indices: Iterable[int],
) -> tuple[int, ...]:
    """Expand a selective run to its full backward-only dependency closure."""
    wanted = {int(index) for index in selected_indices}
    if not wanted:
        return ()
    for index in wanted:
        if index < 0 or index >= len(segments):
            raise MixedSchemaError(f"Mixed run selection index out of range: {index}.")

    stack = list(wanted)
    while stack:
        consumer = stack.pop()
        for producer in collect_dependency_indices(segments, consumer):
            if producer not in wanted:
                wanted.add(producer)
                stack.append(producer)
    return tuple(sorted(wanted))


def dependency_identity(
    segments: Sequence[Mapping[str, object]],
    consumer_index: int,
) -> dict:
    """Canonical dependency descriptor suitable for cache fingerprint input."""
    if consumer_index < 0 or consumer_index >= len(segments):
        raise MixedSchemaError(f"Mixed consumer index out of range: {consumer_index}.")
    consumer = segments[consumer_index]
    refs = [dict(ref) for ref in ((consumer.get("inputs") or {}).get("resultRefs") or [])]
    continuity = consumer.get("continuity") or {}
    continuity_identity = None
    if consumer_index > 0 and (bool(continuity.get("visual")) or bool(continuity.get("audio"))):
        continuity_identity = {
            "sourceSegmentId": str(segments[consumer_index - 1]["id"]),
            "visual": bool(continuity.get("visual")),
            "audio": bool(continuity.get("audio")),
        }
    return {
        "segmentId": str(consumer["id"]),
        "resultRefs": refs,
        "continuity": continuity_identity,
    }
