# H3 Latent Refine, Native Masks, and Segment Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add native H3 video/audio mask preservation, a Director-native learned-latent Global Refine backend, and strict segment boundary/seam validation without adding Draft state.

**Architecture:** Keep the current executor and Global Refine structure. Director owns focused helper/runtime modules for H3 nested-mask handling, learned-latent checkpoint inference, final-canvas keyframe synchronization, and segment-boundary diagnostics. Compatible learned-latent checkpoints live in `ComfyUI/models/latent_upscale_models`; no second custom node is required.

**Tech Stack:** Python 3, PyTorch, ComfyUI MiniMax H3 nodes, vanilla ES modules / Node assertions.

**Spec:** `docs/superpowers/specs/2026-08-19-h3-latent-refine-mask-seams-design.md`

## Global Constraints

- No Draft/Approve/Reject state machine or full Draft latent cache.
- Existing pixel Global Refine methods remain behavior-compatible.
- No automatic seam-frame deletion.
- No LBH source or weights are vendored or redistributed.
- Director itself loads compatible learned-latent checkpoints; `NODE_CLASS_MAPPINGS` from another custom node must not be required.
- Checkpoint state-dict layout is the only source of truth for 2D + Temporal versus Full 3D runtime selection; the user never selects a runtime variant separately.
- Legacy saved `latent_upscale_variant` values are discarded and never forwarded to learned-latent inference.
- A missing/incompatible checkpoint fails explicitly and falls back only through existing Global Refine first-pass fallback.
- Director owns final canvas size and validates returned latent H/W/T exactly.
- Audio masks remain unchanged across spatial video upscale; video masks are nearest-neighbor remapped spatially.
- Normal Motion Context is re-pinned through the existing RGB path; five-frame Source Bridge anchors are synchronized explicitly.

---

### Task 1: H3 nested mask helpers — complete

**Files:**
- `director/h3_noise_mask.py`
- `tests/test_h3_noise_mask.py`

- [x] Split/reconstruct H3 nested video/audio masks.
- [x] Preserve Audio mask exactly.
- [x] Nearest-remap Video mask H/W while preserving T.
- [x] Preserve absence of a mask.
- [x] Cover ordinary tensor and nested mask inputs.

### Task 2: Segment boundary contract and seam diagnostics — complete

**Files:**
- `director/segment_boundary.py`
- `director/audio_trim.py`
- `tests/test_segment_boundary.py`

- [x] Define one authoritative visible frame slice.
- [x] Cover context spans 0/5/22/39.
- [x] Discard H3 alignment tail surplus.
- [x] Reject decoded outputs shorter than the requested visible range.
- [x] Make audio trimming use the same exact frame boundary.
- [x] Keep seam diagnostics non-destructive.

### Task 3: Director-native learned-latent runtime — complete

**Files:**
- `director/h3_latent_upscaler_runtime.py`
- `director/h3_learned_latent.py`
- `director/model_paths.py`
- `tests/test_h3_learned_latent.py`
- `tests/test_h3_learned_internal_runtime.py`
- `tests/test_h3_latent_variant_autodetect.py`
- `tests/test_model_paths.py`
- `tests/test_postprocess_native_runtime_contract.py`

- [x] Register Director-owned `models/latent_upscale_models` model folder.
- [x] Load compatible `.safetensors`, `.pth`, and `.pt` checkpoints directly.
- [x] Detect 2D + Temporal versus Full 3D checkpoint state-dict layouts.
- [x] Make detected checkpoint layout authoritative even when an old saved config contains the opposite variant value.
- [x] Run 24-channel H3 video latent inference without importing another custom node.
- [x] Preserve temporal length.
- [x] Preserve Audio latent and Audio mask; remap Video mask.
- [x] Enforce 2D uniform scaling with normal integer-grid rounding tolerance; permit exact final H/W with Full 3D.
- [x] On CUDA, release first-pass ComfyUI model residency before loading the learned-latent model.
- [x] Release learned-latent model memory before high-resolution H3 refine.
- [x] Lock a test contract that `NODE_CLASS_MAPPINGS` and LBH node class names are not dependencies.

### Task 4: Postprocess config and UI — complete

**Files:**
- `director/postprocess_config.py`
- `web/js/minimax_postprocess_ui.mjs`
- `web/js/minimax_timeline.js`
- `web/js/tests/minimax_postprocess_ui.test.mjs`
- `web/js/tests/minimax_postprocess_bootstrap.test.mjs`
- `tests/test_postprocess_latent_config.py`
- `tests/test_h3_latent_model_scan_ui_contract.py`
- `tests/test_postprocess_boot_token_v8.py`

- [x] Add `h3_learned_latent` method and normalized model/precision/device fields.
- [x] Remove the manual 2D/3D Latent Variant selector.
- [x] Drop legacy `latent_upscale_variant` from normalized/saved config and cache identity.
- [x] Keep old saved configs valid and old upscale methods unchanged.
- [x] Present the method as `H3 Learned Latent`, not as an external-node feature.
- [x] UI explicitly says no separate LBH custom node is required and checkpoint weights determine 2D/3D architecture.
- [x] Keep the existing `postprocess_output_v8` module boot token; a hard browser refresh is required after switching to this branch because the large timeline bootstrap file was intentionally not rewritten just to change the cache token.

### Task 5: Global Refine and conditioning integration — complete

**Files:**
- `director/refine_sampling.py`
- `director/refine_latent_stage.py`
- `tests/test_refine_sampling_learned_integration.py`
- `tests/test_refine_latent_stage.py`

- [x] Learned-latent branch runs before pixel Decode/Encode.
- [x] Existing Lanczos/Upscale Model/RTX VSR paths stay on the old pixel path.
- [x] Do not forward any manual `latent_upscale_variant` value into the learned-latent adapter.
- [x] Preserve existing H3 `noise_mask` even when Motion Context is off (important for Audio Drive).
- [x] Synchronize target keyframe latents to final canvas.
- [x] Leave normal Motion Context keyframes to existing RGB re-pin.
- [x] Synchronize Source Bridge five-frame endpoint anchors explicitly.
- [x] Reject RTX Deblur + learned-latent in one stage instead of silently creating a pixel round-trip.
- [x] Keep first-pass fallback semantics for learned-latent failures.

### Task 6: Verification

- [x] Native learned-latent core regression previously reached 24 tests passed after replacing the external-node adapter.
- [x] Model-folder registration was included in focused regression; the corrected core set previously reached 25 tests passed.
- [x] Python syntax compilation previously passed for affected runtime/refine modules in the isolated local mirror.
- [x] Manual runtime variant mismatch reproduced from the user's real error and checkpoint-driven backend selection was added.
- [x] No Draft state introduced.
- [x] No existing pixel backend removed.
- [x] No separate LBH custom-node installation required.
- [ ] Fresh full branch regression after the final UI/config variant-removal commits still requires an environment containing the complete repository checkout.
- [ ] Real CUDA video inference with the user's actual learned-latent checkpoint remains a runtime validation step because the test environment does not contain the checkpoint/GPU ComfyUI stack.
