import assert from "node:assert/strict";
import {
    globalRefineSummary,
    globalRefineVisibility,
    normalizePostprocessConfig,
    setGlobalUpscaleEnabled,
} from "../minimax_postprocess_ui.mjs";

let cfg = normalizePostprocessConfig({
    global_refine: {
        enabled: true,
        mode: "refine",
        seed_mode: "inherit",
        resolution_mode: "follow_director",
        upscale_method: "lanczos",
    },
});
assert.deepEqual(globalRefineVisibility(cfg), {
    upscaleEnabled: false,
    seedOffset: false,
    upscaleModel: false,
    vsr: false,
    aspectMegapixels: false,
    customSize: false,
});
assert.match(globalRefineSummary(cfg, 1376, 768, "zh"), /保持原 Seed/);

cfg = setGlobalUpscaleEnabled(cfg, true);
assert.equal(cfg.global_refine.mode, "upscale");
cfg.global_refine.upscale_method = "nvidia_rtx_vsr";
cfg.global_refine.vsr_source = "clean";
cfg.global_refine.vsr_quality = "high";
cfg.global_refine.resolution_mode = "aspect_megapixels";
assert.deepEqual(globalRefineVisibility(cfg), {
    upscaleEnabled: true,
    seedOffset: false,
    upscaleModel: false,
    vsr: true,
    aspectMegapixels: true,
    customSize: false,
});
assert.match(globalRefineSummary(cfg, 1376, 768, "zh"), /RTX VSR High/);

cfg.global_refine.upscale_method = "upscale_model";
cfg.global_refine.resolution_mode = "custom";
cfg.global_refine.seed_mode = "offset";
assert.deepEqual(globalRefineVisibility(cfg), {
    upscaleEnabled: true,
    seedOffset: true,
    upscaleModel: true,
    vsr: false,
    aspectMegapixels: false,
    customSize: true,
});

const invalidSeed = normalizePostprocessConfig({ global_refine: { seed_offset: "bad" } });
assert.equal(invalidSeed.global_refine.seed_offset, 1);

console.log("postprocess UI state tests passed");
