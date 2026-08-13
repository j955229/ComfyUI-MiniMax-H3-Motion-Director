"""Per-boundary Previous Context policy for Director segments.

The link is stored on the *consumer* segment: Segment N's link describes which
outputs it accepts from Segment N-1.  ``None`` is intentionally distinct from
an explicit disabled link so workflows saved before this schema can retain the
old global Motion/Audio Context behaviour.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


CONTEXT_LINK_SCHEMA = "previous_context_link_v1"


def _as_bool(value: Any, fallback: bool = False) -> bool:
    if value is None:
        return bool(fallback)
    if value is False or value == 0:
        return False
    if isinstance(value, str) and value.strip().lower() in {"0", "false", "off", "no"}:
        return False
    return True


@dataclass(frozen=True)
class ContextLink:
    enabled: bool
    visual: bool
    audio: bool
    explicit: bool = True

    @property
    def visual_enabled(self) -> bool:
        return bool(self.enabled and self.visual)

    @property
    def audio_enabled(self) -> bool:
        return bool(self.enabled and self.audio)

    @property
    def has_dependency(self) -> bool:
        return self.visual_enabled or self.audio_enabled

    def as_payload(self) -> dict[str, Any]:
        return {
            "schema": CONTEXT_LINK_SCHEMA,
            "enabled": bool(self.enabled),
            "visual": bool(self.visual),
            "audio": bool(self.audio),
        }


@dataclass(frozen=True)
class ResolvedContextLink:
    visual: bool
    audio: bool
    explicit: bool
    visual_reason: str = ""
    audio_reason: str = ""

    @property
    def has_dependency(self) -> bool:
        return bool(self.visual or self.audio)


def parse_context_link(segment: dict[str, Any] | None, segment_index: int) -> ContextLink | None:
    """Parse a saved consumer link; missing means legacy global fallback."""
    if int(segment_index) <= 0:
        return ContextLink(enabled=False, visual=False, audio=False, explicit=True)
    raw = (segment or {}).get("contextLink")
    if raw is None:
        raw = (segment or {}).get("context_link")
    if not isinstance(raw, dict):
        return None
    enabled = _as_bool(raw.get("enabled"), True)
    visual = _as_bool(raw.get("visual"), enabled)
    audio = _as_bool(raw.get("audio"), enabled)
    return ContextLink(
        enabled=enabled and (visual or audio),
        visual=visual,
        audio=audio,
        explicit=True,
    )


def resolve_context_link(
    segment,
    *,
    motion_context_enabled: bool,
    audio_context_enabled: bool,
    audio_generate: bool,
    source_bridge_active: bool,
) -> ResolvedContextLink:
    """Resolve explicit per-boundary state or the exact legacy global fallback.

    Source Bridge only owns the visual path.  Explicit I2V source images also
    reset visual motion, but neither rule suppresses an explicitly requested
    audio continuation.
    """
    slot = int(getattr(segment, "timeline_index", getattr(segment, "index", 0)))
    if slot <= 0:
        return ResolvedContextLink(False, False, True, "first segment", "first segment")

    link = getattr(segment, "context_link", None)
    explicit_i2v_image = bool(
        str(getattr(segment, "task_key", "")).lower() == "i2v"
        and getattr(segment, "source_clip", None) is not None
    )

    if link is None:
        visual = bool(motion_context_enabled and not source_bridge_active and not explicit_i2v_image)
        audio = bool(visual and audio_context_enabled and audio_generate)
        return ResolvedContextLink(
            visual,
            audio,
            False,
            "legacy global Motion Context" if visual else "legacy global policy off",
            "legacy global Audio Context" if audio else "legacy global policy off",
        )

    visual = bool(link.visual_enabled)
    audio = bool(link.audio_enabled)
    visual_reason = "per-boundary link"
    audio_reason = "per-boundary link"
    if source_bridge_active and visual:
        visual = False
        visual_reason = "Source Bridge owns visual continuity"
    if explicit_i2v_image and visual:
        visual = False
        visual_reason = "explicit I2V image resets visual context"
    if audio and not audio_generate:
        audio = False
        audio_reason = "output audio mode is not generate"
    return ResolvedContextLink(visual, audio, True, visual_reason, audio_reason)


def context_link_identity(segment) -> dict[str, Any] | None:
    link = getattr(segment, "context_link", None)
    return link.as_payload() if isinstance(link, ContextLink) else None


__all__ = [
    "CONTEXT_LINK_SCHEMA",
    "ContextLink",
    "ResolvedContextLink",
    "context_link_identity",
    "parse_context_link",
    "resolve_context_link",
]
