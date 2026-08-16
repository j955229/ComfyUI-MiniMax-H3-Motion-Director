import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "http://localhost/" });
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
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
window.confirm = () => true;

const { setLocale } = await import("../minimax_i18n.js");
const { mountMixedUI } = await import("../minimax_mixed_ui.mjs");
setLocale("zh");

const editor = {
    node: { id: 4, widgets: [
        { name: "frame_rate", value: 24 },
        { name: "width", value: 864 },
        { name: "height", value: 480 },
        { name: "ref_max_size", value: 864 },
    ] },
};
const host = document.createElement("div");
document.body.appendChild(host);

function state(mode, inputs = {}) {
    return {
        version: 1,
        timelineMode: "mixed",
        frameRate: 24,
        output: { mode: "fixed", width: 864, height: 480, longEdge: 864, exportMode: "all" },
        segments: [{ id: "seg_1", mode, prompt: "one prompt", duration: 5, inputs: { resultRefs: [], ...inputs }, continuity: {} }],
    };
}

const controller = mountMixedUI({ host, editor, initialState: state("t2v"), onChange() {} });
function promptCount() { return controller.root.querySelectorAll("textarea.bd-prompt").length; }
function mediaCount() { return controller.root.querySelectorAll(".mmx-mixed-media-block").length; }

assert.equal(promptCount(), 1, "Mixed T2V must render exactly one prompt editor");
assert.equal(mediaCount(), 0, "Mixed T2V must render zero media/material slots");

controller.setState(state("i2v"));
assert.equal(promptCount(), 1);
assert.equal(mediaCount(), 1, "Mixed I2V exposes Start Frame only");

controller.setState(state("fl2v"));
assert.equal(promptCount(), 1);
assert.equal(mediaCount(), 2, "Mixed FL2V exposes First/Last Frame only");

controller.setState(state("r2v", { pictures: [], referenceVideos: [], referenceAudios: [] }));
assert.equal(promptCount(), 1);
assert.equal(mediaCount(), 3, "Mixed R2V exposes pictures + reference video + reference audio");

controller.setState(state("source_video", { identityPictures: [], referenceAudios: [] }));
assert.equal(promptCount(), 1);
assert.equal(mediaCount(), 3, "Mixed Source Video exposes source + identity + reference audio");
assert.equal(controller.root.querySelectorAll('[data-mmx-action="library-video"]').length, 0,
    "Source Video itself must never offer Material Library video as source");

controller.destroy();
console.log("Mixed per-mode input contract passed");
