"""Dialogue-driven reference audio for MiniMax H3 R2V / RV2V.

This feature deliberately does *not* replace or freeze the target H3 audio
latent.  The selected uploaded speech clip remains a normal
MiniMaxH3ReferenceToVideo ``ref_audio_N`` reference.  Motion Director only adds
an explicit ``partially_copy`` dialogue relationship to the effective prompt,
so H3 can reproduce the spoken content/performance while still generating the
target soundtrack (ambience, Foley/SFX and music) jointly with the video.
"""

from __future__ import annotations

from typing import Any

AUDIO_MODE_GENERATE = "generate"
DIALOGUE_DRIVE_TASKS = frozenset({"r2v", "rv2v"})
_DIALOGUE_BASE_PROMPT_ATTR = "_mmx_dialogue_drive_base_prompt"
_INSTALLED = False


def _drive_config(plan: Any) -> dict[str, Any]:
    raw = getattr(plan, "raw", None) or {}
    value = raw.get("dialogueDrive") or raw.get("dialogue_drive") or {}
    return value if isinstance(value, dict) else {}


def _raw_segment(plan: Any, segment: Any) -> dict[str, Any]:
    raw = getattr(plan, "raw", None) or {}
    segments = raw.get("segments") or []
    index = int(getattr(segment, "timeline_index", getattr(segment, "index", 0)))
    if 0 <= index < len(segments) and isinstance(segments[index], dict):
        return segments[index]
    return {}


def dialogue_drive_asset_id(plan: Any, segment: Any) -> str:
    """Return the stable reference-audio asset id selected for this segment."""
    config = _drive_config(plan)
    if not config:
        return ""

    if str(getattr(plan, "edit_mode", "") or "").strip().lower() == "global":
        return str(
            config.get("globalAssetId")
            or config.get("global_asset_id")
            or ""
        ).strip()

    raw_segment = _raw_segment(plan, segment)
    segment_id = str(raw_segment.get("id") or "").strip()
    assignments = config.get("segmentAssetIds") or config.get("segment_asset_ids") or {}
    if not isinstance(assignments, dict):
        return ""
    if segment_id:
        return str(assignments.get(segment_id) or "").strip()

    # Legacy/fallback key for timelines that predate stable segment ids.
    index = int(getattr(segment, "timeline_index", getattr(segment, "index", 0)))
    return str(assignments.get(str(index)) or "").strip()


def _audio_asset_id(item: Any) -> str:
    return str(getattr(item, "asset_id", "") or "").strip()


def _dialogue_audio(segment: Any, asset_id: str) -> Any | None:
    for item in getattr(segment, "ref_audios", None) or []:
        if _audio_asset_id(item) == asset_id:
            return item
    return None


def dialogue_drive_tag(segment: Any, asset_id: str) -> str:
    """Resolve the exact official ``<Audio N>`` tag for the selected asset."""
    tags = getattr(segment, "reference_tags", None) or {}
    if isinstance(tags, dict):
        exact = tags.get(("audio", asset_id))
        if exact:
            return str(exact)

    item = _dialogue_audio(segment, asset_id)
    if item is None:
        return ""
    index = int(getattr(item, "index", -1))
    return f"<Audio {index + 1}>" if index >= 0 else ""


def dialogue_drive_instruction(tag: str) -> str:
    """Compile the native H3 reference-audio relationship for spoken dialogue."""
    audio_tag = str(tag or "").strip()
    if not audio_tag:
        raise ValueError("Dialogue Drive requires a valid MiniMax <Audio N> tag.")
    return (
        f"{audio_tag}: partially_copy - Treat the complete spoken dialogue in "
        f"{audio_tag} as the target foreground speech performance. The speaking "
        "on-screen subject described by the prompt physically says that dialogue, "
        "with mouth and jaw motion synchronized to its timing. Preserve the spoken "
        "content, original language, voice identity, timing, pauses, cadence, "
        "emotion and delivery; do not paraphrase, translate, omit, reorder or "
        "duplicate the dialogue. Copy only the dialogue/performance layer from the "
        "reference: keep the target H3 audio generative so it may create additional "
        "scene-appropriate ambience, Foley/sound effects and non-diegetic background "
        "music that are not present in the uploaded speech clip."
    )


def prepare_dialogue_drive_plan(
    plan: Any,
    *,
    audio_mode: str = AUDIO_MODE_GENERATE,
) -> list[tuple[int, str, str]]:
    """Apply dialogue-drive prompt semantics before cache fingerprints are built.

    Returns ``[(timeline_index, asset_id, official_tag), ...]`` for active
    segments.  The function is idempotent for a reused plan object.
    """
    active: list[tuple[int, str, str]] = []

    for segment in getattr(plan, "segments", None) or []:
        base_prompt = getattr(segment, _DIALOGUE_BASE_PROMPT_ATTR, None)
        if base_prompt is None:
            base_prompt = str(getattr(segment, "prompt", "") or "")
            setattr(segment, _DIALOGUE_BASE_PROMPT_ATTR, base_prompt)
        else:
            segment.prompt = base_prompt

        task_key = str(getattr(segment, "task_key", "") or "").strip().lower()
        if task_key not in DIALOGUE_DRIVE_TASKS:
            continue

        asset_id = dialogue_drive_asset_id(plan, segment)
        if not asset_id:
            continue

        audio_item = _dialogue_audio(segment, asset_id)
        if audio_item is None:
            index = int(getattr(segment, "timeline_index", getattr(segment, "index", 0)))
            raise ValueError(
                "Motion Director Dialogue Drive: Segment %d is assigned to reference "
                "audio asset %r, but that audio is missing, disabled, or failed to load."
                % (index + 1, asset_id)
            )

        tag = dialogue_drive_tag(segment, asset_id)
        if not tag:
            index = int(getattr(segment, "timeline_index", getattr(segment, "index", 0)))
            raise ValueError(
                "Motion Director Dialogue Drive: could not resolve the effective "
                "<Audio N> tag for Segment %d." % (index + 1)
            )

        instruction = dialogue_drive_instruction(tag)
        segment.prompt = f"{base_prompt.rstrip()}\n\n{instruction}".strip()
        timeline_index = int(
            getattr(segment, "timeline_index", getattr(segment, "index", 0))
        )
        active.append((timeline_index, asset_id, tag))

    if active and str(audio_mode or "").strip().lower() != AUDIO_MODE_GENERATE:
        raise ValueError(
            "Motion Director Dialogue Drive requires audio output mode Generate. "
            "The uploaded speech is a dialogue conditioning reference; H3 must "
            "generate the target audio so ambience, sound effects and music can "
            "exist alongside the driven dialogue."
        )

    return active


def _append_report(result: Any, active: list[tuple[int, str, str]]) -> Any:
    if not active or not isinstance(result, tuple) or len(result) < 4:
        return result
    report = result[3]
    if not isinstance(report, str):
        return result
    lines = [
        "",
        "[Dialogue Drive]",
        "Mode: native Ref2VA dialogue conditioning (target audio remains generated)",
    ]
    for timeline_index, _asset_id, tag in active:
        lines.append(
            f"- Segment {timeline_index + 1}: {tag} partially_copy dialogue; "
            "H3 may generate additional ambience/SFX/music."
        )
    return (*result[:3], report + "\n" + "\n".join(lines), *result[4:])


def install_audio_drive_support() -> None:
    """Install Dialogue Drive before public Director nodes bind executor helpers."""
    global _INSTALLED
    if _INSTALLED:
        return

    from . import audio_export, executor_core

    original_execute = executor_core.execute_director_plan_core

    def execute_director_plan_core(plan, *args, **kwargs):
        audio_mode = audio_export.resolve_audio_mode(plan)
        active = prepare_dialogue_drive_plan(plan, audio_mode=audio_mode)
        result = original_execute(plan, *args, **kwargs)
        return _append_report(result, active)

    executor_core.execute_director_plan_core = execute_director_plan_core
    _INSTALLED = True


__all__ = [
    "AUDIO_MODE_GENERATE",
    "DIALOGUE_DRIVE_TASKS",
    "dialogue_drive_asset_id",
    "dialogue_drive_instruction",
    "dialogue_drive_tag",
    "install_audio_drive_support",
    "prepare_dialogue_drive_plan",
]
