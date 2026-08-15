"""Unified external Inputs/Assets support for MiniMax H3 Motion Director.

This module deliberately does not own any UI.  It validates the 1-based
external payload, prevents internal/external media mixing, prepares the small
amount of temporary timeline state needed by I2V planning, then overlays the
actual in-memory tensors onto the finished DirectorPlan.
"""

from __future__ import annotations

import base64
import io
import json
import re
from typing import Any

import numpy as np
import torch
from PIL import Image

from ..lib.task_prompts import resolve_task_key
from .context_cache import tensor_fingerprint
from .plan import (
    SegmentRef,
    SegmentRefAudio,
    SegmentRefVideo,
    reinforce_r2v_prompt,
    reinforce_rv2v_prompt,
    reinforce_v2v_prompt,
)

MMX_MOTION_DIR_INPUTS = "MMX_MOTION_DIR_INPUTS"
MMX_MOTION_DIR_ASSETS = "MMX_MOTION_DIR_ASSETS"

_MODE_PREFIX = {
    "text": "t2v",
    "image": "i2v",
    "fl": "fl2v",
    "ref": "r2v",
    "video": "v2v",
    "rv": "rv2v",
}

_PREFIX_FOR_MODE = {value: key for key, value in _MODE_PREFIX.items()}
_ASSET_MODES = frozenset({"i2v", "fl2v", "r2v", "rv2v"})
_DYNAMIC_RE = re.compile(r"^(text|image|fl|ref|video|rv)_(prompt|assets)_([1-9][0-9]*)$")
_ASSET_RE = re.compile(r"^(image|video|audio)_([1-9][0-9]*)$")


def parse_dynamic_input_name(name: str) -> tuple[str, str, int] | None:
    match = _DYNAMIC_RE.fullmatch(str(name or ""))
    if not match:
        return None
    prefix, kind, raw_index = match.groups()
    mode = _MODE_PREFIX[prefix]
    if kind == "assets" and mode not in _ASSET_MODES:
        return None
    return mode, kind, int(raw_index)


def dynamic_input_spec(name: str):
    parsed = parse_dynamic_input_name(name)
    if parsed is None:
        return None
    _mode, kind, _index = parsed
    if kind == "prompt":
        return ("STRING", {"forceInput": True})
    return (MMX_MOTION_DIR_ASSETS,)


def _as_image_batch(value: Any, *, label: str) -> torch.Tensor:
    if isinstance(value, (list, tuple)):
        if not value:
            raise ValueError(f"{label} is empty.")
        value = value[0]
    if not isinstance(value, torch.Tensor) or value.numel() <= 0:
        raise ValueError(f"{label} must be a non-empty IMAGE tensor.")
    tensor = value
    if tensor.ndim == 3:
        tensor = tensor.unsqueeze(0)
    if tensor.ndim != 4:
        raise ValueError(f"{label} must be IMAGE [N,H,W,C], got {tuple(tensor.shape)}.")
    return tensor.contiguous().float()


def _as_audio(value: Any, *, label: str) -> dict:
    if isinstance(value, (list, tuple)):
        if not value:
            raise ValueError(f"{label} is empty.")
        value = value[0]
    if not isinstance(value, dict) or not isinstance(value.get("waveform"), torch.Tensor):
        raise ValueError(f"{label} must be a ComfyUI AUDIO value.")
    return value


def pack_assets_payload(**kwargs) -> dict[str, Any]:
    images: dict[int, torch.Tensor] = {}
    videos: dict[int, torch.Tensor] = {}
    audios: dict[int, dict] = {}

    for name, value in kwargs.items():
        if value is None:
            continue
        match = _ASSET_RE.fullmatch(str(name))
        if not match:
            continue
        kind, raw_index = match.groups()
        index = int(raw_index)
        if kind == "image":
            if index > 9:
                raise ValueError("Director Assets supports image_1 through image_9 only.")
            images[index] = _as_image_batch(value, label=name)[:1]
        elif kind == "video":
            if index > 3:
                raise ValueError("Director Assets supports video_1 through video_3 only.")
            videos[index] = _as_image_batch(value, label=name)
        else:
            if index > 3:
                raise ValueError("Director Assets supports audio_1 through audio_3 only.")
            audios[index] = _as_audio(value, label=name)

    return {
        "version": 1,
        "images": images,
        "videos": videos,
        "audios": audios,
    }


def _normalize_assets_payload(value: Any) -> dict[str, Any]:
    if isinstance(value, (list, tuple)):
        if not value:
            return {"version": 1, "images": {}, "videos": {}, "audios": {}}
        value = value[0]
    if not isinstance(value, dict):
        raise ValueError("Director Inputs assets socket did not receive a Director Assets bundle.")
    images = dict(value.get("images") or {})
    videos = dict(value.get("videos") or {})
    audios = dict(value.get("audios") or {})
    return {
        "version": int(value.get("version") or 1),
        "images": {int(k): v for k, v in images.items()},
        "videos": {int(k): v for k, v in videos.items()},
        "audios": {int(k): v for k, v in audios.items()},
    }


def pack_director_inputs_payload(**kwargs) -> dict[str, Any]:
    mode: str | None = None
    groups: dict[int, dict[str, Any]] = {}

    for name, value in kwargs.items():
        parsed = parse_dynamic_input_name(name)
        if parsed is None:
            continue
        current_mode, kind, group_index = parsed
        if mode is None:
            mode = current_mode
        elif current_mode != mode:
            raise ValueError(
                "MiniMax H3 Motion Director Inputs received mixed mode sockets. "
                "Reconnect it to the current Director mode before running."
            )

        group = groups.setdefault(
            group_index,
            {
                "prompt_connected": False,
                "prompt": "",
                "assets_connected": False,
                "assets": None,
            },
        )
        if kind == "prompt":
            group["prompt_connected"] = True
            group["prompt"] = "" if value is None else str(value)
        else:
            group["assets_connected"] = True
            group["assets"] = _normalize_assets_payload(value)

    return {
        "version": 1,
        "mode": mode,
        "groups": groups,
    }


def _bundle_has_media(bundle: dict[str, Any] | None) -> bool:
    if not bundle:
        return False
    return bool(bundle.get("images") or bundle.get("videos") or bundle.get("audios"))


def validate_assets_for_mode(mode: str, group_index: int, bundle: dict[str, Any]) -> None:
    mode = resolve_task_key(mode)
    images = sorted(int(i) for i in (bundle.get("images") or {}))
    videos = sorted(int(i) for i in (bundle.get("videos") or {}))
    audios = sorted(int(i) for i in (bundle.get("audios") or {}))

    if not (images or videos or audios):
        raise ValueError(
            f"Group {group_index}: external Assets is connected but contains no image, video, or audio."
        )

    if mode in {"t2v", "v2v"}:
        raise ValueError(f"Group {group_index}: {mode} does not accept an external Assets bundle.")

    if mode == "i2v":
        if images != [1] or videos or audios:
            raise ValueError(
                f"Group {group_index}: i2v external Assets accepts image_1 only."
            )
        return

    if mode == "fl2v":
        if any(index not in {1, 2} for index in images) or videos or audios:
            raise ValueError(
                f"Group {group_index}: fl2v external Assets accepts image_1 (first) "
                "and image_2 (last) only."
            )
        return

    if mode == "r2v":
        return

    if mode == "rv2v":
        if videos:
            raise ValueError(
                f"Group {group_index}: rv2v already owns <Video 1> from the Director source video; "
                "external video_1..3 are not accepted. Use image_1..9 and/or audio_1..3."
            )
        return

    raise ValueError(f"Group {group_index}: unsupported Director mode {mode!r}.")


def _image_ref_has_data(value: Any) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if not isinstance(value, dict):
        return False
    return bool(
        str(value.get("imageFile") or value.get("image_file") or "").strip()
        or str(value.get("imageB64") or value.get("image_b64") or "").strip()
    )


def _list_has_media(value: Any) -> bool:
    if not isinstance(value, (list, tuple)):
        return False
    for item in value:
        if item is None:
            continue
        if isinstance(item, dict):
            if any(
                str(item.get(key) or "").strip()
                for key in (
                    "imageFile",
                    "image_file",
                    "videoFile",
                    "video_file",
                    "audioFile",
                    "audio_file",
                    "fileName",
                    "file_name",
                )
            ):
                return True
            if item.get("imageB64") or item.get("image_b64"):
                return True
        else:
            return True
    return False


def _raw_group_has_media(timeline: dict, group_index: int, mode: str) -> bool:
    index = group_index - 1
    segments = list(timeline.get("segments") or [])
    shots = list(timeline.get("shots") or [])
    raw = segments[index] if 0 <= index < len(segments) else {}
    shot = shots[index] if 0 <= index < len(shots) else {}

    # Group-local media.
    if _image_ref_has_data(raw.get("genImage") or raw.get("gen_image")):
        return True
    if _image_ref_has_data(raw.get("endImage") or raw.get("end_image")):
        return True
    if str(raw.get("imageFile") or raw.get("image_file") or "").strip():
        return True
    if any(
        _list_has_media(raw.get(key))
        for key in ("refs", "refImages", "ref_images", "refVideos", "ref_videos", "refAudios", "ref_audios")
    ):
        return True
    if _image_ref_has_data(shot.get("startImage") or shot.get("start_image")):
        return True
    if _image_ref_has_data(shot.get("endImage") or shot.get("end_image")):
        return True

    # Global/common Director media is also Director-owned.  Do not silently mix
    # it with an external group bundle because reference indices would become
    # ambiguous and cache identity would depend on merge order.
    global_block = timeline.get("global") or {}
    common_block = timeline.get("r2vCommon") or timeline.get("r2v_common") or {}
    if mode == "i2v" and _image_ref_has_data(global_block.get("genImage") or global_block.get("gen_image")):
        return True
    if mode in {"r2v", "rv2v"}:
        for block in (global_block, common_block):
            if any(
                _list_has_media(block.get(key))
                for key in ("refs", "refImages", "ref_images", "refVideos", "ref_videos", "refAudios", "ref_audios")
            ):
                return True
    return False


def tensor_to_png_data_url(tensor: torch.Tensor) -> tuple[str, int, int]:
    frame = _as_image_batch(tensor, label="external image")[:1][0]
    array = (
        frame.detach()
        .cpu()
        .clamp(0, 1)
        .mul(255.0)
        .round()
        .to(torch.uint8)
        .numpy()
    )
    if array.shape[-1] > 3:
        array = array[..., :3]
    image = Image.fromarray(np.asarray(array), mode="RGB")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    payload = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{payload}", int(image.width), int(image.height)


def _normalize_director_inputs(value: Any) -> dict[str, Any]:
    if value is None:
        return {"version": 1, "mode": None, "groups": {}}
    if isinstance(value, (list, tuple)):
        if not value:
            return {"version": 1, "mode": None, "groups": {}}
        value = value[0]
    if not isinstance(value, dict):
        raise ValueError("director_inputs did not receive a MiniMax H3 Motion Director Inputs payload.")
    groups: dict[int, dict[str, Any]] = {}
    for raw_index, raw_group in dict(value.get("groups") or {}).items():
        index = int(raw_index)
        if index <= 0 or not isinstance(raw_group, dict):
            continue
        group = {
            "prompt_connected": bool(raw_group.get("prompt_connected")),
            "prompt": str(raw_group.get("prompt") or ""),
            "assets_connected": bool(raw_group.get("assets_connected")),
            "assets": None,
        }
        if group["assets_connected"]:
            group["assets"] = _normalize_assets_payload(raw_group.get("assets"))
        groups[index] = group
    return {
        "version": int(value.get("version") or 1),
        "mode": str(value.get("mode") or "").strip().lower() or None,
        "groups": groups,
    }


def prepare_timeline_for_director_inputs(
    timeline_data: str,
    *,
    task_type: str,
    director_inputs: Any,
    motion_context_enabled: bool,
) -> tuple[str, dict[str, Any]]:
    payload = _normalize_director_inputs(director_inputs)
    if not payload["groups"]:
        return timeline_data, payload

    mode = resolve_task_key(task_type)
    if payload["mode"] and payload["mode"] != mode:
        raise ValueError(
            "MiniMax H3 Motion Director Inputs mode does not match the connected Director: "
            f"Inputs={payload['mode']}, Director={mode}."
        )

    try:
        timeline = json.loads(timeline_data) if str(timeline_data or "").strip() else {}
    except Exception as exc:
        raise ValueError(f"Director timeline_data is invalid JSON: {exc}") from exc
    if not isinstance(timeline, dict):
        timeline = {}

    segments = timeline.setdefault("segments", [])
    if not isinstance(segments, list):
        raise ValueError("Director timeline segments are invalid.")

    for group_index, group in sorted(payload["groups"].items()):
        if group_index > len(segments):
            raise ValueError(
                f"Director Inputs Group {group_index} does not exist; Director currently has {len(segments)} group(s)."
            )
        raw = segments[group_index - 1]
        if not isinstance(raw, dict):
            raise ValueError(f"Director Group {group_index} timeline entry is invalid.")

        if group["prompt_connected"]:
            raw["prompt"] = group["prompt"]

        if not group["assets_connected"]:
            continue
        bundle = group["assets"] or {"images": {}, "videos": {}, "audios": {}}
        validate_assets_for_mode(mode, group_index, bundle)
        if _raw_group_has_media(timeline, group_index, mode):
            raise ValueError(
                f"Group {group_index}: Director internal media already exists. "
                "Remove the internal image/video/audio before connecting external Assets."
            )

        # I2V plan construction requires its starting image before a DirectorPlan
        # exists.  Inject only a transient in-memory PNG into the execution copy
        # of timeline_data; workflow serialization remains untouched.
        if mode == "i2v":
            image = bundle["images"].get(1)
            if image is None:
                if group_index == 1 or not motion_context_enabled:
                    raise ValueError(
                        f"Group {group_index}: i2v external Assets requires image_1."
                    )
                continue
            data_url, width, height = tensor_to_png_data_url(image)
            raw["genImage"] = {
                "imageB64": data_url,
                "imageFile": "",
                "width": width,
                "height": height,
            }
            raw["imageFile"] = ""

    return json.dumps(timeline, ensure_ascii=False), payload


def _fingerprint_assets(bundle: dict[str, Any]) -> dict[str, Any]:
    return {
        "images": {
            str(index): tensor_fingerprint(tensor)
            for index, tensor in sorted((bundle.get("images") or {}).items())
        },
        "videos": {
            str(index): tensor_fingerprint(tensor)
            for index, tensor in sorted((bundle.get("videos") or {}).items())
        },
        "audios": {
            str(index): {
                "sample_rate": int(audio.get("sample_rate") or 0),
                "waveform": tensor_fingerprint(audio["waveform"]),
            }
            for index, audio in sorted((bundle.get("audios") or {}).items())
            if isinstance(audio, dict) and isinstance(audio.get("waveform"), torch.Tensor)
        },
    }


def apply_director_inputs_to_plan(plan, director_inputs: Any):
    payload = _normalize_director_inputs(director_inputs)
    if not payload["groups"]:
        return plan

    mode = resolve_task_key(getattr(plan, "global_task_key", "") or payload.get("mode") or "")
    if payload["mode"] and payload["mode"] != mode:
        raise ValueError(
            f"Director Inputs mode {payload['mode']} does not match plan mode {mode}."
        )

    fingerprint: dict[str, Any] = {"mode": mode, "groups": {}}

    for group_index, group in sorted(payload["groups"].items()):
        if group_index <= 0 or group_index > len(plan.segments):
            raise ValueError(
                f"Director Inputs Group {group_index} is outside the plan's {len(plan.segments)} group(s)."
            )
        seg = plan.segments[group_index - 1]

        if group["prompt_connected"]:
            prompt = group["prompt"]
            if mode == "v2v":
                prompt = reinforce_v2v_prompt(prompt)
            seg.prompt = prompt

        group_fp: dict[str, Any] = {
            "prompt_connected": bool(group["prompt_connected"]),
            "prompt": group["prompt"] if group["prompt_connected"] else None,
            "assets_connected": bool(group["assets_connected"]),
        }

        if group["assets_connected"]:
            bundle = group["assets"] or {"images": {}, "videos": {}, "audios": {}}
            validate_assets_for_mode(mode, group_index, bundle)
            images = bundle.get("images") or {}
            videos = bundle.get("videos") or {}
            audios = bundle.get("audios") or {}

            if mode == "i2v":
                seg.source_clip = _as_image_batch(images[1], label=f"Group {group_index} image_1")[:1]
            elif mode == "fl2v":
                refs = []
                if 1 in images:
                    refs.append(SegmentRef(index=0, tensor=images[1][:1], asset_id=f"external-g{group_index}-first"))
                if 2 in images:
                    refs.append(SegmentRef(index=1, tensor=images[2][:1], asset_id=f"external-g{group_index}-last"))
                seg.refs = refs
            elif mode == "r2v":
                seg.refs = [
                    SegmentRef(
                        index=index - 1,
                        tensor=tensor[:1],
                        asset_id=f"external-g{group_index}-picture-{index}",
                    )
                    for index, tensor in sorted(images.items())
                ]
                seg.ref_videos = [
                    SegmentRefVideo(
                        index=index - 1,
                        tensor=tensor,
                        video_file="",
                        meta={"external": True, "slot": index},
                        asset_id=f"external-g{group_index}-video-{index}",
                    )
                    for index, tensor in sorted(videos.items())
                ]
                seg.ref_audios = [
                    SegmentRefAudio(
                        index=index - 1,
                        audio=audio,
                        audio_file="",
                        asset_id=f"external-g{group_index}-audio-{index}",
                    )
                    for index, audio in sorted(audios.items())
                ]
                seg.ref_video_audios = []
                seg.prompt = reinforce_r2v_prompt(
                    seg.prompt,
                    ref_indices=[index - 1 for index in images],
                    video_indices=[index - 1 for index in videos],
                    audio_indices=[index - 1 for index in audios],
                )
            elif mode == "rv2v":
                seg.refs = [
                    SegmentRef(
                        index=index - 1,
                        tensor=tensor[:1],
                        asset_id=f"external-g{group_index}-picture-{index}",
                    )
                    for index, tensor in sorted(images.items())
                ]
                seg.ref_audios = [
                    SegmentRefAudio(
                        index=index - 1,
                        audio=audio,
                        audio_file="",
                        asset_id=f"external-g{group_index}-audio-{index}",
                    )
                    for index, audio in sorted(audios.items())
                ]
                seg.prompt = reinforce_rv2v_prompt(
                    seg.prompt,
                    ref_indices=[index - 1 for index in images],
                    audio_indices=[index - 1 for index in audios],
                )

            group_fp["assets"] = _fingerprint_assets(bundle)

        fingerprint["groups"][str(group_index)] = group_fp

    raw = getattr(plan, "raw", None)
    if isinstance(raw, dict):
        raw["directorExternalInputs"] = fingerprint

    return plan


class DynamicDirectorInputTypes(dict):
    """Mapping accepted by ComfyUI for frontend-created dynamic input names.

    Iteration intentionally yields no static sockets; LiteGraph creates the
    current sockets from the connected Director.  During execution ComfyUI asks
    this mapping about each actual prompt input by name.
    """

    def __contains__(self, key):
        return dynamic_input_spec(str(key)) is not None

    def __getitem__(self, key):
        spec = dynamic_input_spec(str(key))
        if spec is None:
            raise KeyError(key)
        return spec

    def get(self, key, default=None):
        spec = dynamic_input_spec(str(key))
        return default if spec is None else spec

    def __iter__(self):
        return iter(())

    def keys(self):
        return ().__iter__()

    def items(self):
        return ().__iter__()
