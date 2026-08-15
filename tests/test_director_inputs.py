import importlib.util
import json
import pathlib
import sys
import types

import torch

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "director" / "director_inputs.py"


def load_module():
    package = types.ModuleType("patchpkg")
    package.__path__ = [str(ROOT)]
    sys.modules.setdefault("patchpkg", package)
    director_pkg = types.ModuleType("patchpkg.director")
    director_pkg.__path__ = [str(ROOT / "director")]
    sys.modules.setdefault("patchpkg.director", director_pkg)

    plan = types.ModuleType("patchpkg.director.plan")

    class SegmentRef:
        def __init__(self, index, tensor, asset_id=""):
            self.index = index
            self.tensor = tensor
            self.asset_id = asset_id

    class SegmentRefVideo:
        def __init__(self, index, tensor, video_file="", meta=None, asset_id=""):
            self.index = index
            self.tensor = tensor
            self.video_file = video_file
            self.meta = meta or {}
            self.asset_id = asset_id

    class SegmentRefAudio:
        def __init__(self, index, audio, audio_file="", asset_id=""):
            self.index = index
            self.audio = audio
            self.audio_file = audio_file
            self.asset_id = asset_id

    plan.SegmentRef = SegmentRef
    plan.SegmentRefVideo = SegmentRefVideo
    plan.SegmentRefAudio = SegmentRefAudio
    plan.reinforce_r2v_prompt = lambda prompt, **_: prompt
    plan.reinforce_rv2v_prompt = lambda prompt, **_: prompt
    plan.reinforce_v2v_prompt = lambda prompt: prompt
    sys.modules["patchpkg.director.plan"] = plan

    cache = types.ModuleType("patchpkg.director.context_cache")
    cache.tensor_fingerprint = lambda tensor: {
        "shape": list(tensor.shape),
        "sum": float(tensor.float().sum().item()),
    }
    sys.modules["patchpkg.director.context_cache"] = cache

    task_prompts = types.ModuleType("patchpkg.lib.task_prompts")
    task_prompts.resolve_task_key = lambda value: str(value).split()[0].split("—")[0].strip().lower()
    lib_pkg = types.ModuleType("patchpkg.lib")
    lib_pkg.__path__ = [str(ROOT / "lib")]
    sys.modules.setdefault("patchpkg.lib", lib_pkg)
    sys.modules["patchpkg.lib.task_prompts"] = task_prompts

    spec = importlib.util.spec_from_file_location(
        "patchpkg.director.director_inputs", MODULE_PATH
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def image(value=0.25, frames=1):
    return torch.full((frames, 8, 12, 3), value, dtype=torch.float32)


def audio():
    return {"waveform": torch.zeros((1, 1, 160)), "sample_rate": 16000}


def test_parse_dynamic_input_name_is_one_based_and_mode_specific():
    m = load_module()
    assert m.parse_dynamic_input_name("ref_prompt_1") == ("r2v", "prompt", 1)
    assert m.parse_dynamic_input_name("rv_assets_12") == ("rv2v", "assets", 12)
    assert m.parse_dynamic_input_name("text_prompt_0") is None
    assert m.parse_dynamic_input_name("ref_assets_0") is None
    assert m.parse_dynamic_input_name("text_assets_1") is None


def test_pack_director_inputs_rejects_mixed_modes():
    m = load_module()
    try:
        m.pack_director_inputs_payload(
            text_prompt_1="a",
            ref_prompt_1="b",
        )
    except ValueError as exc:
        assert "mixed" in str(exc).lower()
    else:
        raise AssertionError("mixed mode payload must fail")


def test_asset_bundle_uses_one_based_slots():
    m = load_module()
    bundle = m.pack_assets_payload(
        image_1=image(0.1),
        image_9=image(0.9),
        video_1=image(0.2, frames=5),
        audio_3=audio(),
    )
    assert sorted(bundle["images"]) == [1, 9]
    assert sorted(bundle["videos"]) == [1]
    assert sorted(bundle["audios"]) == [3]


def test_validate_i2v_assets_accepts_only_image_1():
    m = load_module()
    good = m.pack_assets_payload(image_1=image())
    m.validate_assets_for_mode("i2v", 1, good)

    bad = m.pack_assets_payload(image_2=image())
    try:
        m.validate_assets_for_mode("i2v", 1, bad)
    except ValueError as exc:
        assert "image_1" in str(exc)
    else:
        raise AssertionError("i2v image_2 must fail")


def test_validate_rv2v_rejects_extra_reference_video():
    m = load_module()
    bundle = m.pack_assets_payload(video_1=image(frames=5))
    try:
        m.validate_assets_for_mode("rv2v", 1, bundle)
    except ValueError as exc:
        assert "video" in str(exc).lower()
    else:
        raise AssertionError("rv2v external reference video must fail")


def test_prepare_timeline_rejects_internal_external_media_collision():
    m = load_module()
    timeline = {
        "segments": [
            {
                "prompt": "inside",
                "refs": [{"index": 0, "imageFile": "inside.png"}],
            }
        ]
    }
    payload = m.pack_director_inputs_payload(
        ref_assets_1=m.pack_assets_payload(image_1=image())
    )
    try:
        m.prepare_timeline_for_director_inputs(
            json.dumps(timeline),
            task_type="r2v",
            director_inputs=payload,
            motion_context_enabled=True,
        )
    except ValueError as exc:
        assert "group 1" in str(exc).lower()
        assert "internal" in str(exc).lower()
    else:
        raise AssertionError("internal/external media collision must fail")


def test_prepare_i2v_injects_external_image_for_preplan_validation():
    m = load_module()
    timeline = {
        "editMode": "segment",
        "segments": [{"prompt": ""}],
    }
    payload = m.pack_director_inputs_payload(
        image_prompt_1="external prompt",
        image_assets_1=m.pack_assets_payload(image_1=image(0.6)),
    )
    effective, parsed = m.prepare_timeline_for_director_inputs(
        json.dumps(timeline),
        task_type="i2v",
        director_inputs=payload,
        motion_context_enabled=True,
    )
    data = json.loads(effective)
    assert data["segments"][0]["prompt"] == "external prompt"
    assert data["segments"][0]["genImage"]["imageB64"].startswith("data:image/png;base64,")
    assert parsed["groups"][1]["assets_connected"] is True


def test_apply_r2v_assets_maps_one_based_bundle_to_h3_zero_based_refs():
    m = load_module()
    seg = types.SimpleNamespace(
        prompt="scene",
        refs=[],
        ref_videos=[],
        ref_audios=[],
        ref_video_audios=[],
        source_clip=None,
    )
    plan = types.SimpleNamespace(global_task_key="r2v", segments=[seg], raw={})
    payload = m.pack_director_inputs_payload(
        ref_prompt_1="external scene",
        ref_assets_1=m.pack_assets_payload(
            image_1=image(0.1),
            image_2=image(0.2),
            video_1=image(0.3, frames=5),
            audio_1=audio(),
        ),
    )

    out = m.apply_director_inputs_to_plan(plan, payload)

    assert out is plan
    assert seg.prompt == "external scene"
    assert [ref.index for ref in seg.refs] == [0, 1]
    assert [ref.index for ref in seg.ref_videos] == [0]
    assert [ref.index for ref in seg.ref_audios] == [0]
    assert seg.ref_video_audios == []
    assert plan.raw["directorExternalInputs"]["mode"] == "r2v"


def test_apply_fl2v_assets_maps_image_1_and_2_to_first_last_refs():
    m = load_module()
    seg = types.SimpleNamespace(
        prompt="",
        refs=[],
        ref_videos=[],
        ref_audios=[],
        ref_video_audios=[],
        source_clip=None,
    )
    plan = types.SimpleNamespace(global_task_key="fl2v", segments=[seg], raw={})
    payload = m.pack_director_inputs_payload(
        fl_assets_1=m.pack_assets_payload(
            image_1=image(0.15),
            image_2=image(0.85),
        )
    )

    m.apply_director_inputs_to_plan(plan, payload)
    assert [ref.index for ref in seg.refs] == [0, 1]


def test_prompt_only_external_input_does_not_trigger_media_conflict():
    m = load_module()
    timeline = {
        "segments": [
            {
                "prompt": "inside",
                "refs": [{"index": 0, "imageFile": "inside.png"}],
            }
        ]
    }
    payload = m.pack_director_inputs_payload(ref_prompt_1="outside")
    effective, parsed = m.prepare_timeline_for_director_inputs(
        json.dumps(timeline),
        task_type="r2v",
        director_inputs=payload,
        motion_context_enabled=True,
    )
    data = json.loads(effective)
    assert data["segments"][0]["prompt"] == "outside"
    assert parsed["groups"][1]["assets_connected"] is False
