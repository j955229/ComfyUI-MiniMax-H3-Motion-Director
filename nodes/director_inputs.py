"""Unified graph input nodes for MiniMax H3 Motion Director."""

from __future__ import annotations

from ..director.director_inputs import (
    MMX_MOTION_DIR_ASSETS,
    MMX_MOTION_DIR_INPUTS,
    DynamicDirectorAssetTypes,
    DynamicDirectorInputTypes,
    apply_director_inputs_to_plan,
    pack_assets_payload,
    pack_director_inputs_payload,
    prepare_timeline_for_director_inputs,
)
from ..director.executor_core import execute_director_plan_core
from ..director.execution_report import append_report_section_lines, fmt_seconds
from ..director.postprocess_config import normalize_postprocess_config
from ..director.progress import (
    report_director_audio_preview,
    report_director_complete,
    report_director_final_ready,
    report_director_progress,
    report_director_report,
)
from ..director.rtx_deblur import apply_rtx_deblur
from ..director.video_export import FINAL_VIDEO_REGISTRY
from .director import MiniMaxH3MotionDirector as _BaseDirector
from .director_common import (
    default_timeline_json,
    finalize_director_outputs,
    prepare_director_plan,
)

_CATEGORY = "MiniMaxH3"
_INPUT_CATEGORY = "MiniMaxH3/Director"


class MiniMaxH3MotionDirectorAssets:
    """Pack one Director group's mode-specific external media bundle."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": DynamicDirectorAssetTypes(),
        }

    RETURN_TYPES = (MMX_MOTION_DIR_ASSETS,)
    RETURN_NAMES = ("assets",)
    FUNCTION = "pack"
    CATEGORY = _INPUT_CATEGORY
    DESCRIPTION = (
        "Mode-specific media bundle controlled by the connected Director Inputs socket. "
        "FL2V exposes first/last image only; R2V exposes Picture 1-9, Video 1-3 and Audio 1-3; "
        "RV2V exposes Picture 1-9 and Audio 1-3."
    )

    def pack(self, **kwargs):
        return (pack_assets_payload(**kwargs),)


class MiniMaxH3MotionDirectorInputs:
    """Director-controlled dynamic prompt/assets sockets."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": DynamicDirectorInputTypes(),
        }

    RETURN_TYPES = (MMX_MOTION_DIR_INPUTS,)
    RETURN_NAMES = ("director_inputs",)
    FUNCTION = "pack"
    CATEGORY = _INPUT_CATEGORY
    DESCRIPTION = (
        "Connect this node to MiniMax H3 Motion Director.director_inputs. "
        "The Director controls mode and group count: T2V prompt-only, I2V prompt + direct IMAGE, "
        "FL2V/R2V/RV2V prompt + mode-specific Director Assets."
    )

    def pack(self, **kwargs):
        return (pack_director_inputs_payload(**kwargs),)


class MiniMaxH3MotionDirector(_BaseDirector):
    """Public Director schema using the unified Director Inputs socket."""

    @classmethod
    def INPUT_TYPES(cls):
        base = _BaseDirector.INPUT_TYPES()
        schema = {
            "required": dict(base.get("required") or {}),
            "optional": dict(base.get("optional") or {}),
            "hidden": dict(base.get("hidden") or {}),
        }

        optional = schema["optional"]
        optional.pop("i2v_groups", None)
        optional.pop("r2v_groups", None)

        # This socket must be the final visible input on the left side.  Custom
        # data types are link-only, so appending it does not disturb widgets_values.
        optional.pop("director_inputs", None)
        optional["director_inputs"] = (
            MMX_MOTION_DIR_INPUTS,
            {
                "forceInput": True,
                "tooltip": (
                    "Unified external prompts/assets. Connect MiniMax H3 Motion "
                    "Director Inputs. Mode and group count are controlled by this Director."
                ),
            },
        )
        return schema

    DESCRIPTION = (
        "MiniMax H3 Motion Director with one unified director_inputs socket. "
        "Supports t2v / i2v / fl2v / r2v / v2v / rv2v."
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
        director_inputs=None,
        prompt=None,
        extra_pnginfo=None,
        **kwargs,
    ):
        del kwargs

        final_run_id = (
            FINAL_VIDEO_REGISTRY.begin_run(unique_id)
            if unique_id is not None
            else None
        )

        effective_timeline_data = timeline_data
        if not str(effective_timeline_data or "").strip():
            effective_timeline_data = default_timeline_json(
                task_type=task_type,
                global_prompt=global_prompt,
                total_frames=total_frames,
                frame_rate=frame_rate,
                width=width,
                height=height,
                ref_max_size=ref_max_size,
            )

        effective_timeline_data, normalized_inputs = prepare_timeline_for_director_inputs(
            effective_timeline_data,
            task_type=task_type,
            director_inputs=director_inputs,
            motion_context_enabled=motion_context_enabled,
        )

        plan = prepare_director_plan(
            timeline_data=effective_timeline_data,
            task_type=task_type,
            global_prompt=global_prompt,
            total_frames=total_frames,
            frame_rate=frame_rate,
            width=width,
            height=height,
            ref_max_size=ref_max_size,
            unique_id=unique_id,
            motion_context_enabled=motion_context_enabled,
            i2v_groups=None,
            r2v_groups=None,
        )
        apply_director_inputs_to_plan(plan, normalized_inputs)

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

        postprocess = normalize_postprocess_config(postprocess_config)
        deblur_config = postprocess["global_refine"]
        deblur_requested = bool(deblur_config.get("rtx_deblur_enabled"))
        deblur_enabled = bool(deblur_config.get("enabled")) and deblur_requested
        progress_total = max(
            1,
            len(plan.run_indices) if plan.run_indices is not None else len(plan.segments),
        )
        deblur_total = max(1, int(combined.shape[0]))

        def _report_deblur_progress(done: int, total: int) -> None:
            if not deblur_enabled:
                return
            report_director_progress(
                unique_id,
                segment_index=max(0, progress_total - 1),
                segment_total=progress_total,
                phase="rtx_deblur",
                phase_value=int(done),
                phase_max=max(1, int(total)),
            )

        if deblur_enabled:
            _report_deblur_progress(0, deblur_total)
        deblur_outcome = apply_rtx_deblur(
            deblur_config,
            images=combined,
            on_progress=_report_deblur_progress if deblur_enabled else None,
        )
        if deblur_enabled:
            _report_deblur_progress(deblur_total, deblur_total)

        if deblur_outcome.succeeded:
            combined = deblur_outcome.images
            lengths = [int(chunk.shape[0]) for chunk in segment_outputs]
            if sum(lengths) == int(combined.shape[0]):
                refined_segments = []
                cursor = 0
                for length in lengths:
                    refined_segments.append(combined[cursor : cursor + length])
                    cursor += length
                segment_outputs = refined_segments

        report = append_report_section_lines(
            report,
            "RTX Deblur",
            [
                f"Enabled: {'ON' if deblur_enabled else 'OFF'}",
                (
                    "Reason: Global Refine disabled"
                    if deblur_requested and not deblur_config.get("enabled")
                    else ""
                ),
                f"Quality: {str(deblur_outcome.quality).title()}",
                f"Frames: {int(deblur_outcome.frames)}",
                (
                    f"Resolution: {int(deblur_outcome.width)}x{int(deblur_outcome.height)}"
                    if deblur_outcome.width and deblur_outcome.height
                    else "Resolution: n/a"
                ),
                f"Status: {deblur_outcome.status}",
                f"Timing: {fmt_seconds(deblur_outcome.seconds)}",
                f"Error: {deblur_outcome.error}" if deblur_outcome.error else "",
                (
                    "Fallback: PRE_DEBLUR_RESULT"
                    if deblur_outcome.status in {"FAILED", "UNAVAILABLE"}
                    else ""
                ),
            ],
        )
        if deblur_outcome.status in {"FAILED", "UNAVAILABLE"}:
            report = append_report_section_lines(
                report,
                "Warnings",
                [
                    f"- RTX Deblur {deblur_outcome.status}; pre-Deblur frames preserved — "
                    f"{deblur_outcome.error or 'unknown error'}"
                ],
            )
            report = report.replace(
                "[Final]\nStatus: SUCCESS",
                "[Final]\nStatus: SUCCESS_WITH_WARNING",
                1,
            )

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
                save_config = postprocess["save"]
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
                report_director_final_ready(
                    unique_id,
                    {
                        "run_id": final_run_id,
                        "ready": False,
                        "error": str(exc),
                    },
                )

        report_director_report(unique_id, outputs[-1])
        report_director_audio_preview(unique_id, outputs[1])
        report_director_complete(unique_id, progress_total)
        return outputs
