import unittest

import torch

from director.mixed_runtime import _source_id_for_ref, select_result_frame
from director.source_bridge import source_bridge_boundary_enabled


class DummySegment:
    def __init__(self, task_key="v2v", *, mixed=False, stable_id=""):
        self.task_key = task_key
        self.mixed_mode = "source_video" if mixed else None
        self.context_link = None
        self.stable_id = stable_id


class DummyPlan:
    def __init__(self):
        self.segments = [
            DummySegment(stable_id="seg_a"),
            DummySegment(stable_id="seg_b"),
        ]


class MixedRuntimeTests(unittest.TestCase):
    def test_select_last_result_frame(self):
        frames = torch.arange(5 * 2 * 2 * 3, dtype=torch.float32).reshape(5, 2, 2, 3)
        out = select_result_frame(frames, "last")
        self.assertEqual(tuple(out.shape), (1, 2, 2, 3))
        self.assertTrue(torch.equal(out[0], frames[-1]))

    def test_select_explicit_result_frame(self):
        frames = torch.arange(4 * 2 * 2 * 3, dtype=torch.float32).reshape(4, 2, 2, 3)
        self.assertTrue(torch.equal(select_result_frame(frames, 1)[0], frames[1]))

    def test_result_frame_out_of_range_is_explicit(self):
        frames = torch.zeros((2, 2, 2, 3), dtype=torch.float32)
        with self.assertRaisesRegex(ValueError, "outside source result"):
            select_result_frame(frames, 2)

    def test_runtime_accepts_only_canonical_segment_result_reference(self):
        plan = DummyPlan()
        self.assertEqual(
            _source_id_for_ref(
                plan,
                1,
                {"role": "identity", "origin": "segment", "segmentId": "seg_a", "frame": "last"},
            ),
            "seg_a",
        )
        with self.assertRaisesRegex(ValueError, "non-canonical"):
            _source_id_for_ref(
                plan,
                1,
                {"role": "identity", "origin": "previous", "frame": "last"},
            )

    def test_runtime_rejects_missing_segment_result_id(self):
        with self.assertRaisesRegex(ValueError, "stable segment id"):
            _source_id_for_ref(
                DummyPlan(),
                1,
                {"role": "identity", "origin": "segment", "segmentId": "", "frame": "last"},
            )

    def test_mixed_source_video_boundary_never_uses_legacy_source_bridge(self):
        self.assertFalse(
            source_bridge_boundary_enabled(
                DummySegment(mixed=True),
                DummySegment(mixed=True),
                5,
            )
        )

    def test_standalone_source_video_boundary_keeps_existing_bridge_behavior(self):
        self.assertTrue(
            source_bridge_boundary_enabled(
                DummySegment(mixed=False),
                DummySegment(mixed=False),
                5,
            )
        )


if __name__ == "__main__":
    unittest.main()
