# Portions derived from ComfyUI_MiniMaxH3_Director
# Copyright AIMixer and contributors
# Originally licensed under Apache License 2.0
# Modified for MiniMax H3 Motion Director, 2026-08-09
# This derivative project is distributed under GPL-3.0.
# See NOTICE and LICENSES/Apache-2.0-AIMixer.txt.

"""WebSocket progress updates for MiniMax H3 Motion Director multi-segment runs."""

from __future__ import annotations

import logging
import base64
import io
import wave

import torch

log = logging.getLogger("ComfyUI-MiniMax-H3-Motion-Director.director")

DIRECTOR_PHASES = (
    "prepare",
    "context_encode",
    "sample",
    "global_upscale",
    "global_refine",
    "decode",
    "assemble",
    "face_refine",
    "finalize",
)

PHASE_LABELS = {
    "prepare": "准备片段",
    "context_encode": "H3 条件编码",
    "sample": "采样",
    "global_upscale": "全局精修 · 放大",
    "global_refine": "全局精修 · 二次采样",
    "decode": "AV 解码",
    "assemble": "多段组合",
    "face_refine": "人脸精修",
    "finalize": "最终结果 / 导出",
    "plan": "解析时间轴 / 加载视频",
    "finish": "全部完成",
}


def _phase_index(phase: str) -> int:
    try:
        return DIRECTOR_PHASES.index(phase)
    except ValueError:
        return 0


def report_director_progress(
    node_id: str | None,
    *,
    segment_index: int,
    segment_total: int,
    phase: str,
    phase_value: float = 0,
    phase_max: float = 1,
    frames_label: str = "",
    task_key: str = "",
    timeline_segment_index: int | None = None,
    timeline_segment_total: int | None = None,
) -> None:
    if not node_id:
        return

    phases_per = len(DIRECTOR_PHASES)
    overall_max = max(1, segment_total * phases_per)
    phase_fraction = max(0.0, min(1.0, phase_value / max(phase_max, 1)))
    overall_value = min(
        overall_max,
        segment_index * phases_per + _phase_index(phase) + phase_fraction,
    )

    remaining_segments = max(0, segment_total - segment_index - 1)
    if phase == "finish":
        overall_value = overall_max
        remaining_segments = 0

    timeline_seg = (
        timeline_segment_index + 1
        if timeline_segment_index is not None
        else segment_index + 1
    )
    timeline_total = timeline_segment_total if timeline_segment_total is not None else segment_total
    partial_run = (
        timeline_segment_total is not None
        and segment_total < timeline_segment_total
    )

    payload = {
        "node_id": str(node_id),
        "segment": segment_index + 1,
        "segment_total": segment_total,
        "timeline_segment": timeline_seg,
        "timeline_segment_total": timeline_total,
        "partial_run": partial_run,
        "phase": phase,
        "phase_label": PHASE_LABELS.get(phase, phase),
        "phase_value": phase_value,
        "phase_max": phase_max,
        "overall_value": overall_value,
        "overall_max": overall_max,
        "remaining_segments": remaining_segments,
        "frames_label": frames_label,
        "task_key": task_key,
    }

    try:
        from server import PromptServer

        srv = PromptServer.instance
        if srv:
            srv.send_sync("minimax_motion_director_progress", payload, srv.client_id)
            srv.send_progress_text("", str(node_id))
    except Exception as exc:
        log.debug("Director progress send skipped: %s", exc)

    try:
        from comfy_execution.progress import get_progress_state

        get_progress_state().update_progress(str(node_id), overall_value, overall_max)
    except Exception:
        pass


def report_director_segment_preview(
    node_id: str | None,
    *,
    segment_index: int,
    image_b64: str,
    width: int = 0,
    height: int = 0,
    frames: list[str] | None = None,
    fps: float = 24.0,
    live: bool = False,
    step: int | None = None,
    total_steps: int | None = None,
    stage: str = "Generation",
    media_type: str = "image/jpeg",
    result_kind: str = "segment",
) -> None:
    if not node_id or not image_b64:
        return
    payload = {
        "node_id": str(node_id),
        "segment_index": segment_index,
        "image_b64": image_b64,
        "width": width,
        "height": height,
        "live": bool(live),
        "stage": str(stage),
        "media_type": str(media_type),
        "result_kind": str(result_kind),
    }
    if frames:
        payload["frames"] = frames
        payload["fps"] = fps
    if step is not None:
        payload["step"] = int(step)
    if total_steps is not None:
        payload["total_steps"] = int(total_steps)
    try:
        from server import PromptServer

        srv = PromptServer.instance
        if srv:
            srv.send_sync("minimax_motion_director_preview", payload, srv.client_id)
    except Exception as exc:
        log.debug("Director preview send skipped: %s", exc)


def report_director_report(node_id: str | None, report: str) -> None:
    if not node_id:
        return
    try:
        from server import PromptServer

        srv = PromptServer.instance
        if srv:
            srv.send_sync(
                "minimax_motion_director_report",
                {"node_id": str(node_id), "report": str(report or "")},
                srv.client_id,
            )
    except Exception as exc:
        log.debug("Director report send skipped: %s", exc)


def report_director_audio_preview(node_id: str | None, audio_outputs) -> None:
    """Send CPU WAV side-channel data for Output volume/playback controls."""
    if not node_id:
        return
    audio = audio_outputs[0] if isinstance(audio_outputs, (list, tuple)) and audio_outputs else audio_outputs
    waveform = audio.get("waveform") if isinstance(audio, dict) else None
    sample_rate = int(audio.get("sample_rate") or 0) if isinstance(audio, dict) else 0
    if not isinstance(waveform, torch.Tensor) or waveform.numel() <= 0 or sample_rate <= 0:
        return
    try:
        samples = waveform.detach().float().cpu()
        while samples.ndim > 2:
            samples = samples[0]
        if samples.ndim == 1:
            samples = samples.unsqueeze(0)
        pcm = (samples.clamp(-1, 1).transpose(0, 1).contiguous().numpy() * 32767).astype("int16")
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            wav.setnchannels(int(pcm.shape[1]))
            wav.setsampwidth(2)
            wav.setframerate(sample_rate)
            wav.writeframes(pcm.tobytes())
        from server import PromptServer

        srv = PromptServer.instance
        if srv:
            srv.send_sync(
                "minimax_motion_director_audio",
                {
                    "node_id": str(node_id),
                    "audio_b64": base64.b64encode(buffer.getvalue()).decode("ascii"),
                    "media_type": "audio/wav",
                    "sample_rate": sample_rate,
                },
                srv.client_id,
            )
    except Exception as exc:
        log.debug("Director audio preview skipped: %s", exc)


def report_director_finish(node_id: str | None, segment_total: int) -> None:
    report_director_progress(
        node_id,
        segment_index=max(0, segment_total - 1),
        segment_total=max(1, segment_total),
        phase="finish",
        phase_value=1,
        phase_max=1,
    )


def report_director_planning(
    node_id: str | None,
    segment_total: int = 1,
    *,
    timeline_segment_total: int | None = None,
) -> None:
    report_director_progress(
        node_id,
        segment_index=0,
        segment_total=max(1, segment_total),
        phase="plan",
        phase_value=0,
        phase_max=1,
        timeline_segment_total=timeline_segment_total,
    )
