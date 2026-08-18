"""Compact, user-facing execution-path report for Motion Director."""

from __future__ import annotations

import hashlib
import json
import re
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
    "Second Sampling",
    "Upscale",
    "RTX Deblur",
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

    # RTX Deblur now runs inside Global Refine before upscale / second sampling.
    # The legacy node-level final call is intentionally a PRESAMPLE no-op; do not
    # append its duplicate diagnostic block or its meaningless 0.00s timing.
    if section == "RTX Deblur" and any(
        line.strip() == "Status: PRESAMPLE" for line in clean
    ):
        return str(report or "")
    if section == "Timing":
        clean = [
            line for line in clean
            if not line.strip().startswith("RTX Deblur:")
        ]

    if not clean:
        return str(report or "")
    text = str(report or "").rstrip()
    marker = f"[{section}]"
    payload = "\n".join(clean)
    start = text.find(marker)
    if start < 0:
        if section in SECTION_ORDER:
            section_index = SECTION_ORDER.index(section)
            for next_name in SECTION_ORDER[section_index + 1 :]:
                next_marker = f"[{next_name}]"
                next_start = text.find(next_marker)
                if next_start < 0:
                    continue
                prefix = text[:next_start].rstrip()
                suffix = text[next_start:].lstrip()
                return prefix + f"\n\n{marker}\n{payload}\n\n" + suffix
        return text + f"\n\n{marker}\n{payload}"
    next_section = text.find("\n\n[", start + len(marker))
    if next_section < 0:
        return text + "\n" + payload
    return text[:next_section].rstrip() + "\n" + payload + text[next_section:]


def _parse_timing_values(value: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for item in str(value or "").split(","):
        if "=" not in item:
            continue
        key, raw = item.split("=", 1)
        result[key.strip()] = raw.strip()
    return result


def _cache_segment_states(entries: list[str] | None) -> dict[str, str]:
    states: dict[str, str] = {}
    pattern = re.compile(r"^(S\d+):\s*(.+)$")
    for entry in entries or []:
        for raw in str(entry).splitlines():
            match = pattern.match(raw.strip())
            if match:
                states[match.group(1)] = match.group(2).strip()
    return states


def _not_run_reason(cache_state: str | None) -> str:
    state = str(cache_state or "").strip()
    lower = state.lower()
    if "cache hit" in lower:
        return "NOT RUN (cache hit)"
    if "selection skipped" in lower or "passthrough" in lower:
        return "NOT RUN (selection skipped)"
    if state:
        return f"NOT RUN ({state})"
    return "NOT RUN"


def _split_global_refine_sections(
    entries: list[str] | None,
    cache_entries: list[str] | None,
) -> dict[str, list[str]]:
    """Turn the old mixed Global Refine block into stage-specific report blocks."""
    flat: list[str] = []
    for entry in entries or []:
        flat.extend(str(entry).splitlines())
    if not flat:
        return {}

    header: list[str] = []
    segments: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    segment_pattern = re.compile(r"^(S\d+)\s+Status:\s*(.+)$")

    for raw in flat:
        line = raw.strip()
        if not line:
            continue
        match = segment_pattern.match(line)
        if match:
            if current is not None:
                segments.append(current)
            current = {
                "segment": match.group(1),
                "global_status": match.group(2).strip(),
                "lines": [],
            }
            continue
        if current is None:
            header.append(line)
        else:
            current["lines"].append(line)
    if current is not None:
        segments.append(current)

    config: dict[str, str] = {}
    for line in header:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        config[key.strip()] = value.strip()

    for segment in segments:
        values: dict[str, str] = {}
        for line in segment.pop("lines", []):
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            values[key.strip()] = value.strip()
        segment.update(values)
        segment["timings"] = _parse_timing_values(values.get("Timing", ""))

    enabled = config.get("Enabled", "OFF").upper() == "ON"
    cache_states = _cache_segment_states(cache_entries)
    known_ids = {segment["segment"] for segment in segments}
    all_ids = set(known_ids) | set(cache_states)

    def segment_number(segment_id: str) -> int:
        try:
            return int(segment_id[1:])
        except (TypeError, ValueError):
            return 0

    ordered_ids = sorted(all_ids, key=segment_number)
    by_id = {segment["segment"]: segment for segment in segments}

    global_lines = [f"Enabled: {'ON' if enabled else 'OFF'}"]
    if not enabled:
        global_lines.append("Status: DISABLED")
        return {
            "Global Refine": global_lines,
            "Second Sampling": [],
            "Upscale": [],
            "RTX Deblur": [],
        }

    statuses = [str(segment.get("global_status") or "") for segment in segments]
    if any(status == "FAILED" for status in statuses):
        overall = "FAILED"
    elif statuses and all(status == "SKIPPED" for status in statuses):
        overall = "SKIPPED"
    elif statuses and all(status.startswith("SUCCESS") for status in statuses):
        overall = "SUCCESS"
    elif statuses:
        overall = "PARTIAL"
    else:
        overall = "NO_SEGMENTS_RUN"
    global_lines.extend(
        [
            f"Status: {overall}",
            f"Segments: {len(ordered_ids) or len(segments)}",
        ]
    )

    second_enabled = any(
        str(segment.get("Second Sampling") or "OFF").upper() == "ON"
        for segment in segments
    )
    second_lines = [f"Enabled: {'ON' if second_enabled else 'OFF'}"]
    if second_enabled:
        for key in ("Denoise", "Steps", "Seed Mode"):
            if config.get(key):
                second_lines.append(f"{key}: {config[key]}")
    for segment_id in ordered_ids:
        segment = by_id.get(segment_id)
        if segment is None:
            second_lines.append(
                f"{segment_id}: {_not_run_reason(cache_states.get(segment_id))}"
            )
            continue
        if str(segment.get("Second Sampling") or "OFF").upper() != "ON":
            second_lines.append(f"{segment_id}: OFF")
            continue
        state = "FAILED" if segment.get("global_status") == "FAILED" else "SUCCESS"
        timing = segment.get("timings", {}).get("refine_sampling")
        suffix = f" · {timing}" if state == "SUCCESS" and timing else ""
        second_lines.append(f"{segment_id}: {state}{suffix}")

    upscale_enabled = config.get("Mode", "").strip().lower() == "upscale"
    upscale_lines = [f"Enabled: {'ON' if upscale_enabled else 'OFF'}"]
    if upscale_enabled:
        if config.get("Upscale Method"):
            upscale_lines.append(f"Method: {config['Upscale Method']}")
        if config.get("VSR Quality"):
            upscale_lines.append(f"VSR Quality: {config['VSR Quality']}")
    for segment_id in ordered_ids:
        segment = by_id.get(segment_id)
        if segment is None:
            upscale_lines.append(
                f"{segment_id}: {_not_run_reason(cache_states.get(segment_id))}"
            )
            continue
        if not upscale_enabled:
            upscale_lines.append(f"{segment_id}: OFF")
            continue
        state = "FAILED" if segment.get("global_status") == "FAILED" else "SUCCESS"
        line = f"{segment_id}: {state}"
        source = segment.get("Source Resolution")
        target = segment.get("Target Resolution")
        if source and target:
            line += f" · {source} → {target}"
            if segment.get("Scale"):
                line += f" · {segment['Scale']}"
        timing = segment.get("timings", {}).get("upscale")
        if state == "SUCCESS" and timing:
            line += f" · {timing}"
        upscale_lines.append(line)

    deblur_enabled = any(
        str(segment.get("RTX Deblur") or "OFF").upper()
        not in {"OFF", "DISABLED"}
        for segment in segments
    )
    deblur_lines = [f"Enabled: {'ON' if deblur_enabled else 'OFF'}"]
    first_deblur = next(
        (
            segment for segment in segments
            if str(segment.get("RTX Deblur") or "OFF").upper()
            not in {"OFF", "DISABLED"}
        ),
        None,
    )
    if deblur_enabled and first_deblur is not None:
        if first_deblur.get("Quality"):
            deblur_lines.append(f"Quality: {first_deblur['Quality']}")
        if first_deblur.get("Strength"):
            deblur_lines.append(f"Strength: {first_deblur['Strength']}")

    for segment_id in ordered_ids:
        segment = by_id.get(segment_id)
        if segment is None:
            deblur_lines.append(
                f"{segment_id}: {_not_run_reason(cache_states.get(segment_id))}"
            )
            continue
        state = str(segment.get("RTX Deblur") or "OFF").upper()
        if state in {"OFF", "DISABLED"}:
            deblur_lines.append(f"{segment_id}: OFF")
            continue
        deblur_lines.append(f"{segment_id}: {state}")
        if segment.get("Source Resolution"):
            deblur_lines.append(f"  Resolution: {segment['Source Resolution']}")
        for key in ("Mean Delta", "P95 Delta", "Max Delta"):
            if segment.get(key):
                deblur_lines.append(f"  {key}: {segment[key]}")
        timing = segment.get("timings", {}).get("deblur")
        if timing:
            deblur_lines.append(f"  Timing: {timing}")
        if segment.get("Error"):
            deblur_lines.append(f"  Error: {segment['Error']}")
        if segment.get("Fallback"):
            deblur_lines.append(f"  Fallback: {segment['Fallback']}")

    return {
        "Global Refine": global_lines,
        "Second Sampling": second_lines,
        "Upscale": upscale_lines,
        "RTX Deblur": deblur_lines,
    }


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
        sections = {
            name: list(self.sections.get(name) or [])
            for name in SECTION_ORDER
        }
        split = _split_global_refine_sections(
            sections.get("Global Refine"),
            sections.get("Cache"),
        )
        for name, lines in split.items():
            sections[name] = lines

        blocks = ["Director Report"]
        for name in SECTION_ORDER:
            lines = sections.get(name) or []
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
