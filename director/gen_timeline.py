# Portions derived from ComfyUI_MiniMaxH3_Director
# Copyright AIMixer and contributors
# Originally licensed under Apache License 2.0
# Modified for MiniMax H3 Motion Director, 2026-08-09
# This derivative project is distributed under GPL-3.0.
# See NOTICE and LICENSES/Apache-2.0-AIMixer.txt.

"""MiniMax H3 Motion Director generation timeline (t2i / t2v / i2i / i2v) plan building."""

from __future__ import annotations

import logging

import torch

from ..lib.image_prep import fit_canvas, fit_video_long_edge, cat_frames_variable_size, resolve_output_dimensions
from ..lib.task_prompts import resolve_task_key
from .effective_refs import (
    compile_effective_references,
    compile_semantic_prompt,
)
from .context_links import parse_context_link

log = logging.getLogger("ComfyUI-MiniMax-H3-Motion-Director.director.gen")

GEN_BLANK_KEYS = frozenset({"t2v", "r2v"})
GEN_IMAGE_KEYS = frozenset({"i2v"})
FL2V_KEYS = frozenset({"fl2v"})
GEN_TASK_KEYS = GEN_BLANK_KEYS | GEN_IMAGE_KEYS | FL2V_KEYS
PROMPT_BATCH_KEYS = frozenset({"t2v", "i2v", "r2v", "fl2v"})
VIDEO_BATCH_KEYS = frozenset({"t2v", "i2v", "r2v", "fl2v"})
IMAGE_BATCH_KEYS = frozenset()

MIN_GEN_FRAMES = 1
MIN_GEN_VIDEO_FRAMES = 4


def is_gen_task_key(task_key: str) -> bool:
    return task_key in GEN_TASK_KEYS


def is_gen_timeline(timeline: dict, task_key: str) -> bool:
    mode = str(timeline.get("timelineMode") or "").lower()
    if mode in ("gen_blank", "gen_image", "image_batch", "prompt_batch", "fl2v"):
        return True
    if mode == "video":
        return False
    return is_gen_task_key(task_key)


def is_prompt_batch_timeline(timeline: dict, task_key: str) -> bool:
    mode = str(timeline.get("timelineMode") or "").lower()
    if mode in ("image_batch", "prompt_batch"):
        return True
    # fl2v is a separate strip UI but still exports like a video prompt-batch.
    if mode == "fl2v" or task_key == "fl2v":
        return True
    return task_key in PROMPT_BATCH_KEYS


def is_image_batch_timeline(timeline: dict, task_key: str) -> bool:
    return is_prompt_batch_timeline(timeline, task_key)


def is_video_batch_task_key(task_key: str) -> bool:
    return task_key in VIDEO_BATCH_KEYS


def gen_submode(timeline: dict, task_key: str) -> str:
    mode = str(timeline.get("timelineMode") or "").lower()
    if mode == "gen_image" or task_key in GEN_IMAGE_KEYS:
        return "gen_image"
    if mode == "gen_blank" or task_key in GEN_BLANK_KEYS:
        return "gen_blank"
    return "gen_blank"


def _min_frames_for_task(task_key: str) -> int:
    if task_key in IMAGE_BATCH_KEYS or task_key in ("t2i", "i2i"):
        return MIN_GEN_FRAMES
    if task_key in ("t2v", "i2v", "r2v"):
        return MIN_GEN_VIDEO_FRAMES
    return MIN_GEN_VIDEO_FRAMES


def _segment_frame_count(raw: dict, *, default: int, task_key: str) -> int:
    fc = int(raw.get("frameCount") or raw.get("frame_count") or raw.get("length") or default)
    return max(_min_frames_for_task(task_key), fc)


def _gen_segment_ranges(
    segments: list[dict],
    *,
    default_frame_count: int,
    task_key: str,
) -> list[tuple[int, int, dict]]:
    ranges: list[tuple[int, int, dict]] = []
    start = 0
    for raw in segments:
        fc = _segment_frame_count(raw, default=default_frame_count, task_key=task_key)
        ranges.append((start, start + fc, raw))
        start += fc
    if not ranges:
        fc = max(_min_frames_for_task(task_key), default_frame_count)
        ranges.append((0, fc, {}))
    return ranges


def _resolve_gen_image_ref(
    seg_data: dict,
    *,
    edit_mode: str,
    global_block: dict,
    task_key: str = "",
    segment_index: int = 0,
    motion_context_enabled: bool = False,
) -> dict | None:
    def _segment_ref() -> dict | None:
        img = seg_data.get("genImage") or {}
        if img.get("imageFile") or img.get("imageB64"):
            return img
        if seg_data.get("imageFile"):
            return {"imageFile": seg_data["imageFile"]}
        return None

    # With I2V Motion Context, a global image is only the initial anchor.
    # Later cards must remain genuinely empty so the executor can continue from
    # the exported context instead of silently copying the first image.
    if motion_context_enabled and task_key == "i2v":
        own = _segment_ref()
        if own is not None:
            return own
        if segment_index > 0:
            return None
        img = global_block.get("genImage") or {}
        if img.get("imageFile") or img.get("imageB64"):
            return img
        if global_block.get("imageFile"):
            return {"imageFile": global_block["imageFile"]}
        return None

    if edit_mode == "segment":
        return _segment_ref()
    img = global_block.get("genImage") or {}
    if img.get("imageFile") or img.get("imageB64"):
        return img
    if global_block.get("imageFile"):
        return {"imageFile": global_block["imageFile"]}
    return None


def _load_gen_image_tensor(ref: dict) -> torch.Tensor:
    from .plan import load_reference_tensor

    tensor = load_reference_tensor(ref)
    if tensor is None:
        raise ValueError("Generation segment image could not be loaded.")
    return tensor


def _build_i2v_source_clip(
    img: torch.Tensor,
    _frame_count: int,
    *,
    width: int,
    height: int,
    output_mode: str,
    ref_max_size: int,
) -> torch.Tensor:
    """Use the source image as a one-frame source-video context."""
    if img.ndim == 3:
        img = img.unsqueeze(0)
    if output_mode == "fixed":
        return fit_canvas(img, width, height)
    return fit_video_long_edge(img, ref_max_size)


def _resolve_gen_image_source_dims(
    segment_ranges: list[tuple[int, int, dict]],
    global_block: dict,
    output_block: dict,
) -> tuple[int, int]:
    sw = int(global_block.get("sourceWidth") or output_block.get("sourceWidth") or 0)
    sh = int(global_block.get("sourceHeight") or output_block.get("sourceHeight") or 0)
    if sw > 0 and sh > 0:
        return sw, sh
    for _start, _end, seg_data in segment_ranges:
        gi = seg_data.get("genImage") or {}
        sw = int(gi.get("width") or 0)
        sh = int(gi.get("height") or 0)
        if sw > 0 and sh > 0:
            return sw, sh
    return 0, 0


def _build_gen_source_clips(
    ranges: list[tuple[int, int, dict]],
    *,
    task_key: str,
    submode: str,
    edit_mode: str,
    global_block: dict,
    height: int,
    width: int,
    output_mode: str,
    ref_max_size: int,
    motion_context_enabled: bool = False,
) -> list[torch.Tensor | None]:
    chunks: list[torch.Tensor | None] = []
    for seg_index, (_start, end, seg_data) in enumerate(ranges):
        frame_count = end - _start
        if frame_count <= 0:
            continue
        if submode == "gen_blank":
            clip = torch.full((frame_count, height, width, 3), 0.5, dtype=torch.float32)
        else:
            saved_link = parse_context_link(seg_data, seg_index)
            segment_visual_context = bool(
                saved_link.visual_enabled
                if saved_link is not None
                else motion_context_enabled
            )
            ref = _resolve_gen_image_ref(
                seg_data,
                edit_mode=edit_mode,
                global_block=global_block,
                task_key=task_key,
                segment_index=seg_index,
                motion_context_enabled=segment_visual_context,
            )
            if ref is None:
                if segment_visual_context and task_key == "i2v":
                    if seg_index == 0:
                        raise ValueError(
                            "MiniMax H3 Motion Director:\n"
                            "I2V Motion Context sequence requires an initial image on Segment 1.\n"
                            "Later segments may be left empty and will continue from Motion Context."
                        )
                    chunks.append(None)
                    continue
                seg_idx = seg_index + 1
                raise ValueError(
                    f"Segment #{seg_idx} has no source image. "
                    "Upload an image in the generation timeline (global or per-segment)."
                )
            img = _load_gen_image_tensor(ref)
            if task_key == "i2v":
                clip = _build_i2v_source_clip(
                    img,
                    frame_count,
                    width=width,
                    height=height,
                    output_mode=output_mode,
                    ref_max_size=ref_max_size,
                )
            else:
                clip = img.repeat(frame_count, 1, 1, 1)
                if output_mode == "fixed":
                    clip = fit_canvas(clip, width, height)
                else:
                    clip = fit_video_long_edge(clip, ref_max_size)
        chunks.append(clip)
    if not chunks:
        raise ValueError("Generation timeline has no frames.")
    return chunks


def _build_gen_source_video(
    ranges: list[tuple[int, int, dict]],
    *,
    task_key: str,
    submode: str,
    edit_mode: str,
    global_block: dict,
    height: int,
    width: int,
    output_mode: str,
    ref_max_size: int,
) -> torch.Tensor:
    return cat_frames_variable_size(
        _build_gen_source_clips(
            ranges,
            task_key=task_key,
            submode=submode,
            edit_mode=edit_mode,
            global_block=global_block,
            height=height,
            width=width,
            output_mode=output_mode,
            ref_max_size=ref_max_size,
            motion_context_enabled=False,
        )
    )


def _paired_video_audio_entries(video_list: list[dict]) -> list[dict]:
    """Convert UI ref-video soundtrack paths into indexed audio entries."""
    out: list[dict] = []
    for item in video_list or []:
        if not isinstance(item, dict):
            continue
        path = str(item.get("pairedAudioFile") or item.get("paired_audio_file") or "").strip()
        if not path:
            continue
        out.append(
            {
                "index": int(item.get("index", item.get("slot", len(out)))),
                "audioFile": path,
                # A Video and its paired soundtrack are one selectable asset.
                "assetId": str(
                    item.get("assetId")
                    or item.get("asset_id")
                    or item.get("id")
                    or f"video-{int(item.get('index', item.get('slot', len(out))))}"
                ),
            }
        )
    return out


def _raw_asset_id(item: dict, kind: str, index: int) -> str:
    return str(
        item.get("assetId")
        or item.get("asset_id")
        or item.get("id")
        or f"{kind}-{index}"
    )


def _known_assets(*asset_lists: tuple[str, list[dict]]) -> dict[tuple[str, str], str]:
    known: dict[tuple[str, str], str] = {}
    for kind, items in asset_lists:
        for ordinal, item in enumerate(items or []):
            if not isinstance(item, dict):
                continue
            asset_id = _raw_asset_id(item, kind, ordinal)
            label = str(item.get("name") or item.get("label") or asset_id)
            pretty = {"picture": "Picture", "video": "Video", "audio": "Audio"}[kind]
            known[(kind, asset_id)] = f'Common {pretty} "{label}"'
            if kind == "video" and (
                item.get("pairedAudioFile") or item.get("paired_audio_file")
            ):
                known[("audio", asset_id)] = f'Common Video soundtrack "{label}"'
    return known


def _assert_effective_ref_limits(effective, *, segment_index: int) -> None:
    counts = {
        "Picture": (len(effective.pictures), 9),
        "Video": (len(effective.videos), 3),
        # Official standalone input max is three; paired soundtracks are tied to Videos.
        "standalone Audio": (len(effective.audios), 3),
    }
    for label, (actual, limit) in counts.items():
        if actual > limit:
            raise ValueError(
                f"Segment {segment_index + 1} has {actual} effective {label} references; "
                f"MiniMax H3 allows at most {limit}. Disable Common assets or remove Local assets."
            )


def build_gen_director_plan(
    timeline: dict,
    *,
    global_task_type: str,
    global_prompt: str,
    total_frames: int,
    frame_rate: float,
    width: int,
    height: int,
    ref_max_size: int,
    motion_context_enabled: bool = True,
):
    """Build DirectorPlan for generation timeline modes (lazy import avoids cycles)."""
    from .plan import (
        DirectorPlan,
        SegmentPlan,
        _load_ref_audios,
        _load_ref_videos,
        _load_refs,
        _parse_run_selection,
        _run_selection_enabled,
        _resolve_export_mode,
        segment_ref_audios_for_context,
        segment_refs_for_context,
    )

    global_block = timeline.get("global") or {}
    r2v_common_block = timeline.get("r2vCommon") or timeline.get("r2v_common") or {}
    edit_mode = timeline.get("editMode") or timeline.get("edit_mode") or "global"
    if is_prompt_batch_timeline(timeline, resolve_task_key(global_block.get("taskType") or global_task_type or "")):
        edit_mode = "segment"
    elif edit_mode not in ("global", "segment"):
        edit_mode = "global"

    task_type = global_block.get("taskType") or global_task_type or "t2v — 文生视频(Text to Video)"
    task_key = resolve_task_key(task_type)
    if not is_gen_task_key(task_key):
        raise ValueError(f"Task {task_key} is not supported on the generation timeline.")

    submode = gen_submode(timeline, task_key)
    prompt = global_block.get("prompt") or global_prompt or ""
    global_refs = _load_refs(global_block.get("refs") or [])
    common_picture_raw = list(r2v_common_block.get("refs") or [])
    common_video_raw = list(
        r2v_common_block.get("refVideos") or r2v_common_block.get("ref_videos") or []
    )
    common_audio_raw = list(
        r2v_common_block.get("refAudios") or r2v_common_block.get("ref_audios") or []
    )
    common_pictures = _load_refs(common_picture_raw)
    common_known_assets = _known_assets(
        ("picture", common_picture_raw),
        ("video", common_video_raw),
        ("audio", common_audio_raw),
    )

    output_block = timeline.get("output") or {}
    gen_block = timeline.get("gen") or {}
    default_fc = int(gen_block.get("defaultFrameCount") or total_frames or 81)

    segment_ranges = _gen_segment_ranges(
        timeline.get("segments") or [],
        default_frame_count=default_fc,
        task_key=task_key,
    )

    if submode == "gen_blank":
        out_mode = "fixed"
        fw = int(output_block.get("width") or timeline.get("width") or width or 0)
        fh = int(output_block.get("height") or timeline.get("height") or height or 0)
        if fw < 16 or fh < 16:
            raise ValueError(
                "t2i / t2v / r2i / r2v require fixed output width and height (>=16, multiples of 16). "
                "Set width and height in the generation timeline output panel."
            )
        out_w, out_h, ref_max, _ = resolve_output_dimensions(
            fw,
            fh,
            mode="fixed",
            long_edge=ref_max_size,
            fixed_width=fw,
            fixed_height=fh,
        )
    else:
        out_mode = str(output_block.get("mode") or "long_edge").lower()
        if out_mode not in ("fixed", "long_edge"):
            out_mode = "long_edge"
        src_w, src_h = _resolve_gen_image_source_dims(segment_ranges, global_block, output_block)
        out_w, out_h, ref_max, out_mode = resolve_output_dimensions(
            src_w or int(width or 832),
            src_h or int(height or 480),
            mode=out_mode,
            long_edge=int(output_block.get("longEdge") or output_block.get("long_edge") or ref_max_size or 848),
            fixed_width=int(output_block.get("width") or timeline.get("width") or width),
            fixed_height=int(output_block.get("height") or timeline.get("height") or height),
        )

    export_mode = _resolve_export_mode(output_block)
    # Image prompt-batch (t2i/i2i/r2i) always merges to images list; video batch (t2v/i2v/r2v) respects export mode.
    if is_prompt_batch_timeline(timeline, task_key) and not is_video_batch_task_key(task_key):
        export_mode = "all"

    source_clips = _build_gen_source_clips(
        segment_ranges,
        task_key=task_key,
        submode=submode,
        edit_mode=edit_mode,
        global_block=global_block,
        height=out_h,
        width=out_w,
        output_mode=out_mode,
        ref_max_size=ref_max,
        motion_context_enabled=motion_context_enabled,
    )
    attach_source_clips = is_prompt_batch_timeline(timeline, task_key) and task_key in ("i2i", "i2v")
    if attach_source_clips:
        # Placeholder timeline index only; spatial data comes from each segment's source_clip.
        source_video = torch.full((len(source_clips), 16, 16, 3), 0.5, dtype=torch.float32)
    else:
        source_video = cat_frames_variable_size(
            [clip for clip in source_clips if clip is not None]
        )

    segments: list[SegmentPlan] = []
    for idx, (start, end, seg_data) in enumerate(segment_ranges):
        if edit_mode == "global":
            seg_prompt = prompt
            seg_task = task_type
            seg_refs = list(global_refs)
            use_global = True
            seg_negative = ""
        else:
            use_global = False
            local_prompt = (seg_data.get("prompt") or "").strip()
            seg_prompt = local_prompt or prompt
            seg_task = seg_data.get("taskType") or seg_data.get("task_type") or task_type
            # Local references belong only to this segment.  Common references
            # are selected explicitly after task resolution below.
            seg_refs = _load_refs(seg_data.get("refs") or [])
            seg_negative = (
                (seg_data.get("negativePrompt") or seg_data.get("negative_prompt") or "").strip()
            )

        seg_task_key = resolve_task_key(seg_task)
        if seg_task_key == "i2v" and seg_refs:
            log.info(
                "i2v segment #%d: ignoring %d reference image(s); using source video context only",
                idx + 1,
                len(seg_refs),
            )
        seg_refs = segment_refs_for_context(seg_task_key, seg_refs)
        seg_ref_audios = []
        seg_ref_videos = []
        seg_ref_video_audios = []
        reference_tags: dict[tuple[str, str], str] = {}
        if edit_mode == "global":
            seg_ref_audios = segment_ref_audios_for_context(
                seg_task_key,
                _load_ref_audios(global_block.get("refAudios") or global_block.get("ref_audios") or []),
            )
        else:
            seg_ref_audios = segment_ref_audios_for_context(
                seg_task_key,
                _load_ref_audios(seg_data.get("refAudios") or seg_data.get("ref_audios") or []),
            )
            if seg_task_key == "r2v":
                seg_len = max(5, int(end) - int(start))
                raw_vids = seg_data.get("refVideos") or seg_data.get("ref_videos") or []
                # Backward compat: single referenceVideo → slot 0
                legacy = seg_data.get("referenceVideo") or seg_data.get("reference_video") or {}
                if isinstance(legacy, dict) and (legacy.get("videoFile") or legacy.get("fileName")):
                    if not any(int(v.get("index", v.get("slot", -1))) == 0 for v in raw_vids if isinstance(v, dict)):
                        raw_vids = [{"index": 0, **legacy}, *list(raw_vids or [])]
                seg_ref_videos = _load_ref_videos(raw_vids, timeline, seg_len)
                seg_ref_video_audios = _load_ref_audios(
                    _paired_video_audio_entries(list(raw_vids or []))
                )

        if edit_mode != "global" and seg_task_key == "r2v":
            all_common_ids = {
                _raw_asset_id(item, kind, pos)
                for kind, items in (
                    ("picture", common_picture_raw),
                    ("video", common_video_raw),
                    ("audio", common_audio_raw),
                )
                for pos, item in enumerate(items)
                if isinstance(item, dict)
            }
            excluded_common_ids = {
                str(value) for value in (
                    seg_data.get("excludedCommonAssetIds")
                    or seg_data.get("excluded_common_asset_ids")
                    or []
                )
            }
            selected_common_ids = (
                all_common_ids - excluded_common_ids
                if bool(seg_data.get("useCommonAssets", seg_data.get("use_common_assets", True)))
                else set()
            )

            local_refs = list(seg_refs)
            local_audios = list(seg_ref_audios)
            local_videos = list(seg_ref_videos)
            local_video_audios = list(seg_ref_video_audios)

            seg_len = max(5, int(end) - int(start))
            common_videos = _load_ref_videos(common_video_raw, timeline, seg_len)
            common_video_audios = _load_ref_audios(
                _paired_video_audio_entries(common_video_raw)
            )
            common_audios = segment_ref_audios_for_context(
                seg_task_key, _load_ref_audios(common_audio_raw)
            )
            effective = compile_effective_references(
                common_pictures=common_pictures,
                common_videos=common_videos,
                common_audios=common_audios,
                common_video_audios=common_video_audios,
                selected_common_asset_ids=selected_common_ids,
                local_pictures=local_refs,
                local_videos=local_videos,
                local_audios=local_audios,
                local_video_audios=local_video_audios,
            )
            _assert_effective_ref_limits(effective, segment_index=idx)
            seg_refs = effective.pictures
            seg_ref_videos = effective.videos
            seg_ref_audios = effective.audios
            seg_ref_video_audios = effective.video_audios
            reference_tags = effective.tags
            # R2V has no Common Prompt. Every segment owns its full prompt.
            seg_prompt = local_prompt
            seg_prompt = compile_semantic_prompt(
                seg_prompt,
                reference_tags,
                known_assets=common_known_assets,
                segment_label=f"Segment {idx + 1}",
            )

        has_r2v_material = bool(
            seg_refs or seg_ref_videos or seg_ref_audios or seg_ref_video_audios
        )

        if seg_task_key in ("r2v", "r2i") and not has_r2v_material:
            log.warning(
                "gen segment #%d task=%s has no reference media — will behave like "
                "t2v/t2i. Upload 图片/音频/视频 on this material card.",
                idx + 1,
                seg_task_key,
            )
        source_item = source_clips[idx] if idx < len(source_clips) else None
        seg_source = source_item.clone() if source_item is not None else None

        segments.append(
            SegmentPlan(
                index=idx,
                start_frame=start,
                end_frame=end,
                prompt=seg_prompt,
                task_type=seg_task,
                task_key=seg_task_key,
                use_global=use_global,
                refs=seg_refs,
                ref_audios=seg_ref_audios,
                ref_videos=seg_ref_videos,
                ref_video_audios=seg_ref_video_audios,
                negative_prompt=seg_negative,
                source_clip=seg_source,
                reference_tags=reference_tags,
                context_link=parse_context_link(seg_data, idx),
            )
        )

    total = int(segment_ranges[-1][1]) if segment_ranges else int(source_video.shape[0])
    if is_prompt_batch_timeline(timeline, task_key):
        timeline_mode = "prompt_batch"
    else:
        timeline_mode = "gen_image" if submode == "gen_image" else "gen_blank"

    raw = dict(timeline)
    raw["timelineMode"] = timeline_mode
    src_w, src_h = _resolve_gen_image_source_dims(segment_ranges, global_block, output_block)

    return DirectorPlan(
        frame_rate=float(timeline.get("frameRate") or frame_rate or 24),
        total_frames=total,
        width=out_w,
        height=out_h,
        ref_max_size=ref_max,
        output_mode=out_mode,
        source_width=int(src_w or out_w),
        source_height=int(src_h or out_h),
        global_task_type=task_type,
        global_task_key=task_key,
        global_prompt=prompt,
        global_refs=global_refs,
        source_video=source_video,
        segments=segments,
        edit_mode=edit_mode,
        raw=raw,
        export_mode=export_mode,
        run_indices=_parse_run_selection(timeline, len(segments)),
        run_select_enabled=_run_selection_enabled(timeline),
    )
