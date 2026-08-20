# Segment-Final Face Refine Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Face Refine part of the final per-segment Motion Context state, preserve cross-segment tracking without re-sampling history, preserve the existing long-chain audio refresh contract, complete SAM discovery/preflight, and make reporting truthful.

**Architecture:** Motion Context-only timelines run Face Refine immediately after each segment's final decode/seam processing and before caches/handoff are created. `apply_face_refine` receives an optional prior RGB history prefix for tracking, slices that history out before H3 face sampling, and returns per-current-segment output. Successful Face Refine invalidates only visual latent reuse; existing `audio_context_refresh.py` continues to prefer final audible waveform refresh for long-chain stability. Source Bridge timelines retain assembled Face Refine.

**Tech Stack:** Python 3, PyTorch, ComfyUI folder/model APIs, Ultralytics, pytest, ES modules/Node tests.

**Spec:** `docs/superpowers/specs/2026-08-20-face-refine-handoff-sam-design.md`

## Global Constraints

- Final target branch is `main`; development is verified on `work/face-refine-handoff-v10` then fast-forwarded.
- Preserve Color Re-anchor RGB semantics.
- Preserve `audio_context_refresh.py` waveform-refresh semantics and its latent fallback.
- Do not change Source Bridge generation semantics.
- Do not silently fall back from SAM to rectangle masks.
- Do not re-sample Face Refine tracking-history frames.
- Final user-visible RGB is the visual Motion Context source of truth after successful Face Refine.

---

### Task 1: Tracking-history slicing and aggregate Face Refine statistics

**Files:**
- Create: `director/face_refine_streaming.py`
- Modify: `director/face_refine_pipeline.py`
- Test: `tests/test_face_refine_streaming.py`
- Test: `tests/test_face_refine_streaming_pipeline_contract.py`

**Interfaces:**
- Produces: `tracking_history_frames(config) -> int`
- Produces: `select_tracking_history(history, current, config) -> Tensor | None`
- Produces: `slice_tracking_result(result, start, end=None)`
- Produces: `aggregate_denoise_statistics(chunks)`
- Extends: `apply_face_refine(..., tracking_history: torch.Tensor | None = None)`

- [x] Write failing tests proving history selection/slicing and aggregate statistics.
- [x] Run focused helper tests through RED and GREEN.
- [x] Add the minimal streaming helpers.
- [x] Wire history into `apply_face_refine` and remove last-chunk statistics overwrite.
- [ ] Run focused contract and existing Face Refine/track/stitch tests.

### Task 2: Final visual-latent validity without changing audio refresh

**Files:**
- Modify: `director/latent_context_cache.py`
- Test: `tests/test_latent_context_cache.py`
- Create: `tests/test_visual_latent_validity.py`

**Interfaces:**
- Persists: `handoff["visual_latent_valid"]: bool`.
- Leaves: `audio_context_refresh.py` unchanged except report instrumentation if required.

- [ ] Write failing tests for handoff/cache round-trip of `visual_latent_valid=False` and preservation of existing audio-refresh behavior.
- [ ] Run focused tests and confirm expected failures.
- [ ] Preserve the validity flag in cached handoff metadata.
- [ ] Run latent-cache and `test_audio_context_refresh.py` tests to green.

### Task 3: SAM ownership and fail-fast validation

**Files:**
- Modify: `director/model_paths.py`
- Create: `director/face_refine_validation.py`
- Modify: `director/face_stitch.py`
- Modify: `director/http_routes.py`
- Modify: `web/js/minimax_postprocess_ui.mjs`
- Test: `tests/test_model_paths.py`
- Create: `tests/test_face_refine_sam_validation.py`
- Create: `tests/test_sam_capabilities_contract.py`

**Interfaces:**
- Registers: `ComfyUI/models/sams` category.
- Produces: `resolve_sam_model_path(name) -> str`.
- Produces: `validate_face_refine_runtime(config) -> None`.
- Capabilities: compatible Ultralytics `.pt` list plus expected folder.

- [ ] Write failing folder-registration, `.pt` filtering, missing/incompatible SAM preflight, and UI empty-state contract tests.
- [ ] Run focused tests and confirm expected failures.
- [ ] Register Director SAM folder, centralize SAM path resolution, add preflight validation, filter capability results, and show actionable UI text.
- [ ] Run focused Python and JS tests to green.

### Task 4: Segment-final executor lifecycle and cache semantics

**Files:**
- Modify: `director/executor_core.py`
- Modify: `director/postprocess_config.py`
- Modify: `web/js/minimax_timeline.js`
- Modify: `web/js/minimax_postprocess_ui.mjs`
- Rename/update: `tests/test_postprocess_boot_token_v9.py` -> v10 contract
- Create: `tests/test_executor_face_refine_handoff_contract.py`

**Interfaces:**
- Non-bridge path: Face Refine before `save_segment_cache`, `save_motion_context_cache`, and `completed_contexts`.
- Bridge path: assembled Face Refine remains after bridge assembly.
- Successful Face Refine causes visual Motion Context to ignore pre-FaceRefine latent and use final RGB.
- Existing audio refresh remains unchanged and continues to use final exported waveform where safe.
- Postprocess config/boot token: v10.

- [ ] Write failing executor source/ordering contracts and v10 boot/config tests.
- [ ] Run focused tests and confirm expected failures.
- [ ] Move non-bridge Face Refine into `_run_one_segment`, feed previous final history, and invalidate visual latent only on successful pixel changes.
- [ ] Keep assembled Face Refine only for Source Bridge timelines.
- [ ] Add a final-segment pipeline token to context cache settings and bump postprocess/frontend boot version to v10.
- [ ] Run focused tests to green.

### Task 5: Truthful timing/reporting and full regression verification

**Files:**
- Modify: `director/motion_context.py`
- Modify: `director/audio_context_refresh.py` only if needed to expose intentional refresh timing/status.
- Modify: `director/executor_core.py`
- Modify: report contract tests as required.

**Interfaces:**
- `MotionContextInfo` reports actual VideoVAE and AudioVAE encode timing fields.
- Intentional waveform refresh is reported as refresh, not generic fallback.
- Face Refine report distinguishes `segment-final` and `assembled/source-bridge` modes and aggregates segment timings/statistics.

- [ ] Write failing report tests for Motion Context VideoVAE/AudioVAE encode timing labels, waveform-refresh labeling, and aggregate Face Refine statistics.
- [ ] Run the tests and confirm expected failures.
- [ ] Add timing capture around only the real encode paths and aggregate report formatting.
- [ ] Run focused tests to green.
- [ ] Run `pytest -q` for the reconstructed/local repository test set available in this environment and Node postprocess tests.
- [ ] Compare final branch against starting `main`; reject unrelated formatting churn, especially in `director/executor_core.py`.
- [ ] Fast-forward `main` only after fresh verification succeeds.
