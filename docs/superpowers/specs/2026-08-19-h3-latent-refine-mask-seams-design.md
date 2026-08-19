# H3 Latent Refine, Native Masks, and Segment Boundary Integrity

## Scope

This change upgrades three existing Director paths without introducing a Draft/Review state machine:

1. Preserve and validate MiniMax H3 native per-token video/audio noise masks through Director sampling and refine paths.
2. Add a Director-native H3 learned-latent upscale backend for Global Refine. Director loads compatible 24-channel H3 learned-latent checkpoints directly from `ComfyUI/models/latent_upscale_models`; no second custom-node package is required.
3. Add strict segment-boundary validation so Motion Context prefixes and H3 frame-alignment surplus never leak into exported segment chunks; add non-destructive seam diagnostics.

## Non-goals

- No Draft/Approve/Reject UI or Draft cache.
- No before/after Draft comparison UI.
- No automatic removal of seam frames based on image-difference heuristics.
- No broad executor, Material Library, Mixed Mode, Source Bridge, or UI rewrite.
- Existing pixel-space Global Refine backends remain available.
- No LBH source or weights are vendored or redistributed. Compatible checkpoints remain user-supplied model assets.

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

### Native runtime and checkpoint compatibility

Director owns the inference runtime. It does not inspect or call a third-party `NODE_CLASS_MAPPINGS` registry.

- Checkpoints are discovered from Director's registered `latent_upscale_models` model category, physically backed by `ComfyUI/models/latent_upscale_models`.
- Compatible `.safetensors`, `.pth`, and `.pt` checkpoints are loaded directly.
- The checkpoint state dict is the single source of truth for architecture selection: a compatible 2D + Temporal layout runs the 2D runtime, while a compatible Full 3D layout runs the 3D runtime. The user does not select the runtime separately.
- Legacy saved `latent_upscale_variant` values are discarded during config normalization and never forwarded into inference.
- Both runtime variants operate on MiniMax H3 24-channel video latents and preserve temporal length.
- 2D + Temporal uses a uniform spatial scale and therefore cannot change aspect ratio except for normal integer latent-grid rounding.
- Full 3D supports an exact Director-resolved target H/W while preserving T.
- FP16, BF16, and FP32 inference are supported; device may be CUDA or CPU.
- A missing/incompatible checkpoint fails explicitly and Global Refine falls back to the first-pass result. There is no silent switch to a pixel backend.

The user supplies only the checkpoint asset. Installing `LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler` as a second custom node is not required.

### Director ownership

Director owns:

- final canvas resolution and alignment;
- checkpoint discovery/model-folder registration;
- checkpoint architecture detection and learned-latent model loading/inference;
- AV separation/rejoin;
- noise-mask remapping;
- high-resolution conditioning rebuild/synchronization;
- model release / VRAM cleanup around learned-latent inference;
- refine sampling and fallback reporting.

The learned upscaler must not silently alter Director's resolved final canvas. Director validates returned latent H/W and temporal length against the requested target.

### Conditioning

After latent spatial upscale, known H3 conditioning must match the final sampling canvas. Director synchronizes target-canvas keyframe latents at the final resolution and then reapplies Motion Context against the upscaled latent when required.

Normal Motion Context keyframes remain owned by the existing RGB re-pin path. Source Bridge is special: its five-frame endpoint anchors reuse the Motion Context marker but do not run the normal Motion Context re-pin path, so Director synchronizes those endpoint anchors explicitly after learned-latent upscale.

This avoids blindly resizing arbitrary tensors inside CONDITIONING metadata while preventing PackedLayout spatial mismatches.

### VRAM lifecycle

The learned-latent model is a separate neural network. On CUDA, Director uses its existing `cleanup_segment_vram()` path before loading the upscaler so the first-pass H3/VAE stack does not have to coexist with it. The learned-latent model is released after inference and device cache is cleared before high-resolution H3 refine sampling reloads what it needs.

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

Focused tests cover:

- nested video/audio mask preservation and spatial video-mask remap;
- existing Audio Drive mask composition preserving video masks;
- Director-native learned-latent runtime operation with an empty external node registry;
- 2D/3D compatible state-dict layout detection and round-trip model construction;
- checkpoint-driven architecture selection with legacy manual variant values ignored;
- target-size validation, AV preservation, and CUDA model-unload ordering;
- Global Refine config normalization/migration for the new backend and model/precision/device fields;
- Motion Context and Source Bridge high-resolution keyframe synchronization;
- exact segment slicing for context spans 0, 5, 22, and 39;
- H3 frame-alignment surplus trimming;
- rejection of short decoded outputs;
- seam diagnostics being non-destructive;
- UI text explicitly stating that no separate LBH custom node is required;
- no manual 2D/3D runtime selector in the Global Refine UI;
- no regression to existing pixel-space refine behavior.

## Compatibility

- Existing saved workflows remain valid through postprocess-config migration/defaulting; obsolete `latent_upscale_variant` values are dropped.
- Existing Global Refine pixel-space settings retain their meaning.
- `h3_learned_latent` introduces no second custom-node dependency.
- Selecting `h3_learned_latent` requires a compatible learned-latent checkpoint in `ComfyUI/models/latent_upscale_models`.
