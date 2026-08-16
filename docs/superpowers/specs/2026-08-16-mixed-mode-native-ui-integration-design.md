# MiniMax H3 Motion Director — Mixed Mode Native UI Integration Design

## Status

Approved direction: integrate Mixed natively into the existing Director mode state machine. This document supersedes the previous monkey-patch UI integration approach. Backend Mixed semantics from the main Mixed Mode design remain in force unless explicitly revised here.

Development branch: `feature/mixed-mode` only.

Baseline for all standalone-mode behavior: current `main` v1.0.3 (`835f8d54f977ea119deef91ae442fc83d64aece0`).

## Problem being corrected

The previous Mixed UI integration layered a second state machine on top of the existing Director by monkey-patching mode routing, layout switching and persistence from `zz_minimax_mixed_mode.js` / `zzz_minimax_mixed_persistence.js`.

That architecture caused cross-mode state leakage:

- entering Mixed could leave legacy FL2V or batch panels mounted below the Mixed editor;
- two prompt editors could appear at the same time;
- returning from Mixed could leave the wrong legacy workspace active;
- T2V could incorrectly show reference-media slots that are illegal for T2V;
- visible controls depended on which standalone mode the user entered Mixed from.

These are not independent CSS defects. The root cause is two competing mode state machines mutating the same editor state and DOM.

## Chosen architecture

Mixed becomes a first-class Director mode handled by the same native mode-routing path as all existing modes.

Conceptually:

```text
Generation
│
├─ Mode selector
│   ├─ T2V
│   ├─ I2V
│   ├─ FL2V
│   ├─ R2V
│   ├─ V2V
│   ├─ RV2V
│   └─ Mixed
│
└─ applyTaskLayout()
    ├─ existing video layout
    ├─ existing prompt-batch layout
    ├─ existing FL2V layout
    └─ native Mixed layout
```

There must be exactly one authoritative mode transition path.

Mixed must not replace or wrap `getDirectorMode()`, `onGlobalField()` or `applyTaskLayout()` after editor construction. It must be recognized directly by those native functions.

## Non-negotiable compatibility rule

Outside Mixed, the six existing standalone modes must render and behave exactly as `main` v1.0.3.

Mixed code may add an explicit `mixed` branch to shared routing, but it must not broaden the input rules of any existing mode.

Examples that must remain true:

- standalone T2V: prompt/duration only; no reference-image slots;
- standalone I2V: existing first-image behavior only;
- standalone FL2V: existing FL2V workspace and exactly its existing prompt editor;
- standalone R2V: existing reference picture/video/audio behavior;
- standalone V2V/RV2V: existing source-video timeline and Source Bridge behavior.

No Mixed transition may leave mode-specific DOM or state from another mode visible.

## Native mode routing

`minimax_gen_timeline.js` must recognize `mixed` as its own Director mode rather than falling through to `video` or `prompt_batch`.

Expected routing:

```text
T2V / I2V / R2V -> prompt_batch
FL2V             -> fl2v
V2V / RV2V       -> video
Mixed             -> mixed
```

`Mixed` must not be added to `PROMPT_BATCH_TASKS`, because doing so would make legacy prompt-batch helpers treat the entire Mixed timeline as T2V/I2V/R2V batch data.

## State ownership

Mixed state must be separate from standalone workspace state.

Recommended editor state:

```text
editor.timeline       -> existing standalone workspace state
editor.mixedTimeline  -> Mixed schema state
```

When `Mixed` is active:

- Mixed UI reads/writes `editor.mixedTimeline`;
- legacy timeline normalizers do not run against Mixed schema;
- `buildTimelinePayload()` returns the Mixed payload;
- `timeline_data` persistence serializes the Mixed payload;
- the legacy `editor.timeline` remains a valid standalone workspace that can be restored without reconstructing it from Mixed data.

When a standalone mode is active:

- all existing code continues to read/write `editor.timeline` exactly as before;
- Mixed state is retained separately and is not passed through legacy batch/FL2V/video normalizers.

This separation eliminates the need for DOM snapshots and timeline-shape coercion during mode switching.

## Mode transition rules

### Standalone -> Mixed

1. Let the current standalone mode finish its existing stash operation if applicable.
2. Preserve the standalone workspace unchanged.
3. Set native Director mode to `mixed`.
4. Show only the Mixed body plus truly shared Director chrome.
5. Restore `editor.mixedTimeline` if present; otherwise create a default Mixed timeline.

### Mixed -> Standalone

1. Commit pending Mixed editor drafts into `editor.mixedTimeline`.
2. Hide/unmount the Mixed body.
3. Set the selected standalone task normally.
4. Let the existing native `applyTaskLayout()` restore its own workspace.
5. Do not copy Mixed segment fields into the standalone timeline.

### Standalone -> Standalone

Must remain exactly the existing main behavior.

## DOM/layout ownership

Mixed must have one dedicated body container under the existing Director `mainBody`, for example:

```text
.bd-main
├─ existing video-mode DOM
├─ existing prompt-batch DOM
├─ existing FL2V DOM
├─ existing shared output controls
└─ .bd-mixed-panel
```

`applyTaskLayout()` is solely responsible for which mode-specific body is visible.

When Mixed is active, all legacy mode-specific bodies must be hidden:

- source-video stage/controls/viewport where they are video-mode-only;
- prompt-batch group editor/list;
- FL2V panel/detail editor;
- R2V common/reference panel elements owned by prompt-batch mode;
- any legacy prompt textarea not explicitly part of the Mixed selected-segment editor.

The top-level mode selector remains visible.

Shared output controls that are truly mode-independent may remain visible, but only if their semantics are valid for Mixed. V2V/RV2V-only controls such as source-audio passthrough must remain hidden in Mixed v1.

## Mixed visual structure

Mixed must use the existing Director visual language (`bd-*` controls, spacing, borders, typography, buttons and panels). It must not introduce a second design system.

The Mixed Generation body has three regions:

1. Segment strip
   - Add Segment
   - Selective Run toggle
   - segment cards
   - reorder / duplicate / delete

2. Selected Segment editor
   - segment mode
   - exactly one prompt editor
   - duration where the mode permits direct duration editing
   - only that mode's legal inputs

3. Continuity panel
   - Visual continuity
   - Audio continuity
   - first segment shows no previous-segment controls

Output resolution/export controls remain the existing Director controls rather than being duplicated inside Mixed.

## Exactly one prompt editor

A selected Mixed segment has exactly one `prompt` field and exactly one visible prompt textarea.

There is no additional global Mixed prompt box.

Legacy prompt-batch / FL2V prompt editors must be hidden while Mixed is active.

Changing selected Mixed segment updates the same selected-segment prompt editor.

## Per-segment legal input matrix

The UI must be strict. Switching a Mixed segment's mode must show only legal inputs for that mode.

| Mixed mode | Prompt | Duration | Keyframe images | Reference pictures | Reference video/audio | Source Video |
|---|---:|---:|---|---|---|---|
| T2V | yes | yes | none | none | none | none |
| I2V | yes | yes | Start Frame | none | none | none |
| FL2V | yes | yes | First / Last Frame | none | none | none |
| R2V | yes | yes | none | up to H3 limits | existing R2V video/audio refs | none |
| Source Video | yes | derived from Source Range | none | optional identity pictures | allowed RV2V audio refs only | required |

Important acceptance invariant:

> A Mixed T2V segment can never display image/video/audio material slots.

This must be enforced by state/render logic, not merely hidden by CSS after generic material controls are created.

## Segment Result references

The user-facing `Previous` and `Earlier` split remains removed.

All result-based image/keyframe references use one control:

```text
Source: Segment Result
Segment: [Segment 01 / Segment 02 / ...]
Frame: [Last Frame / explicit frame]
```

Canonical state:

```json
{
  "origin": "segment",
  "segmentId": "seg_<stable-id>",
  "frame": "last"
}
```

Only backward references are legal.

Motion/Audio continuity remains a separate immediate-previous relationship and is not merged into this selector.

## Material Library

Mixed must reuse the existing Material Library modal/controller.

No second picker window may be rendered.

The slot requesting an asset supplies a filter/acceptance policy to the existing library:

- I2V/FL2V keyframe -> image only;
- R2V picture -> image only;
- R2V reference video -> reference video;
- R2V reference audio -> audio;
- Source Video identity -> image only.

Material Library videos remain Reference Video only and must never become Mixed Source Video.

Source Video uses its own upload/select-current-source flow.

## i18n

Mixed labels must use the existing locale lifecycle and change in place when the Director language changes.

Technical tokens may remain language-neutral:

- T2V
- I2V
- FL2V
- R2V
- Source Video where used as the formal mode name if the project intentionally keeps mode labels English

All ordinary descriptions, button text, validation messages and field labels must be fully localized. No Chinese UI sentence may contain accidental untranslated helper text.

## Removal of the old monkey-patch integration

After the native path is implemented and covered by tests, the previous state-machine takeover must be removed.

Specifically, `zz_minimax_mixed_mode.js` must no longer patch or replace:

- `getDirectorMode()`
- `getTaskKey()`
- `applyTaskLayout()`
- `onGlobalField()`
- persistence lifecycle methods

`zzz_minimax_mixed_persistence.js` must no longer be required to recover Mixed JSON from legacy editor mutations.

If those files have no remaining legitimate responsibilities after the native rewrite, delete them rather than keep dormant competing logic.

## Backend impact

The existing Mixed schema/planner/runtime work remains conceptually valid and should not be rewritten merely because the UI integration changes.

The native UI must continue serializing the same canonical Mixed schema consumed by:

- `director/mixed_schema.py`
- `director/mixed_plan.py`
- `director/mixed_runtime.py`
- `director/mixed_selection.py`

Backend task compilation remains:

```text
Mixed T2V          -> t2v
Mixed I2V          -> i2v
Mixed FL2V         -> fl2v
Mixed R2V          -> r2v
Mixed Source Video without identity -> v2v
Mixed Source Video with identity    -> rv2v
```

Mixed Source Bridge remains disabled in v1.

## Persistence

Saving a workflow while Mixed is selected must persist:

- top-level task = Mixed;
- canonical Mixed timeline schema;
- stable segment IDs;
- selected segment/mode data where needed for UI restoration;
- no embedded legacy prompt-batch or FL2V workspace masquerading as Mixed content.

Reloading the workflow must enter native Mixed mode directly without first normalizing the Mixed JSON as T2V, FL2V or source-video timeline data.

Switching away from Mixed and back in the same editor session must restore the unchanged Mixed workspace.

## Required regression tests

### Mode isolation

Add browser/jsdom tests for these transitions:

- T2V -> Mixed -> T2V
- I2V -> Mixed -> I2V
- FL2V -> Mixed -> FL2V
- R2V -> Mixed -> R2V
- V2V -> Mixed -> V2V
- RV2V -> Mixed -> RV2V

After returning, visible standalone controls must satisfy the same invariants as `main`.

### Explicit standalone invariants

At minimum:

- T2V has no reference picture/video/audio slots;
- FL2V shows exactly one FL2V prompt editor and its normal first/last-frame UI;
- R2V shows its normal reference UI;
- V2V/RV2V source-video controls remain unchanged;
- no `.bd-mixed-panel` content is visible outside Mixed.

### Mixed invariants

- Mixed T2V shows exactly one prompt editor and no material slots;
- Mixed I2V shows exactly Start Frame media input;
- Mixed FL2V shows exactly First/Last Frame media inputs;
- Mixed R2V shows R2V references only;
- Mixed Source Video shows Source Video + identity controls only;
- switching selected segment changes the one editor rather than mounting another prompt panel;
- shared output resolution controls appear once;
- language switching updates Mixed in place;
- Material Library opens the existing modal only.

### Persistence

- Mixed save/reload preserves canonical schema;
- Mixed -> standalone -> Mixed restores Mixed state;
- standalone -> Mixed -> standalone preserves standalone workspace state;
- loading a Mixed workflow never invokes legacy timeline normalizers on the Mixed schema.

## Acceptance criteria

1. The three UI regressions demonstrated by the user are impossible under automated tests: no duplicate prompt box, no FL2V panel leakage, no T2V material slots.
2. Mixed is handled by native `getDirectorMode()` / `applyTaskLayout()` routing.
3. No monkey-patch layer owns Director mode switching after the rewrite.
4. Existing six standalone modes retain main v1.0.3 behavior.
5. Mixed has exactly one selected-segment prompt editor.
6. Mixed per-segment inputs strictly follow the legal input matrix.
7. Shared output controls are not duplicated.
8. Existing Material Library UI is reused.
9. Mixed and standalone workspace state remain independent across repeated mode switching.
10. Existing Mixed backend schema/planner behavior remains compatible.
11. Both Mixed CI workflows pass on the final feature-branch HEAD.
12. No merge to `main` occurs until real ComfyUI/H3 testing is accepted.

## Non-goals

- redesigning the six existing standalone UIs;
- adding new media capabilities to T2V/I2V/FL2V;
- making Mixed a separate node or separate Director page;
- changing Source Bridge semantics;
- changing the existing backend task meanings;
- merging to main during this rewrite.
