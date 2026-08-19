# H3 Latent Refine, Native Masks, and Segment Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native H3 video/audio mask preservation, an optional LBH learned-latent Global Refine backend, and strict segment boundary/seam validation without adding Draft state.

**Architecture:** Keep the current executor and Global Refine structure. Add focused helper modules for H3 nested-mask handling, external learned-latent adaptation, and segment-boundary diagnostics; then wire those helpers into `refine_sampling.py`, `executor_core.py`, postprocess config, and the existing postprocess UI. Rebuild official H3 conditioning at the final canvas from executor-owned source inputs instead of blindly resizing conditioning tensors.

**Tech Stack:** Python 3, PyTorch, ComfyUI MiniMax H3 nodes, vanilla ES modules / Node assertions.

**Spec:** `docs/superpowers/specs/2026-08-19-h3-latent-refine-mask-seams-design.md`

## Global Constraints

- No Draft/Approve/Reject state machine or full Draft latent cache.
- Existing pixel Global Refine methods remain behavior-compatible.
- No automatic seam-frame deletion.
- No copied LBH implementation source; integration is runtime adaptation of the separately installed custom node.
- Selecting the learned-latent backend fails explicitly if LBH is unavailable and falls back only through the existing Global Refine first-pass fallback.
- Director owns final canvas size and validates returned latent H/W exactly.
- Audio masks remain unchanged across spatial video upscale; video masks are nearest-neighbor remapped spatially.
- High-resolution H3 conditioning is rebuilt from original segment inputs at the final canvas.

---

### Task 1: H3 nested mask helpers

**Files:**
- Create: `director/h3_noise_mask.py`
- Create: `tests/test_h3_noise_mask.py`

**Interfaces:**
- Produces: `split_h3_mask(mask)`, `resize_video_mask(mask, target_h, target_w)`, `remap_h3_noise_mask(mask, target_h, target_w)`, `with_noise_mask(latent, mask)`.

- [ ] Write tests using a tiny fake NestedTensor that verify video/audio split, exact audio-mask preservation, nearest-neighbor spatial video-mask remap, absence preservation, and ordinary tensor masks.
- [ ] Run the new test and confirm failure because the helper module does not exist.
- [ ] Implement the helpers with dynamic `comfy.nested_tensor` import only when a nested mask must be reconstructed.
- [ ] Run the focused test and existing audio-role tests.

### Task 2: Segment boundary contract and seam diagnostics

**Files:**
- Create: `director/segment_boundary.py`
- Create: `tests/test_segment_boundary.py`
- Modify: `director/audio_trim.py`
- Modify: `director/executor_core.py`

**Interfaces:**
- Produces: `BoundarySlice`, `resolve_visible_slice(total_frames, context_frames, target_frames)`, `validate_exported_frame_count(images, target_frames)`, `seam_diagnostics(left, right, left_audio=None, right_audio=None, fps=24.0)`.

- [ ] Write tests for context spans 0/5/22/39, alignment overshoot, short decoded output rejection, exact target count, and non-destructive seam metrics.
- [ ] Run tests and verify failure.
- [ ] Implement pure boundary helpers.
- [ ] Make `trim_segment_av` consume the authoritative boundary slice and validate exact output count.
- [ ] Add per-boundary seam diagnostics in executor reporting after export chunks are available; diagnostics must never mutate frames.
- [ ] Run focused tests and existing audio tests.

### Task 3: Optional LBH learned-latent adapter

**Files:**
- Create: `director/h3_learned_latent.py`
- Create: `tests/test_h3_learned_latent.py`

**Interfaces:**
- Produces: `list_lbh_models()`, `lbh_available()`, `upscale_h3_av_latent(latent, *, width, height, model_name, variant, precision, device)` and `release_lbh_upscaler_cache()`.

- [ ] Write tests with fake LBH package modules and fake H3 nested AV latent covering: missing dependency error, 2D exact-size path, 3D target-dimensions path, audio latent preservation, output canvas validation, noise-mask remap, and cache clear.
- [ ] Run and verify failure.
- [ ] Implement runtime discovery/import of the installed LBH custom node without vendoring its code.
- [ ] Separate H3 AV latent before calling the external video-latent node; rejoin audio afterward; remap existing noise mask using Task 1 helpers.
- [ ] Validate output video latent dimensions exactly against Director target `height//16`, `width//16` and preserve temporal length.
- [ ] Clear LBH model caches and run ComfyUI model-management soft cleanup after the stage.
- [ ] Run focused tests.

### Task 4: Postprocess config and UI

**Files:**
- Modify: `director/postprocess_config.py`
- Modify: `web/js/minimax_postprocess_ui.mjs`
- Modify: `web/js/tests/minimax_postprocess_ui.test.mjs`
- Add/modify Python config tests as needed.

**Interfaces:**
- New config values: `global_refine.upscale_method = "h3_learned_latent"`, `latent_upscale_variant = "2d"|"3d"`, `latent_upscale_model`, `latent_upscale_precision = "fp16"|"bf16"|"fp32"`, `latent_upscale_device = "cuda"|"cpu"`.

- [ ] Extend UI/config tests first and verify failure.
- [ ] Bump backend config version and add normalized defaults/migration-safe choices.
- [ ] Add the learned-latent method to UI labels/options and conditionally show model/variant/precision/device fields.
- [ ] Keep old saved configs valid and old upscale methods unchanged.
- [ ] Run Node state tests and Python config tests.

### Task 5: Global Refine integration and conditioning rebuild

**Files:**
- Modify: `director/refine_sampling.py`
- Modify: `director/executor_core.py`
- Create: `tests/test_refine_latent_backend.py`

**Interfaces:**
- `apply_global_refine(..., repin=...)` remains callable by existing code; executor's repin callback is upgraded to rebuild full official MiniMax H3 conditioning at the upscaled canvas and then reapply Motion Context.

- [ ] Write tests that prove learned-latent refine does not call pixel decode/encode, preserves/remaps masks, rejects RTX Deblur + learned-latent combination, and uses exact final canvas.
- [ ] Run and verify failure.
- [ ] Add learned-latent branch before pixel decode in `apply_global_refine`.
- [ ] Keep pixel methods on the existing decode/upscale/encode path.
- [ ] After learned upscale, call the executor callback to rebuild official H3 conditioning from original prompt/task/frames/references at final width/height; reapply Motion Context using the new latent.
- [ ] Release LBH upscaler cache before high-resolution H3 sampling.
- [ ] Preserve existing first-pass fallback semantics and stage report fields.
- [ ] Run focused tests.

### Task 6: Documentation and verification

**Files:**
- Modify: `README.md`
- Modify: `README_zh.md`

- [ ] Document the optional LBH dependency, installation/model location, 2D/3D choice, time-vs-VRAM behavior, and the recommended random-seed-low-res -> lock seed -> enable refine workflow.
- [ ] Document native video/audio mask preservation and boundary validation behavior.
- [ ] Run all Python tests available without a full ComfyUI install, Node UI tests, Python syntax compilation, and compare branch against `main`.
- [ ] Verify no Draft state was introduced, no existing pixel backend was removed, and no LBH source was copied.
