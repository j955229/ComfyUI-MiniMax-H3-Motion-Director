import importlib.util
import pathlib
import sys
import types

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "nodes" / "director_output.py"


def load_module():
    package = types.ModuleType("patchpkg")
    package.__path__ = [str(ROOT)]
    sys.modules["patchpkg"] = package

    nodes_pkg = types.ModuleType("patchpkg.nodes")
    nodes_pkg.__path__ = [str(ROOT / "nodes")]
    sys.modules["patchpkg.nodes"] = nodes_pkg

    unified = types.ModuleType("patchpkg.nodes.director_inputs")

    class UnifiedDirector:
        RETURN_TYPES = ("IMAGE", "AUDIO", "FLOAT", "INT", "IMAGE", "STRING")
        RETURN_NAMES = ("images", "audio", "fps", "frame_count", "source_images", "report")
        OUTPUT_IS_LIST = (True, True, False, False, True, False)
        FUNCTION = "execute"
        CATEGORY = "MiniMaxH3"
        DESCRIPTION = "unified"

        def execute(self, *args, **kwargs):
            self.received_args = args
            self.received_kwargs = dict(kwargs)
            return (
                ["images"],
                ["audio"],
                24.0,
                124,
                ["source_images"],
                "report",
            )

    unified.MiniMaxH3MotionDirector = UnifiedDirector
    sys.modules["patchpkg.nodes.director_inputs"] = unified

    spec = importlib.util.spec_from_file_location(
        "patchpkg.nodes.director_output", MODULE_PATH
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_public_director_keeps_only_images_audio_fps_and_is_output_node():
    m = load_module()
    cls = m.MiniMaxH3MotionDirector

    assert cls.RETURN_TYPES == ("IMAGE", "AUDIO", "FLOAT")
    assert cls.RETURN_NAMES == ("images", "audio", "fps")
    assert cls.OUTPUT_IS_LIST == (True, True, False)
    assert cls.OUTPUT_NODE is True


def test_execute_keeps_internal_pipeline_but_returns_only_three_public_outputs():
    m = load_module()
    node = m.MiniMaxH3MotionDirector()

    result = node.execute(model="model", export_source_images=True)

    assert result == (["images"], ["audio"], 24.0)
    assert node.received_kwargs["model"] == "model"
    assert node.received_kwargs["export_source_images"] is False


def test_root_registration_uses_output_adapter_for_public_director():
    text = (ROOT / "__init__.py").read_text(encoding="utf-8")

    assert "from .nodes.director_output import MiniMaxH3MotionDirector" in text
    assert "MiniMaxH3MotionDirector,\n        MiniMaxH3MotionDirectorAssets" not in text
