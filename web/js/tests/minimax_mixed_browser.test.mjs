import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "http://localhost/",
});
Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    FormData: dom.window.FormData,
    File: dom.window.File,
});
Object.defineProperty(globalThis, "localStorage", {
    value: dom.window.localStorage,
    configurable: true,
});
window.confirm = () => true;

const { setLocale } = await import("../minimax_i18n.js");
const { mountMixedUI } = await import("../minimax_mixed_ui.mjs");

setLocale("zh");

let pickerCalls = 0;
const editor = {
    node: {
        id: 9,
        widgets: [
            { name: "frame_rate", value: 24 },
            { name: "width", value: 864 },
            { name: "height", value: 480 },
            { name: "ref_max_size", value: 864 },
        ],
    },
    _materialLibraryController: {
        async pick({ type }) {
            pickerCalls += 1;
            return { id: `picked-${type}`, type, title: `picked-${type}` };
        },
    },
};
const host = document.createElement("div");
document.body.appendChild(host);
const initialState = {
    version: 1,
    timelineMode: "mixed",
    frameRate: 24,
    output: { mode: "fixed", width: 864, height: 480, longEdge: 864, exportMode: "all" },
    runSelectEnabled: false,
    runSelection: [],
    segments: [{
        id: "seg_a",
        mode: "r2v",
        prompt: "",
        duration: 5,
        inputs: { resultRefs: [], pictures: [], referenceVideos: [], referenceAudios: [] },
        continuity: {},
    }],
};

const controller = mountMixedUI({ host, editor, initialState, onChange() {} });
assert.ok(controller.root.isConnected);
assert.equal(
    controller.root.querySelector(".mmx-mixed-global"),
    null,
    "Mixed must not duplicate the Director FPS/width/height/output controls",
);
assert.ok(controller.root.querySelector(".bd-panel"), "Mixed panels must reuse Director .bd-panel styling");
assert.ok(controller.root.querySelector(".bd-btn"), "Mixed buttons must reuse Director .bd-btn styling");
assert.ok(controller.root.querySelector(".bd-select"), "Mixed selects must reuse Director .bd-select styling");

const addButton = controller.root.querySelector('[data-mmx-i18n="mixed.addSegment"]');
assert.ok(addButton, "Mixed controls must expose stable i18n keys");
assert.equal(addButton.textContent, "添加片段");
setLocale("en");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(addButton.textContent, "Add Segment", "Mixed text must update with the existing locale toggle");

const libraryButton = controller.root.querySelector('[data-mmx-action="library-image"]');
assert.ok(libraryButton, "R2V picture controls must expose the existing Material Library action");
libraryButton.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(pickerCalls, 1, "Mixed must call the existing Material Library controller picker");
assert.equal(
    document.querySelector(".mmx-mixed-picker-layer"),
    null,
    "Mixed must not create a second Material Library modal",
);

controller.destroy();
console.log("mixed integrated browser contract passed");
