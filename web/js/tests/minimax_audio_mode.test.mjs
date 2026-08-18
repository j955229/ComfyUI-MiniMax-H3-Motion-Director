import test from "node:test";
import assert from "node:assert/strict";
import {
    AUDIO_MODE_DRIVE,
    applyVisibleAudioMode,
    visibleAudioMode,
} from "../minimax_audio_mode_core.mjs";

test("Audio Drive serializes through the legacy source mode plus an explicit flag", () => {
    const output = { audioMode: "generate" };
    applyVisibleAudioMode(output, AUDIO_MODE_DRIVE);
    assert.equal(output.audioMode, "source");
    assert.equal(output.audioDrive, true);
    assert.equal(visibleAudioMode(output), AUDIO_MODE_DRIVE);
});

test("legacy output normalization can preserve the Audio Drive flag", () => {
    const saved = { audioMode: "source", audioDrive: true, width: 864 };
    const normalized = { ...saved, audioMode: "source" };
    assert.equal(visibleAudioMode(normalized), AUDIO_MODE_DRIVE);
});

test("selecting any legacy audio mode clears Audio Drive", () => {
    for (const mode of ["generate", "source", "mute"]) {
        const output = { audioMode: "source", audioDrive: true };
        applyVisibleAudioMode(output, mode);
        assert.equal(output.audioMode, mode);
        assert.equal(output.audioDrive, false);
        assert.equal(visibleAudioMode(output), mode);
    }
});
