import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../minimax_rtx_deblur_ui.js", import.meta.url), "utf8");
assert.doesNotMatch(source, /MutationObserver/, "RTX Deblur UI must not use MutationObserver; it can self-trigger and freeze ComfyUI");
assert.match(source, /nodeCreated\s*\(/, "RTX Deblur UI must attach through the ComfyUI node lifecycle");
assert.match(source, /loadedGraphNode\s*\(/, "RTX Deblur UI must rescan after serialized nodes load");

Object.assign(globalThis, {
  document: {
    documentElement: {},
    querySelectorAll() { return []; },
  },
  MutationObserver: class {
    constructor() { throw new Error("MutationObserver must never be constructed by RTX Deblur UI"); }
  },
  requestAnimationFrame(callback) { callback(); },
});
const { __extensions } = await import("../../../scripts/app.js");
await import("../minimax_rtx_deblur_ui.js?lifecycle-contract=1");
const extension = __extensions.find((item) => item.name === "MiniMaxH3.MotionDirector.RTXDeblurUI");
assert.ok(extension, "RTX Deblur extension must register");
await extension.setup();
extension.nodeCreated?.({});
extension.loadedGraphNode?.({});
await Promise.resolve();
console.log("RTX Deblur lifecycle regression contract passed");
