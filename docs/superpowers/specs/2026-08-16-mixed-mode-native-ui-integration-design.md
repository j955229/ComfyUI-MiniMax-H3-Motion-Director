# MiniMax H3 Motion Director — Mixed Mode Native UI Integration Design

## Status

Approved direction: integrate Mixed natively into the existing Director mode state machine. This document supersedes the previous monkey-patch UI integration approach. Backend Mixed semantics from the main Mixed Mode design remain in force unless explicitly revised here.

Development branch: `feature/mixed-mode` only.

Standalone baseline: current `main` v1.0.3 (`835f8d54f977ea119deef91ae442fc83d64aece0`).

## Root cause being corrected

The previous Mixed integration added a second state machine by monkey-patching mode routing, layout switching and persistence from `zz_minimax_mixed_mode.js` / `zzz_minimax_mixed_persistence.js`.

That architecture caused cross-mode state leakage:

- legacy FL2V or prompt-batch panels could remain visible under Mixed;
- two prompt editors could appear at once;
- returning from Mixed could restore the wrong standalone workspace;
- standalone T2V could incorrectly inherit reference-media UI;
- Mixed visibility could depend on which mode the user entered it from.

These are architectural state-ownership defects, not isolated CSS defects.

## Chosen architecture

Mixed becomes a first-class Director mode handled by the same native routing path as the existing modes.

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
└─ native applyTaskLayout()
    ├─ existing video layout
    ├─ existing prompt-batch layout
    ├─ existing FL2V layout
    └─ Mixed layout
```

There is exactly one authoritative mode-transition path.

Mixed must not patch or wrap `getDirectorMode()`, `getTaskKey()`, `onGlobalField()` or `applyTaskLayout()` after editor construction. Those native functions must explicitly understand Mixed.

## Standalone compatibility boundary

Outside Mixed, the six existing modes must render and behave exactly as `main` v1.0.3.

The rewrite may add explicit `mixed` branches to shared routing, but must not broaden any standalone mode's legal inputs.

Required invariants:

- standalone T2V: prompt/duration only; no reference picture/video/audio slots;
- standalone I2V: existing start-image behavior only;
- standalone FL2V: existing FL2V workspace, first/last-frame UI and exactly its existing prompt editor;
- standalone R2V: existing reference picture/video/audio behavior;
- standalone V2V/RV2V: existing source-video timeline, source-audio behavior and Source Bridge behavior.

No Mixed transition may leave mode-specific DOM or state from another mode visible.

## Native mode routing

`minimax_gen_timeline.js` must return a dedicated `mixed` Director mode.

```text
T2V / I2V / R2V -> prompt_batch
FL2V             -> fl2v
V2V / RV2V       -> video
Mixed             -> mixed
```

`Mixed` must not be added to `PROMPT_BATCH_TASKS`; otherwise legacy batch helpers will reinterpret Mixed schema as T2V/I2V/R2V batch state.

## State ownership

This is a hard requirement, not a recommendation:

```text
editor.timeline       -> standalone workspace state only
editor.mixedTimeline  -> Mixed schema state only
```

While Mixed is active:

- Mixed UI reads/writes `editor.mixedTimeline` only;
- legacy batch/FL2V/video timeline normalizers never receive Mixed schema;
- `buildTimelinePayload()` returns the canonical Mixed payload;
- persistence serializes the Mixed payload;
- `editor.timeline` remains a valid standalone workspace and is not rewritten into Mixed shape.

While a standalone mode is active:

- existing code continues to read/write `editor.timeline` exactly as before;
- `editor.mixedTimeline` remains stored separately and untouched by standalone normalizers.

This separation replaces the previous DOM-snapshot and timeline-shape recovery hacks.

## Native transition rules

### Standalone -> Mixed

1. Let the current standalone mode execute its existing stash logic where applicable.
2. Preserve `editor.timeline` as standalone state.
3. Switch the native Director mode to `mixed`.
4. Show the Mixed body and only shared Director chrome whose semantics are valid for Mixed.
5. Restore `editor.mixedTimeline`, or create a default Mixed timeline if none exists.

### Mixed -> Standalone

1. Commit pending Mixed drafts to `editor.mixedTimeline`.
2. Hide/unmount Mixed mode-specific body.
3. Set the requested standalone task normally.
4. Let native `applyTaskLayout()` restore its existing standalone workspace.
5. Never copy Mixed segment fields into `editor.timeline`.

### Standalone -> Standalone

Must remain the existing main behavior with no Mixed detour.

## DOM/layout ownership

Mixed receives one dedicated body container under the existing Director `mainBody`.

```text
.bd-main
├─ existing video-mode DOM
├─ existing prompt-batch DOM
├─ existing FL2V DOM
├─ existing shared controls
└─ .bd-mixed-panel
```

Only native `applyTaskLayout()` decides which mode-specific body is visible.

When Mixed is active, all legacy mode-specific bodies are hidden:

- source-video stage/controls/viewport when they are video-mode-only;
- prompt-batch group list/editor;
- FL2V panel/detail editor;
- R2V common/reference UI owned by prompt-batch mode;
- every legacy prompt textarea not belonging to the Mixed selected-segment editor.

The top-level mode selector stays visible.

Shared output resolution/export controls remain the existing Director controls and appear once. V2V/RV2V-only source-audio passthrough controls remain hidden in Mixed v1.

## Mixed visual structure

Mixed must use the existing Director `bd-*` visual system for controls, spacing, borders, typography and panels. It must not introduce an independent design language.

Mixed Generation contains:

1. Segment strip
   - Add Segment
   - Selective Run toggle
   - segment cards
   - reorder / duplicate / delete

2. Selected Segment editor
   - mode
   - exactly one prompt textarea
   - duration where the mode permits direct duration editing
   - only the legal inputs for that mode

3. Continuity panel
   - Visual continuity
   - Audio continuity
   - no previous-segment controls for Segment 1

There is no global Mixed prompt editor.

Changing selected segment rebinds the same selected-segment editor instead of mounting another prompt panel.

## Strict per-segment input matrix

| Mixed mode | Prompt | Duration | Keyframe images | Reference pictures | Reference video/audio | Source Video |
|---|---:|---:|---|---|---|---|
| T2V | yes | yes | none | none | none | none |
| I2V | yes | yes | Start Frame | none | none | none |
| FL2V | yes | yes | First / Last Frame | none | none | none |
| R2V | yes | yes | none | up to H3 limits | existing R2V video/audio refs | none |
| Source Video | yes | derived from Source Range | none | optional identity pictures | allowed RV2V audio refs only | required |

Hard invariant:

> A Mixed T2V segment can never create or display image, video or audio material slots.

This is enforced by render/state branching. Generic media controls must not be created and then merely hidden with CSS.

## Segment Result references

The user-facing `Previous` / `Earlier` split remains removed.

All result-derived image/keyframe references use one control:

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

Mixed reuses the existing Material Library modal/controller. It must never render a second picker window.

Legal filters:

- I2V/FL2V keyframe: image only;
- R2V picture: image only;
- R2V Reference Video: reference video;
- R2V Reference Audio: audio;
- Source Video identity: image only.

Material Library video remains Reference Video only and can never become Mixed Source Video.

Mixed Source Video uses its dedicated source-video upload/range flow.

## i18n

Mixed uses the existing locale lifecycle and updates in place.

Only model/task acronyms remain language-neutral:

- T2V
- I2V
- FL2V
- R2V

Ordinary English phrases are localized. In Chinese locale, the user-facing Mixed segment mode label is `源视频`, not `Source Video`; in English locale it is `Source Video`.

Likewise `Segment Result`, field labels, help text, buttons, validation messages and status text are fully localized. Chinese mode must not contain accidental English helper phrases, and English mode must not contain accidental Chinese UI phrases.

Backend keys remain language-independent (`mixed`, `source_video`, `segment`, etc.).

## Removal of old monkey-patch ownership

After native routing is implemented and regression-tested, remove the previous mode-state takeover.

`zz_minimax_mixed_mode.js` must no longer patch:

- `getDirectorMode()`
- `getTaskKey()`
- `applyTaskLayout()`
- `onGlobalField()`
- persistence lifecycle methods.

`zzz_minimax_mixed_persistence.js` must no longer be needed to recover Mixed JSON after legacy normalizers mutate it.

If those files have no non-patch responsibilities remaining, they are deleted rather than left as dormant competing integration code.

## Backend boundary

The UI rewrite does not redefine the existing Mixed backend architecture.

Canonical Mixed schema continues to feed:

- `director/mixed_schema.py`
- `director/mixed_plan.py`
- `director/mixed_runtime.py`
- `director/mixed_selection.py`

Backend compilation remains:

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

Saving while Mixed is active persists:

- top-level task = Mixed;
- canonical Mixed timeline schema;
- stable segment IDs;
- selected-segment UI state where needed;
- no legacy FL2V/prompt-batch workspace embedded as Mixed content.

Reloading a Mixed workflow enters native Mixed mode directly. Legacy timeline normalizers must not run on Mixed schema first.

Switching Mixed -> standalone -> Mixed restores the unchanged Mixed workspace. Switching standalone -> Mixed -> standalone restores the unchanged standalone workspace.

## Required regression tests

### Transition matrix

At minimum:

- T2V -> Mixed -> T2V
- I2V -> Mixed -> I2V
- FL2V -> Mixed -> FL2V
- R2V -> Mixed -> R2V
- V2V -> Mixed -> V2V
- RV2V -> Mixed -> RV2V

### Standalone invariants

After each return from Mixed:

- T2V has no reference picture/video/audio slots;
- FL2V has exactly one FL2V prompt editor plus normal first/last-frame UI;
- R2V has its normal reference UI;
- V2V/RV2V source-video controls remain unchanged;
- `.bd-mixed-panel` is not visible.

### Mixed invariants

- Mixed T2V: exactly one prompt editor, no material slots;
- Mixed I2V: exactly Start Frame input;
- Mixed FL2V: exactly First/Last Frame inputs;
- Mixed R2V: R2V references only;
- Mixed Source Video: source-video/range + identity/allowed audio controls only;
- selecting another segment reuses the same editor;
- shared output resolution controls appear once;
- locale switching updates all Mixed text in place;
- Material Library action opens the existing modal only.

### Persistence invariants

- Mixed save/reload preserves canonical schema;
- Mixed -> standalone -> Mixed preserves Mixed state;
- standalone -> Mixed -> standalone preserves standalone state;
- loading Mixed never routes its schema through legacy timeline normalizers.

## Acceptance criteria

1. The user-reported regressions are covered and prevented: no duplicate prompt box, no FL2V leakage, no T2V reference-material slots.
2. Mixed is a native `getDirectorMode()` / `applyTaskLayout()` mode.
3. No monkey-patch layer owns Director mode switching after the rewrite.
4. Existing six standalone modes retain main v1.0.3 behavior.
5. Mixed has exactly one selected-segment prompt editor.
6. Mixed inputs strictly follow the legal matrix.
7. Existing shared output controls appear once.
8. Existing Material Library modal is reused.
9. Mixed and standalone states remain independent through repeated switching.
10. Existing Mixed backend schema/planner remains compatible.
11. Both Mixed CI workflows pass on the final feature-branch HEAD.
12. No merge to `main` occurs until real ComfyUI/H3 testing is accepted.

## Non-goals

- redesigning the six existing standalone UIs;
- adding media capabilities to T2V/I2V/FL2V;
- making Mixed a separate node or separate Director page;
- changing Source Bridge semantics;
- changing backend task meanings;
- merging to main during this rewrite.
