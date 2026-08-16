import unittest
from types import SimpleNamespace

from director.mixed_schema import MixedSchemaError
from director.mixed_selection import MixedRunSelection


def t2v(seg_id, *, refs=None, visual=False, audio=False):
    return {
        "id": seg_id,
        "mode": "t2v",
        "inputs": {"resultRefs": list(refs or [])},
        "continuity": {"visual": visual, "audio": audio},
    }


class MixedSelectionTests(unittest.TestCase):
    def _segments(self):
        return [
            t2v("a"),
            t2v("b"),
            {
                "id": "c",
                "mode": "source_video",
                "inputs": {
                    "resultRefs": [
                        {"role": "identity", "origin": "segment", "segmentId": "a", "frame": "last"}
                    ]
                },
                "continuity": {"visual": True, "audio": False},
            },
        ]

    def _plan(self):
        return SimpleNamespace(
            cache_settings=None,
            segments=[SimpleNamespace(index=i) for i in range(3)],
        )

    def test_before_runtime_cache_settings_only_requested_indices_are_visible(self):
        plan = self._plan()
        selection = MixedRunSelection(plan=plan, segments=self._segments(), requested={2}, node_id="7")
        self.assertEqual(tuple(selection), (2,))
        self.assertIsNone(selection._resolved)

    def test_valid_result_dependency_reuses_cache_while_missing_context_dependency_reruns(self):
        plan = self._plan()
        plan.cache_settings = {
            "seed": 1,
            "motion_context_enabled": True,
            "audio_context_enabled": True,
        }
        selection = MixedRunSelection(plan=plan, segments=self._segments(), requested={2}, node_id="7")
        selection._full_segment_hit = lambda index: index == 0
        selection._context_hit = lambda index, **kwargs: False
        self.assertEqual(tuple(selection), (1, 2))
        self.assertEqual(plan.mixed_auto_run_indices, frozenset({1}))

    def test_all_valid_dependencies_are_reused(self):
        plan = self._plan()
        plan.cache_settings = {
            "seed": 1,
            "motion_context_enabled": True,
            "audio_context_enabled": True,
        }
        selection = MixedRunSelection(plan=plan, segments=self._segments(), requested={2}, node_id="7")
        selection._full_segment_hit = lambda index: True
        selection._context_hit = lambda index, **kwargs: True
        self.assertEqual(tuple(selection), (2,))
        self.assertEqual(plan.mixed_auto_run_indices, frozenset())

    def test_missing_result_dependency_recurses_into_its_dependencies(self):
        segments = [
            t2v("a"),
            t2v("b", refs=[
                {"role": "identity", "origin": "segment", "segmentId": "a", "frame": "last"}
            ]),
            t2v("c", refs=[
                {"role": "identity", "origin": "segment", "segmentId": "b", "frame": "last"}
            ]),
        ]
        plan = self._plan()
        plan.cache_settings = {"seed": 1}
        selection = MixedRunSelection(plan=plan, segments=segments, requested={2}, node_id="7")
        selection._full_segment_hit = lambda index: False
        selection._context_hit = lambda index, **kwargs: False
        self.assertEqual(tuple(selection), (0, 1, 2))

    def test_noncanonical_previous_origin_is_rejected_after_schema_boundary(self):
        segments = [
            t2v("a"),
            t2v("b", refs=[{"role": "identity", "origin": "previous", "frame": "last"}]),
        ]
        plan = SimpleNamespace(cache_settings={"seed": 1}, segments=[SimpleNamespace(index=0), SimpleNamespace(index=1)])
        selection = MixedRunSelection(plan=plan, segments=segments, requested={1}, node_id="7")
        with self.assertRaisesRegex(MixedSchemaError, "non-canonical"):
            tuple(selection)

    def test_visual_master_off_removes_visual_only_dependency(self):
        segments = [t2v("a"), t2v("b", visual=True)]
        plan = SimpleNamespace(
            cache_settings={"motion_context_enabled": False, "audio_context_enabled": True},
            segments=[SimpleNamespace(index=0), SimpleNamespace(index=1)],
        )
        selection = MixedRunSelection(plan=plan, segments=segments, requested={1}, node_id="7")
        selection._full_segment_hit = lambda index: False
        selection._context_hit = lambda index, **kwargs: False
        self.assertEqual(tuple(selection), (1,))

    def test_audio_master_off_removes_audio_only_dependency(self):
        segments = [t2v("a"), t2v("b", audio=True)]
        plan = SimpleNamespace(
            cache_settings={"motion_context_enabled": True, "audio_context_enabled": False},
            segments=[SimpleNamespace(index=0), SimpleNamespace(index=1)],
        )
        selection = MixedRunSelection(plan=plan, segments=segments, requested={1}, node_id="7")
        selection._full_segment_hit = lambda index: False
        selection._context_hit = lambda index, **kwargs: False
        self.assertEqual(tuple(selection), (1,))

    def test_result_dependency_survives_all_continuity_masters_off(self):
        segments = [
            t2v("a"),
            t2v(
                "b",
                refs=[{"role": "identity", "origin": "segment", "segmentId": "a", "frame": "last"}],
                visual=True,
                audio=True,
            ),
        ]
        plan = SimpleNamespace(
            cache_settings={"motion_context_enabled": False, "audio_context_enabled": False},
            segments=[SimpleNamespace(index=0), SimpleNamespace(index=1)],
        )
        selection = MixedRunSelection(plan=plan, segments=segments, requested={1}, node_id="7")
        selection._full_segment_hit = lambda index: False
        selection._context_hit = lambda index, **kwargs: False
        self.assertEqual(tuple(selection), (0, 1))


if __name__ == "__main__":
    unittest.main()
