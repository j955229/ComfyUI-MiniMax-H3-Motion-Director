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
    MouseEvent: dom.window.MouseEvent,
});
Object.defineProperty(globalThis, "localStorage", {
    value: dom.window.localStorage,
    configurable: true,
});
window.confirm = () => true;

const { api } = await import("../../../scripts/api.js");
const { setLocale } = await import("../minimax_i18n.js");
const { mountMixedUI } = await import("../minimax_mixed_ui.mjs");
const { pickMixedMaterial } = await import("../minimax_mixed_material_picker.mjs");

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

// Exercise the current real controller shape: existing layer/open/close, no
// dedicated pick() API. Mixed captures a card choice from that same modal and
// blocks the normal standalone allocation click.
const originalFetchApi = api.fetchApi;
api.fetchApi = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
        items: [{ id: "video-1", type: "video", title: "Existing Fight Clip" }],
        categories: {},
    }),
    text: async () => "",
});

const existingLayer = document.createElement("div");
existingLayer.className = "mmx-ml-layer";
const existingCard = document.createElement("article");
existingCard.className = "mmx-ml-card";
existingCard.dataset.id = "video-1";
existingCard.dataset.type = "video";
existingLayer.appendChild(existingCard);
document.body.appendChild(existingLayer);
let openCount = 0;
let closeCount = 0;
let standaloneAllocationRan = false;
existingCard.addEventListener("click", () => { standaloneAllocationRan = true; });
const fallbackEditor = {
    getTaskKey() { return "mixed"; },
    _materialLibraryController: {
        layer: existingLayer,
        state: { activeType: "image" },
        async open() { openCount += 1; },
        close() { closeCount += 1; },
    },
};
const pickedPromise = pickMixedMaterial(fallbackEditor, { type: "video" });
await new Promise((resolve) => setTimeout(resolve, 0));
existingCard.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const picked = await pickedPromise;
assert.equal(picked?.id, "video-1");
assert.equal(openCount, 1, "Mixed must open the existing Material Library modal");
assert.equal(closeCount, 1, "selecting a card must close the existing modal through its controller");
assert.equal(standaloneAllocationRan, false, "picker capture must block standalone allocation mutation");
assert.ok(existingLayer.isConnected, "the existing Material Library layer is reused, not replaced");
assert.equal(document.querySelector(".mmx-mixed-picker-layer"), null);
existingLayer.remove();

// Closing that existing modal by its controller (Escape/backdrop/other owner)
// must also settle the picker. Otherwise a cancelled picker remains pending and
// the next Material Library action appears stuck.
const cancelLayer = document.createElement("div");
cancelLayer.className = "mmx-ml-layer";
document.body.appendChild(cancelLayer);
let cancelCloseCount = 0;
const cancelEditor = {
    getTaskKey() { return "mixed"; },
    _materialLibraryController: {
        layer: cancelLayer,
        state: { activeType: "image" },
        async open() {},
        close() { cancelCloseCount += 1; },
    },
};
const cancelPromise = pickMixedMaterial(cancelEditor, { type: "image" });
await new Promise((resolve) => setTimeout(resolve, 0));
cancelEditor._materialLibraryController.close();
const cancelled = await Promise.race([
    cancelPromise,
    new Promise((resolve) => setTimeout(() => resolve("__timeout__"), 50)),
]);
assert.equal(cancelled, null, "external Material Library close must resolve the Mixed picker as cancelled");
assert.equal(cancelCloseCount, 1);
cancelLayer.remove();
api.fetchApi = originalFetchApi;

console.log("mixed integrated browser contract passed");
