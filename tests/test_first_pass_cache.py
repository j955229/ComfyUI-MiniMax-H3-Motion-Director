import importlib
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import torch

ROOT = Path(__file__).resolve().parents[1]
COMFY_ROOT = ROOT.parents[1]
if str(COMFY_ROOT) not in sys.path:
    sys.path.insert(0, str(COMFY_ROOT))

PACKAGE = "_motion_director_first_pass_cache_test"
package = types.ModuleType(PACKAGE)
package.__path__ = [str(ROOT)]
sys.modules.setdefault(PACKAGE, package)
director_package = types.ModuleType(f"{PACKAGE}.director")
director_package.__path__ = [str(ROOT / "director")]
sys.modules.setdefault(f"{PACKAGE}.director", director_package)

cache_module = importlib.import_module(f"{PACKAGE}.director.first_pass_cache")
plan_module = importlib.import_module(f"{PACKAGE}.director.plan")

first_pass_cache_fingerprint = cache_module.first_pass_cache_fingerprint
load_first_pass_cache = cache_module.load_first_pass_cache
load_global_refine_cache = cache_module.load_global_refine_cache
save_first_pass_cache = cache_module.save_first_pass_cache
save_global_refine_cache = cache_module.save_global_refine_cache
DirectorPlan = plan_module.DirectorPlan
SegmentPlan = plan_module.SegmentPlan

import comfy.nested_tensor


def _plan():
    segment = SegmentPlan(
        index=0,
        start_frame=0,
        end_frame=22,
        prompt="test",
        task_type="t2va",
        task_key="t2v",
        use_global=True,
    )
    plan = DirectorPlan(
        frame_rate=24.0,
        total_frames=22,
        width=576,
        height=576,
        ref_max_size=1024,
        output_mode="fixed",
        source_width=576,
        source_height=576,
        global_task_type="t2va",
        global_task_key="t2v",
        global_prompt="",
        global_refs=[],
        segments=[segment],
        source_video=torch.empty((0, 1, 1, 3)),
        edit_mode="segment",
        raw={},
    )
    return segment, plan


def _settings(global_refine):
    return {
        "pipeline": "test",
        "seed": 42,
        "steps": 8,
        "sampler": "euler",
        "scheduler": "simple",
        "motion_context_enabled": True,
        "audio_context_enabled": True,
        "audio_mode": "generate",
        "context_length": 22,
        "global_refine": global_refine,
        "face_refine": False,
    }


class FirstPassCacheTests(unittest.TestCase):
    def test_postprocess_settings_do_not_change_first_pass_identity(self):
        segment, plan = _plan()
        disabled = _settings(False)
        enabled = _settings({"enabled": True, "denoise": 0.25})
        plan.cache_settings = disabled
        first = first_pass_cache_fingerprint(segment, plan, disabled)
        plan.cache_settings = enabled
        second = first_pass_cache_fingerprint(segment, plan, enabled)
        self.assertEqual(first, second)

        changed_generation = dict(enabled, steps=12)
        plan.cache_settings = changed_generation
        self.assertNotEqual(
            second,
            first_pass_cache_fingerprint(segment, plan, changed_generation),
        )

    def test_round_trip_restores_nested_av_samples_and_mask(self):
        segment, plan = _plan()
        settings = _settings(False)
        plan.cache_settings = settings
        video = torch.arange(48, dtype=torch.float32).reshape(1, 3, 1, 4, 4)
        audio = torch.arange(32, dtype=torch.float32).reshape(1, 4, 2, 4)
        video_mask = torch.ones_like(video)
        audio_mask = torch.zeros_like(audio)
        latent = {
            "samples": comfy.nested_tensor.NestedTensor((video, audio)),
            "noise_mask": comfy.nested_tensor.NestedTensor((video_mask, audio_mask)),
            "batch_index": [0],
        }

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.object(cache_module, "_cache_root", return_value=root):
                self.assertTrue(
                    save_first_pass_cache(
                        "node", segment, plan, latent=latent, settings=settings,
                    )
                )
                loaded = load_first_pass_cache(
                    "node", segment, plan, settings=settings,
                )
                self.assertIsNotNone(loaded)
                loaded_video, loaded_audio = loaded["samples"].unbind()
                loaded_video_mask, loaded_audio_mask = loaded["noise_mask"].unbind()
                self.assertTrue(torch.equal(loaded_video, video))
                self.assertTrue(torch.equal(loaded_audio, audio))
                self.assertTrue(torch.equal(loaded_video_mask, video_mask))
                self.assertTrue(torch.equal(loaded_audio_mask, audio_mask))

                changed = dict(settings, steps=12)
                plan.cache_settings = changed
                self.assertIsNone(
                    load_first_pass_cache("node", segment, plan, settings=changed)
                )

    def test_face_refine_can_reuse_latest_global_refine_latent(self):
        segment, plan = _plan()
        settings = _settings({"enabled": True, "mode": "upscale", "steps": 0})
        plan.cache_settings = settings
        video = torch.arange(48, dtype=torch.float32).reshape(1, 3, 1, 4, 4)
        audio = torch.arange(32, dtype=torch.float32).reshape(1, 4, 2, 4)
        latent = {
            "samples": comfy.nested_tensor.NestedTensor((video, audio)),
        }

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.object(cache_module, "_cache_root", return_value=root):
                self.assertTrue(
                    save_global_refine_cache(
                        "node",
                        segment,
                        plan,
                        latent=latent,
                        settings=settings,
                        refine_config=settings["global_refine"],
                    )
                )
                face_only = _settings(False)
                face_only["face_refine"] = {"enabled": True}
                plan.cache_settings = face_only
                loaded = load_global_refine_cache(
                    "node", segment, plan, settings=face_only,
                )
                self.assertIsNotNone(loaded)
                loaded_video, loaded_audio = loaded["samples"].unbind()
                self.assertTrue(torch.equal(loaded_video, video))
                self.assertTrue(torch.equal(loaded_audio, audio))


if __name__ == "__main__":
    unittest.main()
