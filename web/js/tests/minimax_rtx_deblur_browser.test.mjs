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
});
Object.defineProperty(globalThis, "localStorage", {
    value: dom.window.localStorage,
    configurable: true,
});

let forbiddenObserverConstructions = 0;
globalThis.MutationObserver = class {
    constructor() {
        forbiddenObserverConstructions += 1;
        throw new Error("RTX Deblur UI must not construct MutationObserver");
    }
};

const { __extensions } = await import("../../../scripts/app.js");
const { setLocale } = await import("../minimax_i18n.js");
const { PostprocessConfigStore, mountPostprocessUI } = await import("../minimax_postprocess_ui.mjs");

setLocale("zh");
const widget = {
    value: JSON.stringify({
        version: 4,
        global_refine: {
            enabled: false,
            rtx_deblur_enabled: true,
            rtx_deblur_quality: "high",
        },
    }),
};
const store = new PostprocessConfigStore(widget);
const host = document.createElement("div");
document.body.appendChild(host);
const postprocess = mountPostprocessUI(host, store, { locale: () => "zh" });

await import("../minimax_rtx_deblur_ui.js?browser-contract=1");
const extension = __extensions.find((item) => item.name === "MiniMaxH3.MotionDirector.RTXDeblurUI");
assert.ok(extension, "RTX Deblur extension must register");
extension.setup();
await Promise.resolve();

const root = postprocess.root;
const section = root.querySelector("[data-rtx-deblur-section]");
assert.ok(section, "RTX Deblur controls must be inserted after the native Upscale section");
assert.equal(root.querySelectorAll("[data-rtx-deblur-section]").length, 1);
const enabled = section.querySelector('[data-path="global_refine.rtx_deblur_enabled"]');
const quality = section.querySelector('[data-path="global_refine.rtx_deblur_quality"]');
assert.equal(enabled.checked, true, "persisted RTX Deblur enabled state must be restored from the postprocess store");
assert.equal(quality.value, "high", "persisted RTX Deblur quality must be restored from the postprocess store");
assert.equal(root.querySelector('[data-section="global_refine"]').classList.contains("mmx-post-disabled"), false,
    "RTX Deblur must keep the Global Refine column active even when second sampling is disabled");

extension.nodeCreated?.({});
extension.loadedGraphNode?.({});
await Promise.resolve();
assert.equal(root.querySelectorAll("[data-rtx-deblur-section]").length, 1,
    "repeated lifecycle scans must remain idempotent");

setLocale("en");
await Promise.resolve();
assert.equal(section.querySelector("[data-rtx-deblur-enabled-label]").textContent, "ON / OFF");
assert.equal(section.querySelector("[data-rtx-deblur-quality-label]").textContent, "Quality");
setLocale("zh");
await Promise.resolve();
assert.equal(section.querySelector("[data-rtx-deblur-enabled-label]").textContent, "开 / 关");
assert.equal(section.querySelector("[data-rtx-deblur-quality-label]").textContent, "质量");

enabled.checked = false;
enabled.dispatchEvent(new Event("change", { bubbles: true }));
await Promise.resolve();
assert.equal(store.get().global_refine.rtx_deblur_enabled, false,
    "RTX Deblur checkbox must write through the existing postprocess store");
assert.equal(root.querySelector('[data-section="global_refine"]').classList.contains("mmx-post-disabled"), true);

quality.value = "";
enabled.checked = true;
enabled.dispatchEvent(new Event("change", { bubbles: true }));
await Promise.resolve();
assert.equal(store.get().global_refine.rtx_deblur_enabled, true);
assert.equal(store.get().global_refine.rtx_deblur_quality, "medium",
    "enabling Deblur with an unset quality must persist the Medium default");
assert.equal(root.querySelector('[data-section="global_refine"]').classList.contains("mmx-post-disabled"), false);
assert.equal(forbiddenObserverConstructions, 0, "the regression path must not construct any MutationObserver");

postprocess.destroy();
host.remove();
console.log("RTX Deblur browser lifecycle contract passed");
