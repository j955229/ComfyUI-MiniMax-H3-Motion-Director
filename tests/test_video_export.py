from __future__ import annotations

import sys
import types
from enum import Enum

import pytest

from _minimax_h3_motion_director_testpkg.director.video_export import (
    FinalVideoRegistry,
    StaleFinalVideoRun,
    _safe_filename_prefix,
    save_final_video,
)


class FakeVideo:
    def __init__(self):
        self.saved = []

    def save_to(self, *args, **kwargs):
        self.saved.append((args, kwargs))

    def get_dimensions(self):
        return 864, 480


def test_final_video_contains_images_audio_and_fps_and_manual_save_reuses_it():
    made = []
    saved = []

    def factory(images, audio, fps):
        made.append((images, audio, fps))
        return FakeVideo()

    def saver(record, config):
        record.video.save_to("result.mp4", format=config["format"])
        saved.append(record.run_id)
        return {"filename": "result.mp4", "run_id": record.run_id}

    registry = FinalVideoRegistry(video_factory=factory, saver=saver)
    run_id = registry.begin_run("7")
    record, auto = registry.register_final(
        "7", run_id, images="final-images", audio="generated-audio", fps=24, frame_count=48,
        save_config={"auto_save": False},
    )
    assert auto is None
    assert made == [("final-images", "generated-audio", 24.0)]

    first = registry.save("7", run_id, {"format": "mp4"})
    second = registry.save("7", run_id, {"format": "mp4"})
    assert first["filename"] == second["filename"] == "result.mp4"
    assert saved == [run_id, run_id]
    assert len(record.video.saved) == 2
    assert len(made) == 1


def test_auto_save_runs_exactly_once_per_run_but_new_run_can_save():
    saves = []
    registry = FinalVideoRegistry(
        video_factory=lambda *_args: FakeVideo(),
        saver=lambda record, _config: saves.append(record.run_id) or {"run_id": record.run_id},
    )
    first = registry.begin_run("7")
    registry.register_final("7", first, images=1, audio=2, fps=24, frame_count=1, save_config={"auto_save": True})
    registry.register_final("7", first, images=1, audio=2, fps=24, frame_count=1, save_config={"auto_save": True})
    assert saves == [first]

    second = registry.begin_run("7")
    registry.register_final("7", second, images=1, audio=2, fps=24, frame_count=1, save_config={"auto_save": True})
    assert saves == [first, second]
    with pytest.raises(StaleFinalVideoRun):
        registry.save("7", first, {"format": "mp4"})


def test_releasing_a_node_invalidates_its_runtime_video_reference():
    registry = FinalVideoRegistry(video_factory=lambda *_args: FakeVideo(), saver=lambda *_args: {})
    run_id = registry.begin_run("7")
    registry.register_final("7", run_id, images=1, audio=2, fps=24, frame_count=1, save_config={})
    registry.release("7")
    with pytest.raises(Exception, match="released"):
        registry.save("7", run_id, {})


def test_native_saver_uses_comfy_counter_metadata_and_video_save_to(monkeypatch, tmp_path):
    class VideoContainer(str, Enum):
        AUTO = "auto"
        MP4 = "mp4"

        @classmethod
        def as_input(cls):
            return [item.value for item in cls]

        @classmethod
        def get_extension(cls, _value):
            return "mp4"

    class VideoCodec(str, Enum):
        AUTO = "auto"
        H264 = "h264"

        @classmethod
        def as_input(cls):
            return [item.value for item in cls]

    latest = types.ModuleType("comfy_api.latest")
    latest.Types = types.SimpleNamespace(VideoContainer=VideoContainer, VideoCodec=VideoCodec)
    monkeypatch.setitem(sys.modules, "comfy_api", types.ModuleType("comfy_api"))
    monkeypatch.setitem(sys.modules, "comfy_api.latest", latest)

    import folder_paths

    monkeypatch.setattr(folder_paths, "get_output_directory", lambda: str(tmp_path))
    monkeypatch.setattr(
        folder_paths,
        "get_save_image_path",
        lambda prefix, output, width, height: (str(tmp_path / "video"), "MiniMaxH3_Director", 3, "video", prefix),
        raising=False,
    )
    video = FakeVideo()
    from _minimax_h3_motion_director_testpkg.director.video_export import FinalVideoRecord

    record = FinalVideoRecord("7", "run", video, 24, 48, prompt={"prompt": True}, extra_pnginfo={"workflow": {}})
    result = save_final_video(record, {
        "filename_prefix": "video/MiniMaxH3_Director", "format": "mp4", "codec": "h264",
        "encoding": "re-encode", "crf": 21,
    })
    assert result["path"] == "video/MiniMaxH3_Director_00003_.mp4"
    assert len(video.saved) == 1
    args, kwargs = video.saved[0]
    assert args[0].endswith("MiniMaxH3_Director_00003_.mp4")
    assert kwargs["format"] == VideoContainer.MP4
    assert kwargs["codec"] == "h264"
    assert kwargs["crf"] == 21
    assert kwargs["metadata"] == {"workflow": {}, "prompt": {"prompt": True}}


def test_native_saver_rejects_output_directory_traversal():
    with pytest.raises(ValueError, match="output directory"):
        _safe_filename_prefix("../outside")
