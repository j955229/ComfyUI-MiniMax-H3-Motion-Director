import assert from "node:assert/strict";
import fs from "node:fs";

const gen = fs.readFileSync(new URL("../minimax_gen_timeline.js", import.meta.url), "utf8");
const timeline = fs.readFileSync(new URL("../minimax_timeline.js", import.meta.url), "utf8");

assert.match(gen, /if \(key === "mixed"\) return "mixed";/);
assert.match(timeline, /this\.mixedTimeline = normalizeMixedTimeline/);
assert.match(timeline, /_enterMixedNative\(prevMode\)/);
assert.match(timeline, /if \(mode === "mixed"\)/);
assert.match(timeline, /if \(nextMode === "mixed"\)/);
assert.match(timeline, /if \(this\.isMixedMode\(\)\) return this\._mixedPayload\(\);/);
assert.match(timeline, /return mode !== "video" && mode !== "prompt_batch" && mode !== "fl2v" && mode !== "mixed";/);
assert.doesNotMatch(timeline, /_mmxMixedPatched/);
assert.doesNotMatch(timeline, /_mmxLegacyBeforeMixed/);

// Standalone task legality remains untouched by the native Mixed branch.
assert.match(gen, /const NO_REF_IMAGE_TASKS = new Set\(\["v2v", "mv2v", "ads2v", "t2v", "i2v", "fl2v"\]\)/);
assert.match(gen, /return taskKey === "r2v" \|\| taskKey === "r2i" \|\| taskKey === "rv2v"/);

console.log("native Mixed integration contract passed");
