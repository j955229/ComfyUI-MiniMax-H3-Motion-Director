import unittest

from director.postprocess_config import normalize_postprocess_config, refine_seed_for, resolve_vsr_quality_name

class PostprocessConfigTests(unittest.TestCase):
    def test_vsr_is_always_high_bitrate_for_h3_decoded_frames(self):
        cfg=normalize_postprocess_config({"global_refine":{"vsr_source":"compressed","vsr_quality":"ultra"}})["global_refine"]
        self.assertNotIn("vsr_source",cfg)
        self.assertEqual(resolve_vsr_quality_name(cfg),"HIGHBITRATE_ULTRA")

    def test_invalid_vsr_quality_falls_back_to_high(self):
        cfg=normalize_postprocess_config({"global_refine":{"vsr_quality":"max"}})["global_refine"]
        self.assertEqual(cfg["vsr_quality"],"high")
        self.assertEqual(resolve_vsr_quality_name(cfg),"HIGHBITRATE_HIGH")

    def test_face_defaults_match_upstream_tuned_workflow(self):
        f=normalize_postprocess_config({})["face_refine"]
        self.assertEqual((f["crop_factor"],f["smooth_window"],f["size_smooth_window"]),(2.5,21,51))
        self.assertEqual(f["canvas_mode"],"auto_capped_768")
        self.assertEqual((f["base_denoise"],f["strength_small_face"],f["strength_large_face"]),(0.45,0.8,0.35))
        self.assertEqual((f["face_px_small"],f["face_px_large"]),(30,120))
        self.assertEqual((f["mask_mode"],f["feather"],f["mask_dilation"]),("rect",24.0,24.0))
        self.assertFalse(f["feather_scales_with_crop"])
        self.assertEqual(f["sam_threshold"],0.93)

    def test_v3_untouched_face_defaults_migrate(self):
        f=normalize_postprocess_config({"version":3,"face_refine":{"crop_factor":2.0,"smooth_window":9,"size_smooth_window":13,"base_denoise":0.22,"feather":0.12,"mask_dilation":0.06,"feather_scales_with_crop":True}})["face_refine"]
        self.assertEqual((f["crop_factor"],f["smooth_window"],f["size_smooth_window"]),(2.5,21,51))
        self.assertEqual((f["base_denoise"],f["feather"],f["mask_dilation"]),(0.45,24.0,24.0))
        self.assertFalse(f["feather_scales_with_crop"])

    def test_custom_v3_values_are_preserved(self):
        f=normalize_postprocess_config({"version":3,"face_refine":{"crop_factor":2.8,"base_denoise":0.31,"feather":18}})["face_refine"]
        self.assertEqual((f["crop_factor"],f["base_denoise"],f["feather"]),(2.8,0.31,18.0))

    def test_seed_inherit_and_offset(self):
        self.assertEqual(refine_seed_for({"seed_mode":"inherit","seed_offset":99},1234),1234)
        self.assertEqual(refine_seed_for({"seed_mode":"offset","seed_offset":-1},1234),1233)

if __name__ == "__main__": unittest.main()
