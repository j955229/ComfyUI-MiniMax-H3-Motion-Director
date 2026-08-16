import unittest
from types import SimpleNamespace

from director.mixed_selection import MixedRunSelection


class MixedSelectionTests(unittest.TestCase):
    def _segments(self):
        return [
            {"id": "a", "mode": "t2v", "inputs": {"resultRefs": []}, "continuity": {}},
            {"id": "b", "mode": "t2v", "inputs": {"resultRefs": []}, "continuity": {}},
            {
                "id": "c",
                "mode": "source_video",
                "inputs": {
                    "resultRefs": [
                        {"role": "identity", "origin": "earlier", "segmentId": "a", "frame": "last"}
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
        selection = MixedRunSelection(
            plan=plan,
            segments=self._segments(),
            requested={2},
            node_id="7",
        )
        self.assertEqual(tuple(selection), (2,))
        self.assertIsNone(selection._resolved)

    def test_valid_result_dependency_reuses_cache_while_missing_context_dependency_reruns(self):
        plan = self._plan()
        plan.cache_settings = {"seed": 1}
        selection = MixedRunSelection(
            plan=plan,
            segments=self._segments(),
            requested={2},
            node_id="7",
        )
        selection._full_segment_hit = lambda index: index == 0
        selection._context_hit = lambda index, **kwargs: False
        self.assertEqual(tuple(selection), (1, 2))
        self.assertEqual(plan.mixed_auto_run_indices, frozenset({1}))

    def test_all_valid_dependencies_are_reused(self):
        plan = self._plan()
        plan.cache_settings = {"seed": 1}
        selection = MixedRunSelection(
            plan=plan,
            segments=self._segments(),
            requested={2},
            node_id="7",
        )
        selection._full_segment_hit = lambda index: True
        selection._context_hit = lambda index, **kwargs: True
        self.assertEqual(tuple(selection), (2,))
        self.assertEqual(plan.mixed_auto_run_indices, frozenset())

    def test_missing_result_dependency_recurses_into_its_dependencies(self):
        segments = [
            {"id": "a", "inputs": {"resultRefs": []}, "continuity": {}},
            {
                "id": "b",
                "inputs": {"resultRefs": [{"role": "identity", "origin": "previous", "frame": "last"}]},
                "continuity": {},
            },
            {
                "id": "c",
                "inputs": {"resultRefs": [{"role": "identity", "origin": "previous", "frame": "last"}]},
                "continuity": {},
            },
        ]
        plan = self._plan()
        plan.cache_settings = {"seed": 1}
        selection = MixedRunSelection(
            plan=plan,
            segments=segments,
            requested={2},
            node_id="7",
        )
        selection._full_segment_hit = lambda index: False
        selection._context_hit = lambda index, **kwargs: False
        self.assertEqual(tuple(selection), (0, 1, 2))


if __name__ == "__main__":
    unittest.main()
