# Portions derived from ComfyUI_MiniMaxH3_Director
# Copyright AIMixer and contributors
# Originally licensed under Apache License 2.0
# Modified for MiniMax H3 Motion Director, 2026-08-09
# This derivative project is distributed under GPL-3.0.
# See NOTICE and LICENSES/Apache-2.0-AIMixer.txt.

"""Shared helpers for the MiniMax H3 Motion Director timeline node."""

from __future__ import annotations

import json
import logging

import torch

from ..director.audio_export import (
    AUDIO_MODE_GENERATE,
    build_director_audio_outputs,
    resolve_audio_mode,
    source_audio_report_note,
)
from ..director.frame_align import pad_or_trim_frames
from ..director.gen_timeline import is_prompt_batch_timeline, is_video_batch_task_key
from ..director.plan import build_director_plan, count_all_timeline_segments, count_timeline_segments, plan_summary
from ..director.progress import report_director_planning
from ..lib.image_prep import fit_canvas, fit_video_long_edge
from ..lib.video_io import load_timeline_segment
from ..lib.task_prompts import resolve_task_key, task_type_combo_options

log = logging.getLogger("ComfyUI-MiniMax-H3-Motion-Director")


def timeline_required_inputs() -> dict:
    """Timeline + prompt widgets shared by Director nodes."""
    combo_options, combo_meta = task_type_combo_options()
    return {
        "task_type": (combo_options, combo_meta),
        "global_prompt": (
            "STRING",
            {
                "default": "",
                "multiline": True,
                "tooltip": "Synced from in-node UI (global mode).",
            },
        ),
        "bd_grp_sample": ("BDGROUP", {"default": "采样设置"}),
        "cfg": (
            "FLOAT",
            {"default": 1.0, "min": 0.0, "max": 30.0, "step": 0.01, "tooltip": "CFG for KSampler."},
        ),
        "seed": (
            "INT",
            {
                "default": 0,
                "min": 0,
                "max": 0xFFFFFFFFFFFFFFFF,
                "control_after_generate": True,
                "tooltip": "Random seed for sampling.",
            },
        ),
        "frame_rate": (
            "FLOAT",
            {"default": 24.0, "min": 1.0, "max": 240.0, "step": 0.01, "tooltip": "Timeline / output FPS (H3 trained at 24)."},
        ),
        "width": ("INT", {"default": 864, "min": 32, "max": 8192, "step": 32}),
        "height": ("INT", {"default": 480, "min": 32, "max": 8192, "step": 32}),
        "ref_max_size": ("INT", {"default": 864, "min": 32, "max": 8192, "step": 32}),
        "total_frames": (
            "INT",
            {
                "default": 124,
                "min": 5,
                "max": 100000,
                "tooltip": "Timeline total frames (fl2v = sum of shots). Per-shot generation still capped near 512.",
            },
        ),
        "timeline_data": (
            "STRING",
            {"default": "", "multiline": True, "tooltip": "Internal — video, segments, refs (populated by UI)."},
        ),
    }


def director_perf_inputs() -> dict:
    """Performance widgets shared by Director nodes."""
    return {
        "bd_grp_perf": ("BDGROUP", {"default": "性能"}),
        "clear_vram_between_segments": (
            "BOOLEAN",
            {
                "default": True,
                "tooltip": "段间清理显存：每段结束后卸载模型并清空 CUDA 缓存。",
            },
        ),
        "export_source_images": (
            "BOOLEAN",
            {
                "default": False,
                "tooltip": "输出 source_images（时间轴原片帧对比）。默认关以节省内存。",
            },
        ),
    }


def default_timeline_json(
    *,
    task_type: str,
    global_prompt: str,
    total_frames: int,
    frame_rate: float,
    width: int,
    height: int,
    ref_max_size: int,
) -> str:
    return json.dumps(
        {
            "version": 4,
            "editMode": "global",
            "totalFrames": total_frames,
            "frameRate": frame_rate,
            "width": width,
            "height": height,
            "refMaxSize": ref_max_size,
            "output": {
                "mode": "fixed",
                "longEdge": ref_max_size,
                "width": width,
                "height": height,
                "maxExportFrames": 0,
                "exportMode": "all",
                "audioMode": "generate",
            },
            "videoClips": [],
            "video": {
                "fileName": "",
                "videoFile": "",
                "subfolder": "",
                "type": "input",
                "frames": [],
                "frameMap": [],
            },
            "global": {"taskType": task_type, "prompt": global_prompt, "refs": [], "referenceVideo": {}, "continuousReference": False},
            "segments": [
                {
                    "id": "s0",
                    "start": 0,
                    "length": total_frames,
                    "prompt": "",
                    "taskType": "",
                    "refs": [],
                    "referenceVideo": {},
                }
            ],
        },
        ensure_ascii=False,
    )


def _default_mixed_timeline_json(
    *,
    global_prompt: str,
    frame_rate: float,
    width: int,
    height: int,
    ref_max_size: int,
) -> str:
    """Create a valid root Mixed project when the user switches mode before editing cards."""
    return json.dumps(
        {
            "version": 1,
            "timelineMode": "mixed",
            "frameRate": frame_rate,
            "width": width,
            "height": height,
            "refMaxSize": ref_max_size,
            "output": {
                "mode": "fixed",
                "longEdge": ref_max_size,
                "width": width,
                "height": height,
                "maxExportFrames": 0,
                "exportMode": "all",
                "audioMode": "generate",
            },
            "runSelectEnabled": False,
            "runSelection": [],
            "segments": [
                {
                    "id": "seg_1",
                    "mode": "t2v",
                    "prompt": global_prompt or "",
                    "duration": 5.0,
                    "inputs": {"resultRefs": [], "identityPictures": []},
                    "continuity": {"visual": False, "audio": False},
                }
            ],
        },
        ensure_ascii=False,
    )


def prepare_director_plan(
    *,
    timeline_data: str,
    task_type: str,
    global_prompt: str,
    total_frames: int,
    frame_rate: float,
    width: int,
    height: int,
    ref_max_size: int,
    unique_id: str | None,
    motion_context_enabled: bool = True,
    i2v_groups=None,
    r2v_groups=None,
):
    from ..director.external_groups import (
        build_plan_from_external_groups,
        validate_external_group_inputs,
    )
    from ..director.mixed_plan import build_mixed_director_plan, is_mixed_timeline

    task_key_requested = resolve_task_key(task_type)
    if not timeline_data or not timeline_data.strip():
        if task_key_requested == "mixed":
            timeline_data = _default_mixed_timeline_json(
                global_prompt=global_prompt,
                frame_rate=frame_rate,
                width=width,
                height=height,
                ref_max_size=ref_max_size,
            )
        else:
            timeline_data = default_timeline_json(
                task_type=task_type,
                global_prompt=global_prompt,
                total_frames=total_frames,
                frame_rate=frame_rate,
                width=width,
                height=height,
                ref_max_size=ref_max_size,
            )

    try:
        timeline_obj = json.loads(timeline_data)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid timeline_data JSON: {exc}") from exc

    if is_mixed_timeline(timeline_obj, task_key_requested):
        if i2v_groups is not None or r2v_groups is not None:
            raise ValueError(
                "Mixed v1 does not accept Director Inputs / external groups. "
                "Disconnect i2v_groups/r2v_groups and configure each Mixed segment in the Director."
            )
        plan = build_mixed_director_plan(
            timeline_obj,
            global_task_type=task_type,
            global_prompt=global_prompt,
            total_frames=total_frames,
            frame_rate=frame_rate,
            width=width,
            height=height,
            ref_max_size=ref_max_size,
        )
        runnable = len(plan.run_indices) if plan.run_indices is not None else len(plan.segments)
        report_director_planning(
            unique_id,
            runnable,
            timeline_segment_total=len(plan.segments),
        )
        log.info("MiniMax H3 Motion Director: Mixed | %s", plan_summary(plan).replace("\n", " | "))
        return plan

    task_key, ext_groups, family = validate_external_group_inputs(
        task_type=task_type,
        i2v_groups=i2v_groups,
        r2v_groups=r2v_groups,
        motion_context_enabled=motion_context_enabled,
        timeline_data=timeline_data,
    )

    if ext_groups is not None and family is not None:
        plan = build_plan_from_external_groups(
            ext_groups,
            family=family,
            timeline_data=timeline_data,
            task_type=task_type,
            global_prompt=global_prompt,
            total_frames=total_frames,
            frame_rate=frame_rate,
            width=width,
            height=height,
            ref_max_size=ref_max_size,
            motion_context_enabled=motion_context_enabled,
        )
        runnable = len(plan.run_indices) if plan.run_indices is not None else len(plan.segments)
        report_director_planning(
            unique_id,
            runnable,
            timeline_segment_total=len(plan.segments),
        )
        log.info(
            "MiniMax H3 Motion Director: external %s groups × %d (task=%s) | %s",
            family,
            len(ext_groups),
            task_key,
            plan_summary(plan).replace("\n", " | "),
        )
        return plan

    report_director_planning(
        unique_id,
        count_timeline_segments(timeline_data),
        timeline_segment_total=count_all_timeline_segments(timeline_data),
    )

    plan = build_director_plan(
        timeline_data,
        global_task_type=task_type,
        global_prompt=global_prompt,
        total_frames=total_frames,
        frame_rate=frame_rate,
        width=width,
        height=height,
        ref_max_size=ref_max_size,
        motion_context_enabled=motion_context_enabled,
    )
    log.info(plan_summary(plan).replace("\n", " | "))
    return plan


def _fit_source_clip_to_plan(plan, raw_clip: torch.Tensor) -> torch.Tensor:
    if plan.output_mode == "fixed":
        return fit_canvas(raw_clip, plan.width, plan.height)
    return fit_video_long_edge(
        raw_clip,
        plan.ref_max_size,
        stride=int(getattr(plan, "spatial_stride", 32)),
    )


def _mixed_source_images_output(plan, images_out: list[torch.Tensor]) -> list[torch.Tensor]:
    """Expose each Mixed segment's actual source without inventing a global timeline.

    Source Video segments own a segment-local ``source_clip``. Source-free modes
    (T2V/R2V, plus I2V/FL2V which have keyframes rather than a temporal source)
    emit a one-frame gray placeholder so ``source_images`` never pretends the
    generated result was source footage. Keeping placeholders to one frame also
    avoids recreating the large blank-video allocations fixed in v1.0.1.
    """
    outputs: list[torch.Tensor] = []
    if not plan.segments:
        return _empty_source_images_for(images_out)

    for seg in plan.segments:
        raw = getattr(seg, "source_clip", None)
        if isinstance(raw, torch.Tensor) and raw.ndim == 4 and int(raw.shape[0]) > 0:
            fitted = _fit_source_clip_to_plan(plan, raw)
            target_len = max(1, int(getattr(seg, "end_frame", 0)) - int(getattr(seg, "start_frame", 0)))
            outputs.append(pad_or_trim_frames(fitted, target_len).cpu().float())
            continue
        outputs.append(torch.full((1, max(1, int(plan.height)), max(1, int(plan.width)), 3), 0.5))
    return outputs


def build_source_images_output(
    plan,
    images_out: list[torch.Tensor],
    *,
    split_outputs: bool,
) -> list[torch.Tensor]:
    if bool(getattr(plan, "mixed_mode", False)):
        return _mixed_source_images_output(plan, images_out)

    if split_outputs:
        chunks: list[torch.Tensor] = []
        segment_indices = (
            sorted(plan.run_indices)
            if plan.run_indices is not None
            else list(range(len(plan.segments)))
        )
        for seg_index, generated in zip(segment_indices, images_out):
            seg = plan.segments[seg_index]
            target_len = int(generated.shape[0])
            raw = load_timeline_segment(plan.raw, seg.start_frame, seg.end_frame)
            fitted = _fit_source_clip_to_plan(plan, raw)
            chunks.append(pad_or_trim_frames(fitted, target_len).cpu().float())
        return chunks

    target_len = int(images_out[0].shape[0]) if images_out else int(plan.total_frames or 0)
    raw = load_timeline_segment(plan.raw, 0, target_len)
    fitted = _fit_source_clip_to_plan(plan, raw)
    return [pad_or_trim_frames(fitted, target_len).cpu().float()]


def _empty_source_images_for(images_out: list[torch.Tensor]) -> list[torch.Tensor]:
    if not images_out:
        return [torch.full((1, 1, 1, 3), 0.5)]
    placeholders: list[torch.Tensor] = []
    for img in images_out:
        if isinstance(img, torch.Tensor) and img.ndim == 4:
            h, w, c = int(img.shape[1]), int(img.shape[2]), int(img.shape[3])
        else:
            h, w, c = 1, 1, 3
        placeholders.append(torch.full((1, h, w, c), 0.5))
    return placeholders


def _ensure_nonempty_image_batches(images_out: list[torch.Tensor], *, label: str) -> list[torch.Tensor]:
    fixed: list[torch.Tensor] = []
    for i, img in enumerate(images_out):
        if not isinstance(img, torch.Tensor) or img.ndim != 4:
            raise ValueError(f"Director {label}[{i}] is not a valid IMAGE tensor.")
        if int(img.shape[0]) <= 0:
            h, w, c = int(img.shape[1]), int(img.shape[2]), int(img.shape[3])
            log.warning("Director %s[%d] has 0 frames; emitting 1-frame placeholder.", label, i)
            fixed.append(torch.full((1, max(1, h), max(1, w), max(1, c)), 0.5))
        else:
            fixed.append(img)
    return fixed


def finalize_director_outputs(
    plan,
    combined,
    segment_outputs,
    report,
    *,
    export_source_images: bool = False,
    segment_audios: list | None = None,
):
    is_batch = is_prompt_batch_timeline(plan.raw, plan.global_task_key)
    export_segments = plan.export_mode == "segments"
    video_batch = is_video_batch_task_key(plan.global_task_key)

    if export_segments or (is_batch and not video_batch):
        images_out = segment_outputs
        frame_count = sum(int(s.shape[0]) for s in segment_outputs)
        if export_segments and len(segment_outputs) > 1:
            report = (
                report
                + f"\n\nExport mode: segments — {len(segment_outputs)} clip(s) on images output."
            )
        if plan.run_indices is not None:
            report = (
                report
                + f"\n\nPartial run: output contains {len(segment_outputs)} re-generated clip(s) only."
            )
    else:
        combined = pad_or_trim_frames(combined, plan.total_frames).cpu().float()
        images_out = [combined]
        frame_count = int(combined.shape[0])
        if video_batch and is_batch and len(segment_outputs) > 1:
            report = report + f"\n\nExport mode: all — merged {frame_count} frame(s) on images output."
        if plan.run_indices is not None and video_batch:
            report = report + f"\n\nPartial run: re-generated {len(segment_outputs)} video group(s)."

    split_for_audio = export_segments or (is_batch and not video_batch)
    audio_frame_end = frame_count if not split_for_audio else None
    audio_mode = resolve_audio_mode(plan)
    use_generated = audio_mode == AUDIO_MODE_GENERATE
    audio_out, source_fallback = build_director_audio_outputs(
        plan,
        images_out,
        export_segments=split_for_audio,
        output_frame_end=audio_frame_end,
        segment_audios=segment_audios if use_generated else None,
        audio_mode=audio_mode,
    )
    report = report + source_audio_report_note(
        plan,
        audio_out,
        export_segments=split_for_audio,
        output_frame_end=audio_frame_end,
        used_generated_audio=bool(use_generated and segment_audios),
        audio_mode=audio_mode,
        source_fallback=source_fallback,
    )

    split_source_outputs = export_segments or (is_batch and not video_batch)
    if export_source_images:
        try:
            source_images_out = build_source_images_output(
                plan,
                images_out,
                split_outputs=split_source_outputs,
            )
            if bool(getattr(plan, "mixed_mode", False)):
                report = report + (
                    "\n\nSource images: Mixed segment-local sources; source-free segments emit "
                    "one-frame placeholders."
                )
        except Exception as exc:
            log.warning("Source images output failed: %s", exc)
            source_images_out = images_out
            report = report + f"\n\nSource images: fallback to generated output ({exc})."
    else:
        source_images_out = _empty_source_images_for(images_out)

    images_out = _ensure_nonempty_image_batches(images_out, label="images")
    source_images_out = _ensure_nonempty_image_batches(source_images_out, label="source_images")

    fps_out = float(plan.frame_rate or 24.0)
    return images_out, audio_out, fps_out, frame_count, source_images_out, report
