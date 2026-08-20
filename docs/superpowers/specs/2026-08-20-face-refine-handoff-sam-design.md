# Segment-Final Face Refine, Latent Handoff, and SAM Integration

## Scope

This change fixes the postprocess/continuity contract exposed by real three-segment H3 runs:

1. For Motion Context chains, Face Refine runs per generated segment after Global Refine/final decode and before that segment becomes the predecessor for the next segment.
2. Face tracking keeps a bounded tail of the previous final segment as history, but only the current segment is sampled/refined; history frames are never re-sampled.
3. Source Bridge timelines keep Face Refine after bridge assembly because bridge pixels do not exist until both adjacent nominal segments are available.
4. Motion Context video and audio latent sources are independent. Final pixel edits may invalidate video latent reuse while the audio latent remains reusable.
5. SAM model discovery becomes Director-owned and fails early with actionable validation instead of exposing an empty selector or failing after generation.
6. Reports expose context-repin timing and aggregate Face Refine statistics instead of hiding VAE work or reporting only the last chunk.

## Segment-final Face Refine contract

For a normal Motion Context boundary, the execution order is:

`Generation -> Global Refine -> final AV decode/trim -> seam colour match -> Face Refine -> cache/final segment -> Motion Context handoff -> next segment`.

A successful Face Refine changes final RGB pixels. Therefore its predecessor video latent is no longer an exact representation of the user-visible result and must not be reused as visual Motion Context. The next visual context uses the final RGB tail and VideoVAE encoding. Audio is different: Face Refine never changes the generated audio latent, so audio continuation should keep using the latent tail without an AudioVAE waveform round-trip.

If Face Refine is disabled, returns `NO_FACE`, or fails and falls back without changing pixels, normal matching-canvas video-latent reuse remains eligible.

## Stateful cross-segment tracking

The tracker receives a bounded history prefix from the previous final segment. The history length is the largest half-window required by current centre/size smoothing, capped by available cached context frames. With defaults (`Centre Window=21`, `Size Window=51`) this needs 25 preceding frames, which fits the existing 39-frame exported RGB context cache.

Tracking is performed on `history + current`, then the resulting crops/transform are sliced to the current segment before H3 Face Refine sampling. This preserves target identity/position/size continuity without re-running H3 sampling on history frames.

Same-run history comes from the previous final segment output. Selection runs may use the previous final context/segment cache when available. Resolution-mismatched history is ignored rather than resized into a misleading tracking coordinate system.

## Source Bridge policy

Source Bridge generates boundary pixels only after both adjacent nominal segments exist. A per-segment Face Refine performed before bridge generation cannot refine those bridge pixels. Therefore any timeline with an active Source Bridge keeps the existing assembled-result Face Refine path. The report identifies this as `assembled/source-bridge` mode. Motion Context-only timelines use the new `segment-final` mode.

## Video/audio latent separation

`apply_exported_motion_context` accepts separate visual and audio latent candidates.

- Visual latent: used only when it exactly represents final pixels, Color Re-anchor is off, and the latent canvas matches the target canvas.
- Audio latent: independently used whenever a valid prior AV latent tail exists, regardless of video canvas mismatch, Color Re-anchor, or Face Refine pixel edits.
- RGB/waveform remain explicit fallbacks.

Latent handoff metadata carries `visual_latent_valid`. Existing base/refine cache files remain the storage mechanism; the chosen file may still contain a valid audio stream when its video stream is marked invalid for visual reuse.

The cache producer fingerprint gains a new final-segment pipeline token so pre-change caches cannot be mistaken for Face-Refined-final handoffs.

## SAM model contract

Director owns `ComfyUI/models/sams` and registers it as a model category at startup. The integrated backend is Ultralytics SAM, so the selector exposes compatible `.pt` checkpoints only. Existing incompatible `.pth` Meta-SAM checkpoints are not silently passed to `ultralytics.SAM`.

When `Mask=SAM`, preflight validation occurs before segment generation:

- a SAM model must be selected;
- the selected file must resolve from Director-owned/compatible model categories;
- the file must be `.pt` for the integrated Ultralytics backend;
- the Ultralytics runtime must be importable.

The capabilities endpoint returns the expected SAM folder and compatible model list. The UI displays an actionable empty-state message when no compatible model is found.

## Reporting

Global Refine reporting separates the main latent/pixel upscale timings from Motion Context re-pin work. Per segment, re-pin reports at least total time and VideoVAE/AudioVAE encode time accumulated by the Motion Context call.

Face Refine reports per-segment timing in segment-final mode and aggregate statistics across all refined chunks/segments. Adaptive denoise min/max are global extrema and mean is frame-weighted; it is no longer whichever chunk ran last.

## Compatibility and fallback

- Postprocess config version becomes v10; saved v9 settings normalize forward without losing user values.
- The frontend boot token becomes v10 so browsers cannot keep the stale modal module.
- Face Refine failure keeps the pre-Face-Refine segment result and does not invalidate an otherwise valid video latent.
- No Source Bridge generation semantics are changed.
- Color Re-anchor still requires RGB VideoVAE re-encoding; this change only prevents audio from being dragged into the same fallback.
- Existing Global Refine result-preview default remains OFF.

## Tests

Focused tests must prove:

- tracking history affects tracking input but is excluded from Face Refine sampling/output;
- track result slicing preserves current-segment transforms/statistics;
- adaptive denoise statistics aggregate across chunks;
- Face Refine-success marks visual latent invalid while audio latent remains consumable;
- Color Re-anchor can use RGB visual context and latent audio context simultaneously;
- cache handoff preserves/reloads `visual_latent_valid`;
- SAM folder registration and `.pt` filtering work without another custom node;
- SAM preflight rejects missing/incompatible models before generation;
- executor source contract places segment-final Face Refine before cache/handoff for non-bridge paths and retains assembled Face Refine for Source Bridge;
- report/boot-token contracts reflect v10 and new timing/source fields.
