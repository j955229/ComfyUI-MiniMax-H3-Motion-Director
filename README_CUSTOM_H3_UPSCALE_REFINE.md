# Custom H3 Upscale and Refine Notes

Last reviewed against the local Motion Director tree: **2026-09-11**.

These are local working notes for producing a long MiniMax H3 video as a
sequence of approximately 10-second Motion Director segments. The model used
for these notes was `10Eros_Max_h3_TURBO-hybrid_beta4_int8_convrot.safetensors`,
which has the Turbo acceleration baked in; treat that checkpoint note as a
snapshot, not a current model recommendation.

The reference result is the LBH example workflow
`minimax_h3_r2v_Latent Upscaler example workflow3.json`:

1. Generate at 608 x 352 (about 0.2 MP).
2. Run only the first four high-noise intervals of an eight-step schedule.
3. Forward the sampler's predicted clean `denoised_output` (`x0`).
4. Apply the learned MiniMax H3 3D latent upscaler to reach approximately
   1344 x 768 (about 1 MP and 2.2x per axis).
5. Regenerate the high-resolution latent with a short, relatively aggressive
   three-, four-, or five-step sigma schedule.

The result is unusually effective because the first pass establishes motion,
composition, identity, and large forms cheaply. The learned 3D upscaler gives
the second pass a temporally coherent high-resolution starting point. The
second pass then receives enough noise to reconstruct detail at the target
resolution instead of merely enlarging low-resolution texture.

## Main conclusion

Motion Director's `h3_learned_latent` Global Refine path has essentially the
same quality ceiling as the LBH full-frame 3D workflow. It uses the same kind
of learned spatiotemporal upscaler and can use the same checkpoint.

It is not numerically identical to the example workflow:

- Motion Director normally completes the first-pass schedule.
- Its internal Global Refine uses ordinary ComfyUI `steps + denoise` schedule
  construction rather than the example's manually selected sigma lists.
- Its external first-pass `SAMPLER + SIGMAS` path returns the sampler trajectory
  output. It does not expose the callback's clean `x0` as the first-pass result,
  so supplying only the high-sigma half of an eight-step schedule does not
  reproduce the example's `denoised_output` handoff.

For a plain, isolated R2V clip, the two implementations should be comparable
when they use the same 3D checkpoint and similar high-resolution noise levels.
For a multi-segment Director production, the integrated path is preferable:
it rebuilds target-resolution conditioning, remaps masks, re-encodes native
keyframes where needed, and repins Motion Context before high-resolution
sampling. The current postprocess v10 lifecycle also makes the final pixels of
each segment authoritative before the next segment's context is cached.

## Developments in the current Director implementation

The package now has a small compatibility facade in front of the preserved
executor and postprocess implementations:

- `director/executor_core.py` makes normal Face Refine segment-final. It runs
  after the segment's final color/seam work and before Motion Context/cache
  finalization, so a face edit cannot leave a stale visual latent in the next
  segment's handoff.
- When Face Refine changes the final pixels, the visual latent is marked
  invalid and the next visual context is rebuilt from final RGB/VAE pixels.
  The previous latent may still be retained as an independent audio candidate;
  visual and audio continuation are no longer forced to share a stale latent.
- The refined-resolution latent handoff remains available when the canvas is
  unchanged or when a valid refine-canvas cache is present. Source Bridge
  timelines retain the assembled compatibility path because their pixels are
  not available until both sides of the bridge exist.
- `director/postprocess_config.py` is postprocess configuration **v10**. The
  cache fingerprint includes pixel-producing Global Refine and Face Refine
  settings, while UI-only result-preview settings are deliberately excluded.
  Changing either actual refine stage therefore invalidates the relevant cache;
  toggling result previews does not.
- Global Refine result previews are disabled by default. Turning them on can
  add VAE decode/UI work for the first result and each refine pass, but does
  not change generated pixels. Keep them off for long production runs unless
  intermediate visual inspection is needed.
- Execution reports now expose learned-upscale progress, per-pass timing, seam
  diagnostics, Face Refine timing, and Motion Context VideoVAE/AudioVAE timing.
  These measurements are useful for comparing a 4+4 Director run against the
  external LBH graph instead of relying on wall-clock impressions alone.
- Changing the Director's connected first-pass H3 MODEL does not invalidate
  existing segment caches. This allows a retake or a following clip to use a
  different model while earlier clips remain reusable. Changing only Global
  Refine's **Refine Model** still affects the refinement stage while preserving
  the cached first pass.
- The Director also exposes an optional `turbo_lora_model` MODEL socket. Connect
  the output of MiniMax H3 Turbo LoRA there when the base H3 MODEL should run the
  first pass and the patched model should run Global Refine and Face Refine.
  Leave the socket disconnected to follow the first-pass model. The old
  `global_refine.refine_model` setting is still accepted in saved configs for
  compatibility, but the current UI no longer exposes a redundant model
  dropdown.

Face Refine is a separate, additional regeneration stage. It is not part of
the learned latent upscale quality comparison. For a clean A/B against the LBH
workflow, leave Face Refine disabled; enable it only after the segment's
composition and high-resolution Global Refine result are worth keeping.

## Recommended configuration for 10-second segments

These are recommendations, not the node defaults. The Director first-pass
default is 25 steps; the postprocess UI defaults to FP16/CUDA and no learned
upscaler checkpoint until one is selected. Start with:

| Setting | Value |
|---|---|
| First-pass steps | `6` |
| First-pass sampler / scheduler | A known-good baked-Turbo combination; start with the current Euler/simple setup |
| Global Refine | Enabled |
| Global Refine mode | Upscale |
| Upscale method | `h3_learned_latent` |
| Target | Approximately `1344 x 768` (LBH baseline; the Director's default 1 MP 16:9 target is about `1376 x 768`) |
| Learned-upscaler checkpoint | Original MiniMax H3 3D BF16 checkpoint |
| Upscaler precision | `bf16` (set explicitly; UI default is `fp16`) |
| Second sampling | Enabled |
| Refine passes | `1` |
| Refine steps | Explicitly `4` -- do not leave this at `0`/auto |
| Refine denoise | `0.40` to `0.45`; start at `0.425` |
| Refine model | Leave `turbo_lora_model` disconnected to follow first pass, or connect a Turbo-LoRA MODEL |
| Refine seed | Inherit |
| Result previews | Off for production; UI-only and disabled by default |

Use four first-pass steps when strict speed parity matters and the four-step
Turbo result already has stable motion. Raise the first pass to six or eight
when motion, anatomy, composition, or boundary continuity needs help. Do not
double the nominal schedule to 12 or 16 merely because Turbo is baked in.

Suggested A/B tests:

| Test | First steps | Refine steps | Denoise | Purpose |
|---|---:|---:|---:|---|
| Speed parity | 4 | 4 | 0.425 | Same denoiser evaluation count as the 4+4 reference |
| Recommended | 6 | 4 | 0.425 | More low-resolution motion work for little extra total cost |
| Conservative | 8 | 4 | 0.25-0.30 | Greater identity and conditioning fidelity |
| Aggressive | 6 | 4-5 | 0.40-0.50 | More high-resolution invention and texture |

Keep the number of refine passes at one. Repeated passes cost much more than
extra low-resolution steps and increase the chance of identity, color, audio,
or motion drift.

If Face Refine is enabled, treat its sampling and face detection/tracking time
as an additional stage after Global Refine. Its segment-final ordering is
important for continuity, but it is not a free substitute for Global Refine.

## Runtime comparison

At the current sizes, the target contains about five times as many pixels as
the first pass. A useful first approximation is:

```text
relative cost = low-resolution steps * 0.2 + high-resolution steps * 1.0
```

This ignores nonlinear attention cost, model loading, VAE work, and memory
traffic, but it correctly shows which setting dominates.

| Setup | Low-res evaluations | High-res evaluations | Approximate cost units |
|---|---:|---:|---:|
| Reference 4+3 | 4 | 3 | 3.8 |
| Reference 4+4 | 4 | 4 | 4.8 |
| Reference 4+5 | 4 | 5 | 5.8 |
| Director 4+4 | 4 | 4 | 4.8 |
| Director 6+4 | 6 | 4 | 5.2 |
| Director 8+4 | 8 | 4 | 5.6 |
| Director automatic 8+8 | 8 | 8 | 9.6 |

The important optimization is therefore to set Global Refine to four explicit
steps. Leaving its step count at zero resolves to
`max(8, round(first_pass_steps * 0.4))`; with a 25-step first pass that is 10
refine steps, while an 8-step first pass still produces the 8-step minimum.
Moving from four to six first-pass steps should add only modest runtime because
those two extra evaluations run on the 0.2 MP latent.

For a long sequence, total generation time should remain approximately linear
in the number of 10-second segments. Director's context encoding, cache, and
stitching work adds overhead, but H3 high-resolution denoising remains the main
cost.

## Why integrated refinement helps continuity

When Global Refine changes the canvas size, Motion Director maintains two
useful handoff paths:

- Base-resolution context for generating the next segment.
- Refined-resolution latent context for repinning and refining the next
  segment when its refine canvas matches.

This allows the next high-resolution segment to inherit the preceding refined
tail instead of independently rediscovering the boundary. If the refined
latent handoff is unavailable, the Director falls back to RGB/VAE context
reconstruction rather than silently dropping continuity.

With current postprocess v10, a segment-final Face Refine edit invalidates only
the visual latent that no longer matches the final pixels. The audio candidate
can remain independent, and the next visual context is encoded from the actual
final segment frames. This avoids propagating a face-refined RGB result through
an old, inconsistent visual latent.

This is the main reason to prefer integrated Global Refine over generating the
entire low-resolution project first and independently upscaling every segment
afterward.

## Resolution guidance

The learned upscaler was designed for roughly 1x-4x linear scaling, with 2x
being the most representative operating point. The current 608 x 352 to
1344 x 768 conversion is approximately 2.2x per axis and is appropriate.

For reliable detail:

- Prefer about 1.5x-2.25x linear scaling.
- Increase first-pass resolution above roughly 2.5x linear scaling.
- Increase it when faces, hands, text, or important objects occupy too few
  source pixels, even if the formal scaling ratio is supported.
- For targets substantially beyond 1 MP, consider approximately 672 x 384 or
  704 x 400 first passes, preserving the intended aspect ratio and valid H3
  dimensions.

An upscaler can invent plausible texture, but it cannot reliably recover
identity or geometry that was never resolved in the first pass.

## Comparison with other installed approaches

| Approach | Best use | Trade-off |
|---|---|---|
| LBH full-frame 3D | Clean quality baseline when the complete latent fits | Manual graph; no Director-aware continuity |
| Motion Director learned Global Refine | Long multi-segment projects, Motion Context, references, audio drive | Its schedule is not the example's exact manual sigma sequence |
| MMH3 Ultimate Upscale | High resolution or duration that requires temporal/spatial splitting | Tiling trades global context for VRAM scalability |
| LBH Split Upscale | Advanced tiled refinement with seam correction and anchors | More complex and unnecessary near 1 MP when full-frame fits |
| MiniMaxH3 Context Loop | Deferred or shot-by-shot orchestration | Uses another upscale backend; not a better upscaler by itself |
| MAINodes `H3LatentUpscale` | Fast utility interpolation | Bilinear/nearest initialization is weaker than the learned 3D model |

For 10-second clips at about 1 MP, use full-frame Motion Director refinement if
it fits in memory. Avoid tiled or temporal-split refinement unless VRAM forces
it. When splitting is necessary, use the largest chunks and tiles that fit.

## Checkpoint notes

Use the original `minimax_h3_latent_upscaler_3d_bf16.safetensors` with BF16
precision as the baseline. The locally installed `CONSERVATIVE_v5` model is
advertised as mixed BF16/FP16, but the current learned-upscaler loaders convert
the complete network to the selected uniform precision. That loader path does
not preserve the checkpoint's advertised mixed-precision arrangement.

The 10Eros-Max model card used for this note flags the INT8 beta3/beta4 files as
corrupted test versions and identifies beta5 as the functional replacement. If
you are still using beta4, compare beta5 before spending too much time tuning
minor refinement differences. Do not load an additional Turbo LoRA on a model
whose filename already identifies it as `TURBO-hybrid`.

## Relevant implementation files

- `director/h3_learned_latent.py`: splits the H3 audio/video latent, learned-
  upscales the 24-channel video portion, remaps its noise mask, and recombines
  the untouched audio portion.
- `director/refine_latent_stage.py`: rebuilds high-resolution conditioning and
  keyframe latents before refinement.
- `director/refine_sampling.py`: performs the learned upscale and Global Refine
  sampling passes.
- `nodes/director.py` and `nodes/director_inputs.py`: expose the optional
  `turbo_lora_model` refinement-model socket while keeping the required MODEL
  on the first-pass path.
- `director/core_sampling.py`: implements internal and external first-pass
  sampling. Its external path does not return the sampler callback's `x0`.
- `director/postprocess_config_legacy.py`: resolves `steps=0` to
  `max(8, round(first_pass_steps * 0.4))` refinement evaluations.
- `director/executor_core.py`: current segment-final lifecycle facade; places
  Face Refine before final Motion Context/cache handoff and separates visual
  latent validity from the independent audio candidate.
- `director/executor_core_legacy.py`: preserved executor implementation used by
  the facade and by compatibility paths such as Source Bridge timelines; it
  also builds the connected-model cache identity.
- `director/postprocess_config.py`: current postprocess v10 facade and cache
  fingerprint; excludes UI-only result-preview settings from pixel identity.
- `director/execution_report.py` and `director/seam_report.py`: timing,
  progress, seam, and learned-upscale diagnostics shown in the execution
  report.

## External references

- [LBH MiniMax H3 latent upscaler](https://github.com/LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler)
- [LBH upscaler model card](https://huggingface.co/LBH-123-AI/Minimax_h3_latent_Upscaler)
- [MMH3 Ultimate Upscale](https://github.com/bbaudio-2025/Comfyui-MMH3-UltimateUpscale)
- [FL MiniMax H3](https://github.com/filliptm/ComfyUI-FL-MiniMaxH3)
- [Flow-Aligned Regenerate](https://github.com/xmarre/MiniMax-H3-Flow-Aligned-Regenerate)
- [10Eros-Max model card](https://huggingface.co/TenStrip/10Eros-Max)
