import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const importers = [
    "minimax_director_sections.js",
    "minimax_fl2v.js",
    "minimax_gen_timeline.js",
    "minimax_image_batch.js",
    "minimax_material_library_i18n.mjs",
    "minimax_mixed_i18n.mjs",
    "minimax_mixed_ui.mjs",
    "minimax_prompt_mentions.js",
    "minimax_rtx_deblur_ui.js",
    "minimax_sam_ui.js",
    "minimax_timeline.js",
    "zz_minimax_audio_drive_ui.js",
    "zz_minimax_director_runtime_fix.js",
];

for (const filename of importers) {
    const source = fs.readFileSync(new URL(filename, root), "utf8");
    assert.match(
        source,
        /minimax_i18n\.js\?boot=director_i18n_v2/,
        `${filename} must use the current shared i18n module identity`,
    );
}

const bootstrap = fs.readFileSync(new URL("minimax_prompt_enhancer.js", root), "utf8");
assert.match(bootstrap, /minimax_timeline\.js\?boot=director_ui_recovery_v9/);

const materialBootstrap = fs.readFileSync(new URL("minimax_material_library.js", root), "utf8");
assert.match(materialBootstrap, /minimax_material_library_modal\.mjs\?boot=mixed_global_library_v2/);

console.log("Director i18n cache-key test passed");
