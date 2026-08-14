"""Persistent Director post-processing configuration and migration helpers.

The entire configuration is stored in one append-only STRING widget.  Keeping
the public Python inputs stable is important because old ComfyUI workflows save
``widgets_values`` by position.
"""

from __future__ import annotations

import copy
import json
import math
from typing import Any


POSTPROCESS_CONFIG_VERSION = 2
CANVAS_MULTIPLE = 32

DEFAULT_POSTPROCESS_CONFIG: dict[str, Any] = {
    "version": POSTPROCESS_CONFIG_VERSION,
    "global_refine": {
        "enabled": False,
        "mode": "refine",
        "denoise": 0.25,
        "steps": 0,
        "seed_mode": "inherit",
        "seed_offset": 1,
        "skip_fl2v": False,
        "upscale_method": "lanczos",
        "upscale_model": "",
        "resolution_mode": "follow_director",
        "aspect": "16:9",
        "megapixels": 1.0,
        "width": 1376,
        "height": 768,
    },
    "face_refine": {
        "enabled": False,
        "detector": "ultralytics",
        "detector_model": "",
        "confidence": 0.35,
        "select": "largest",
        "crop_factor": 2.0,
        "canvas_mode": "auto_capped_768",
        "canvas_size": 768,
        "smooth_method": "gaussian",
        "smooth_window": 9,
        "size_smooth_window": 13,
        "size_mode": "adaptive",
        "adaptive": True,
        "base_denoise": 0.22,
        "strength_small_face": 0.35,
        "strength_large_face": 0.16,
        "face_px_small": 96,
        "face_px_large": 320,
        "mask_mode": "rect",
        "paste_region": "face_rect",
        "feather": 0.12,
        "colour_match": True,
        "blend": 1.0,
        "undetected_frames": "fade",
        "identity_reference": "",
        "identity_track": False,
        "identity_threshold": 0.35,
        "fallback_detector": "none",
        "fallback_head_frac": 0.34,
        "gamma": 1.0,
        "denoise_smooth": 5,
        "mask_dilation": 0.06,
        "feather_scales_with_crop": True,
        "sam_model": "",
        "sam_threshold": 0.5,
        "sam_dilation": 0.04,
        "sam_temporal_smooth": 5,
    },
    "preview": {
        "enabled": True,
        "preview_frames": 8,
        "preview_fps": 12,
        "max_resolution": 1024,
        "jpeg_quality": 80,
        "preview_every": 1,
    },
    "save": {
        "auto_save": False,
        "filename_prefix": "video/MiniMaxH3_Director",
        "format": "auto",
        "codec": "auto",
        "encoding": "auto",
        "crf": 23,
    },
}


def _bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"1", "true", "yes", "on"}:
            return True
        if text in {"0", "false", "no", "off", ""}:
            return False
    if value is None:
        return default
    return bool(value)


def _choice(value: Any, choices: set[str], default: str) -> str:
    text = str(value or "").strip().lower().replace(" ", "_")
    return text if text in choices else default


def _int(value: Any, default: int, low: int, high: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(low, min(high, parsed))


def _float(value: Any, default: float, low: float, high: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = default
    if not math.isfinite(parsed):
        parsed = default
    return max(low, min(high, parsed))


def _snap(value: int, multiple: int = CANVAS_MULTIPLE) -> int:
    return max(multiple, int(round(int(value) / multiple)) * multiple)


def normalize_postprocess_config(raw: Any) -> dict[str, Any]:
    """Parse current and legacy values into a complete, bounded config."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw) if raw.strip() else {}
        except (TypeError, ValueError, json.JSONDecodeError):
            raw = {}
    if not isinstance(raw, dict):
        raw = {}

    result = copy.deepcopy(DEFAULT_POSTPROCESS_CONFIG)
    g_raw = raw.get("global_refine") or raw.get("globalRefine") or {}
    f_raw = raw.get("face_refine") or raw.get("faceRefine") or {}
    p_raw = raw.get("preview") or raw.get("director_preview") or {}
    s_raw = raw.get("save") or raw.get("video_save") or {}
    if not isinstance(g_raw, dict):
        g_raw = {}
    if not isinstance(f_raw, dict):
        f_raw = {}
    if not isinstance(p_raw, dict):
        p_raw = {}
    if not isinstance(s_raw, dict):
        s_raw = {}

    g = result["global_refine"]
    g["enabled"] = _bool(g_raw.get("enabled"), False)
    g["mode"] = _choice(g_raw.get("mode"), {"refine", "upscale"}, "refine")
    g["denoise"] = _float(g_raw.get("denoise"), 0.25, 0.01, 1.0)
    g["steps"] = _int(g_raw.get("steps"), 0, 0, 200)
    g["seed_mode"] = _choice(g_raw.get("seed_mode"), {"inherit", "offset"}, "inherit")
    g["seed_offset"] = _int(g_raw.get("seed_offset"), 1, -2_147_483_648, 2_147_483_647)
    g["skip_fl2v"] = _bool(g_raw.get("skip_fl2v"), False)
    g["upscale_method"] = _choice(
        g_raw.get("upscale_method"),
        {"lanczos", "upscale_model", "nvidia_rtx_vsr"},
        "lanczos",
    )
    g["upscale_model"] = str(g_raw.get("upscale_model") or "")
    g["resolution_mode"] = _choice(
        g_raw.get("resolution_mode"),
        {"follow_director", "aspect_megapixels", "custom"},
        "follow_director",
    )
    g["aspect"] = str(g_raw.get("aspect") or "16:9")
    g["megapixels"] = _float(g_raw.get("megapixels"), 1.0, 0.1, 16.0)
    g["width"] = _snap(_int(g_raw.get("width"), 1376, 32, 8192))
    g["height"] = _snap(_int(g_raw.get("height"), 768, 32, 8192))

    f = result["face_refine"]
    f["enabled"] = _bool(f_raw.get("enabled"), False)
    f["detector"] = _choice(f_raw.get("detector"), {"ultralytics", "insightface"}, "ultralytics")
    f["detector_model"] = str(f_raw.get("detector_model") or "")
    f["confidence"] = _float(f_raw.get("confidence"), 0.35, 0.01, 1.0)
    f["select"] = _choice(f_raw.get("select"), {"largest", "most_central"}, "largest")
    f["crop_factor"] = _float(f_raw.get("crop_factor"), 2.0, 1.05, 5.0)
    f["canvas_mode"] = _choice(
        f_raw.get("canvas_mode"),
        {"manual", "auto_no_downscale", "auto_capped_768"},
        "auto_capped_768",
    )
    f["canvas_size"] = _snap(_int(f_raw.get("canvas_size"), 768, 256, 1536))
    f["smooth_method"] = _choice(
        f_raw.get("smooth_method"), {"gaussian", "moving_average", "savgol"}, "gaussian"
    )
    f["smooth_window"] = _int(f_raw.get("smooth_window"), 9, 1, 101) | 1
    f["size_smooth_window"] = _int(f_raw.get("size_smooth_window"), 13, 1, 101) | 1
    f["size_mode"] = _choice(f_raw.get("size_mode"), {"adaptive", "stable"}, "adaptive")
    f["adaptive"] = _bool(f_raw.get("adaptive"), True)
    for key, default in (
        ("base_denoise", 0.22), ("strength_small_face", 0.35),
        ("strength_large_face", 0.16), ("feather", 0.12),
        ("blend", 1.0), ("identity_threshold", 0.35),
        ("fallback_head_frac", 0.34), ("mask_dilation", 0.06),
        ("sam_threshold", 0.5), ("sam_dilation", 0.04),
    ):
        f[key] = _float(f_raw.get(key), default, 0.0, 1.0)
    f["face_px_small"] = _int(f_raw.get("face_px_small"), 96, 8, 4096)
    f["face_px_large"] = _int(f_raw.get("face_px_large"), 320, 8, 8192)
    f["mask_mode"] = _choice(f_raw.get("mask_mode"), {"rect", "ellipse", "sam"}, "rect")
    f["paste_region"] = _choice(f_raw.get("paste_region"), {"face_rect", "full_crop"}, "face_rect")
    f["colour_match"] = _bool(f_raw.get("colour_match"), True)
    f["undetected_frames"] = _choice(f_raw.get("undetected_frames"), {"fade", "skip"}, "fade")
    f["identity_reference"] = str(f_raw.get("identity_reference") or "")
    f["identity_track"] = _bool(f_raw.get("identity_track"), False)
    f["fallback_detector"] = str(f_raw.get("fallback_detector") or "none")
    f["gamma"] = _float(f_raw.get("gamma"), 1.0, 0.1, 4.0)
    f["denoise_smooth"] = _int(f_raw.get("denoise_smooth"), 5, 1, 51) | 1
    f["feather_scales_with_crop"] = _bool(f_raw.get("feather_scales_with_crop"), True)
    f["sam_model"] = str(f_raw.get("sam_model") or "")
    f["sam_temporal_smooth"] = _int(f_raw.get("sam_temporal_smooth"), 5, 1, 51) | 1

    p = result["preview"]
    legacy_live = raw.get("liveTaePreview", raw.get("live_tae_preview"))
    p["enabled"] = _bool(p_raw.get("enabled", legacy_live), True)
    p["preview_frames"] = _int(p_raw.get("preview_frames"), 8, 1, 32)
    p["preview_fps"] = _int(p_raw.get("preview_fps"), 12, 1, 60)
    p["max_resolution"] = _int(p_raw.get("max_resolution"), 1024, 128, 4096)
    p["jpeg_quality"] = _int(p_raw.get("jpeg_quality"), 80, 20, 100)
    p["preview_every"] = _int(p_raw.get("preview_every"), 1, 1, 100)

    s = result["save"]
    s["auto_save"] = _bool(s_raw.get("auto_save"), False)
    prefix = str(s_raw.get("filename_prefix") or "video/MiniMaxH3_Director").strip()
    s["filename_prefix"] = prefix[:512] or "video/MiniMaxH3_Director"
    s["format"] = str(s_raw.get("format") or "auto").strip().lower()[:32] or "auto"
    s["codec"] = str(s_raw.get("codec") or "auto").strip().lower()[:64] or "auto"
    s["encoding"] = _choice(s_raw.get("encoding"), {"auto", "re-encode"}, "auto")
    s["crf"] = _int(s_raw.get("crf"), 23, 0, 51)
    return result


def serialize_postprocess_config(raw: Any) -> str:
    return json.dumps(normalize_postprocess_config(raw), ensure_ascii=False, separators=(",", ":"))


def refine_steps_for(config: dict[str, Any], first_steps: int) -> int:
    configured = int(config.get("steps") or 0)
    return configured if configured > 0 else max(8, int(round(int(first_steps) * 0.4)))


def refine_seed_for(config: dict[str, Any], seed: int) -> int:
    return int(seed) + int(config.get("seed_offset", 1)) if config.get("seed_mode") == "offset" else int(seed)


def resolve_upscale_target(config: dict[str, Any], director_width: int, director_height: int) -> tuple[int, int]:
    mode = config.get("resolution_mode") or "follow_director"
    if mode == "follow_director":
        return _snap(director_width), _snap(director_height)
    if mode == "custom":
        return _snap(int(config.get("width") or director_width)), _snap(int(config.get("height") or director_height))
    try:
        aw, ah = (int(part) for part in str(config.get("aspect") or "16:9").split(":", 1))
        if aw <= 0 or ah <= 0:
            raise ValueError
    except (TypeError, ValueError):
        aw, ah = 16, 9
    pixels = max(0.1, float(config.get("megapixels") or 1.0)) * 1024 * 1024
    scale = math.sqrt(pixels / (aw * ah))
    return _snap(round(aw * scale)), _snap(round(ah * scale))


def postprocess_cache_fingerprint(config: dict[str, Any]) -> dict[str, Any]:
    """Only per-segment Global Refine affects segment/continuity caches."""
    g = normalize_postprocess_config(config)["global_refine"]
    return {"global_refine": g if g["enabled"] else False}


__all__ = [
    "DEFAULT_POSTPROCESS_CONFIG", "POSTPROCESS_CONFIG_VERSION",
    "normalize_postprocess_config", "serialize_postprocess_config",
    "refine_steps_for", "refine_seed_for", "resolve_upscale_target",
    "postprocess_cache_fingerprint",
]
