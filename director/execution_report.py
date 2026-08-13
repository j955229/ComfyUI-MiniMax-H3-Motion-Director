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
    "Warnings",
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
    visual = "ON" if diag["visual"] else f"OFF ({diag['visual_reason']})"
    audio = "ON" if diag["audio"] else f"OFF ({diag['audio_reason']})"
    lines = [
        f"S{from_segment + 1} -> S{to_segment + 1}:",
        f"Visual: {visual}",
        f"Visual source: {diag.get('visual_source', 'none')}",
        f"Requested frames: {diag.get('requested_frames', 0)}",
        f"Actual frames: {diag.get('actual_frames', 0)}",
        f"Audio: {audio}",
        f"Audio source: {diag.get('audio_source', 'none')}",
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
    "fmt_float",
    "format_audio_context",
    "format_pin_handoff",
    "format_previous_context",
    "segment_list",
    "short_fingerprint",
]
