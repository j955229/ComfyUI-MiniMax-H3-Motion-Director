# MiniMax H3 Motion Director — Mixed Mode Design

## Status

Approved product decisions for implementation on an isolated feature branch. Existing T2V/I2V/FL2V/R2V/V2V/RV2V behavior must remain unchanged.

## Goal

Add a new top-level `Mixed` generation mode that allows a single Director timeline to contain heterogeneous generative segments while keeping generation method, identity source, source video, reference media, and continuity as separate concepts.

## User-facing Mixed modes

Mixed exposes five segment modes:

- `T2V`
- `I2V`
- `FL2V`
- `R2V`
- `Source Video`

`V2V` and `RV2V` remain backend semantics and remain available as the existing standalone modes, but Mixed does not expose them as two separate buttons.

For a Mixed `Source Video` segment:

- no identity pictures => backend V2V semantics;
- one or more identity pictures => backend RV2V semantics.

## Non-negotiable semantic boundaries

### Source Video

A Source Video is the complete motion/time/content skeleton for the current segment. It is not a reference-video-library asset and is not previous-segment continuity.

### Reference Video

A Reference Video is R2V reference media. It can influence motion, camera, rhythm, or semantics, but it is not the source timeline skeleton.

### Identity Source

Identity Source supplies `Picture` references that define who the subject is / what the subject looks like. It is independent from Motion Context.

### Continuity

Continuity supplies cross-segment visual/audio handoff state. It must not be used as a substitute for explicit identity references.

In short:

- `Source Video` = how this segment moves over time;
- `Identity Source` = who/what appears;
- `Reference Video` = what motion/camera/content may be referenced;
- `Motion Context` = how this segment connects to the previous generated segment.

## Top-level compatibility

The existing standalone modes are frozen:

- T2V
- I2V
- FL2V
- R2V
- V2V
- RV2V

Existing workflows, Director Inputs, Director Assets, material library semantics, source-timeline behavior, Source Bridge behavior, caches, results, and post-processing must continue to work unchanged outside Mixed.

Mixed uses a separate schema/planner path and compiles into the existing execution abstractions instead of changing the meaning of existing standalone schemas.

## Mixed segment model

Each Mixed segment has a stable persistent ID independent from display order.

Conceptual shape:

```json
{
  "id": "seg_<stable-id>",
  "mode": "t2v|i2v|fl2v|r2v|source_video",
  "prompt": "...",
  "duration": 10.0,
  "inputs": {},
  "continuity": {
    "visual": true,
    "audio": true
  }
}
```

Display numbering (`Segment 01`, `Segment 02`, …) is derived from current order and must never be the persistent reference identity.

## Input rules by Mixed mode

### T2V

Inputs:

- prompt
- duration

No media input is required.

### I2V

Inputs:

- prompt
- start frame (optional, preserving native H3 prompt-only behavior when absent)

Legal start-frame origins:

- Upload
- Material Library image
- Previous Segment Last Frame
- Earlier Segment selected still

An explicit I2V start frame resets visual Motion Context for that segment, matching current Director behavior. Audio continuity may remain enabled.

### FL2V

Inputs:

- prompt
- first frame (optional)
- last frame (optional)

Legal image origins:

- Upload
- Material Library image
- Previous Segment still
- Earlier Segment selected still

First/Last frames are keyframe conditioning, not Motion Context.

### R2V

Inputs:

- prompt
- Picture references, up to H3's existing picture limit
- Reference Video references, up to the existing R2V limit
- Reference Audio references, up to the existing R2V limit

Picture origins:

- Upload
- Material Library
- Previous Segment still
- Earlier Segment still

Reference Video remains reference media only. A previous segment's entire generated result is not automatically converted into Reference Video.

### Source Video

Inputs:

- source video (required)
- source range (required/derived from chosen clip)
- prompt
- optional identity pictures
- optional reference audio where existing RV2V semantics permit it

Source Video is segment-local in Mixed. It does not use Material Library Reference Video as a source.

The selected source range defines segment duration. Example: choosing 04.0s–11.5s creates a 7.5s segment. Mixed v1 does not time-stretch/compress a source clip to a separately entered duration.

Identity pictures may be assembled from multiple origins simultaneously:

- Manual upload
- Material Library pictures
- Previous Segment stills
- Earlier Segment stills

All identity pictures are compiled to H3 `Picture` references and remain subject to the existing maximum picture count.

No identity pictures => backend V2V semantics.

At least one identity picture => backend RV2V semantics.

## Previous/Earlier Segment stills

Previous Segment Stills default to the previous segment's Last Frame.

The UI may allow the user to add additional selected frames manually. Mixed v1 does not add face detection or automatic “best identity frame” selection.

Earlier Segment references bind to the source segment's stable ID plus an explicit selected frame identity/index.

## Continuity rules

Mixed v1 continuity always refers to the immediate previous segment in current timeline order.

Per segment:

- Visual continuity ON/OFF
- Audio continuity ON/OFF

Mixed v1 does not allow Motion Context to point to arbitrary earlier segments. Earlier-person identity reuse is handled by Earlier Segment Stills instead.

Existing global masters such as Motion Context, Audio Context, Color Re-anchor, Pin Renorm and related backend policy remain authoritative where applicable.

### Explicit I2V frame

When I2V has an explicit start frame:

- visual MC is suppressed/reset;
- audio MC may remain active.

This preserves current Director conflict resolution.

### Source Video + identity + MC

These may coexist because they carry different semantics:

```text
Source Video    -> motion/time skeleton
Identity Source -> subject appearance
Visual/Audio MC -> previous-segment handoff
```

## Source Bridge

Mixed v1 does not support Source Bridge.

The existing standalone V2V/RV2V Source Bridge remains unchanged.

Reason: current Source Bridge assumes adjacent source-driven segments in the existing source timeline and a fixed H3-native 5-frame bridge policy. Mixed uses segment-local source videos, so applying the old bridge semantics without a new model would be incorrect.

Mixed v1 uses Motion Context for cross-segment visual continuity instead.

## Director Inputs / Assets

Existing Director Inputs remains unchanged and unsupported by Mixed v1.

The current protocol is single-mode and must not be broadened implicitly to heterogeneous Mixed segments.

Mixed-compatible external inputs, if added later, require a separate explicit protocol/schema.

Material Library retains current semantics:

- images may be used where picture/keyframe inputs are legal;
- videos in the library are Reference Videos, never Source Videos.

## Timeline UI

Top-level Generation adds `Mixed` after the six existing standalone modes.

Mixed page has three stable vertical regions:

1. Mixed Timeline
   - segment sequence
   - mode
   - duration
   - status/progress
   - add/delete/duplicate/reorder
   - selective run

2. Current Segment Editor
   - mode
   - prompt
   - duration where mode permits direct duration editing
   - mode-specific input cards

3. Continuity
   - Visual ON/OFF
   - Audio ON/OFF

Only mode-specific inputs change when segment mode changes.

The `Source Video` editor additionally shows a source preview and `Source Range`. This is an input trim/range control and must not be confused with generation progress.

## Source selector UI rule

Use a consistent `From [▼]` interaction style, but legal options are semantic-slot-specific.

Do not create one global origin list that makes every media source legal everywhere.

Examples:

- I2V Start Frame may allow Upload / Material Library / Previous / Earlier.
- R2V Reference Video may allow Upload / Material Library.
- Source Video must never offer Material Library Reference Video as a source.

## Segment reorder semantics

Two reference classes intentionally behave differently:

### Previous Segment

A dynamic positional relationship. After reorder it points to the newly adjacent previous segment.

### Earlier Segment

A stable-ID relationship. Reordering does not change which source segment is referenced.

If an Earlier Segment source is moved after its consumer, the reference becomes invalid and must be surfaced as `Invalid Reference`; it must not silently retarget.

Forward references are forbidden.

## Delete semantics

Before deleting a referenced segment, show which dependent segments will be affected.

After confirmed deletion, dependents become explicitly invalid/missing. Never silently substitute another segment.

## Duplicate semantics

Duplicating a segment creates a new stable segment ID.

The duplicate copies its own settings and valid source bindings, but no other segment that referenced the original is silently retargeted to the duplicate.

## Dependency model

Mixed execution is a DAG constrained to backward-only references.

Dependencies include, where applicable:

- selected stills from earlier segment results;
- previous-segment continuity;
- other explicit persisted result dependencies introduced by Mixed.

Cycles and forward references are invalid by construction.

## Selective Run

Selective Run must resolve required dependencies automatically.

Example: user selects Segment 05, but it needs identity stills from Segment 03 and continuity from Segment 04.

- valid cached 03/04 results => reuse cache and run 05;
- missing dependency => execute dependency first;
- stale dependency => regenerate dependency first;
- UI/report explains why an unselected dependency was executed.

## Cache invalidation

Mixed segment cache identity must include its own generation settings plus identities/fingerprints of all result dependencies that affect generation.

At minimum this includes, as applicable:

- mode
- prompt
- duration / source range
- mode-specific media
- sampling/settings already included in current cache policy
- identity-source segment/result fingerprint
- continuity-source result/context fingerprint

Changing an upstream dependency marks dependent cache stale rather than reusing output generated from an older dependency result.

## Planner architecture

Do not rewrite the current executor around Mixed.

Add a Mixed-specific schema/parser/planner that validates Mixed state and compiles each segment into the existing execution abstractions (`SegmentPlan` and related reference/context structures).

The planner must explicitly derive backend task semantics:

```text
mixed t2v          -> t2v
mixed i2v          -> i2v
mixed fl2v         -> fl2v
mixed r2v          -> r2v
mixed source_video + no identity pictures -> v2v
mixed source_video + identity pictures    -> rv2v
```

The resulting executor path should reuse current H3 conditioning, sampling, preview, post-processing and results infrastructure wherever semantics match.

## Error handling

Mixed must fail explicitly for invalid state rather than silently fall back.

Required examples:

- Source Video segment without source => `Source Video required`.
- Earlier Segment reference points forward after reorder => `Invalid Reference`.
- Referenced source segment deleted => `Missing Reference`.
- No valid cached dependency and dependency cannot execute => dependency error naming both source and consumer.
- H3 picture/video/audio limits exceeded => existing H3-compatible limit error.

No mode may silently turn into T2V because required media is missing.

## Results and post-processing

Mixed output feeds the existing mode-agnostic infrastructure:

- Live Preview
- Segment Results
- Multi
- Final
- Global Refine
- Face Refine
- Video/audio export

Mixed must not fork duplicate post-processing implementations.

## Mixed v1 scope

Required in the first working implementation:

- top-level Mixed mode
- five Mixed segment modes
- mode-specific editor switching
- segment-local Source Video + Source Range
- identity source from manual/library/previous/earlier stills
- R2V previous/earlier still pictures
- I2V/FL2V previous/earlier still bindings
- Visual/Audio MC integration
- stable segment IDs
- reorder/delete/duplicate validation
- Selective Run dependency resolution
- dependency-aware cache invalidation
- existing Results/Multi/Final integration
- existing preview/post-processing integration
- tests for all above behavior

Deferred:

- Mixed Source Bridge
- Mixed-compatible Director Inputs protocol
- automatic face/identity best-frame selection
- arbitrary earlier-segment MC source
- different source segment per continuity channel

## Acceptance criteria

1. Opening/saving/running any old non-Mixed workflow yields unchanged semantics.
2. One Mixed timeline can contain T2V, I2V, FL2V, R2V and Source Video segments in one ordered project.
3. Switching a segment mode shows only legal inputs for that semantic mode.
4. R2V Reference Video and Source Video cannot be confused in UI or planner state.
5. Material Library video cannot become Source Video.
6. Source Video with no pictures compiles to V2V semantics; adding identity pictures compiles to RV2V semantics without requiring the user to switch modes.
7. Previous Segment Last Frame can be used as an identity/keyframe source without treating it as MC.
8. Explicit I2V Start Frame suppresses Visual MC while allowing Audio MC according to existing masters.
9. Reorder/delete operations never silently retarget stable Earlier Segment references.
10. Selective Run automatically executes missing/stale prerequisites and reuses valid prerequisite caches.
11. Upstream dependency changes invalidate affected downstream caches.
12. Mixed v1 never activates Source Bridge.
13. Existing standalone Source Bridge continues to work unchanged.
14. Existing standalone Director Inputs continues to work unchanged.
15. Mixed results pass through current preview, post-processing and final-output paths without duplicate implementations.

## Out-of-scope non-goals

- Replacing the existing six standalone modes.
- Making Material Library videos valid V2V/RV2V source timelines.
- Treating Motion Context as an identity mechanism.
- Automatically using previous generated videos as R2V Reference Video.
- Supporting forward segment references.
- Silently coercing invalid/missing mode inputs into another task mode.
