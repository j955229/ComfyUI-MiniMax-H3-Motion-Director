# MiniMax H3 Motion Director

[English](README.md) | [简体中文](README_zh.md)

![Version](https://img.shields.io/badge/version-v1.1.5%20HotFix%231-2ea44f)
![License](https://img.shields.io/badge/license-GPL--3.0-blue)
![ComfyUI](https://img.shields.io/badge/ComfyUI-custom%20node-6f42c1)

**One Director. From a single MiniMax H3 shot to a complete multi-segment video project.**

Build `T2V / I2V / FL2V / R2V / V2V / RV2V` shots in one production interface, mix generation methods segment by segment, carry visual and generated-audio context across shots, rerun only the segments that need work, manage reusable assets, preview the pipeline live, refine the result, and export the final video without turning the ComfyUI graph into a wall of nodes.

> Current version: **v1.1.5 HotFix#1** · Registry package: **1.1.6**

<!-- IMAGE SLOT 1
Place your Mixed + Selective Run screenshot here:
docs/images/hero-mixed-selective-run.png
Recommended source: 螢幕擷取畫面 2026-08-19 041546.png
-->

![MiniMax H3 Motion Director — Mixed Mode](docs/images/hero-mixed-selective-run.png)

The screenshot above shows the native **Mixed** timeline: five segments using different generation paths, per-boundary visual/audio continuity controls, and **Selective Run** enabled so only chosen segments are regenerated.

---

## What it does

| Area | What Motion Director adds |
|---|---|
| **Standalone generation** | `T2V / I2V / FL2V / R2V / V2V / RV2V` |
| **Mixed Mode** | Choose `T2V / I2V / FL2V / R2V / Source Video` independently for each segment |
| **Selective Run** | Regenerate selected segments instead of rerunning the whole sequence |
| **Cross-segment continuity** | Motion Context, Context Frames, Latent Scale Lock, generated-audio continuation, Color Re-anchor |
| **Segment Result reuse** | Reuse a decoded frame from an earlier Mixed segment as a later I2V / FL2V input |
| **Source-video workflow** | Dedicated V2V / RV2V handling and Source Bridge for standalone source-video boundaries |
| **Assets** | Common References plus a persistent Material Library for images, audio, video, and prompts |
| **Sampling** | Built-in sampling or external ComfyUI `SAMPLER + SIGMAS` |
| **Post-processing** | Global Refine, upscale, optional NVIDIA RTX VSR / Deblur, Face Refine |
| **Preview & output** | Director Live Preview, Segment / Multi Segment / Final Result views, final video saving |
| **ComfyUI integration** | External `Director Inputs / Director Assets`, plus `images / audio / fps` outputs |

Motion Director is an `OUTPUT_NODE`, so it can run as the end of a workflow while still exposing its final frames, audio, and FPS to downstream ComfyUI nodes.

---

## Live Preview

Motion Director has its own live preview instead of relying only on the normal sampler preview. It can show the active generation stage while the workflow is running, including later post-processing stages.

<!-- IMAGE SLOT 2
Place your Live Preview GIF here:
docs/images/live-preview.gif
Recommended source: Video Project 1(1).gif
-->

![MiniMax H3 Motion Director — Live Preview](docs/images/live-preview.gif)

---

## Mixed Mode: different generation methods in one timeline

A normal H3 workflow usually treats every generation as an isolated clip. Mixed Mode treats the project as a timeline instead.

Example:

```text
S1  T2V
S2  I2V
S3  R2V
S4  Source Video
S5  T2V
```

Each segment has its own mode, prompt, duration or source range, and legal media inputs.

### Mixed segment modes

| Mixed segment mode | Runtime path | Main use |
|---|---|---|
| `T2V` | T2V | Text-driven shot |
| `I2V` | I2V | Start from an uploaded image or earlier Segment Result |
| `FL2V` | FL2V | Control first frame, last frame, or both |
| `R2V` | R2V | Identity / scene / motion / voice references |
| `Source Video` | V2V or RV2V | Use source motion, optionally with identity pictures |

`Source Video` intentionally stays one Mixed mode:

```text
Source Video + 0 Identity Pictures  -> V2V
Source Video + Identity Pictures    -> RV2V
```

The source clip is segment-local. `Start sec` and `End sec` define the source range; the selected range determines that segment's duration.

### Per-boundary continuity

Continuity can be requested directly between Mixed segment cards:

```text
[S1]  S1 -> S2  [S2]  S2 -> S3  [S3]
        visual          visual
        audio           audio
```

The node-level continuity settings remain the global masters. This makes it possible to continue some boundaries while deliberately resetting others.

### Segment Result

Mixed Mode can reuse a static decoded frame from an earlier generated segment:

```text
Earlier Segment -> last frame
Earlier Segment -> explicit frame index
```

Typical uses:

- earlier segment -> I2V start image
- earlier segment -> FL2V first frame
- earlier segment -> FL2V last frame

A Segment Result is a static frame reference; it is separate from Motion Context, so the two mechanisms can be used together where the mode allows it.

### Selective Run

Long projects rarely need every shot regenerated. Enable **Selective Run**, mark only the segments that need another pass, and keep the rest of the sequence intact when cached/source results are available.

This is one of the main reasons the Director exists: fixing Shot 3 should not automatically mean paying for Shots 1, 2, 4, and 5 again.

---

## Standalone H3 modes

The same Director also supports six standalone MiniMax H3 task modes.

| Mode | Main input | Typical use |
|---|---|---|
| `T2V` | Prompt | Text-driven multi-shot generation |
| `I2V` | Prompt + start image | Animate a character or scene image |
| `FL2V` | Prompt + first/last image | Explicit start/end visual control |
| `R2V` | Prompt + multimodal references | Character, style, motion, scene, voice, or object references |
| `V2V` | Source Video + Prompt | Regenerate visuals while keeping source motion/content structure |
| `RV2V` | Source Video + Prompt + references | Source motion plus identity / audio references |

For R2V, each Assets group can contain up to:

```text
Picture 1-9
Video 1-3
Audio 1-3
```

Standalone V2V / RV2V use the Director's dedicated source-video workflow. Source Bridge can rebuild a short generated transition around eligible source-video segment boundaries instead of treating the split as only a hard cut.

---

## Common References

Common References are project-level media that many standalone segments can share. They are useful for recurring characters, scenes, props, reference motion, and audio without adding the same material to every segment manually.

<!-- IMAGE SLOT 3
Place your Common References screenshot here:
docs/images/common-references.png
Recommended source: 螢幕擷取畫面 2026-08-19 040543(1).png
-->

![MiniMax H3 Motion Director — Common References](docs/images/common-references.png)

Segment-specific assets remain local to that segment/group. At execution time, common and local references are combined into the reference sequence used by the current task.

---

## Material Library

The persistent **Material Library** is for media you want to reuse across shots or later projects.

It can store:

- Images
- Audio
- Video
- Prompts

Images can be organized into categories such as characters, scenes, props, or other material. Search and allocation happen inside the Director UI instead of repeatedly browsing for the same files on disk.

<!-- IMAGE SLOT 4
Place your Material Library screenshot here:
docs/images/material-library.png
Recommended source: 螢幕擷取畫面 2026-08-19 035702(1).png
-->

![MiniMax H3 Motion Director — Material Library](docs/images/material-library.png)

In Mixed Mode, the Library targets the currently selected segment and only exposes media that are legal for that segment mode. The actual Mixed `Source Video` remains a local upload rather than a Material Library reference video.

---

## Post-processing

The Director can continue beyond first-pass generation instead of requiring a separate post-processing graph for every project.

<!-- IMAGE SLOT 5
Place your Postprocess screenshot here:
docs/images/postprocess.png
Recommended source: 螢幕擷取畫面 2026-08-19 034623(1).png
-->

![MiniMax H3 Motion Director — Postprocess](docs/images/postprocess.png)

### Global Refine

Global Refine can run a second sampling pass and optionally upscale the segment/result before refinement.

Available paths include, depending on the installed runtime and models:

- normal resize/upscale processing
- ComfyUI upscale models
- NVIDIA RTX Video Super Resolution
- NVIDIA RTX Deblur
- secondary H3 sampling/refinement

If Global Refine fails, the Director keeps the first-pass result instead of discarding the completed generation.

### Face Refine

Face Refine provides an integrated face-repair path with:

- face detection and tracking
- crop-based H3 regeneration
- adaptive refine strength
- mask / stitching controls
- color matching

If no usable face is detected or Face Refine fails, the assembled result is kept as the fallback.

---

## Results: Segment, Multi Segment, Final Result

Results are managed inside the Director rather than being reduced to one anonymous output batch.

<!-- IMAGE SLOT 6
Place your Results screenshot here:
docs/images/results-final.png
Recommended source: 螢幕擷取畫面 2026-08-19 035629(1).png
-->

![MiniMax H3 Motion Director — Final Result](docs/images/results-final.png)

The Results page has three levels:

- **Segment** — inspect one generated segment
- **Multi Segment** — preview/export a continuous segment range
- **Final Result** — inspect and save the complete pipeline result

The Final view also exposes video save options and a Director Report containing the actual run configuration, continuity state, sampling information, and post-processing status.

Public node outputs remain simple:

| Output | Type | Description |
|---|---|---|
| `images` | `IMAGE` list | Final generated video frames |
| `audio` | `AUDIO` list | Matching final audio |
| `fps` | `FLOAT` | Final frame rate |

---

## External Director Inputs / Assets

The Director is an all-in-one production interface, but it is not a closed box. Other ComfyUI nodes can still feed prompts and media into standalone modes through the external input architecture.

<!-- IMAGE SLOT 7
Place your external Inputs / Assets node screenshot here:
docs/images/external-inputs.png
Recommended source: 螢幕擷取畫面 2026-08-19 040419(1).png
-->

![MiniMax H3 Motion Director — External Inputs and Assets](docs/images/external-inputs.png)

```text
MiniMax H3 Motion Director Assets
        ↓
MiniMax H3 Motion Director Inputs
        ↓
MiniMax H3 Motion Director
```

The repository exposes three Director-related nodes:

| Node | Purpose |
|---|---|
| `MiniMax H3 Motion Director` | Main UI, execution, continuity, preview, post-processing, and results |
| `MiniMax H3 Motion Director Inputs` | Dynamic Prompt / image / Assets inputs |
| `MiniMax H3 Motion Director Assets` | Packages mode-specific media for an input group |

External input shapes by standalone mode:

```text
T2V   prompt_N
I2V   image_prompt_N + image_N
FL2V  fl_prompt_N + fl_assets_N
R2V   ref_prompt_N + ref_assets_N
RV2V  rv_prompt_N + rv_assets_N
V2V   Source Video is managed by Director
```

Mixed v1 uses its native Director timeline/media UI rather than the external group system.

---

## Sampling and performance

Motion Director can use either its internal sampler settings or an external ComfyUI sampling chain.

Connect both:

```text
SAMPLER
SIGMAS
```

and the Director uses external sampling. Otherwise it uses its internal sampler, scheduler, step count, Video Sigma Shift, and Audio Sigma Shift settings.

For longer jobs, **Clear VRAM Between Segments** can reduce memory pressure by releasing models/cache between segment runs. This trades some speed for lower VRAM usage and is intended as a stability option rather than a performance boost.

---

## Installation

### ComfyUI-Manager / Comfy Registry

Search for:

```text
MiniMax H3 Motion Director
```

### Manual install

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/j955229/ComfyUI-MiniMax-H3-Motion-Director.git
cd ComfyUI-MiniMax-H3-Motion-Director
python -m pip install -r requirements.txt
```

If you use a Windows portable build, run `pip` with the Python executable used by that ComfyUI installation.

Restart ComfyUI completely after installation. If an update changes frontend files, restart ComfyUI and hard-refresh the browser.

---

## Requirements / compatibility

Motion Director requires a **recent ComfyUI build with official MiniMax H3 support**, including the official MiniMax H3 conditioning nodes used by the current runtime.

Core Python dependencies are declared in the project package/requirements files. Some post-processing features have additional optional runtime/model requirements, for example:

- NVIDIA RTX VSR / Deblur requires the compatible NVIDIA VFX runtime/package and supported NVIDIA hardware
- Face Refine detector/SAM paths require the corresponding detector/model dependencies selected in the UI
- Upscale Model mode requires a compatible ComfyUI upscale model

If a feature is optional, the Director is designed to keep the usable earlier result when that post-processing stage cannot run.

> Do not load the standalone `ComfyUI-H3-Motion-Context` alongside this project. Motion Context compatibility is integrated into Motion Director.

---

## Mixed v1 notes

- Mixed v1 manages its media through the native Director UI instead of external `Director Inputs` groups.
- Mixed `Source Video` is local-upload only; Material Library videos are references, not the actual source-video input.
- Source Bridge is a standalone V2V / RV2V feature and is not used by Mixed v1.
- Segment Result references are backward-only: a later segment may reuse an earlier result, not a future result.
- Continuity improves cross-segment handoff but does not guarantee an invisible boundary in every generation; MiniMax H3 can still introduce visual, motion, lighting, or identity drift.

---

## Credits / upstream projects

Motion Director is intentionally an integrated project. It contains, modifies, or adapts code/algorithms from several existing ComfyUI H3 projects rather than pretending every component was invented independently.

- [AIMixer / ComfyUI_MiniMaxH3_Director](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director) — Apache-2.0
- [NikoDemon80 / ComfyUI-H3-Motion-Context](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context) — GPL-3.0
- [Carasibana / ComfyUI-H3-FaceRefine](https://github.com/Carasibana/ComfyUI-H3-FaceRefine) — MIT
- [Kijai / ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) — GPL-3.0; portions of packed-latent preview / TAEHV behavior were informed by its implementation

Thanks to the upstream authors and contributors.

See [`NOTICE`](NOTICE), [`LICENSE`](LICENSE), and [`LICENSES`](LICENSES) for the exact attribution and derivative-work details.

## License

This project is distributed as a whole under **GNU GPL v3.0**.
