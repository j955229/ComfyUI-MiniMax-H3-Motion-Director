# Mixed Mode Implementation Plan

## Goal

Implement the approved Mixed Mode design on `feature/mixed-mode` without changing the semantics of the six existing standalone modes.

## Constraints

- `Mixed` is a meta-mode, not an H3 backend task key.
- Backend `SegmentPlan.task_key` must remain one of `t2v/i2v/fl2v/r2v/v2v/rv2v`.
- Existing Director Inputs remains unsupported by Mixed v1.
- Mixed v1 never enables Source Bridge.
- Material Library videos remain Reference Video only and can never become Source Video.
- Previous/Earlier result stills are runtime result dependencies, not planner-time image tensors.
- Existing Results, preview, post-processing and export paths must be reused.

## Phase 1 — Pure Mixed schema and dependency model

Create `director/mixed_schema.py` with no ComfyUI imports.

Responsibilities:

- supported user modes and normalization;
- stable segment ID validation;
- Source Video backend mode derivation (`v2v` vs `rv2v`);
- normalize persisted result-reference descriptors;
- distinguish dynamic `previous` from stable-ID `earlier` references;
- reject missing/forward Earlier references;
- collect explicit result dependencies;
- collect immediate-previous continuity dependencies;
- expand selective-run dependency closure in timeline order;
- generate stable dependency identity data for cache fingerprinting.

Tests first in `tests/test_mixed_schema.py`.

## Phase 2 — Mixed planner

Create `director/mixed_plan.py` and route only `timelineMode == mixed` to it.

Responsibilities:

- validate versioned `mixedTimeline`/Mixed timeline state;
- keep stable IDs on `SegmentPlan`;
- compile T2V/I2V/FL2V/R2V/Source Video to existing backend task keys;
- load only media that exists before execution (uploads/library media/source clips);
- persist unresolved previous/earlier result-still descriptors on SegmentPlan;
- make Source Video segment-local and derive duration from Source Range;
- force Source Bridge off for Mixed plan only;
- set explicit previous-only visual/audio ContextLink state;
- preserve run selection while recording dependency closure information.

Add planner tests for all five user modes and invalid states.

## Phase 3 — Runtime result references + selective dependencies

Add runtime resolver shared by I2V/FL2V/R2V/Source Video identity inputs.

Resolution order for a result-still descriptor:

1. current-run `completed_outputs`;
2. valid persistent segment cache;
3. dependency must execute before consumer.

Responsibilities:

- materialize Last Frame / selected frame as `SegmentRef` or explicit source/keyframe input;
- automatically execute missing/stale prerequisite segments for Selective Run;
- never use a whole prior result video as Source Video or R2V Reference Video;
- report auto-executed dependency reasons;
- include upstream result dependency identities/fingerprints in segment cache fingerprint;
- keep existing immediate-previous MC behavior separate from identity stills.

Add tests for cache hit/missing/stale dependency paths and Previous vs Earlier behavior.

## Phase 4 — Top-level Mixed mode and pure JS state

Add `mixed` only to user-facing task selection/meta routing.

- `lib/task_prompts.py`: add Mixed combo item.
- Do NOT add Mixed to `MiniMaxH3Task` or `SUPPORTED_TASK_KEYS`.
- `web/js/minimax_gen_timeline.js`: `getDirectorMode("mixed") -> "mixed"`.

Create `web/js/minimax_mixed_state.mjs` with pure state helpers:

- create/normalize Mixed timeline;
- create stable segment IDs;
- add/delete/duplicate/reorder;
- detect dependents and invalid Earlier references;
- mode-specific legal input origins;
- backend mode preview;
- dependency summary;
- serialize only stable state.

Add Node tests for this pure module.

## Phase 5 — Mixed UI module

Create `web/js/minimax_mixed_ui.mjs` and make only minimal integration edits to `minimax_timeline.js`.

UI regions:

1. Mixed Timeline
2. Current Segment Editor
3. Continuity

Required editors:

- T2V: prompt + duration
- I2V: prompt + Start Frame origin
- FL2V: prompt + First/Last origins
- R2V: Picture/Reference Video/Reference Audio, with prior-result still Picture sources
- Source Video: segment-local source upload + Source Range + identity Picture sources

Source origin menus must be semantic-slot-specific.

Selective run, reorder, duplicate and delete operations must use the pure Mixed state/dependency helpers.

## Phase 6 — Integration and compatibility verification

Verify:

- all existing non-Mixed task routes unchanged;
- Mixed executor segments always use existing backend task keys;
- standalone V2V/RV2V Source Bridge still works;
- Mixed Source Bridge remains disabled;
- old Director Inputs unchanged;
- Issue #2 memory fixes remain present;
- Results/Multi/Final, preview, Global Refine and Face Refine use existing paths;
- Python tests and JS pure-module tests pass;
- inspect `main...feature/mixed-mode` diff for unrelated changes.

Do not merge into `main` until the feature branch is fully verified and explicitly approved.