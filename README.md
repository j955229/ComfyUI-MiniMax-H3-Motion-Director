# ComfyUI MiniMax H3 Motion Director

[English](README.md) | [简体中文](README_zh.md)

A ComfyUI Director node built for **multi-segment MiniMax H3 video production**.

It brings the parts that matter in real multi-shot production into one Director: segmentation, prompts, reference assets, cross-segment continuity, selective reruns, post-processing, live preview, and final export.

Supported modes: `T2V / I2V / FL2V / R2V / V2V / RV2V`.

![MiniMax H3 Motion Director](docs/images/director-node.webp)

# Credits / License

This project is distributed as a whole under **GNU GPL v3.0**. See [`NOTICE`](NOTICE), [`LICENSE`](LICENSE), and [`LICENSES`](LICENSES) for third-party attribution and derivative-work details.

This project contains or modifies code / algorithms from:

- [AIMixer / ComfyUI_MiniMaxH3_Director](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director) — Apache-2.0
- [NikoDemon80 / ComfyUI-H3-Motion-Context](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context) — GPL-3.0
- [Carasibana / ComfyUI-H3-FaceRefine](https://github.com/Carasibana/ComfyUI-H3-FaceRefine) — MIT
- [Kijai / ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) — GPL-3.0; portions of packed-latent preview / TAEHV behavior were informed by its implementation.

Thanks to all upstream projects and contributors.


## Why use Director?

A normal H3 workflow is great for generating a single clip. Once a project grows to 30 seconds, one minute, or longer, the workflow quickly becomes harder to manage:

- Every segment needs its own Prompt and assets.
- If only a few segments fail, you should not have to regenerate the whole video.
- A later segment may need to inherit motion, image state, or generated audio from the previous segment.
- The same character, scene, prop, or voice may appear across many segments.
- R2V / RV2V can involve many reference assets and quickly turn the node graph into a wiring problem.
- After generation you may still need upscaling, face refinement, live preview, and final encoding.

Motion Director puts those jobs back into one production interface while keeping ComfyUI's node graph composable.

## Core features

- Six MiniMax H3 task modes: `T2V / I2V / FL2V / R2V / V2V / RV2V`.
- Multi-segment timeline with an independent Prompt, duration, mode, and assets for each segment.
- **Selective Run**: rerun only selected segments instead of regenerating the entire sequence.
- Cross-segment continuity: Motion Context, Context Frames, Latent Scale Lock, Continue Generated Audio, and Color Re-anchor.
- Source Bridge for V2V / RV2V source-video boundaries.
- Common Assets and a persistent Material Library to reduce repeated uploads.
- Unified external `Director Inputs` / `Director Assets` architecture.
- Built-in sampling or external ComfyUI `SAMPLER + SIGMAS`.
- Global Refine and Face Refine post-processing.
- Director Live Preview, independent of ComfyUI's default sampler preview.
- Results page with Segment / Multi / Final views and final video saving.
- The main node is an `OUTPUT_NODE`, so it can execute without a downstream node while still exposing `images / audio / fps` for additional ComfyUI processing.

---

## Quick start

1. Add `MiniMax H3 Motion Director` to the workflow.
2. Connect the MiniMax H3 `model`, `video_vae`, `audio_vae`, and `clip`.
3. Open Director.
4. Choose the task mode on the Generation page.
5. Create the required segments or prompt groups.
6. Fill in each Prompt and add the images, audio, or video required by the selected mode.
7. Enable continuity features when later segments should continue from earlier ones.
8. Use **Selective Run** when only some segments need to be regenerated.
9. Queue the workflow.
10. Watch progress in Live Preview and inspect the outputs in Results.

---

# Generation: six task modes

The same Director can switch between all six MiniMax H3 video tasks.

<img width="1709" height="902" alt="T2V generation mode" src="https://github.com/user-attachments/assets/89d1275a-fc5e-4d0e-aead-edfd82f8dae9" />
<img width="1717" height="894" alt="I2V generation mode" src="https://github.com/user-attachments/assets/c5eea561-fc53-460c-b010-36abe8a7d60f" />
<img width="1718" height="913" alt="FL2V generation mode" src="https://github.com/user-attachments/assets/e3a12dc8-0b6d-4f0a-9a6a-5b3076cdc0ca" />
<img width="1712" height="917" alt="R2V generation mode" src="https://github.com/user-attachments/assets/5553a223-41a8-49a8-a797-fb184bbe7b75" />
<img width="1719" height="900" alt="V2V generation mode" src="https://github.com/user-attachments/assets/5b1f49db-09d3-42c3-952f-c056b01e6c74" />
<img width="1721" height="907" alt="RV2V generation mode" src="https://github.com/user-attachments/assets/a28ea179-d9a1-40ca-b30b-570dd2bec188" />

| Mode | Main input | External Director Inputs | Director Assets | Source Video | Typical use |
|---|---|---|---|---|---|
| `T2V` | Prompt | `prompt_N` | Not required | None | Text-driven storyboards and multi-shot clips |
| `I2V` | Prompt + start image | `image_prompt_N` + `image_N` | Not required | None | Generate from a character or scene image |
| `FL2V` | Prompt + first/last image | `fl_prompt_N` + `fl_assets_N` | `first_image / last_image` | None | Control the start and end state of a shot |
| `R2V` | Prompt + multimodal references | `ref_prompt_N` + `ref_assets_N` | 9 images / 3 videos / 3 audios | None | Character, voice, motion, object, and style references |
| `V2V` | Source Video + Prompt | Managed by Director | Not required | Uploaded in Director | Video redraw / transformation while keeping source motion |
| `RV2V` | Source Video + Prompt + image/audio references | `rv_prompt_N` + `rv_assets_N` | 9 images / 3 audios | Uploaded in Director | Source motion plus identity / voice references |

## T2V

Each segment is primarily driven by its Prompt. It works well for splitting a script into several shots and using Motion Context to continue from one segment to the next.

## I2V

Each prompt group can provide its own starting image.

## FL2V

Each group can use a first frame, a last frame, or both.

## R2V

R2V exposes the most complete reference-asset structure. Each Assets group can contain up to:

```text
Picture 1-9
Video 1-3
Audio 1-3
```

This is useful when character identity, clothing, scene references, voice, motion, and other references need to exist in the same shot.

## V2V

The Source Video is managed inside Director. It supports global mode, segmented mode, manual splitting, smart scene splitting, and Source Bridge at segment boundaries.

## RV2V

RV2V uses Source Video as the primary motion/content source while allowing additional reference images and audio.

In RV2V, `Director Assets` currently exposes 9 image slots and 3 audio slots. Source Video remains managed by Director and is not replaced by an Assets video input.

---

# Asset system

![Common Assets and Material Library](docs/images/asset-system.webp)

## Common Assets

When the same character, scene, prop, or voice needs to appear across many segments, it can be placed in Common Assets instead of being added repeatedly.

Example for R2V:

```text
Common Assets: Character A, Character B

Segment 1: Prop X
Segment 2: Prop Y
Segment 3: No additional asset
```

At execution time, every segment receives the Common Assets plus its own segment-specific assets, and the references are renumbered into a continuous official reference sequence.

Common Assets are intended for references that the whole shot chain should know. Segment assets are intended for references that only matter in the current segment.

## Material Library

The Material Library is a persistent asset-management interface separate from the current segment editor. It can store and reuse:

- Images
- Audio
- Video
- Prompts

Images can be categorized as characters, scenes, props, or other material. Library items can be assigned to the current task and target segment without repeatedly browsing for the same files on disk.

---

# External Director Inputs / Assets

Other ComfyUI nodes can feed generated images, audio, or video directly into Director through the unified external input architecture:

```text
MiniMax H3 Motion Director Assets
        ↓
MiniMax H3 Motion Director Inputs
        ↓
MiniMax H3 Motion Director
```

![External Director Inputs and Assets](docs/images/external-inputs.webp)

The repository exposes only three Director-related nodes:

| Node | Purpose |
|---|---|
| `MiniMax H3 Motion Director` | Main production UI, execution, preview, post-processing, and result management |
| `MiniMax H3 Motion Director Inputs` | Dynamic Prompt / image / Assets inputs |
| `MiniMax H3 Motion Director Assets` | Packages mode-specific media for the current group |

Director decides the active task mode and group count, and Inputs changes its sockets accordingly. You do not need to maintain six separate input-node variants manually.

### External input shapes by mode

```text
T2V   prompt_N
I2V   image_prompt_N + image_N
FL2V  fl_prompt_N + fl_assets_N
R2V   ref_prompt_N + ref_assets_N
RV2V  rv_prompt_N + rv_assets_N
V2V   Source Video is managed by Director
```

For a given group, internally uploaded media and externally connected media are mutually exclusive. Prompt sourcing is handled separately, so you can externalize media only, Prompt only, or both.

---

# Main node controls

The main node stays compact and exposes four areas that are used frequently.

## Sampling

- Seed
- Control after generate
- Steps
- Built-in sampler
- Scheduler
- Video Sigma Shift
- Audio Sigma Shift

The node reports sampling state as internal, external, or incomplete.

When both external `sampler + sigmas` are connected correctly, Director uses external sampling. Otherwise it falls back to its internal sampling settings.

## Cross-segment continuity

- Motion Context
- Context Frames
- Latent Scale Lock
- Continue Generated Audio
- Color Re-anchor
- Source Bridge, where applicable

These controls define how a later segment can inherit state from the previous segment.

## Post-processing

- Global Refine
- Face Refine

The main node shows the switches and summaries. Full parameters live on Director's Post Processing page.

## Performance

- Clear VRAM between segments

This is intended for long or multi-segment jobs where memory pressure needs to be reduced between segments.

---

# Post Processing / Live Preview / Results

<img width="1713" height="893" alt="Post Processing" src="https://github.com/user-attachments/assets/44c38e64-6efb-4bef-a348-40184af44eaf" />
<img width="1723" height="894" alt="Live Preview" src="https://github.com/user-attachments/assets/519b44c7-c1d6-4607-bed2-ef38e530f6b8" />
<img width="1734" height="889" alt="Results" src="https://github.com/user-attachments/assets/631a6278-c490-4ada-9a7c-b43e97934edb" />

## Post Processing

Post Processing uses a side-by-side layout.

### Global Refine

Runs a second sampling/upscaling pass over the full segment. It can configure secondary sampling, scaling method, target size, and related refine parameters.

### Face Refine

Handles face detection, tracking, cropping, local denoising, and compositing. It is useful when faces in the original H3 output are unstable, too small, or need an additional local repair pass.

Global Refine and Face Refine can be enabled independently.

## Live Preview

Live Preview does not use ComfyUI's default sampler preview as the final preview interface. Director displays the active generation stage itself.

The page is divided into:

```text
General
Upscale
Face Refine
```

Preview frame count, preview FPS, maximum resolution, JPEG quality, and preview interval can be configured.

During generation, the current Stage / Step is updated continuously. The completed previous stage remains as a static snapshot so you can compare generation, Global Refine, and Face Refine results.

## Results

Results is divided into:

```text
Segment
Multi
Final
```

The Final section can configure auto-save, output path, filename prefix, format, encoder, and encoding mode.

---

# Outputs

The public outputs are intentionally simple:

| Output | Type | Description |
|---|---|---|
| `images` | `IMAGE` list | Final generated video frames |
| `audio` | `AUDIO` list | Matching final audio |
| `fps` | `FLOAT` | Final frame rate |

`MiniMax H3 Motion Director` is also an `OUTPUT_NODE`:

- It can run as the final workflow node even when nothing is connected to its right-side outputs.
- If you want your own ComfyUI post-processing chain, continue wiring `images / audio / fps` into other nodes.

---

# Multi-segment continuity

The simplest model is:

```text
S1 → S2 → S3 → S4
```

Independent generation treats the four segments as unrelated tasks. Director's continuity system lets later segments inherit context from earlier ones.

### Motion Context

Carries motion and visual context across generated segments. `Context Frames` controls how much of the previous segment's tail is brought into the next generation.

### Latent Scale Lock

Reduces instability caused by latent-scale changes between segments.

### Continue Generated Audio

Maintains a generated-audio continuity chain so each segment does not restart its audio context from zero.

### Color Re-anchor

Helps suppress color and overall visual drift across long segment chains.

### Source Bridge

V2V / RV2V also has to deal with the movement boundaries of the Source Video itself. Source Bridge rebuilds a transition across source-video segment boundaries after the source has been split.

These controls are optional and can be enabled according to the needs of each project.

---

# Recommended workflows

### Text-driven multi-shot video

`T2V` + multiple segment Prompts + Motion Context. Split a script into shots and rerun only the failed segments.

### Continuous shots starting from character artwork

`I2V` + start image + Motion Context. Useful for character art, anime illustrations, or scene concept images.

### Explicit start/end control

`FL2V` + first/last image. Useful for transitions that need a defined visual state at both ends.

### Character / voice / multi-reference short-form production

`R2V` + Common Assets + segment assets + Material Library. Useful for projects that repeatedly reuse people, identity references, voices, and props.

### Redrawing motion from an existing video

`V2V` + segmented mode + Source Bridge. Useful when the original motion/timing should be preserved while regenerating the visuals.

### Existing video + character identity reference

`RV2V` + Source Video + reference images / audio. Useful when the original motion should drive the video while identity and voice references are added or replaced.

---

# Installation

Open ComfyUI's `custom_nodes` directory:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/j955229/ComfyUI-MiniMax-H3-Motion-Director.git
cd ComfyUI-MiniMax-H3-Motion-Director
python -m pip install -r requirements.txt
```

If you use the Windows portable build, replace `python` with the Python executable actually used by that ComfyUI installation.

Restart ComfyUI completely after installation.

### Update

```bash
cd ComfyUI/custom_nodes/ComfyUI-MiniMax-H3-Motion-Director
git pull
```

When an update contains frontend files, restart ComfyUI and hard-refresh the browser.

### Dependencies

`requirements.txt` currently includes:

- `opencv-python-headless` — V2V / source-video timeline decoding.
- `imageio-ffmpeg` — V2V / RV2V source-audio extraction.
- `scenedetect` — smart scene splitting.

> Do not load the standalone `ComfyUI-H3-Motion-Context` at the same time. This project integrates and modifies the relevant H3 runtime patch, and loading both implementations can cause conflicts.

---

# Usage notes

- External `sampler` and `sigmas` should be connected as a pair. Connecting only one is treated as an incomplete external sampling setup.
- `Director Inputs` is optional. Without it, the entire workflow can be managed through Director's internal UI.
- FL2V Assets exposes only first and last images. Do not apply the R2V 9/3/3 asset layout to FL2V.
- RV2V Assets does not expose Reference Video. Source Video is managed by Director.
- Do not use internal and external media sources for the same group at the same time.
- Multi-segment generation, post-processing, and high-resolution jobs can significantly increase VRAM and system-memory pressure. Enable VRAM clearing between segments when needed.
- If the interface still shows an older frontend after an update, restart ComfyUI completely and hard-refresh the browser cache.
- Do not load the standalone `ComfyUI-H3-Motion-Context` alongside this project.

