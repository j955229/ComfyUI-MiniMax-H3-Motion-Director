import test from "node:test";
import assert from "node:assert/strict";

import {
    contextLinkMode,
    ensureTimelineContextLinks,
    legacyContextDefaults,
    normalizedContextLink,
    setContextLinkChannels,
    toggleContextLink,
} from "../web/js/minimax_context_links.mjs";

test("Segment 1 is always disconnected", () => {
    assert.deepEqual(
        normalizedContextLink({ enabled: true, visual: true, audio: true }, 0),
        { schema: "previous_context_link_v1", enabled: false, visual: false, audio: false },
    );
});

test("main boundary toggle enables/disables both channels", () => {
    const on = toggleContextLink(null, 1);
    assert.equal(contextLinkMode(on, 1), "both");
    const off = toggleContextLink(on, 1);
    assert.equal(contextLinkMode(off, 1), "off");
});

test("advanced boundary state supports all four channel combinations", () => {
    const base = toggleContextLink(null, 1);
    assert.equal(contextLinkMode(setContextLinkChannels(base, 1, { visual: true, audio: true }), 1), "both");
    assert.equal(contextLinkMode(setContextLinkChannels(base, 1, { visual: true, audio: false }), 1), "visual");
    assert.equal(contextLinkMode(setContextLinkChannels(base, 1, { visual: false, audio: true }), 1), "audio");
    assert.equal(contextLinkMode(setContextLinkChannels(base, 1, { visual: false, audio: false }), 1), "off");
});

test("legacy workflow derives links from old global flags", () => {
    const timeline = { segments: [{}, {}, {}] };
    ensureTimelineContextLinks(timeline, (_seg, index) => ({
        visual: index > 0,
        audio: index > 0,
    }));
    assert.equal(contextLinkMode(timeline.segments[0].contextLink, 0), "off");
    assert.equal(contextLinkMode(timeline.segments[1].contextLink, 1), "both");
    assert.equal(contextLinkMode(timeline.segments[2].contextLink, 2), "both");
});

test("legacy Source Bridge remains visual/audio disconnected", () => {
    assert.deepEqual(legacyContextDefaults({
        taskKey: "rv2v",
        motionEnabled: true,
        audioEnabled: true,
        audioGenerate: true,
        sourceBridgeFrames: 5,
    }), { visual: false, audio: false });
});

test("legacy explicit I2V image resets both old coupled channels", () => {
    assert.deepEqual(legacyContextDefaults({
        taskKey: "i2v",
        motionEnabled: true,
        audioEnabled: true,
        audioGenerate: true,
        hasExplicitI2vImage: true,
    }), { visual: false, audio: false });
});
