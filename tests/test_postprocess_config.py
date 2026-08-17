import unittest

from director.postprocess_config import (
    normalize_postprocess_config,
    refine_seed_for,
    resolve_vsr_quality_name,
)


class PostprocessConfigTests(unittest.TestCase):
    def test_vsr_defaults_are_clean_high(self):
        cfg = normalize_postprocess_config({})["global_refine"]
        self.assertEqual(cfg["vsr_source"], "clean")
        self.assertEqual(cfg["vsr_quality"], "high")
        self.assertEqual(resolve_vsr_quality_name(cfg), "HIGHBITRATE_HIGH")

    def test_vsr_compressed_ultra_maps_to_standard_ultra(self):
        cfg = normalize_postprocess_config({
            "global_refine": {"vsr_source": "compressed", "vsr_quality": "ultra"}
        })["global_refine"]
        self.assertEqual(resolve_vsr_quality_name(cfg), "ULTRA")

    def test_invalid_vsr_values_fall_back_to_clean_high(self):
        cfg = normalize_postprocess_config({
            "global_refine": {"vsr_source": "wat", "vsr_quality": "max"}
        })["global_refine"]
        self.assertEqual(cfg["vsr_source"], "clean")
        self.assertEqual(cfg["vsr_quality"], "high")
        self.assertEqual(resolve_vsr_quality_name(cfg), "HIGHBITRATE_HIGH")

    def test_seed_inherit_and_offset(self):
        self.assertEqual(refine_seed_for({"seed_mode": "inherit", "seed_offset": 99}, 1234), 1234)
        self.assertEqual(refine_seed_for({"seed_mode": "offset", "seed_offset": -1}, 1234), 1233)


if __name__ == "__main__":
    unittest.main()
