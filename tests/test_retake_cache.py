import importlib
import sys
import tempfile
import types
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parents[1]))
import comfy.cli_args
comfy.cli_args.args.cpu = True

PACKAGE = "minimax_retake_tests"
package = types.ModuleType(PACKAGE)
package.__path__ = [str(ROOT)]
sys.modules[PACKAGE] = package
core = importlib.import_module(f"{PACKAGE}.director.executor_core_legacy")
cache = importlib.import_module(f"{PACKAGE}.director.segment_cache")
context = importlib.import_module(f"{PACKAGE}.director.context_cache")
latent_cache = importlib.import_module(f"{PACKAGE}.director.latent_context_cache")
first_pass = importlib.import_module(f"{PACKAGE}.director.first_pass_cache")
plans = importlib.import_module(f"{PACKAGE}.director.plan")
mixed = importlib.import_module(f"{PACKAGE}.director.mixed_selection")


class SamplingReached(Exception):
    pass


class RetakeCacheTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.folder = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.stack.enter_context(patch.object(cache.folder_paths, "get_output_directory", return_value=str(self.folder)))
        self.segments = [plans.SegmentPlan(
            index=i, start_frame=22*i, end_frame=22*(i+1), prompt="test",
            task_type="t2va", task_key="t2v", use_global=False,
        ) for i in range(3)]
        self.plan = plans.DirectorPlan(
            frame_rate=24, total_frames=66, width=32, height=32, ref_max_size=32,
            output_mode="fixed", source_width=32, source_height=32,
            global_task_type="t2va", global_task_key="t2v", global_prompt="", global_refs=[],
            segments=self.segments, source_video=torch.empty((0, 1, 1, 3)), edit_mode="segment",
            raw={}, run_indices=frozenset({2}), run_select_enabled=True,
        )
        self.settings = dict(steps=8, seed=42, motion_context_enabled=True,
                             audio_context_enabled=False, audio_mode="generate", model_options={"take": "old"})
        self.plan.cache_settings = self.settings
        self.frames = torch.zeros((22, 32, 32, 3))
        self.audio = {"waveform": torch.zeros((1, 1, 220)), "sample_rate": 240}

    def test_all_checked_selection_is_normalized_to_full_run(self):
        self.assertIsNone(
            plans._parse_run_selection(
                {"runSelectEnabled": True, "runSelection": [0, 1, 2]},
                3,
            )
        )
        self.assertEqual(
            plans._parse_run_selection(
                {"runSelectEnabled": True, "runSelection": [2]},
                3,
            ),
            frozenset({2}),
        )

    def save_previous(self, index):
        seg = self.segments[index]
        cache.save_segment_cache("node", seg, self.plan, self.frames)
        cache.save_segment_audio_cache("node", seg, self.plan, self.audio)
        self.assertTrue(context.save_motion_context_cache(
            "node", seg, self.plan, frames=self.frames, audio=self.audio, settings=self.settings,
        ))

    def enable_retake(self):
        self.plan.raw["retake"] = "one-job"
        return core._prepare_retake(self.plan)

    def test_scoped_reuse_preserves_fingerprints_and_files(self):
        for index in range(3):
            self.save_previous(index)
        before = {path: path.read_bytes() for path in self.folder.rglob("*") if path.is_file()}
        self.settings["model_options"] = {"take": "new"}
        self.assertIsNone(cache.load_segment_cache("node", self.segments[1], self.plan))
        self.enable_retake()
        self.assertEqual(self.plan.reuse_cache_indices, {0, 1})
        self.assertIsNotNone(cache.load_segment_cache("node", self.segments[1], self.plan))
        self.assertIsNotNone(cache.load_segment_audio_cache("node", self.segments[1], self.plan))
        self.assertIsNotNone(context.load_motion_context_cache("node", self.segments[1], self.plan, settings=self.settings))
        self.assertIsNone(cache.load_segment_cache("node", self.segments[2], self.plan))
        self.assertEqual(cache.segment_cache_status("node", self.segments[1], self.plan), "stale")
        self.assertEqual(self.plan.stale_cache_reused, {1})
        self.assertEqual(before, {path: path.read_bytes() for path in before})
        self.plan.raw.clear()
        core._prepare_retake(self.plan)
        self.assertIsNone(cache.load_segment_cache("node", self.segments[1], self.plan))

    def test_corrupt_data_and_wrong_fps_are_not_overridden(self):
        self.save_previous(1)
        self.enable_retake()
        self.plan.frame_rate = 30
        self.assertIsNone(context.load_motion_context_cache("node", self.segments[1], self.plan, settings=self.settings))
        tensor_path = cache._cache_root("node") / "seg_0001.pt"
        torch.save(torch.empty(0), tensor_path)
        self.assertIsNone(cache.load_segment_cache("node", self.segments[1], self.plan))

    def test_audio_must_belong_to_the_cached_video(self):
        self.save_previous(1)
        self.settings["steps"] = 12
        cache.save_segment_audio_cache("node", self.segments[1], self.plan, self.audio)
        self.enable_retake()
        self.assertIsNone(cache.load_segment_audio_cache("node", self.segments[1], self.plan))

    def test_latent_tail_can_be_reused_but_not_the_selected_first_pass(self):
        seg = self.segments[1]
        latent = {"samples": (torch.zeros(1, 4, 7, 2, 2), torch.zeros(1, 4, 2, 64))}
        handoff = dict(context_end_frame=22, trim_frames=0, export_frames=22, sample_frames=22)
        self.assertTrue(latent_cache.save_latent_context_cache(
            "node", seg, self.plan, latent=latent, handoff=handoff, settings=self.settings,
        ))
        self.assertTrue(first_pass.save_first_pass_cache(
            "node", self.segments[2], self.plan, latent=latent, settings=self.settings,
        ))
        self.settings["steps"] = 12
        self.assertIsNone(latent_cache.load_latent_context_cache("node", seg, self.plan, settings=self.settings))
        self.enable_retake()
        self.assertIsNotNone(latent_cache.load_latent_context_cache("node", seg, self.plan, settings=self.settings))
        self.assertIsNone(first_pass.load_first_pass_cache("node", self.segments[2], self.plan, settings=self.settings))

    def test_mixed_selection_does_not_expand_or_accept_later_caches(self):
        self.plan.mixed_mode = True
        self.plan.mixed_requested_run_indices = frozenset({1})
        selection = mixed.MixedRunSelection(plan=self.plan, segments=[], requested={1}, node_id="node")
        self.plan.run_indices = selection
        with patch.object(selection, "_resolve", side_effect=AssertionError("must not expand")):
            self.assertEqual(self.enable_retake(), {1})
        self.assertEqual(self.plan.run_indices, {1})
        self.assertEqual(self.plan.reuse_cache_indices, {0})

    def test_missing_prerequisite_stops_before_any_sampling(self):
        self.plan.run_indices = frozenset({0, 2})
        self.enable_retake()
        with patch.object(core, "sample_single_stage") as sample:
            with self.assertRaisesRegex(ValueError, "S3: S2 has no usable continuity cache"):
                self.execute_until_sampling()
            sample.assert_not_called()

    def execute_until_sampling(self):
        with ExitStack() as stack:
            stack.enter_context(patch.object(core, "motion_context_patch_status", return_value=(True, "")))
            stack.enter_context(patch.object(core, "_build_minimax_inputs", return_value=(None,) * 6))
            stack.enter_context(patch.object(core, "run_minimax_conditioning", return_value=({}, {}, {}, "test")))
            stack.enter_context(patch.object(core, "apply_exported_motion_context", return_value=({}, None)))
            stack.enter_context(patch.object(core, "report_director_progress"))
            return core.execute_director_plan_core(
                self.plan, node_id="node", model=types.SimpleNamespace(model=None, model_options={}),
                vae=None, audio_vae=None, clip=None, seed=42, steps=8,
                motion_context_enabled=True, audio_context_enabled=False,
                clear_vram_between_segments=False, source_overlap_frames=0,
            )

    def test_retake_reaches_sampler_without_loading_own_latents(self):
        for index in (0, 1):
            self.save_previous(index)
        before = {path: path.read_bytes() for path in self.folder.rglob("*") if path.is_file()}
        self.enable_retake()
        with (
            patch.object(core, "sample_single_stage", side_effect=SamplingReached) as sample,
            patch.object(core, "load_first_pass_cache") as first,
            patch.object(core, "load_global_refine_cache") as refined,
        ):
            with self.assertRaises(SamplingReached):
                self.execute_until_sampling()
            sample.assert_called_once()
            first.assert_not_called()
            refined.assert_not_called()
        self.assertEqual(before, {path: path.read_bytes() for path in before})

    def test_normal_selective_run_reuses_selected_valid_cache(self):
        """Checkbox selection must not force a valid selected clip through VAE."""
        self.plan.raw = {"output": {"audioMode": "generate"}}
        with patch.object(core, "motion_context_patch_status", return_value=(True, "")), \
             patch.object(core, "load_segment_cache", return_value=self.frames), \
             patch.object(core, "load_segment_audio_cache", return_value=self.audio), \
             patch.object(core, "report_director_progress"), \
             patch.object(core, "sample_single_stage", side_effect=SamplingReached) as sample:
            combined, outputs, audios, report = core.execute_director_plan_core(
                self.plan, node_id="node", model=types.SimpleNamespace(model=None, model_options={}),
                vae=None, audio_vae=None, clip=None, seed=42, steps=8,
                motion_context_enabled=True, audio_context_enabled=False,
                clear_vram_between_segments=False, source_overlap_frames=0,
            )

        sample.assert_not_called()
        self.assertEqual(len(outputs), 1)
        self.assertEqual(len(audios), 3)
        self.assertEqual(int(combined.shape[0]), 66)
        self.assertIn("Reused from cache: S1,S2,S3", report)

    def test_all_checked_normal_run_reuses_every_valid_cache(self):
        """All checked is a full run, but still must remain cache-first."""
        self.plan.raw = {"output": {"audioMode": "generate"}}
        self.plan.run_indices = None
        with patch.object(core, "motion_context_patch_status", return_value=(True, "")), \
             patch.object(core, "load_segment_cache", return_value=self.frames), \
             patch.object(core, "load_segment_audio_cache", return_value=self.audio), \
             patch.object(core, "report_director_progress"), \
             patch.object(core, "sample_single_stage", side_effect=SamplingReached) as sample:
            combined, outputs, _audios, report = core.execute_director_plan_core(
                self.plan, node_id="node", model=types.SimpleNamespace(model=None, model_options={}),
                vae=None, audio_vae=None, clip=None, seed=42, steps=8,
                motion_context_enabled=True, audio_context_enabled=False,
                clear_vram_between_segments=False, source_overlap_frames=0,
            )

        sample.assert_not_called()
        self.assertEqual(len(outputs), 3)
        self.assertEqual(int(combined.shape[0]), 66)
        self.assertIn("Reused from cache: S1,S2,S3", report)


if __name__ == "__main__":
    unittest.main()
