import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "http://localhost/",
});
Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    HTMLCanvasElement: dom.window.HTMLCanvasElement,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    FormData: dom.window.FormData,
    File: dom.window.File,
    MouseEvent: dom.window.MouseEvent,
    MutationObserver: dom.window.MutationObserver,
});
Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
});
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((fn) => setTimeout(() => fn(Date.now()), 0));
globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame || ((id) => clearTimeout(id));
globalThis.ResizeObserver = globalThis.ResizeObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
Object.defineProperty(globalThis, "localStorage", {
    value: dom.window.localStorage,
    configurable: true,
});

const { __extensions } = await import("../../../scripts/app.js");
await import("../minimax_timeline.js?director_module_load_smoke=1");

const extension = __extensions.find((item) => item?.name === "ComfyUI.MiniMaxH3MotionDirectorPlugin");
assert.ok(extension, "the real Director module must load and register its ComfyUI extension");
assert.equal(typeof extension.beforeRegisterNodeDef, "function");

const source = fs.readFileSync(new URL("../minimax_timeline.js", import.meta.url), "utf8");
assert.match(
    source,
    /\n\s{4}isMixedMode\(\)\s*\{\s*\n\s*return this\.getDirectorMode\(\) === ["']mixed["'];\s*\n\s*\}/,
    "native Director class must define the isMixedMode predicate used during initialization",
);
assert.ok((source.match(/this\.isMixedMode\(\)/g) || []).length > 0,
    "the regression guard is only meaningful while native initialization calls isMixedMode");

console.log("Director module load smoke passed");
