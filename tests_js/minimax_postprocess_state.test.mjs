import test from "node:test";
import assert from "node:assert/strict";

import {
    PostprocessConfigStore,
    faceRefineSummary,
    globalRefineSummary,
    normalizePostprocessConfig,
    serializePostprocessConfig,
} from "../web/js/minimax_postprocess_ui.mjs";

test("old workflows migrate with both postprocess stages off", () => {
    const config = normalizePostprocessConfig("");
    assert.equal(config.global_refine.enabled, false);
    assert.equal(config.face_refine.enabled, false);
    assert.equal(config.preview.enabled, true);
});

test("node and modal share the same serialized widget store", () => {
    const widget = { value: "", callback(value) { this.last = value; } };
    const store = new PostprocessConfigStore(widget);
    store.toggle("global_refine");
    const reloaded = normalizePostprocessConfig(widget.value);
    assert.equal(reloaded.global_refine.enabled, true);
    assert.equal(JSON.parse(serializePostprocessConfig(reloaded)).global_refine.enabled, true);
    assert.match(globalRefineSummary(reloaded), /Refine/);
    assert.match(globalRefineSummary(reloaded, 864, 480, "zh"), /精修/);
    store.toggle("face_refine");
    assert.match(faceRefineSummary(store.get()), /YOLO/);
});

test("a failing host widget callback cannot remove or block postprocess state", () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        const widget = { value: "", callback() { throw new Error("host callback failed"); } };
        const store = new PostprocessConfigStore(widget);
        assert.doesNotThrow(() => store.toggle("global_refine"));
        assert.equal(JSON.parse(widget.value).global_refine.enabled, true);
    } finally {
        console.warn = originalWarn;
    }
});
