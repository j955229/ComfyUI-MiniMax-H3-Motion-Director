# Segment-Final Face Refine Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Face Refine part of the final per-segment Motion Context state, preserve cross-segment tracking without re-sampling history, reuse audio latent independently, complete SAM discovery/preflight, and make reporting truthful.

**Architecture:** Motion Context-only timelines run Face Refine immediately after each segment's final decode/seam processing and before caches/handoff are created. `apply_face_refine` receives an optional prior RGB history prefix for tracking, slices that history out before H3 face sampling, and returns per-current-segment output. AV latent handoff carries an explicit visual-validity bit; Motion Context consumes separate video/audio latent candidates. Source Bridge timelines retain assembled Face Refine.

**Tech Stack:** Python 3, PyTorch, ComfyUI folder/model APIs, Ultralytics, pytest, ES modules/Node tests.

**Spec:** `docs/superpowers/specs/2026-08-20-face-refine-handoff-sam-design.md`

## Global Constraints

- Final target branch is `main`; development is verified on `work/face-refine-handoff-v10` then fast-forwarded.
- Preserve Color Re-anchor RGB semantics.
- Do not change Source Bridge generation semantics.
- Do not silently fall back from SAM to rectangle masks.
- Do not re-sample Face Refine tracking-history frames.
- Final user-visible RGB is the visual Motion Context source of truth after successful Face Refine.
- Audio latent remains reusable across video-canvas changes and pixel-only final edits.

---

### Task 1: Tracking-history slicing and aggregate Face Refine statistics

**Files:**
- Modify: `director/face_track.py`
- Modify: `director/face_refine_pipeline.py`
- Test: `tests/test_face_refine_streaming.py`

**Interfaces:**
- Produces: `face_tracking_history_frames(config) -> int`
- Produces: `slice_face_track_result(result, start, end=None) -> FaceTrackResult`
- Extends: `apply_face_refine(..., tracking_history: torch.Tensor | None = None)`

- [ ] Write failing tests proving history is included in tracking but excluded from sampled/refined output, sliced transform fields have current length, and denoise statistics aggregate across multiple chunks.
- [ ] Run the focused test file and confirm failures are caused by missing streaming/history behavior.
- [ ] Add the minimal slicing/history helpers and aggregate statistic accumulator.
- [ ] Run focused tests to green.
- [ ] Run existing Face Refine/track/stitch tests.

### Task 2: Independent audio-latent Motion Context

**Files:**
- Modify: `director/motion_context.py`
- Modify: `director/latent_context_cache.py`
- Test: `tests/test_motion_context_audio_latent_split.py`
- Test: `tests/test_latent_context_cache.py`

**Interfaces:**
- Extends: `apply_exported_motion_context(..., context_audio_latent=None)`
- Preserves: `context_latent` as visual candidate only.
- Persists: `handoff["visual_latent_valid"]: bool`.

- [ ] Write failing tests where visual context is RGB/Color Re-anchor but audio must come from latent, plus cache round-trip for `visual_latent_valid=False`.
- [ ] Run focused tests and confirm expected failures.
- [ ] Decouple audio latent selection from visual latent selection and preserve the validity flag in cached handoff metadata.
- [ ] Run focused tests to green.
- [ ] Run existing Motion Context and latent-cache tests.

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
- Registers: `models/sams` category.
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
- Maintains in-memory final RGB tracking tail and independent AV audio-latent tail.
- Postprocess config/boot token: v10.

- [ ] Write failing executor source/ordering contracts and v10 boot/config tests.
- [ ] Run focused tests and confirm expected failures.
- [ ] Move non-bridge Face Refine into `_run_one_segment`, feed previous final history, invalidate visual latent only on successful pixel changes, and pass independent audio latent to both first-pass and Refine-Canvas repin Motion Context.
- [ ] Keep assembled Face Refine only for Source Bridge timelines.
- [ ] Add a final-segment pipeline token to context cache settings and bump postprocess/frontend boot version to v10.
- [ ] Run focused tests to green.

### Task 5: Truthful timing/reporting and full regression verification

**Files:**
- Modify: `director/motion_context.py`
- Modify: `director/executor_core.py`
- Modify: report contract tests as required.

**Interfaces:**
- `MotionContextInfo` reports context encode timing fields.
- Face Refine report distinguishes `segment-final` and `assembled/source-bridge` modes and aggregates segment timings/statistics.

- [ ] Write failing report tests for Motion Context VideoVAE/AudioVAE encode timing labels and aggregate Face Refine statistics.
- [ ] Run the tests and confirm expected failures.
- [ ] Add timing capture around only the real encode paths and aggregate report formatting.
- [ ] Run focused tests to green.
- [ ] Run `pytest -q` for the reconstructed/local repository test set available in this environment and Node postprocess tests.
- [ ] Compare final branch against starting `main`; reject unrelated formatting churn, especially in `director/executor_core.py`.
- [ ] Fast-forward `main` only after fresh verification succeeds.
