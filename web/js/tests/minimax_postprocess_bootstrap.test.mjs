import assert from "node:assert/strict"; import fs from "node:fs";
const timeline=fs.readFileSync(new URL("../minimax_timeline.js",import.meta.url),"utf8");
assert.match(timeline,/minimax_postprocess_ui\.mjs\?boot=postprocess_output_v9/,"postprocess UI changes must bump the module boot token");
console.log("postprocess bootstrap cache token test passed");
