"""Compact, user-facing execution-path report for Motion Director."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any


SECTION_ORDER = (
    "Run",
    "Previous Context",
    "Latent Scale Lock",
    "Color",
    "Audio Context",
    "Cache",
    "References",
    "Generation",
    "Global Refine",
    "Face Refine",
    "Timing",
    "Preview",
    "Warnings",
    "Final",
)


def segment_list(indices) -> str:
    values = sorted({int(value) for value in indices})
    return ",".join(f"S{value + 1}" for value in values) if values else "none"


def short_fingerprint(value: Any, length: int = 8) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[: max(4, int(length))]


def fmt_float(value: Any) -> str:
    if value is None:
        return "n/a"
    return f"{float(value):.6f}"


def fmt_seconds(value: Any) -> str:
    if value is None:
        return "n/a"
    seconds = max(0.0, float(value))
    if seconds < 60.0:
        return f"{seconds:.2f}s"
    minutes = int(seconds // 60)
    remain = seconds - minutes * 60
    return f"{minutes}m {remain:05.2f}s"


def append_report_section_lines(report: str, section: str, lines) -> str:
    clean = [str(line) for line in lines if str(line).strip()]
    if not clean:
        return str(report or "")
    text = str(report or "").rstrip()
    marker = f"[{section}]"
    payload = "\n".join(clean)
    start = text.find(marker)
    if start < 0:
        return text + f"\n\n{marker}\n{payload}"
    next_section = text.find("\n\n[", start + len(marker))
    if next_section < 0:
        return text + "\n" + payload
    return text[:next_section].rstrip() + "\n" + payload + text[next_section:]


def context_shortfall_warning(segment_slot: int, requested: int, actual: int) -> str | None:
    if int(actual) >= int(requested):
        return None
    return (
        f"S{int(segment_slot) + 1}: requested {int(requested)} context frames "
        f"but only {int(actual)} were usable"
    )


SEED_MODES = frozenset({"fixed", "increment", "decrement", "randomize"})


def normalize_seed_mode(value: Any) -> str:
    """Return ComfyUI's actual seed-control mode without inventing a default."""
    mode = str(value or "").strip().lower()
    return mode if mode in SEED_MODES else "unknown"


def format_effective_references(
    segment_slot: int,
    *,
    ref_images: dict[str, Any] | None,
    ref_videos: dict[str, Any] | None,
    ref_audios: dict[str, Any] | None,
    ref_video_audios: dict[str, Any] | None,
) -> str:
    """Count only reference mappings actually passed to H3 conditioning."""
    return (
        f"S{int(segment_slot) + 1}: Picture x{len(ref_images or {})} / "
        f"Video x{len(ref_videos or {})} / "
        f"Audio x{len(ref_audios or {}) + len(ref_video_audios or {})}"
    )


@dataclass
class DirectorExecutionReport:
    sections: dict[str, list[str]] = field(
        default_factory=lambda: {name: [] for name in SECTION_ORDER}
    )

    def add(self, section: str, *lines: str) -> None:
        bucket = self.sections.setdefault(section, [])
        bucket.extend(str(line) for line in lines if str(line).strip())

    def render(self) -> str:
        blocks = ["Director Report"]
        for name in SECTION_ORDER:
            lines = self.sections.get(name) or []
            if not lines:
                continue
            blocks.append(f"[{name}]\n" + "\n".join(lines))
        return "\n\n".join(blocks)


def format_pin_handoff(
    *,
    from_segment: int,
    to_segment: int,
    requested_frames: int,
    actual_frames: int,
    status: str,
    reason: str = "",
    baseline_source: str | None = None,
    baseline_std: float | None = None,
    before_std: float | None = None,
    scale: float | None = None,
    after_std: float | None = None,
    mean_abs_delta: float | None = None,
    max_abs_delta: float | None = None,
) -> str:
    head = f"S{from_segment + 1} -> S{to_segment + 1}"
    if status != "APPLIED":
        suffix = f"\nPin Renorm: {status}"
        if reason:
            suffix += f"\nReason: {reason}"
        return head + suffix
    return "\n".join(
        (
            head,
            f"baseline: {baseline_source or 'created'}",
            f"frames: requested {int(requested_frames)} / actual {int(actual_frames)}",
            f"baseline_std: {fmt_float(baseline_std)}",
            f"before_std: {fmt_float(before_std)}",
            f"scale: {fmt_float(scale)}",
            f"after_std: {fmt_float(after_std)}",
            f"mean_abs_delta: {fmt_float(mean_abs_delta)}",
            f"max_abs_delta: {fmt_float(max_abs_delta)}",
        )
    )


def format_previous_context(from_segment: int, to_segment: int, diag: dict[str, Any]) -> str:
    visual_source = str(diag.get("visual_source", "none"))
    visual_actual = bool(diag.get("visual") or visual_source == "Source Bridge")
    lines = [
        f"S{from_segment + 1} -> S{to_segment + 1}:",
        f"Visual requested: {'ON' if diag.get('requested_visual') else 'OFF'}",
        f"Visual actual: {'ON' if visual_actual else 'OFF'}",
        f"Visual source: {visual_source}",
        f"Visual reason: {diag.get('visual_reason', 'none')}",
        f"Requested frames: {diag.get('requested_frames', 0)}",
        f"Actual frames: {diag.get('actual_frames', 0)}",
        f"Audio requested: {'ON' if diag.get('requested_audio') else 'OFF'}",
        f"Audio actual: {'ON' if diag.get('audio') else 'OFF'}",
        f"Audio source: {diag.get('audio_source', 'none')}",
        f"Audio reason: {diag.get('audio_reason', 'none')}",
    ]
    if diag.get("bridge_details"):
        lines.append(str(diag["bridge_details"]))
    return "\n".join(lines)


def format_audio_context(from_segment: int, to_segment: int, diag: dict[str, Any]) -> str:
    lines = [
        f"S{from_segment + 1} -> S{to_segment + 1}:",
        f"requested: {'ON' if diag.get('requested_audio') else 'OFF'}",
        f"actual: {'ON' if diag.get('audio') else 'OFF'}",
        f"source: {diag.get('audio_source', 'none')}",
    ]
    if not diag.get("audio"):
        lines.append(f"reason: {diag.get('audio_reason', 'Context Link audio disabled')}")
    return "\n".join(lines)


__all__ = [
    "DirectorExecutionReport",
    "append_report_section_lines",
    "fmt_float",
    "fmt_seconds",
    "context_shortfall_warning",
    "format_audio_context",
    "format_effective_references",
    "format_pin_handoff",
    "format_previous_context",
    "normalize_seed_mode",
    "segment_list",
    "short_fingerprint",
]
