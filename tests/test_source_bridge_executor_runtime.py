from __future__ import annotations

import importlib
from types import SimpleNamespace

import pytest
import torch

from _minimax_h3_motion_director_testpkg.director.context_links import ContextLink


def _segment(index: int, start: int, end: int, task_key: str):
    return SimpleNamespace(
        index=index,
        ui_index=None,
        timeline_index=index,
        start_frame=start,
        end_frame=end,
        frame_count=end - start,
        prompt="edit the source motion",
        negative_prompt="",
        task_type=task_key,
        task_key=task_key,
        source_clip=None,
        refs=[],
        ref_audios=[],
        ref_videos=[],
        ref_video_audios=[],
        reference_video_meta={},
        reference_video_start_frame=0,
    )


class _VAE:
    def __init__(self):
        self.anchor_inputs = []

    def encode(self, frames):
        self.anchor_inputs.append(frames.detach().cpu().clone())
        return torch.ones((1, 4, 1, 2, 2), dtype=torch.float32)


@pytest.mark.parametrize("task_key", ["v2v", "rv2v"])
@pytest.mark.parametrize("selection_run", [False, True])
@pytest.mark.parametrize("boundary_connected", [True, False])
def test_executor_runs_nominal_segments_then_native_bridge(
    monkeypatch, task_key, selection_run, boundary_connected
):
    """Runs with real ComfyUI imports when available; GPU/model work is mocked."""
    try:
        executor = importlib.import_module(
            "_minimax_h3_motion_director_testpkg.director.executor_core"
        )
    except (ImportError, ModuleNotFoundError) as exc:
        pytest.skip(f"full ComfyUI runtime is unavailable: {exc}")

    segments = [
        _segment(0, 0, 121, task_key),
        _segment(1, 121, 243, task_key),
    ]
    segments[1].context_link = ContextLink(
        boundary_connected,
        boundary_connected,
        False,
    )
    if task_key == "rv2v":
        for segment in segments:
            segment.refs = [
                SimpleNamespace(index=0, tensor=torch.full((1, 8, 8, 3), 0.25))
            ]
            segment.ref_audios = [
                SimpleNamespace(
                    index=0,
                    audio={
                        "waveform": torch.zeros(1, 1, 320),
                        "sample_rate": 32000,
                    },
                    audio_file="same.wav",
                )
            ]
    source = (5000 + torch.arange(243, dtype=torch.float32)).reshape(243, 1, 1, 1)
    plan = SimpleNamespace(
        frame_rate=24.0,
        total_frames=243,
        width=32,
        height=32,
        ref_max_size=32,
        output_mode="fixed",
        source_width=32,
        source_height=32,
        global_task_type=task_key,
        global_task_key=task_key,
        global_prompt="",
        global_refs=[],
        segments=segments,
        segment_count=2,
        source_video=source.repeat(1, 32, 32, 3),
        edit_mode="segmented",
        raw={"timelineMode": "gen_blank", "output": {"audioMode": "generate"}},
        source_total_frames=243,
        export_max_frames=0,
        export_mode="segments" if selection_run else "all",
        run_indices=frozenset({1}) if selection_run else None,
        continuity_enabled=False,
        continuity_overlap_frames=0,
        source_overlap_frames=0,
    )
    calls = []
    bridge_keyframes = []

    def fake_conditioning(**kwargs):
        call_index = len(calls)
        refs = kwargs.get("ref_videos") or {}
        calls.append(
            {
                "length": int(kwargs["length"]),
                "ref_length": int(refs["ref_video_0"].shape[0]),
                "ref_values": refs["ref_video_0"][:, 0, 0, 0].detach().cpu().tolist(),
                "first": kwargs.get("first_frame"),
                "last": kwargs.get("last_frame"),
                "ref_image_count": len(kwargs.get("ref_images") or {}),
                "ref_audio_count": len(kwargs.get("ref_audios") or {}),
            }
        )
        positive = [[torch.zeros(1), {"minimax_refs": [{"kind": "video"}]}]]
        return positive, [], {"requested_length": int(kwargs["length"]), "call": call_index}, "mock"

    def fake_sample(**kwargs):
        metadata = kwargs["positive"][0][1]
        if metadata.get("minimax_keyframes"):
            bridge_keyframes.extend(metadata["minimax_keyframes"])
        return kwargs["latent"]

    def fake_decode(samples, *_args, **_kwargs):
        count = int(samples["requested_length"])
        call = int(samples["call"])
        if call == 0:
            values = torch.arange(count, dtype=torch.float32)
        elif call == 1:
            values = torch.arange(121, 121 + count, dtype=torch.float32)
        else:
            values = torch.arange(1000, 1000 + count, dtype=torch.float32)
        frames = values.reshape(-1, 1, 1, 1).repeat(1, 32, 32, 3)
        audio = {
            "waveform": torch.full((1, 1, count * 10), float(call + 1)),
            "sample_rate": 240,
        }
        return frames, audio

    monkeypatch.setattr(executor, "plan_summary", lambda _plan: "mock plan")
    monkeypatch.setattr(executor, "run_minimax_conditioning", fake_conditioning)
    monkeypatch.setattr(executor, "sample_single_stage", fake_sample)
    monkeypatch.setattr(executor, "_decode_av_latent", fake_decode)
    monkeypatch.setattr(executor, "save_segment_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(executor, "load_segment_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(executor, "save_motion_context_cache", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(executor, "motion_context_patch_status", lambda: (True, "ok"))
    monkeypatch.setattr(
        executor,
        "apply_exported_motion_context",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("visual Motion Context must be skipped in Bridge mode")
        ),
    )
    monkeypatch.setattr(executor, "cleanup_segment_vram", lambda **_kwargs: None)
    monkeypatch.setattr(executor, "report_director_progress", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(executor, "report_director_finish", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(executor, "report_director_segment_preview", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(executor, "tensor_frame_to_jpeg_b64", lambda _frame: "jpeg")

    vae = _VAE()
    model = SimpleNamespace(model=SimpleNamespace(), model_options={})
    execute_kwargs = dict(
        plan=plan,
        node_id="runtime-test",
        model=model,
        vae=vae,
        audio_vae=object(),
        clip=object(),
        motion_context_enabled=True,
        source_overlap_frames=5,
        clear_vram_between_segments=False,
    )
    if selection_run:
        if not boundary_connected:
            combined, outputs, _audios, report = executor.execute_director_plan_core(
                **execute_kwargs
            )
            assert [call["length"] for call in calls] == [124]
            assert int(combined.shape[0]) == 122
            assert [int(tensor.shape[0]) for tensor in outputs] == [122]
            assert "source frames = 119..123" not in report
            return
        with pytest.raises(
            ValueError,
            match="Source Bridge requires both adjacent generated segments",
        ):
            executor.execute_director_plan_core(**execute_kwargs)
        assert [call["length"] for call in calls] == [124]
        return

    if not boundary_connected:
        combined, outputs, audios, report = executor.execute_director_plan_core(
            **execute_kwargs
        )
        assert [call["length"] for call in calls] == [124, 124]
        assert [int(tensor.shape[0]) for tensor in outputs] == [121, 122]
        assert int(combined.shape[0]) == 243
        assert len(audios) == 2
        assert "source frames = 119..123" not in report
        assert "Source Bridge" not in report.split("[Previous Context]", 1)[-1].split("[Latent Scale Lock]", 1)[0]
        return

    combined, outputs, audios, report = executor.execute_director_plan_core(
        **execute_kwargs
    )

    assert [call["length"] for call in calls] == [124, 124, 5]
    assert [call["ref_length"] for call in calls] == [124, 124, 5]
    assert calls[2]["ref_values"] == [5119, 5120, 5121, 5122, 5123]
    assert calls[2]["first"] is None and calls[2]["last"] is None
    if task_key == "rv2v":
        assert calls[2]["ref_image_count"] == 1
        assert calls[2]["ref_audio_count"] == 1
    assert [item["motion_context_index"] for item in bridge_keyframes] == [0, 4]
    assert [frames[0, 0, 0, 0].item() for frames in vae.anchor_inputs] == [119, 123]
    assert [int(tensor.shape[0]) for tensor in outputs] == [121, 122]
    assert int(combined.shape[0]) == 243
    assert combined[119:125, 0, 0, 0].tolist() == [119, 1001, 1002, 1003, 123, 124]
    assert float(combined.max()) < 5000.0
    assert len(audios) == 2
    assert [audio["waveform"].shape[-1] for audio in audios] == [1210, 1220]
    assert [audio["waveform"][0, 0, 0].item() for audio in audios] == [1, 2]
    assert "source frames = 119..123" in report
    assert "emitted bridge frames = 120..122" in report
