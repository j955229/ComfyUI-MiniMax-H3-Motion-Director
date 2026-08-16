# Portions derived from ComfyUI_MiniMaxH3_Director
# Copyright AIMixer and contributors
# Originally licensed under Apache License 2.0
# Modified for MiniMax H3 Motion Director, 2026-08-09
# This derivative project is distributed under GPL-3.0.
# See NOTICE and LICENSES/Apache-2.0-AIMixer.txt.

"""MiniMax H3 Motion Director — timeline UI + official MiniMax H3 AV execution."""

from __future__ import annotations

import comfy.samplers

from ..director.executor_core import execute_director_plan_core
from ..director.mixed_runtime import bind_mixed_runtime_node
from ..director.postprocess_config import normalize_postprocess_config
from ..director.progress import (
    report_director_audio_preview,
    report_director_final_ready,
    report_director_report,
)
from ..director.video_export import FINAL_VIDEO_REGISTRY
from .director_common import (
    finalize_director_outputs,
    prepare_director_plan,
    timeline_required_inputs,
    director_perf_inputs,
)

_CATEGORY = "MiniMaxH3"

_DEFAULT_GLOBAL_PROMPT = "A cinematic scene with natural motion and synchronized ambience"


def director_timeline_required_inputs() -> dict:
    """Timeline widgets — defaults aligned with official MiniMax H3 workflow templates."""
    inputs = timeline_required_inputs()
    combo_options, combo_meta = inputs["task_type"]

    gp_meta = dict(inputs["global_prompt"][1])
    gp_meta["default"] = _DEFAULT_GLOBAL_PROMPT
    gp_meta["tooltip"] = (
        "User prompt — sent directly to MiniMaxH3ImageToVideo / ReferenceToVideo. "
        "r2v: <Picture 1>. v2v: source-timeline edit (<Video 1>). "
        "rv2v: source timeline + reference images (<Video 1> + <Picture N>). "
        "mixed: each segment compiles to an existing H3 task."
    )

    frames_meta = dict(inputs["total_frames"][1])
    frames_meta["default"] = 124
    frames_meta["tooltip"] = (
        "Frame count at 24 fps; snapped to MiniMax 17k+5 grid (124 ≈ 5s)."
    )

    return {
        **inputs,
        "task_type": (combo_options, combo_meta),
        "global_prompt": ("STRING", gp_meta),
        "total_frames": ("INT", frames_meta),
    }


def _append_mixed_dependency_report(plan, report: str) -> str:
    auto_indices = sorted(getattr(plan, "mixed_auto_run_indices", None) or [])
    if not auto_indices:
        return report
    reasons = getattr(plan, "mixed_auto_run_reasons", None) or {}
    lines = ["", "[Mixed Selective Run]", "Auto-executed prerequisite segment(s):"]
    for index in auto_indices:
        why = reasons.get(int(index)) or reasons.get(str(index)) or []
        suffix = f" — {' | '.join(str(item) for item in why)}" if why else ""
        lines.append(f"- Segment {int(index) + 1}{suffix}")
    lines.append("Only missing/stale prerequisites were added; valid dependency caches were reused.")
    return (report or "") + "\n" + "\n".join(lines)


class MiniMaxH3MotionDirector:
    """In-node timeline Director using ComfyUI official MiniMax H3 pipeline."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": (
                    "MODEL",
                    {"tooltip": "MiniMax H3 UNET (UNETLoader)."},
                ),
                "video_vae": (
                    "VAE",
                    {"tooltip": "MiniMax H3 video VAE (minimax_h3_video_vae)."},
                ),
                "audio_vae": (
                    "VAE",
                    {"tooltip": "MiniMax H3 audio VAE (minimax_h3_audio_vae). Required for r2v / v2v / rv2v."},
                ),
                "clip": (
                    "CLIP",
                    {"tooltip": "CLIPLoader type=minimax (qwen3vl)."},
                ),
                **director_timeline_required_inputs(),
            },
            "optional": {
                "i2v_groups": (
                    "MMX_MOTION_DIR_GROUP",
                    {
                        "tooltip": (
                            "External Image to Video group(s) (t2v / i2v / fl2v). "
                            "When connected, overrides UI cards for execution (external priority). "
                            "Connect Group (Image to Video).group, or Groups Combine."
                        ),
                    },
                ),
                "r2v_groups": (
                    "MMX_MOTION_DIR_GROUP",
                    {
                        "tooltip": (
                            "External Reference to Video group(s). "
                            "When connected, overrides UI cards for execution (external priority). "
                            "Connect Group (Reference to Video).group, or Groups Combine."
                        ),
                    },
                ),
                "bd_grp_motion": ("BDGROUP", {"default": "Motion Context"}),
                "motion_context_enabled": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            "Use the previous segment's final exported frames as "
                            "real H3 motion history. For segment N>1 this replaces "
                            "the old single-last-frame continuity handoff."
                        ),
                    },
                ),
                "context_length": (
                    "INT",
                    {
                        "default": 22,
                        "min": 1,
                        "max": 39,
                        "step": 1,
                        "tooltip": (
                            "Previous exported frames carried into the next segment. "
                            "Video mode uses H3-valid runs 1, 5, 22 or 39 and snaps "
                            "down when a shorter value is entered."
                        ),
                    },
                ),
                "source_overlap_frames": (
                    "INT",
                    {
                        "default": 5,
                        "min": 0,
                        "max": 5,
                        "step": 5,
                        "tooltip": (
                            "V2V/RV2V only. 5 runs an independent H3-native bridge "
                            "across each eligible boundary: five original source frames "
                            "are conditioning only, generated frames at B-2/B+2 are "
                            "anchors, and regenerated B-1/B/B+1 replace the hard cut. "
                            "Visual Motion Context is skipped. 0 disables Source Bridge. "
                            "Mixed v1 always forces this to 0 because its Source Videos are segment-local."
                        ),
                    },
                ),
                "audio_context_enabled": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            "Continue the previous segment's final exported generated "
                            "audio. Automatically disabled for source or mute audio mode."
                        ),
                    },
                ),
                "color_reanchor_enabled": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": (
                            "Re-anchor incoming Motion Context color statistics to a "
                            "stable reference to reduce cumulative color drift."
                        ),
                    },
                ),
                "bd_grp_advanced": ("BDGROUP", {"default": "高级采样"}),
                "steps": (
                    "INT",
                    {
                        "default": 25,
                        "min": 1,
                        "max": 200,
                        "tooltip": "Sampling steps — official template: 25.",
                    },
                ),
                "sampler_name": (
                    comfy.samplers.KSampler.SAMPLERS,
                    {
                        "default": "res_multistep",
                        "tooltip": "Internal mode sampler. Official template: res_multistep.",
                    },
                ),
                "scheduler": (
                    comfy.samplers.KSampler.SCHEDULERS,
                    {
                        "default": "simple",
                        "tooltip": "Official template: BasicScheduler simple.",
                    },
                ),
                "shift_video": (
                    "FLOAT",
                    {"default": 12.0, "min": 0.01, "max": 100.0, "step": 0.01, "tooltip": "MiniMaxH3SigmaShift shift_video."},
                ),
                "shift_audio": (
                    "FLOAT",
                    {"default": 3.0, "min": 0.01, "max": 100.0, "step": 0.01, "tooltip": "MiniMaxH3SigmaShift shift_audio."},
                ),
                "sampler": (
                    "SAMPLER",
                    {
                        "tooltip": (
                            "External mode: connect KSamplerSelect or MiniMax-H3 Turbo Sampler."
                        )
                    },
                ),
                "sigmas": (
                    "SIGMAS",
                    {
                        "tooltip": (
                            "External mode: connect BasicScheduler or another standard "
                            "ComfyUI scheduler built from the same H3 MODEL."
                        )
                    },
                ),
                **director_perf_inputs(),
                "bd_grp_experimental": ("BDGROUP", {"default": "Experimental"}),
                "pin_renorm_enabled": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": (
                            "Re-normalize only the previous segment's "
                            "video latent tail to the first handoff std of the current "
                            "visual chain. Does not modify audio, source video, Picture "
                            "references, or RGB Color Re-anchor."
                        ),
                    },
                ),
                "postprocess_config": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                        "tooltip": "Internal Director post-processing and Output Preview configuration.",
                    },
                ),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    @classmethod
    def VALIDATE_INPUTS(cls, input_types=None, **_kwargs):
        if input_types is not None:
            expected = {
                "model": "MODEL",
                "video_vae": "VAE",
                "audio_vae": "VAE",
                "clip": "CLIP",
                "sampler": "SAMPLER",
                "sigmas": "SIGMAS",
            }
            for name, want in expected.items():
                got = input_types.get(name)
                if got is not None and got != want:
                    return f"{name}: expected {want}, linked node returns {got}."
        return True

    RETURN_TYPES = ("IMAGE", "AUDIO", "FLOAT", "INT", "IMAGE", "STRING")
    RETURN_NAMES = ("images", "audio", "fps", "frame_count", "source_images", "report")
    OUTPUT_IS_LIST = (True, True, False, False, True, False)
    FUNCTION = "execute"
    CATEGORY = _CATEGORY
    DESCRIPTION = (
        "MiniMax H3 Motion Director: exported video/audio Motion Context, "
        "MiniMaxH3ImageToVideo / ReferenceToVideo conditioning, internal KSampler "
        "or external SAMPLER+SIGMAS, and LTXVSeparateAVLatent decode. "
        "Supports t2v / i2v / fl2v / r2v / v2v / rv2v plus Mixed meta-mode. "
        "Optional i2v_groups / r2v_groups accept multi-group packs from Director Group nodes "
        "for standalone modes; Mixed v1 uses its own segment-local schema. "
        "Defaults: 0.4MP 16:9 (864×480), 5s / 124 frames @ 24 fps."
    )

    def execute(
        self,
        model,
        video_vae,
        audio_vae,
        clip,
        task_type,
        global_prompt,
        frame_rate,
        width,
        height,
        ref_max_size,
        total_frames,
        timeline_data,
        unique_id=None,
        i2v_groups=None,
        r2v_groups=None,
        motion_context_enabled=True,
        context_length=22,
        source_overlap_frames=5,
        audio_context_enabled=True,
        color_reanchor_enabled=False,
        steps=25,
        sampler_name="res_multistep",
        scheduler="simple",
        sampler=None,
        sigmas=None,
        cfg=1.0,
        seed=0,
        shift_video=12.0,
        shift_audio=3.0,
        clear_vram_between_segments=True,
        export_source_images=False,
        pin_renorm_enabled=False,
        postprocess_config="",
        prompt=None,
        extra_pnginfo=None,
        **kwargs,
    ):
        del kwargs

        final_run_id = FINAL_VIDEO_REGISTRY.begin_run(unique_id) if unique_id is not None else None

        plan = prepare_director_plan(
            timeline_data=timeline_data,
            task_type=task_type,
            global_prompt=global_prompt,
            total_frames=total_frames,
            frame_rate=frame_rate,
            width=width,
            height=height,
            ref_max_size=ref_max_size,
            unique_id=unique_id,
            motion_context_enabled=motion_context_enabled,
            i2v_groups=i2v_groups,
            r2v_groups=r2v_groups,
        )

        if bool(getattr(plan, "mixed_mode", False)):
            bind_mixed_runtime_node(plan, unique_id)
            source_overlap_frames = 0
            # Mixed boundary toggles are per-link requests. The visible node-level
            # Motion/Audio Context switches remain the user-controlled global masters;
            # executor_core combines master AND ContextLink for the actual handoff.

        combined, segment_outputs, segment_audios, report = execute_director_plan_core(
            plan,
            node_id=unique_id,
            model=model,
            vae=video_vae,
            audio_vae=audio_vae,
            clip=clip,
            cfg=cfg,
            seed=seed,
            steps=steps,
            sampler=sampler_name,
            scheduler=scheduler,
            shift_video=shift_video,
            shift_audio=shift_audio,
            external_sampler=sampler,
            external_sigmas=sigmas,
            motion_context_enabled=motion_context_enabled,
            context_length=context_length,
            source_overlap_frames=source_overlap_frames,
            audio_context_enabled=audio_context_enabled,
            color_reanchor_enabled=color_reanchor_enabled,
            pin_renorm_enabled=pin_renorm_enabled,
            clear_vram_between_segments=clear_vram_between_segments,
            postprocess_config=postprocess_config,
        )

        if bool(getattr(plan, "mixed_mode", False)):
            report = _append_mixed_dependency_report(plan, report)

        outputs = finalize_director_outputs(
            plan,
            combined,
            segment_outputs,
            report,
            export_source_images=export_source_images,
            segment_audios=segment_audios,
        )
        if final_run_id is not None:
            try:
                save_config = normalize_postprocess_config(postprocess_config)["save"]
                record, auto_result = FINAL_VIDEO_REGISTRY.register_final(
                    unique_id,
                    final_run_id,
                    images=outputs[0],
                    audio=outputs[1],
                    fps=outputs[2],
                    frame_count=outputs[3],
                    save_config=save_config,
                    prompt=prompt,
                    extra_pnginfo=extra_pnginfo,
                    segment_indices=[
                        int(getattr(segment, "timeline_index", segment.index))
                        for segment in (
                            plan.segments
                            if plan.export_mode == "all"
                            else [
                                plan.segments[index]
                                for index in sorted(
                                    plan.run_indices
                                    if plan.run_indices is not None
                                    else range(len(plan.segments))
                                )
                            ]
                        )
                    ],
                    segment_frame_counts=[
                        int(segment.frame_count)
                        for segment in (
                            plan.segments
                            if plan.export_mode == "all"
                            else [
                                plan.segments[index]
                                for index in sorted(
                                    plan.run_indices
                                    if plan.run_indices is not None
                                    else range(len(plan.segments))
                                )
                            ]
                        )
                    ],
                )
                final_payload = record.info()
                if auto_result is not None:
                    final_payload["auto_save"] = auto_result
                    if auto_result.get("ok", False):
                        outputs = (*outputs[:-1], outputs[-1] + (
                            "\n\n[Save Video]\nStatus: AUTO_SAVED"
                            f"\nPath: {auto_result.get('path') or auto_result.get('filename') or ''}"
                        ))
                    else:
                        outputs = (*outputs[:-1], outputs[-1] + (
                            "\n\n[Save Video]\nStatus: FAILED (generation result preserved)"
                            f"\nError: {auto_result.get('error') or 'Unknown save error'}"
                        ))
                report_director_final_ready(unique_id, final_payload)
            except Exception as exc:
                outputs = (*outputs[:-1], outputs[-1] + (
                    "\n\n[Save Video]\nStatus: FAILED (generation result preserved)"
                    f"\nError: {exc}"
                ))
                report_director_final_ready(unique_id, {
                    "run_id": final_run_id,
                    "ready": False,
                    "error": str(exc),
                })
        report_director_report(unique_id, outputs[-1])
        report_director_audio_preview(unique_id, outputs[1])
        return outputs
