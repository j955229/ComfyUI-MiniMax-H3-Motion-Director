import assert from "node:assert/strict";
import fs from "node:fs";

const timeline = fs.readFileSync(new URL("../minimax_timeline.js", import.meta.url), "utf8");
const runtimeFix = fs.readFileSync(new URL("../zz_minimax_director_runtime_fix.js", import.meta.url), "utf8");
const mixedUi = fs.readFileSync(new URL("../minimax_mixed_ui.mjs", import.meta.url), "utf8");

const MIXED_UI_KEY = "./minimax_mixed_ui.mjs?boot=mixed_issue16_v2";
const INTERACTIONS_KEY = "./minimax_mixed_interactions.mjs?boot=issue16_v2";

function mixedUiImportKey(source) {
    const match = source.match(/from\s+["'](\.\/minimax_mixed_ui\.mjs\?boot=[^"']+)["']/);
    return match?.[1] || "";
}

assert.equal(
    mixedUiImportKey(timeline),
    MIXED_UI_KEY,
    "production timeline must import the current Mixed UI cache key",
);
assert.equal(
    mixedUiImportKey(runtimeFix),
    MIXED_UI_KEY,
    "runtime fix must use the same Mixed UI module identity as production",
);
assert.ok(
    mixedUi.includes(INTERACTIONS_KEY),
    "Mixed UI wrapper must force-load the current Issue #16 interaction helper",
);

console.log("Mixed UI cache-key test passed");
