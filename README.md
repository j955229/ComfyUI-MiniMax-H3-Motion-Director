# ComfyUI MiniMax H3 Motion Director

一个面向 **MiniMax H3 多段视频生产** 的 ComfyUI Director 节点。

把多段视频真正会用到的流程集中到一个导演台里：分段、Prompt、参考素材、跨段接续、选择重跑、后期处理、实时预览和最终导出。

支持：`T2V / I2V / FL2V / R2V / V2V / RV2V`。

# Credits / License

本项目整体以 **GNU GPL v3.0** 发布。详细第三方版权与派生说明见 [`NOTICE`](NOTICE) 和 [`LICENSES`](LICENSES)。

本项目包含并修改了以下项目的代码或算法：

- [AIMixer / ComfyUI_MiniMaxH3_Director](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director) — Apache-2.0
- [NikoDemon80 / ComfyUI-H3-Motion-Context](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context) — GPL-3.0
- [Carasibana / ComfyUI-H3-FaceRefine](https://github.com/Carasibana/ComfyUI-H3-FaceRefine) — MIT
- [Kijai / ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) — GPL-3.0，部分 packed-latent preview / TAEHV 行为参考其实现

感谢所有上游项目和贡献者。

## 为什么用 Director

普通的 H3 工作流很适合生成一个片段，但当项目变成 30 秒、1 分钟甚至更长时，很快会出现这些问题：

- 每一段都要有自己的 Prompt 和素材。
- 某几段失败时，不想整条视频全部重跑。
- 后一段需要继承前一段的运动、画面或音频状态。
- 同一个角色、场景、声音会在很多段里反复出现。
- R2V / RV2V 的参考素材数量多，节点图很容易失控。
- 生成后还要做放大、人脸精修、实时预览和最终保存。

Motion Director 的目标就是把这些工作放回一个统一的生产界面里，同时保留 ComfyUI 节点图的可组合性。

## 核心功能

- 六种 MiniMax H3 任务模式：`T2V / I2V / FL2V / R2V / V2V / RV2V`。
- 多段时间线，每段独立 Prompt、时长和模式对应素材。
- `选择运行`：只重跑选中的片段，不必整条重新生成。
- 跨段接续：Motion Context、Context Frames、Latent Scale Lock、Continue Generated Audio、Color Re-anchor。
- V2V / RV2V 支持 Source Bridge，用于源视频分段边界的过渡。
- 公共素材和长期素材库，减少重复上传。
- 统一的 `Director Inputs` / `Director Assets` 外接架构。
- 内置采样，也可以外接 ComfyUI `SAMPLER + SIGMAS`。
- Global Refine 和 Face Refine 后期处理。
- Director Live Preview，独立于 ComfyUI 默认 sampler preview。
- Results 页面提供 Segment / Multi / Final 三类结果查看与最终视频保存。
- 主节点本身是 `OUTPUT_NODE`，即使不连接下游节点也可以执行；同时仍输出 `images / audio / fps` 给其他 ComfyUI 节点继续处理。

---

## 快速开始

1. 放置 `MiniMax H3 Motion Director`。
2. 接入 MiniMax H3 `model`、`video_vae`、`audio_vae` 和 `clip`。
3. 打开 Director。
4. 在 Generation 页面选择任务模式。
5. 建立需要的片段或提示词组。
6. 为每段填写 Prompt，并加入当前模式需要的图片、音频或视频。
7. 需要连续镜头时，使用跨段接续功能。
8. 只想修部分片段时，开启 `选择运行` 并选择目标段。
9. Queue 工作流。
10. 在 Live Preview 和 Results 查看生成过程与最终结果。

`sampler`、`sigmas` 和 `director_inputs` 都是可选的外部扩展入口，不是最基础工作流的必接项。

---

# Generation：六种任务模式

同一个 Director 可以直接切换六种 MiniMax H3 视频任务，不需要为每种模式维护一套完全不同的导演界面。

<img width="1709" height="902" alt="螢幕擷取畫面 2026-08-16 014840" src="https://github.com/user-attachments/assets/89d1275a-fc5e-4d0e-aead-edfd82f8dae9" />
<img width="1717" height="894" alt="螢幕擷取畫面 2026-08-16 014848" src="https://github.com/user-attachments/assets/c5eea561-fc53-460c-b010-36abe8a7d60f" />
<img width="1718" height="913" alt="螢幕擷取畫面 2026-08-16 014855" src="https://github.com/user-attachments/assets/e3a12dc8-0b6d-4f0a-9a6a-5b3076cdc0ca" />
<img width="1712" height="917" alt="螢幕擷取畫面 2026-08-16 014903" src="https://github.com/user-attachments/assets/5553a223-41a8-49a8-a797-fb184bbe7b75" />
<img width="1719" height="900" alt="螢幕擷取畫面 2026-08-16 014910" src="https://github.com/user-attachments/assets/5b1f49db-09d3-42c3-952f-c056b01e6c74" />
<img width="1721" height="907" alt="螢幕擷取畫面 2026-08-16 014917" src="https://github.com/user-attachments/assets/a28ea179-d9a1-40ca-b30b-570dd2bec188" />

| 模式 | 主要输入 | 外接 Director Inputs | Director Assets | Source Video | 典型用途 |
|---|---|---|---|---|---|
| `T2V` | Prompt | `prompt_N` | 不需要 | 无 | 纯文字分镜、多段短片 |
| `I2V` | Prompt + 起始图片 | `image_prompt_N` + `image_N` | 不需要 | 无 | 从角色图或场景图开始生成 |
| `FL2V` | Prompt + 首帧/尾帧 | `fl_prompt_N` + `fl_assets_N` | `first_image / last_image` | 无 | 控制镜头起点和终点 |
| `R2V` | Prompt + 多模态参考 | `ref_prompt_N` + `ref_assets_N` | 9 图片 / 3 视频 / 3 音频 | 无 | 角色、声音、动作或风格参考 |
| `V2V` | Source Video + Prompt | 当前由 Director 管理 | 不需要 | Director 内上传 | 视频重绘、动作/内容转换 |
| `RV2V` | Source Video + Prompt + 参考图片/音频 | `rv_prompt_N` + `rv_assets_N` | 9 图片 / 3 音频 | Director 内上传 | 源视频动作 + 身份/声音参考 |

## T2V

每一段主要由 Prompt 驱动。适合先把剧本拆成多个镜头，再用 Motion Context 让后一段延续前一段。

## I2V

每个提示词组可以提供自己的起始图片。外接时，图片直接进入 `MiniMax H3 Motion Director Inputs` 的 `image_N`，不需要经过 Assets 节点。

## FL2V

每组可以使用首帧、尾帧或首尾两张图片。外接时使用 `MiniMax H3 Motion Director Assets`，该模式只暴露：

```text
first_image
last_image
```

Director 仍然负责组数、Prompt 和时间线。

## R2V

R2V 是参考素材最完整的模式。每组 Assets 最多可接：

```text
Picture 1-9
Video 1-3
Audio 1-3
```

适合角色身份、服装、场景、音色、动作参考等需要同时存在的镜头。

## V2V

V2V 的 Source Video 在 Director 内管理。支持全局模式、分段模式、手动分割和智能分割，并可在分段边界使用 Source Bridge。

## RV2V

RV2V 以 Source Video 为主要运动/内容来源，同时可以加入参考图片和参考音频。

当前 `Director Assets` 在 RV2V 下暴露 9 个图片槽和 3 个音频槽；Source Video 仍由 Director 自己管理，不会被 Assets 中的视频替代。

---

# 素材系统

![Common Assets and Material Library](docs/images/asset-system.webp)

## 公共素材

当同一个角色、场景或声音需要跨多个片段反复出现时，可以把它放进公共素材，而不是在每段重复添加。

以 R2V 为例：

```text
公共素材：角色 A、角色 B

片段 1：道具 X
片段 2：道具 Y
片段 3：无额外素材
```

执行时，每段都会得到公共素材，再叠加自己的本段素材，并重新整理为连续的官方参考编号。

公共素材适合“这一整个镜头链都应该认识”的参考，本段素材适合“只在当前片段出现”的参考。

## 素材库

素材库是独立于当前片段编辑区的长期素材管理界面，可以保存并重复使用：

- 图片
- 音频
- 视频
- Prompt

图片默认可以按人物、场景、道具、其他等分类管理。素材库可以把素材分配给当前任务和目标片段，不需要每次重新从磁盘寻找文件。

素材库会根据当前任务模式限制可用素材类型，例如 RV2V 不会把素材库视频当成 Source Video。

---

# 外接 Director Inputs / Assets

如果希望把其他 ComfyUI 节点产生的图片、音频或视频直接送进 Director，可以使用统一外接架构：

```text
MiniMax H3 Motion Director Assets
        ↓
MiniMax H3 Motion Director Inputs
        ↓
MiniMax H3 Motion Director
```

![External Director Inputs and Assets](docs/images/external-inputs.webp)

仓库只公开三个 Director 相关节点：

| 节点 | 作用 |
|---|---|
| `MiniMax H3 Motion Director` | 主导演台、执行、预览、后期和结果管理 |
| `MiniMax H3 Motion Director Inputs` | 动态 Prompt / 图片 / Assets 入口 |
| `MiniMax H3 Motion Director Assets` | 为当前组打包模式对应的媒体素材 |

Director 决定当前任务模式和组数，Inputs 会跟着改变插槽。你不需要手动维护六套不同的输入节点。

### 各模式的外接形态

```text
T2V   prompt_N
I2V   image_prompt_N + image_N
FL2V  fl_prompt_N + fl_assets_N
R2V   ref_prompt_N + ref_assets_N
RV2V  rv_prompt_N + rv_assets_N
V2V   Source Video 由 Director 管理
```

同一组的媒体来源在 Director 内部上传和外接 Inputs/Assets 之间采用互斥；Prompt 来源单独处理，因此可以只外接媒体，也可以只外接 Prompt。

---

# 主节点控制

主节点保持紧凑，只留下四个实际会经常使用的区域。

## 采样设置

- 种子
- 生成后定制
- 采样步数
- 内置采样器
- 调度器
- 视频 Sigma Shift
- 音频 Sigma Shift

状态会显示 `内部`、`外部` 或 `连接不完整`。

当 `sampler + sigmas` 两个外部接口都正确连接时，Director 使用外部采样；否则使用节点内部采样设置。

## 跨段接续

- 运动上下文
- 上下文帧数
- 潜变量尺度锁定
- 延续生成音频
- 颜色重锚定
- Source Bridge（适用模式）

这些功能负责“下一段怎样知道上一段发生了什么”，而不是要求用户手工把上一段重新塞回模型。

## 后期处理

- 全局精修
- 人脸精修

这里只显示开关和摘要；完整参数放在 Director 的 Post Processing 页面。

## 性能

- 段间清理显存

用于长任务和多段任务之间的显存管理。

---

# Post Processing / Live Preview / Results

<img width="1713" height="893" alt="螢幕擷取畫面 2026-08-16 015003" src="https://github.com/user-attachments/assets/44c38e64-6efb-4bef-a348-40184af44eaf" />
<img width="1723" height="894" alt="螢幕擷取畫面 2026-08-16 015012" src="https://github.com/user-attachments/assets/519b44c7-c1d6-4607-bed2-ef38e530f6b8" />
<img width="1734" height="889" alt="螢幕擷取畫面 2026-08-16 015021" src="https://github.com/user-attachments/assets/631a6278-c490-4ada-9a7c-b43e97934edb" />

## Post Processing

Post Processing 页面采用左右布局：

### Global Refine

用于整段画面的二次采样和放大，可配置二次采样、放大方式、目标尺寸和相关 refine 参数。

### Face Refine

用于人脸检测、跟踪、裁切、局部去噪和回贴。适合主体面部在 H3 原始输出里不稳定、尺寸较小或需要额外修复的场景。

两套后处理都可以独立开关，不需要为了使用其中一个而开启另一个。

## Live Preview

Live Preview 不使用 ComfyUI 默认 sampler preview 作为最终预览界面，而是由 Director 自己显示当前运行阶段。

页面分为：

```text
一般
放大
脸部精修
```

可以控制预览帧数、预览帧率、最大分辨率、JPEG 质量和预览间隔等参数。

生成过程中当前 Stage / Step 会持续更新；已经完成的上一个阶段保留静态快照，方便判断生成、Global Refine 和 Face Refine 分别发生了什么变化。

## Results

Results 页面分为：

```text
分段
多段
最终结果
```

最终结果区可以配置自动保存、保存路径、文件名前缀、格式、编码器和编码模式。Results 的播放器与 Live Preview 独立，不需要依赖节点图上的额外 Video Combine 才能查看 Director 结果。

---

# 对外输出

当前公开输出保持简单：

| 输出 | 类型 | 说明 |
|---|---|---|
| `images` | `IMAGE` list | 生成后的最终视频帧 |
| `audio` | `AUDIO` list | 对应最终音频 |
| `fps` | `FLOAT` | 最终帧率 |

`MiniMax H3 Motion Director` 同时是 `OUTPUT_NODE`：

- 单独放在工作流里，不连接右侧输出，也能作为最终执行节点运行。
- 如果你需要自己的 ComfyUI 后处理链，也可以继续把 `images / audio / fps` 接给其他节点

---

# 多段连续性

最简单的理解方式是：

```text
S1 → S2 → S3 → S4
```

普通的独立生成会把四段当成四次互不认识的任务；Director 的连续性系统则允许指定后一段继承上一段的上下文。

### Motion Context

主要用于生成类任务的跨段运动和画面上下文。`Context Frames` 决定带入多少上一段尾部信息。

### Latent Scale Lock

用于减少跨段潜变量尺度变化带来的不稳定。

### Continue Generated Audio

让多段生成音频具备连续链，而不是每段都完全从零开始处理音频上下文。

### Color Re-anchor

用于抑制长镜头链中的颜色和整体观感漂移。

### Source Bridge

V2V / RV2V 的核心问题与纯生成模式不同：它们还有 Source Video 自己的运动边界。Source Bridge 用于在源视频被拆成多段后，对段间源动作重新建立过渡。

这些功能可以按项目需要选择，并不是要求所有任务全部开启。

---

# 推荐使用方式

### 文生多镜头短片

`T2V` + 多段 Prompt + Motion Context。适合先把剧本拆镜头，再只重跑失败片段。

### 角色图片开始的连续镜头

`I2V` + 起始图 + Motion Context。适合角色图、二次元立绘、场景概念图等起始条件。

### 明确控制镜头起点与终点

`FL2V` + first/last image。适合需要指定镜头首尾状态的过渡段。

### 角色 / 声音 / 多素材短剧

`R2V` + 公共素材 + 本段素材 + 素材库。适合多人、角色身份、声音和道具需要反复复用的项目。

### 原视频动作重绘

`V2V` + 分段模式 + Source Bridge。适合保留原始动作或时序，同时重新生成画面。

### 原视频 + 角色身份参考

`RV2V` + Source Video + 参考图片 / 音频。适合以原视频动作作为基础，再替换或强化主体身份和声音参考。

---

## 安装

进入 ComfyUI 的 `custom_nodes`：

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/j955229/ComfyUI-MiniMax-H3-Motion-Director.git
cd ComfyUI-MiniMax-H3-Motion-Director
python -m pip install -r requirements.txt
```

如果你使用 Windows 便携版，请把上面的 `python` 换成该 ComfyUI 实际使用的内置 Python 可执行文件。

然后完整重启 ComfyUI。

### 更新

```bash
cd ComfyUI/custom_nodes/ComfyUI-MiniMax-H3-Motion-Director
git pull
```

更新包含前端文件时，建议重启 ComfyUI 后再对浏览器执行一次强制刷新。

### 依赖

`requirements.txt` 当前包含：

- `opencv-python-headless`：V2V / 时间线源视频解码。
- `imageio-ffmpeg`：V2V / RV2V 源音频提取。
- `scenedetect`：智能分割。

> 不建议同时加载独立版 `ComfyUI-H3-Motion-Context`。本项目已经集成并修改了相关 H3 runtime patch，同时加载两套实现可能发生冲突。

---

# 使用注意

- `sampler` 和 `sigmas` 应成对外接；只接其中一个时，主节点会显示连接不完整。
- `Director Inputs` 是可选扩展接口，不接时可以完全使用 Director 内部 UI。
- FL2V 的 Assets 只提供首帧和尾帧；不要把 R2V 的 9/3/3 素材结构套到 FL2V。
- RV2V 的 Assets 不提供 Reference Video；Source Video 由 Director 管理。
- 同组媒体的内部来源与外部来源不要同时使用。
- 多段、后期处理和高分辨率任务会显著增加显存和内存压力；必要时启用段间清理显存。
- 更新前端代码后如果界面仍显示旧版本，请完整重启 ComfyUI 并强制刷新浏览器缓存。
- 不建议与独立版 `ComfyUI-H3-Motion-Context` 同时加载。

---
