# Mixed Mode UI Integration Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Mixed mode into the existing Director UI instead of maintaining a second standalone UI, while preserving the already implemented Mixed backend/schema behavior and all six standalone modes.

**Architecture:** Keep the existing `.bd-wrap` Director shell, mode selector, output controls, locale system, and Material Library modal alive in every mode. Mixed owns only a dedicated middle workspace mounted inside the existing Generation page. Result-frame references are simplified to one explicit `segment` origin keyed by stable segment ID; legacy `previous`/`earlier` Mixed data is migrated during normalization.

**Tech Stack:** ComfyUI frontend JavaScript ES modules, existing Director DOM/CSS (`.bd-*`), existing `minimax_i18n.js`, existing Material Library modal/controller, Python Mixed schema/planner/runtime, GitHub Actions Node/jsdom/Python CI.

## Global Constraints

- Work only on `feature/mixed-mode`; do not move or modify `main`.
- Branch baseline must include `main` v1.0.3 (`835f8d54f977ea119deef91ae442fc83d64aece0`).
- Standalone `T2V / I2V / FL2V / R2V / V2V / RV2V` behavior and Director Inputs socket contracts remain unchanged.
- Mixed user-facing segment modes remain exactly `T2V / I2V / FL2V / R2V / Source Video`.
- Material Library video remains Reference Video only; it cannot become Mixed Source Video.
- Mixed v1 does not enable Director Inputs or Source Bridge.
- UI strings must be fully localized through the existing zh/en locale system; model/task abbreviations such as T2V/I2V/FL2V/R2V remain technical labels.
- Result-frame references may target only an earlier segment by stable segment ID; no self/future/cyclic references.

---

### Task 1: Preserve the existing Director shell while entering Mixed

**Files:**
- Modify: `web/js/zz_minimax_mixed_mode.js`
- Modify: `web/js/minimax_mixed_ui.mjs`
- Test: `web/js/tests/minimax_mixed_lifecycle.test.mjs`

**Interfaces:**
- Consumes: `editor.root`, `editor.globalTask`, `editor.mainBody`, existing Director modal Generation host.
- Produces: `mountMixedUI({ host, editor, initialState, onChange })` mounted only inside a dedicated Mixed workspace host while the existing toolbar/mode selector remains connected.

- [ ] **Step 1: Add a failing lifecycle test**

Assert that after entering Mixed:

```js
assert.ok(editor.globalTask.isConnected);
assert.equal(editor.globalTask.value, "mixed — 混合模式(Mixed)");
assert.ok(editor.root.contains(editor.globalTask));
assert.ok(editor._mmxMixedController.root.isConnected);
```

Then change `globalTask.value` to a standalone mode, dispatch `change`, and assert Mixed unmounts while the original Director root remains connected.

- [ ] **Step 2: Run the browser/lifecycle test and confirm failure**

Expected failure: existing `enterMixed()` replaces the Generation host and disconnects the toolbar selector.

- [ ] **Step 3: Replace full-page replacement with a dedicated workspace host**

Keep `editor.root` mounted. Add/retain a `div` inside the existing Generation body for Mixed content and hide only the legacy middle-mode surfaces that conflict with Mixed. Never call `host.replaceChildren(mixedRoot)`.

- [ ] **Step 4: Ensure switching modes uses the existing selector event path**

`editor.globalTask.onchange` remains authoritative. Mixed wrappers observe the resulting task key and mount/unmount the workspace without replacing the selector itself.

- [ ] **Step 5: Run lifecycle/browser CI**

Expected: Mixed → T2V → Mixed round-trip preserves both workspaces and selector visibility.

### Task 2: Reuse existing Director visual components

**Files:**
- Modify: `web/js/minimax_mixed_ui.mjs`
- Test: `web/js/tests/minimax_mixed_browser.test.mjs`

**Interfaces:**
- Consumes: existing `.bd-btn`, `.bd-btn-primary`, `.bd-select`, `.bd-num`, `.bd-panel`, `.bd-meta`, `.bd-label` and Director layout containers.
- Produces: Mixed cards/editor using existing Director class vocabulary; only Mixed-specific structural classes remain where no equivalent exists.

- [ ] **Step 1: Add DOM assertions for shared class usage**

Require the Mixed mode selector, buttons, numeric inputs, and major panels to use existing `.bd-*` classes.

- [ ] **Step 2: Remove duplicate global FPS/Width/Height controls**

Mixed reads the existing Director output/widgets through stable field names. Do not parse visible labels such as `FPS`, `Width`, or `Height` to find widgets.

- [ ] **Step 3: Refactor Mixed CSS down to structural-only rules**

Retain only timeline/card/workspace geometry that has no existing equivalent. Colors, borders, buttons, selects, inputs, and panel appearance inherit from the Director styles.

- [ ] **Step 4: Verify mobile/modal sizing remains within the existing page shell**

No extra full-screen overlay or second shell is introduced.

### Task 3: Route every Mixed string through existing i18n

**Files:**
- Modify: `web/js/minimax_i18n.js`
- Modify: `web/js/minimax_mixed_ui.mjs`
- Modify: `web/js/zz_minimax_mixed_mode.js`
- Test: `web/js/tests/minimax_mixed_browser.test.mjs`

**Interfaces:**
- Consumes: `t`, `getLocale`, `onLocaleChange` from `minimax_i18n.js`.
- Produces: localized Mixed DOM; controller method `updateLocale()` or equivalent rerender hook.

- [ ] **Step 1: Add zh/en text assertions**

Mount in zh and assert representative labels contain only the approved Chinese UI text. Toggle to en and assert the same controls update without remounting the Director.

- [ ] **Step 2: Add `mixed.*` locale keys**

Cover mode labels, segment/result labels, Source Video fields, reference media, continuity, errors, delete/reorder confirmations, run selection, upload/library actions, and status messages.

- [ ] **Step 3: Replace hard-coded UI prose with `t("mixed.…")`**

Technical abbreviations remain literal only where they are mode names.

- [ ] **Step 4: Subscribe/unsubscribe to locale changes**

The Mixed controller rerenders or refreshes strings on `onLocaleChange`, and destroys the subscription on unmount.

### Task 4: Collapse Previous/Earlier result refs into one explicit Segment Result selector

**Files:**
- Modify: `web/js/minimax_mixed_state.mjs`
- Modify: `web/js/minimax_mixed_ui.mjs`
- Modify: `director/mixed_schema.py`
- Modify: `director/mixed_runtime.py`
- Test: `web/js/tests/minimax_mixed_state.test.mjs`
- Test: `tests/test_mixed_schema.py`
- Test: `tests/test_mixed_runtime.py`

**Interfaces:**
- New canonical result ref:

```json
{
  "role": "identity|i2v_start|fl2v_first|fl2v_last",
  "origin": "segment",
  "segmentId": "seg_xxx",
  "frame": "last|N"
}
```

- [ ] **Step 1: Write migration tests**

Legacy `origin: "previous"` is converted at normalization time to the concrete prior segment ID. Legacy `origin: "earlier"` becomes `origin: "segment"` with its existing ID.

- [ ] **Step 2: Write validation tests**

A result ref is valid only when `segmentId` resolves to an index lower than the consumer index. Deleted/moved-forward IDs produce explicit Missing/Invalid Reference errors.

- [ ] **Step 3: Update Python/JS canonical normalization**

Remove `previous` and `earlier` from new UI-origin options. Preserve migration compatibility only in parsers.

- [ ] **Step 4: Replace UI controls**

For Identity/Start/First/Last frame, one `Segment Result` action opens/uses a selector listing all earlier segments. Frame defaults to `Last Frame`; user may enter/select a specific frame.

- [ ] **Step 5: Keep MC separate**

Continuity remains immediate-previous Visual/Audio Context and is not converted to arbitrary segment selection.

### Task 5: Reuse the existing Material Library modal as a picker

**Files:**
- Modify: `web/js/minimax_material_library_modal.mjs`
- Modify: `web/js/minimax_mixed_ui.mjs`
- Test: `web/js/tests/minimax_mixed_browser.test.mjs`

**Interfaces:**
- Extend existing Material Library controller with a picker API such as:

```js
await editor._materialLibraryController.pick({
  type: "image" | "video" | "audio",
  multiple: false,
  maxCount: 1,
});
```

The picker returns existing Material Library item descriptors. Mixed materializes selected items through the existing API and maps them into its media descriptors.

- [ ] **Step 1: Add a failing test proving Mixed invokes the existing controller**

Stub `editor._materialLibraryController.pick` and assert clicking a Mixed Library action calls it instead of creating `.mmx-mixed-picker-layer`.

- [ ] **Step 2: Add picker mode to the existing modal/controller**

Reuse the same layer, tabs, category filtering, search, preview, and locale. Picker mode returns the chosen item(s) without running the normal allocation plan.

- [ ] **Step 3: Delete Mixed `openLibraryPicker()` and all duplicate picker CSS**

No second Material Library modal remains.

- [ ] **Step 4: Apply to every Mixed library-capable slot**

I2V/FL2V image, R2V picture/video/audio, and Source Video identity image all use the same picker. Mixed Source Video itself remains upload-only.

### Task 6: Audit workspace persistence, delete/reorder, and duplicate global state

**Files:**
- Modify: `web/js/zz_minimax_mixed_mode.js`
- Modify: `web/js/minimax_mixed_state.mjs`
- Modify: `web/js/minimax_mixed_ui.mjs`
- Test: `web/js/tests/minimax_mixed_lifecycle.test.mjs`
- Test: `web/js/tests/minimax_mixed_state.test.mjs`

**Interfaces:**
- Produces: independent `editor._mmxMixedWorkspace` and standalone workspace; stable-ID result refs; no duplicate FPS/size ownership.

- [ ] **Step 1: Test Mixed → standalone → Mixed persistence**

Prompt, media descriptors, segment IDs, result refs, and run selection must survive round-trip.

- [ ] **Step 2: Test delete semantics**

Deleting a referenced segment warns and leaves dependents explicitly invalid/missing after confirmation; no silent retarget.

- [ ] **Step 3: Test reorder semantics**

Stable-ID result refs remain bound to the same source; moving the source after its consumer becomes invalid.

- [ ] **Step 4: Remove duplicate global-state capture based on visible text**

Use widget names/fields directly and reuse existing Director output state.

### Task 7: Integrate main v1.0.3 cache fixes into Mixed dependency behavior

**Files:**
- Verify: `director/cache_path.py`
- Verify: `director/context_cache.py`
- Verify: `director/context_identity.py`
- Verify: `director/latent_context_cache.py`
- Verify: `director/segment_cache.py`
- Test: `tests/test_cache_path.py`
- Test: `tests/test_context_identity_seed.py`
- Test: `tests/test_mixed_selection.py`

**Interfaces:**
- Mixed lazy-result/cache lookup uses the same Windows-safe node cache root and the v1.0.3 producer identity rules.

- [ ] **Step 1: Assert branch contains `version = "1.0.3"`**
- [ ] **Step 2: Run Windows compound node-ID cache path tests**
- [ ] **Step 3: Run seed cache-reuse test**
- [ ] **Step 4: Run Mixed dependency/selective-run cache tests**

### Task 8: Full compatibility and browser verification

**Files:**
- Modify if required: `.github/workflows/mixed_mode_ci.yml`
- Modify if required: `.github/workflows/mixed_mode_browser_ci.yml`
- Test: all Mixed and standalone parser/socket tests.

- [ ] **Step 1: Run Python tests**

```bash
python -m pytest tests/test_mixed_schema.py tests/test_mixed_runtime.py tests/test_mixed_selection.py tests/test_cache_path.py tests/test_context_identity_seed.py -q
```

- [ ] **Step 2: Run Node pure-state tests**

```bash
node web/js/tests/minimax_mixed_state.test.mjs
```

- [ ] **Step 3: Run jsdom lifecycle/browser tests**

Require: selector remains visible in Mixed; mode switching works both directions; locale toggles update Mixed; existing Material Library modal is reused; Mixed workspace persists.

- [ ] **Step 4: Re-run standalone Director Inputs/parser compatibility assertions**

T2V/I2V/FL2V/R2V/V2V/RV2V socket names and task routing must match the baseline.

- [ ] **Step 5: Compare branch against main**

Confirm `main` is an ancestor of `feature/mixed-mode`, Mixed changes remain isolated to the feature branch, and no release/publish action is triggered.
