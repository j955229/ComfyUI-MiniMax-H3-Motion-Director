import unittest

from director.mixed_schema import (
    MIXED_USER_MODES,
    MixedSchemaError,
    backend_task_key,
    collect_dependency_indices,
    dependency_identity,
    expand_run_selection,
    normalize_mixed_segments,
)


def seg(seg_id, mode="t2v", *, refs=None, visual=False, audio=False, identity_count=0):
    return {
        "id": seg_id,
        "mode": mode,
        "inputs": {
            "resultRefs": list(refs or []),
            "identityPictures": [{} for _ in range(identity_count)],
        },
        "continuity": {"visual": visual, "audio": audio},
    }


class MixedSchemaTests(unittest.TestCase):
    def test_user_modes_are_exactly_the_approved_five(self):
        self.assertEqual(
            MIXED_USER_MODES,
            ("t2v", "i2v", "fl2v", "r2v", "source_video"),
        )

    def test_source_video_compiles_to_v2v_or_rv2v_from_identity_count(self):
        self.assertEqual(backend_task_key("source_video", identity_count=0), "v2v")
        self.assertEqual(backend_task_key("source_video", identity_count=1), "rv2v")
        self.assertEqual(backend_task_key("r2v", identity_count=9), "r2v")

    def test_duplicate_stable_ids_are_rejected(self):
        with self.assertRaisesRegex(MixedSchemaError, "Duplicate segment id"):
            normalize_mixed_segments([seg("seg_a"), seg("seg_a")])

    def test_previous_reference_is_positional_and_follows_reorder(self):
        refs = [{"role": "identity", "origin": "previous", "frame": "last"}]
        original = normalize_mixed_segments([
            seg("seg_a"),
            seg("seg_b"),
            seg("seg_c", refs=refs),
        ])
        self.assertEqual(collect_dependency_indices(original, 2), (1,))

        reordered = normalize_mixed_segments([
            seg("seg_b"),
            seg("seg_a"),
            seg("seg_c", refs=refs),
        ])
        self.assertEqual(collect_dependency_indices(reordered, 2), (1,))
        self.assertEqual(reordered[1]["id"], "seg_a")

    def test_earlier_reference_is_stable_id_and_forward_move_becomes_invalid(self):
        ref = [{"role": "identity", "origin": "earlier", "segmentId": "seg_a", "frame": "last"}]
        valid = normalize_mixed_segments([
            seg("seg_a"),
            seg("seg_b"),
            seg("seg_c", refs=ref),
        ])
        self.assertEqual(collect_dependency_indices(valid, 2), (0,))

        invalid = normalize_mixed_segments([
            seg("seg_b"),
            seg("seg_c", refs=ref),
            seg("seg_a"),
        ])
        with self.assertRaisesRegex(MixedSchemaError, "Invalid Reference"):
            collect_dependency_indices(invalid, 1)

    def test_missing_earlier_reference_is_explicit(self):
        segments = normalize_mixed_segments([
            seg("seg_a"),
            seg("seg_b", refs=[
                {"role": "identity", "origin": "earlier", "segmentId": "gone", "frame": "last"},
            ]),
        ])
        with self.assertRaisesRegex(MixedSchemaError, "Missing Reference"):
            collect_dependency_indices(segments, 1)

    def test_continuity_adds_only_immediate_previous_dependency(self):
        segments = normalize_mixed_segments([
            seg("seg_a"),
            seg("seg_b"),
            seg("seg_c", visual=True),
        ])
        self.assertEqual(collect_dependency_indices(segments, 2), (1,))

    def test_selective_run_expands_backward_dependency_closure(self):
        segments = normalize_mixed_segments([
            seg("seg_a"),
            seg("seg_b"),
            seg("seg_c"),
            seg("seg_d"),
            seg(
                "seg_e",
                refs=[{"role": "identity", "origin": "earlier", "segmentId": "seg_c", "frame": "last"}],
                visual=True,
            ),
        ])
        self.assertEqual(expand_run_selection(segments, {4}), (2, 3, 4))

    def test_dependency_identity_distinguishes_result_and_continuity_sources(self):
        segments = normalize_mixed_segments([
            seg("seg_a"),
            seg(
                "seg_b",
                refs=[{"role": "identity", "origin": "earlier", "segmentId": "seg_a", "frame": 7}],
                audio=True,
            ),
        ])
        ident = dependency_identity(segments, 1)
        self.assertEqual(ident["segmentId"], "seg_b")
        self.assertEqual(
            ident["resultRefs"],
            [{"role": "identity", "origin": "earlier", "segmentId": "seg_a", "frame": 7}],
        )
        self.assertEqual(ident["continuity"], {"sourceSegmentId": "seg_a", "visual": False, "audio": True})

    def test_source_video_requires_source_descriptor(self):
        with self.assertRaisesRegex(MixedSchemaError, "Source Video required"):
            normalize_mixed_segments([seg("seg_a", mode="source_video")])

        good = seg("seg_a", mode="source_video")
        good["inputs"]["sourceVideo"] = {"videoFile": "fight.mp4", "range": {"startSec": 1.0, "endSec": 3.0}}
        normalized = normalize_mixed_segments([good])
        self.assertEqual(normalized[0]["backendTask"], "v2v")


if __name__ == "__main__":
    unittest.main()
