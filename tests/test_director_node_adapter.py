import importlib.util
import pathlib
import sys
import types

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "nodes" / "director_inputs.py"


def load_module():
    package = types.ModuleType("patchpkg")
    package.__path__ = [str(ROOT)]
    sys.modules["patchpkg"] = package

    nodes_pkg = types.ModuleType("patchpkg.nodes")
    nodes_pkg.__path__ = [str(ROOT / "nodes")]
    sys.modules["patchpkg.nodes"] = nodes_pkg

    director_pkg = types.ModuleType("patchpkg.director")
    director_pkg.__path__ = [str(ROOT / "director")]
    sys.modules["patchpkg.director"] = director_pkg

    base_mod = types.ModuleType("patchpkg.nodes.director")

    class BaseDirector:
        @classmethod
        def INPUT_TYPES(cls):
            return {
                "required": {
                    "model": ("MODEL",),
                    "clip": ("CLIP",),
                },
                "optional": {
                    "i2v_groups": ("MMX_MOTION_DIR_GROUP",),
                    "r2v_groups": ("MMX_MOTION_DIR_GROUP",),
                    "sampler": ("SAMPLER",),
                    "sigmas": ("SIGMAS",),
                    "postprocess_config": ("STRING",),
                },
                "hidden": {"unique_id": "UNIQUE_ID"},
            }

        RETURN_TYPES = ("IMAGE",)
        RETURN_NAMES = ("images",)
        OUTPUT_IS_LIST = (True,)
        FUNCTION = "execute"
        CATEGORY = "MiniMaxH3"
        DESCRIPTION = "base"

    base_mod.MiniMaxH3MotionDirector = BaseDirector
    sys.modules["patchpkg.nodes.director"] = base_mod

    common = types.ModuleType("patchpkg.nodes.director_common")
    common.default_timeline_json = lambda **_: '{"segments":[{}]}'
    common.finalize_director_outputs = lambda *args, **kwargs: args[1:]
    common.prepare_director_plan = lambda **kwargs: types.SimpleNamespace(
        segments=[types.SimpleNamespace(prompt="", refs=[], ref_audios=[], ref_videos=[], ref_video_audios=[], source_clip=None)],
        global_task_key="t2v",
        raw={},
    )
    sys.modules["patchpkg.nodes.director_common"] = common

    helper = types.ModuleType("patchpkg.director.director_inputs")
    helper.MMX_MOTION_DIR_INPUTS = "MMX_MOTION_DIR_INPUTS"
    helper.MMX_MOTION_DIR_ASSETS = "MMX_MOTION_DIR_ASSETS"

    class DynamicDirectorInputTypes(dict):
        pass

    class DynamicDirectorAssetTypes(dict):
        pass

    helper.DynamicDirectorInputTypes = DynamicDirectorInputTypes
    helper.DynamicDirectorAssetTypes = DynamicDirectorAssetTypes
    helper.pack_assets_payload = lambda **kwargs: kwargs
    helper.pack_director_inputs_payload = lambda **kwargs: kwargs
    helper.prepare_timeline_for_director_inputs = lambda timeline_data, **kwargs: (timeline_data, kwargs.get("director_inputs"))
    helper.apply_director_inputs_to_plan = lambda plan, _payload: plan
    sys.modules["patchpkg.director.director_inputs"] = helper

    executor = types.ModuleType("patchpkg.director.executor_core")
    executor.execute_director_plan_core = lambda *args, **kwargs: (None, [], [], "")
    sys.modules["patchpkg.director.executor_core"] = executor

    post = types.ModuleType("patchpkg.director.postprocess_config")
    post.normalize_postprocess_config = lambda _value: {"save": {}}
    sys.modules["patchpkg.director.postprocess_config"] = post

    progress = types.ModuleType("patchpkg.director.progress")
    progress.report_director_audio_preview = lambda *args, **kwargs: None
    progress.report_director_final_ready = lambda *args, **kwargs: None
    progress.report_director_report = lambda *args, **kwargs: None
    sys.modules["patchpkg.director.progress"] = progress

    video = types.ModuleType("patchpkg.director.video_export")

    class Registry:
        @staticmethod
        def begin_run(_uid):
            return None

    video.FINAL_VIDEO_REGISTRY = Registry()
    sys.modules["patchpkg.director.video_export"] = video

    spec = importlib.util.spec_from_file_location(
        "patchpkg.nodes.director_inputs", MODULE_PATH
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_director_schema_replaces_old_group_inputs_and_appends_new_socket_last():
    m = load_module()
    schema = m.MiniMaxH3MotionDirector.INPUT_TYPES()
    optional = schema["optional"]

    assert "i2v_groups" not in optional
    assert "r2v_groups" not in optional
    assert list(optional)[-1] == "director_inputs"
    assert optional["director_inputs"][0] == "MMX_MOTION_DIR_INPUTS"


def test_assets_node_uses_dynamic_optional_mapping():
    m = load_module()
    schema = m.MiniMaxH3MotionDirectorAssets.INPUT_TYPES()

    assert schema["required"] == {}
    assert isinstance(schema["optional"], m.DynamicDirectorAssetTypes)
    assert m.MiniMaxH3MotionDirectorAssets.RETURN_TYPES == ("MMX_MOTION_DIR_ASSETS",)
    assert m.MiniMaxH3MotionDirectorAssets.RETURN_NAMES == ("assets",)


def test_inputs_node_exposes_dynamic_optional_mapping_and_single_bundle_output():
    m = load_module()
    schema = m.MiniMaxH3MotionDirectorInputs.INPUT_TYPES()

    assert schema["required"] == {}
    assert isinstance(schema["optional"], m.DynamicDirectorInputTypes)
    assert m.MiniMaxH3MotionDirectorInputs.RETURN_TYPES == ("MMX_MOTION_DIR_INPUTS",)
    assert m.MiniMaxH3MotionDirectorInputs.RETURN_NAMES == ("director_inputs",)


def test_director_execute_prepares_external_timeline_then_overlays_plan_before_sampling():
    m = load_module()
    calls = []
    payload = {"version": 1, "mode": "r2v", "groups": {}}
    plan = types.SimpleNamespace(segments=[], global_task_key="r2v", raw={})

    def prepare_timeline(timeline_data, **kwargs):
        calls.append(("timeline", timeline_data, kwargs["director_inputs"]))
        return "effective-json", payload

    def prepare_plan(**kwargs):
        calls.append(("plan", kwargs["timeline_data"]))
        return plan

    def overlay(actual_plan, actual_payload):
        calls.append(("overlay", actual_plan is plan, actual_payload is payload))
        actual_plan.overlayed = True
        return actual_plan

    def sample(actual_plan, **_kwargs):
        calls.append(("sample", getattr(actual_plan, "overlayed", False)))
        return object(), [], [], "report"

    m.prepare_timeline_for_director_inputs = prepare_timeline
    m.prepare_director_plan = prepare_plan
    m.apply_director_inputs_to_plan = overlay
    m.execute_director_plan_core = sample
    m.finalize_director_outputs = lambda *_args, **_kwargs: (
        [object()],
        [{}],
        24.0,
        1,
        [object()],
        "report",
    )

    node = m.MiniMaxH3MotionDirector()
    result = node.execute(
        model=object(),
        video_vae=object(),
        audio_vae=object(),
        clip=object(),
        task_type="r2v",
        global_prompt="",
        frame_rate=24.0,
        width=864,
        height=480,
        ref_max_size=864,
        total_frames=124,
        timeline_data='{"segments":[{}]}',
        director_inputs=payload,
    )

    assert result[-1] == "report"
    assert [entry[0] for entry in calls[:4]] == ["timeline", "plan", "overlay", "sample"]
    assert calls[1][1] == "effective-json"
    assert calls[3][1] is True
