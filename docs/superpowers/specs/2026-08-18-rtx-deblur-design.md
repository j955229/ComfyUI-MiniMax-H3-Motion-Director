# RTX Deblur Integration Design

## Goal
Add optional NVIDIA RTX Deblur as a native final RGB post-processing stage in MiniMax H3 Motion Director, targeting blur/smear already present in generated H3 frames without triggering another H3 sampling pass.

## Scope
- Add an `rtx_deblur` section to the existing versioned post-process JSON config.
- UI controls appear directly below the existing Global Refine upscale controls.
- Controls: enabled toggle and quality dropdown using the same names as NVIDIA RTX VSR: `Low`, `Medium`, `High`, `Ultra`.
- Default is disabled; default quality is `Medium`.
- Execution happens after Face Refine and before final output/video encoding.
- Add frame-accurate progress and timing/report entries.
- Reuse the already-required `nvvfx` runtime path; do not depend on the external PixWizardry node package.

## Execution Order

```text
H3 Generation
→ Global Refine / Upscale (optional)
→ Assembly
→ Face Refine (optional)
→ NVIDIA RTX Deblur (optional)
→ Final output / auto-save encode
```

UI placement does not define execution placement: the controls live under upscale for discoverability, while processing remains at the end of the RGB pipeline.

## Configuration
Bump the post-processing configuration version and migrate existing workflows append-only:

```json
"rtx_deblur": {
  "enabled": false,
  "quality": "medium"
}
```

Accepted normalized quality values: `low`, `medium`, `high`, `ultra`.

## NVIDIA Mapping

- `low` → `DEBLUR_LOW`
- `medium` → `DEBLUR_MEDIUM`
- `high` → `DEBLUR_HIGH`
- `ultra` → `DEBLUR_ULTRA`

The implementation must resolve the quality enum defensively against the installed `nvvfx` runtime rather than silently downgrade to another mode.

## Processor Boundary
Create a dedicated RTX Deblur processor module instead of adding more responsibilities to `director/refine_sampling.py`.

Input/output contract:
- Input: ComfyUI IMAGE tensor in BHWC layout.
- Output: same shape, same resolution, RGB content deblurred.
- Audio is untouched.
- Processing uses CUDA float BCHW frames with `nvvfx.VideoSuperRes` configured to the selected `DEBLUR_*` quality and output dimensions equal to input dimensions.
- DLPack is used for the NVIDIA output path, matching the existing RTX VSR integration style.

## Progress
RTX Deblur reports true frame progress:

```text
RTX Deblur
Frame 37 / 124
29.8%
```

It becomes a dedicated global progress phase with its own weight and elapsed stage time. Failure still advances/finishes the stage cleanly so the UI cannot remain stuck.

## Report / Timing
Add a dedicated section:

```text
[RTX Deblur]
Enabled: ON
Quality: Medium
Frames: 124
Resolution: 1376x768
Status: SUCCESS
Timing: 8.42s
```

Failure includes the error and indicates that the pre-Deblur frames were kept.

The `[Timing]` section adds:

```text
RTX Deblur: 8.42s
```

`Pipeline Total` includes RTX Deblur. `Video Encode / Auto Save` remains separate, and `End-to-end Total` includes both.

## Failure Policy
RTX Deblur is optional and must never destroy a successfully generated result.

If `nvidia-vfx` is missing, the requested `DEBLUR_*` mode is unavailable, CUDA execution fails, or the processor raises any error:
- keep the exact pre-Deblur image tensor;
- mark RTX Deblur `FAILED`/`UNAVAILABLE` in the report;
- include the error text;
- continue final output and auto-save normally.

No automatic downgrade to another Deblur quality or different algorithm.

## UI
Place below the existing Global Refine upscale controls:

```text
RTX Deblur        [OFF / ON]
Quality           [Medium ▼]
```

Quality options: `Low`, `Medium`, `High`, `Ultra`.

No blend slider, auto-detection, local mask, or temporal heuristics in the first implementation.

## Testing
Add regression coverage for:
- config migration/defaults and quality normalization;
- UI serialization/restore and placement state;
- quality enum mapping;
- same-resolution output contract;
- fallback to original frames on unavailable runtime/error;
- per-frame progress reaching 100%;
- report fields and timing inclusion;
- Pipeline Total including Deblur but encode timing remaining separate.

## Non-goals
- Do not modify H3 sampling parameters.
- Do not treat Deblur as an upscale method.
- Do not replace RTX VSR.
- Do not add denoise in this change.
- Do not attempt to reconstruct missing anatomy or guarantee removal of generative double-limb artifacts.
