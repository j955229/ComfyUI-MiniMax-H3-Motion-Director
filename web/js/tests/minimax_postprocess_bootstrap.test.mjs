import assert from "node:assert/strict";
import fs from "node:fs";

const timeline = fs.readFileSync(
    new URL("../minimax_timeline.js", import.meta.url),
    "utf8",
);

assert.match(
    timeline,
    /minimax_postprocess_ui\.mjs\?boot=postprocess_output_v6/,
    "Director bootstrap must use postprocess_output_v6 so updated postprocess UI cannot reuse the v5 module URL",
);

console.log("postprocess bootstrap cache token test passed");
