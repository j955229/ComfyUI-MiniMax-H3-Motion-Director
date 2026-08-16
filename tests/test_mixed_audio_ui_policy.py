import unittest
from pathlib import Path


class MixedAudioUiPolicyTests(unittest.TestCase):
    @staticmethod
    def _native_source():
        return (Path(__file__).parents[1] / "web" / "js" / "minimax_timeline.js").read_text(encoding="utf-8")

    def test_mixed_hides_legacy_v2v_audio_passthrough_control(self):
        source = self._native_source()
        self.assertIn('[data-r="out-audio-wrap"]', source)
        self.assertIn('if (audio) audio.hidden = !!active;', source)

    def test_mixed_persists_generated_audio_mode_only(self):
        source = self._native_source()
        self.assertIn('state.output.audioMode = "generate";', source)
        self.assertIn('state.output[key] = key === "audioMode" ? "generate" : value;', source)


if __name__ == "__main__":
    unittest.main()
