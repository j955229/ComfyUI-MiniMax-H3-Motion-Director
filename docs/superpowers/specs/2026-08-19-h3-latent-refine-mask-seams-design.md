# H3 Latent Refine, Native Masks, and Segment Boundary Integrity

## Scope

This change upgrades three existing Director paths without introducing a Draft/Review state machine:

1. Preserve and validate MiniMax H3 native per-token video/audio noise masks through Director sampling and refine paths.
2. Add an H3 learned-latent upscale backend for Global Refine by adapting an installed `LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler` node while keeping Director in control of canvas size, conditioning, masks, and VRAM lifecycle.
3. Add strict segment-boundary validation so Motion Context prefixes and H3 frame-alignment surplus never leak into exported segment chunks; add non-destructive seam diagnostics.

## Non-goals

- No Draft/Approve/Reject UI or Draft cache.
- No before/after Draft comparison UI.
- No automatic removal of seam frames based on image-difference heuristics.
- No broad executor, Material Library, Mixed Mode, Source Bridge, or UI rewrite.
- Existing pixel-space Global Refine backends remain available.
- No copied implementation from the LBH repository. The repository currently has no explicit LICENSE file, so Director integrates it as an optional external custom-node dependency rather than vendoring its source.

## User workflow

The intended workflow stays simple:

1. Keep Global Refine disabled and use random seeds to regenerate a segment until its motion/composition is acceptable.
2. Lock the accepted seed and keep first-pass generation settings unchanged.
3. Enable Global Refine and rerun the selected segment.
4. When the learned-latent backend is selected, the first-pass H3 AV latent is spatially upscaled directly, then sampled again at final resolution without a decode -> pixel-upscale -> encode round-trip.

A rerun may repeat the first low-resolution sampling pass; this version does not persist a full Draft latent.

## Native H3 noise-mask contract

Director treats `latent["noise_mask"]` as part of the latent state, not disposable metadata.

- H3 nested AV samples may contain `(video_latent, audio_latent)`.
- H3 nested masks may contain `(video_mask, audio_mask)`.
- Video mask semantics follow current ComfyUI MiniMax H3: `1` means generate/denoise, `0` means preserve, with model-side pooling to the H3 2x2 video token grid.
- Audio mask semantics follow current ComfyUI MiniMax H3: `1` means generate/denoise, `0` means preserve, pooled to audio latent frames.
- Audio Drive may compose its exact-drive mask with an existing audio mask; it must not replace an unrelated video mask.
- Refine paths must preserve or remap masks explicitly rather than silently dropping them.

For a spatial video-latent upscale:

- Audio mask is unchanged.
- Video mask is spatially resized to the new video latent H/W while preserving its temporal dimension and value semantics. Nearest-neighbor resizing is used so locked/generated regions are not blurred into fractional boundaries by Director. Current ComfyUI may subsequently quantize/pool values internally.
- If no mask exists, Director does not synthesize one unless the selected refine operation requires an explicit full-generation video mask.

## Learned latent upscale backend

Global Refine gains a latent-space backend named `h3_learned_latent` alongside the existing pixel-space methods.

### External compatibility

The backend targets the currently installed LBH MiniMax H3 latent-upscaler custom node and its checkpoints in ComfyUI's `models/latent_upscale_models` directory.

- 2D + Temporal Conv is the default fast variant.
- Full 3D is an advanced variant.
- Spatial upscale only; temporal latent length is preserved.
- Director passes an exact target canvas derived from its own final-resolution resolver.
- If the LBH custom node is not installed, the selected stage fails explicitly and Global Refine falls back to the first-pass result. There is no silent switch to a pixel backend.

Director discovers the external custom node at runtime and calls its public node entrypoint. No LBH source code or model architecture implementation is copied into this repository.

### Director ownership

Director owns:

- final canvas resolution and alignment;
- AV separation/rejoin;
- noise-mask remapping;
- high-resolution conditioning rebuild/synchronization;
- external-upscaler cache release / VRAM cleanup before high-resolution H3 sampling;
- refine sampling and fallback reporting.

The learned upscaler must not silently alter Director's resolved final canvas. Director validates the returned latent H/W against the requested target.

### Conditioning

After latent spatial upscale, known H3 conditioning must match the final sampling canvas. Director rebuilds the segment's official MiniMax H3 conditioning using the same prompt, task, first/last frames, references and audio references at the final canvas, then reapplies Motion Context against the upscaled latent when required.

This avoids blindly resizing arbitrary 4D tensors inside CONDITIONING metadata and correctly regenerates H3 keyframe latents for the final canvas.

### VRAM lifecycle

LBH currently caches loaded upscaler models. Director therefore explicitly clears the external module's model cache after the upscale call and invokes its normal segment VRAM cleanup before high-resolution H3 refine sampling. This prevents the upscaler from remaining resident alongside H3, VAE, and Face Refine models.

## Global Refine compatibility

Existing pixel-space methods remain unchanged in behavior:

- `lanczos`
- `upscale_model`
- `nvidia_rtx_vsr`

The learned-latent backend bypasses pixel decode/upscale/re-encode for the upscale step. RTX Deblur remains a pixel-space preprocessing feature and is rejected when combined with the learned-latent backend in this version, rather than silently forcing a pixel round-trip.

If learned-latent upscale is unavailable or fails, existing Global Refine stage-fallback behavior reports the failure and returns the first-pass result; it must not silently switch to a different upscale backend.

## Segment boundary contract

For each visible segment, Director distinguishes:

- requested visible target frame count;
- Motion Context prefix length;
- H3 aligned generation frame count;
- decoded raw frame count;
- exported visible chunk frame count.

The exported visible chunk must satisfy:

`exported_frames == requested_visible_frames`

For a segment with a context prefix, the visible chunk starts at exactly `context_span` and ends at `context_span + requested_visible_frames`.

H3 alignment surplus at the tail is discarded before caching/export/assembly. Motion Context prefix frames are never exported as visible content.

Boundary validation covers normal generation, Motion Context, Source Bridge, Selective Run/cache reconstruction, and audio trimming.

## Seam diagnostics

Director computes lightweight diagnostics across `segment N` tail frames and `segment N+1` head frames (export counts, mean absolute RGB jump, luma jump, and audio duration/sample-boundary metadata) for reporting/debugging.

Diagnostics are non-destructive. Director must not automatically drop one or two frames merely because a visual-difference metric is high.

## Testing

Add focused tests for:

- nested video/audio mask preservation and spatial video-mask remap;
- existing Audio Drive mask composition preserving video masks;
- learned-latent adapter target-size validation, AV preservation, model-cache release, and explicit failure when the external node is absent;
- Global Refine config normalization/migration for the new backend and variant/model fields;
- exact segment slicing for context spans 0, 5, 22, and 39;
- H3 frame-alignment surplus trimming;
- rejection of short decoded outputs;
- seam diagnostics being non-destructive;
- no regression to existing tests.

## Compatibility

- Existing saved workflows remain valid through postprocess-config migration/defaulting.
- Existing Global Refine pixel-space settings retain their meaning.
- No new required dependency is introduced for users who do not select the learned-latent backend.
- Selecting `h3_learned_latent` requires the LBH custom node to be installed separately.
