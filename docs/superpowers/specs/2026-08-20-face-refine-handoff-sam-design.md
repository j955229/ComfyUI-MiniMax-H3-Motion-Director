# Segment-Final Face Refine, Motion Handoff, and SAM Integration

## Scope

This change fixes the postprocess/continuity contract exposed by real three-segment H3 runs:

1. For Motion Context chains, Face Refine runs per generated segment after Global Refine/final decode and before that segment becomes the predecessor for the next segment.
2. Face tracking keeps a bounded tail of the previous final segment as history, but only the current segment is sampled/refined; history frames are never re-sampled.
3. Source Bridge timelines keep Face Refine after bridge assembly because bridge pixels do not exist until both adjacent nominal segments are available.
4. A successful Face Refine invalidates visual latent reuse because final RGB changed; the next visual Motion Context must use the true final RGB tail.
5. Existing long-chain Audio Previous Context refresh remains intact: when the exported waveform can safely cover the context span, Director intentionally removes the hidden audio latent and re-encodes the audible waveform to avoid recursive hidden-latent drift. Latent audio remains the strict fallback.
6. SAM model discovery becomes Director-owned and fails early with actionable validation instead of exposing an empty selector or failing after generation.
7. Reports expose hidden Motion Context encode work and aggregate Face Refine statistics instead of reporting only the last chunk.

## Segment-final Face Refine contract

For a normal Motion Context boundary, the execution order is:

`Generation -> Global Refine -> final AV decode/trim -> seam colour match -> Face Refine -> cache/final segment -> Motion Context handoff -> next segment`.

A successful Face Refine changes final RGB pixels. Therefore its predecessor video latent is no longer an exact representation of the user-visible result and must not be reused as visual Motion Context. The next visual context uses the final RGB tail and VideoVAE encoding.

If Face Refine is disabled, returns `NO_FACE`, or fails and falls back without changing pixels, normal matching-canvas video-latent reuse remains eligible.

## Stateful cross-segment tracking

The tracker receives a bounded history prefix from the previous final segment. The history length is the largest half-window required by current centre/size smoothing, capped by available cached context frames. With defaults (`Centre Window=21`, `Size Window=51`) this needs 25 preceding frames, which fits the existing 39-frame exported RGB context cache.

Tracking is performed on `history + current`, then the resulting crops/transform are sliced to the current segment before H3 Face Refine sampling. This preserves target identity/position/size continuity without re-running H3 sampling on history frames.

Same-run history comes from the previous final segment output. Selection runs may use the previous final context/segment cache when available. Resolution-mismatched history is ignored rather than resized into a misleading tracking coordinate system.

## Source Bridge policy

Source Bridge generates boundary pixels only after both adjacent nominal segments exist. A per-segment Face Refine performed before bridge generation cannot refine those bridge pixels. Therefore any timeline with an active Source Bridge keeps the existing assembled-result Face Refine path. The report identifies this as `assembled/source-bridge` mode. Motion Context-only timelines use the new `segment-final` mode.

## Motion Context visual/audio contract

Visual and audio continuity intentionally have different source-of-truth rules.

### Visual

- Matching video latent may be reused only when it still exactly represents final pixels, Color Re-anchor is off, and its canvas matches the target canvas.
- Successful Face Refine is a final RGB edit, so it invalidates visual latent reuse for that segment.
- Color Re-anchor continues to force RGB -> VideoVAE because the colour-adjusted pixels are the state that must be inherited.
- RGB is an explicit visual fallback, not an error-masking path.

Latent handoff metadata carries `visual_latent_valid`. Existing base/refine cache files remain the storage mechanism. The cache producer fingerprint gains a new final-segment pipeline token so pre-change caches cannot be mistaken for Face-Refined-final handoffs.

### Audio

The existing `audio_context_refresh.py` behavior is preserved. Its purpose is long-chain stability, not accidental fallback:

- when final exported waveform has enough samples and `audio_vae` is available, hidden audio latent is removed from the Motion Context candidate and the exact audible waveform tail is re-encoded;
- this prevents hidden audio latent distribution drift from recursively feeding itself across long chains;
- if waveform refresh cannot be performed safely, cached audio latent remains the strict fallback;
- Face Refine never changes audio, so no new audio processing is introduced by segment-final Face Refine.

The report must distinguish intentional `waveform refresh` from generic fallback and account for its AudioVAE encode time.

## SAM model contract

Director owns `ComfyUI/models/sams` and registers it as a model category at startup. The integrated backend is Ultralytics SAM, so the selector exposes compatible `.pt` checkpoints only. Existing incompatible `.pth` Meta-SAM checkpoints are not silently passed to `ultralytics.SAM`.

When `Mask=SAM`, preflight validation occurs before segment generation:

- a SAM model must be selected;
- the selected file must resolve from Director-owned/compatible model categories;
- the file must be `.pt` for the integrated Ultralytics backend;
- the Ultralytics runtime must be importable.

The capabilities endpoint returns the expected SAM folder and compatible model list. The UI displays an actionable empty-state message when no compatible model is found.

## Reporting

Global Refine reporting separates the main latent/pixel upscale timings from Motion Context re-pin work. Per segment, context reports include actual VideoVAE encode and intentional AudioVAE waveform-refresh time when those paths run.

Face Refine reports per-segment timing in segment-final mode and aggregate statistics across refined chunks/segments. Adaptive denoise min/max are global extrema and mean is frame-weighted; it is no longer whichever chunk ran last.

## Compatibility and fallback

- Postprocess config version becomes v10; saved v9 settings normalize forward without losing user values.
- The frontend boot token becomes v10 so browsers cannot keep the stale modal module.
- Face Refine failure keeps the pre-Face-Refine segment result and does not invalidate an otherwise valid video latent.
- No Source Bridge generation semantics are changed.
- Color Re-anchor still requires RGB VideoVAE re-encoding.
- Existing long-chain audio waveform-refresh behavior is preserved.
- Existing Global Refine result-preview default remains OFF.

## Tests

Focused tests must prove:

- tracking history affects tracking input but is excluded from Face Refine sampling/output;
- track result slicing preserves current-segment transforms/statistics;
- adaptive denoise statistics aggregate across chunks;
- successful Face Refine invalidates visual latent reuse and causes the next visual context to use final RGB;
- failed/disabled Face Refine does not unnecessarily invalidate a valid video latent;
- existing audio-context refresh tests remain green and the report labels the intentional waveform refresh correctly;
- cache handoff preserves/reloads `visual_latent_valid`;
- SAM folder registration and `.pt` filtering work without another custom node;
- SAM preflight rejects missing/incompatible models before generation;
- executor source contract places segment-final Face Refine before cache/handoff for non-bridge paths and retains assembled Face Refine for Source Bridge;
- report/boot-token contracts reflect v10 and new timing/source fields.
