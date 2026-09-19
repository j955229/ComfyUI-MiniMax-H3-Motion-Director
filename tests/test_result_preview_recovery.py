import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch

import torch


ROOT = Path(__file__).resolve().parents[1]


def load_progress_module():
    spec = importlib.util.spec_from_file_location("minimax_director_progress_test", ROOT / "director/progress.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_result_preview_indices_are_bounded_and_span_the_video():
    progress = load_progress_module()

    assert progress.result_preview_indices(0) == []
    assert progress.result_preview_indices(5) == [0, 1, 2, 3, 4]
    assert progress.result_preview_indices(100, 4) == [0, 33, 66, 99]

    indices = progress.result_preview_indices(729, 32)
    assert len(indices) == 32
    assert indices[0] == 0
    assert indices[-1] == 728
    assert len(set(indices)) == len(indices)


def test_latest_result_snapshot_recovers_bounded_preview():
    progress = load_progress_module()
    events = []

    class FakeServer:
        client_id = "test-client"

        def send_sync(self, event, payload, _client_id):
            events.append((event, payload))

        def send_progress_text(self, _text, _node_id):
            pass

    fake_server_module = SimpleNamespace(PromptServer=SimpleNamespace(instance=FakeServer()))
    with patch.dict(sys.modules, {"server": fake_server_module}):
        node_id = "director-1"
        frames = [f"frame-{index}" for index in range(100)]
        progress.report_director_segment_preview(
            node_id,
            segment_index=0,
            image_b64=frames[0],
            frames=frames,
            frame_count=729,
        )
        progress.report_director_report(node_id, "complete")
        progress.report_director_final_ready(node_id, {"ready": True, "run_id": "run-1"})

    snapshot = progress.director_result_snapshot(node_id)
    assert snapshot["report"] == "complete"
    assert snapshot["final_ready"]["run_id"] == "run-1"
    assert snapshot["previews"][0]["frame_count"] == 729
    assert len(snapshot["previews"][0]["frames"]) == progress.MAX_RESULT_PREVIEW_FRAMES
    assert len(events[0][1]["frames"]) == progress.MAX_RESULT_PREVIEW_FRAMES
    preview = snapshot["previews"][0]
    assert abs(
        (len(preview["frames"]) - 1) / preview["preview_fps"]
        - (preview["frame_count"] - 1) / preview["fps"]
    ) < 1e-9

    with patch.dict(sys.modules, {"server": fake_server_module}):
        for segment_index in range(progress.MAX_RESULT_SNAPSHOT_PREVIEWS + 4):
            progress.report_director_segment_preview(
                node_id,
                segment_index=segment_index,
                image_b64="frame",
                frames=["frame"],
            )
    assert len(progress.director_result_snapshot(node_id)["previews"]) == progress.MAX_RESULT_SNAPSHOT_PREVIEWS

    with patch.dict(sys.modules, {"server": fake_server_module}):
        progress.report_director_planning(node_id)
    assert progress.director_result_snapshot(node_id) is None


def test_results_ui_requests_latest_snapshot():
    source = (ROOT / "web/js/minimax_output_ui.mjs").read_text(encoding="utf-8")
    routes = (ROOT / "director/http_routes.py").read_text(encoding="utf-8")

    assert "/minimax/motion-director/latest_result?node_id=" in source
    assert "void restoreLatestResult();" in source
    assert "activeResult()?.preview_fps" in source
    assert '"GET", "/minimax/motion-director/latest_result"' in routes
    assert 'body.get("run_id")' in routes


def test_stale_ui_release_cannot_clear_a_newer_run():
    from director.video_export import FinalVideoRegistry, FinalVideoUnavailable

    registry = FinalVideoRegistry(
        video_factory=lambda images, audio, fps: SimpleNamespace(images=images, audio=audio, fps=fps),
    )
    old_run = registry.begin_run("director-1")
    new_run = registry.begin_run("director-1")

    assert registry.release("director-1", old_run) is False
    record, _auto_result = registry.register_final(
        "director-1",
        new_run,
        images=torch.zeros((2, 2, 2, 3)),
        audio=None,
        fps=24,
        frame_count=2,
        save_config={"auto_save": False},
    )
    assert registry.get("director-1", new_run) is record
    assert registry.release("director-1", new_run) is True

    try:
        registry.get("director-1", new_run)
    except FinalVideoUnavailable:
        pass
    else:
        raise AssertionError("matching release must clear the completed result")
