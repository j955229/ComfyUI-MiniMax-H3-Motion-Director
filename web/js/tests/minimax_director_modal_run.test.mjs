import assert from "node:assert/strict";
import fs from "node:fs";
import { setLocale, t } from "../minimax_i18n.js";

const modal = fs.readFileSync(new URL("../minimax_director_modal.js", import.meta.url), "utf8");
const timeline = fs.readFileSync(new URL("../minimax_timeline.js", import.meta.url), "utf8");

assert.match(modal, /runButton\.dataset\.a = "run-director"/);
assert.match(modal, /runButton\.textContent = translate\("modal\.run"\)/);
assert.match(modal, /await onRun\(\)/);
assert.doesNotMatch(modal.match(/const handleRunClick[\s\S]*?const handleCloseClick/)?.[0] || "", /api\.close/,
    "running must leave the Director editor open");
assert.match(timeline, /queueNodeIds:\s*\[String\(this\.node\.id\)\]/,
    "Director Run must request partial execution through this node");
setLocale("en");
assert.equal(t("modal.run"), "Run Director");
setLocale("zh");
assert.equal(t("modal.run"), "运行 Director");
console.log("Director modal run test passed");
