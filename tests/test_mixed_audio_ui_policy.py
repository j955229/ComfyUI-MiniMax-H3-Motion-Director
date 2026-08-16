import unittest
from pathlib import Path


class MixedAudioUiPolicyTests(unittest.TestCase):
    def test_mixed_hides_legacy_v2v_audio_passthrough_control(self):
        source = (Path(__file__).parents[1] / "web" / "js" / "zz_minimax_mixed_mode.js").read_text(encoding="utf-8")
        self.assertIn('out-audio-wrap', source)

    def test_mixed_persists_generated_audio_mode_only(self):
        source = (Path(__file__).parents[1] / "web" / "js" / "minimax_mixed_ui_v2.mjs").read_text(encoding="utf-8")
        self.assertIn('state.output.audioMode = "generate"', source)


if __name__ == "__main__":
    unittest.main()
