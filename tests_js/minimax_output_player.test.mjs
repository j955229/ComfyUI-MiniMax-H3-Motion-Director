import test from "node:test";
import assert from "node:assert/strict";

import { ResultPlaybackController, frameIndexAtTime } from "../web/js/minimax_output_player.mjs";

function harness({ audioSource = true } = {}) {
    let now = 1000;
    let nextId = 1;
    const pending = new Map();
    const frames = [];
    const audio = {
        src: audioSource ? "blob:audio" : "",
        currentSrc: "",
        currentTime: 0,
        ended: false,
        paused: true,
        pauseCalls: 0,
        play() { this.paused = false; return Promise.resolve(); },
        pause() { this.paused = true; this.pauseCalls += 1; },
    };
    const controller = new ResultPlaybackController({
        audio,
        now: () => now,
        requestFrame(callback) { const id = nextId++; pending.set(id, callback); return id; },
        cancelFrame(id) { pending.delete(id); },
        getFps: () => 24,
        getFrameCount: () => 240,
        onFrame(index) { frames.push(index); },
    });
    return {
        audio, controller, frames, pending,
        advance(ms) {
            now += ms;
            const callbacks = [...pending.values()];
            pending.clear();
            callbacks.forEach((callback) => callback(now));
        },
    };
}

test("seek synchronizes the audio clock whether playing or paused", () => {
    const h = harness();
    h.controller.seek(120);
    assert.equal(h.audio.currentTime, 5);
    assert.equal(h.frames.at(-1), 120);
});

test("audio currentTime is the master clock during playback", () => {
    const h = harness();
    h.controller.play(0);
    h.audio.currentTime = 3.25;
    h.advance(16);
    assert.equal(h.frames.at(-1), frameIndexAtTime(3.25, 24, 240));
});

test("no-audio playback uses a monotonic RAF clock", () => {
    const h = harness({ audioSource: false });
    h.controller.play(24);
    h.advance(500);
    assert.equal(h.frames.at(-1), 36);
});

test("pause and destroy cancel RAF and pause audio", () => {
    const h = harness();
    h.controller.play(0);
    assert.equal(h.pending.size, 1);
    h.controller.pause();
    assert.equal(h.pending.size, 0);
    assert.equal(h.audio.pauseCalls, 1);
    h.controller.play(0);
    h.controller.destroy();
    assert.equal(h.pending.size, 0);
    assert.equal(h.audio.pauseCalls, 2);
});
