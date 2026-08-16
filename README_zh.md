# ComfyUI MiniMax H3 Motion Director

[English](README.md) | [简体中文](README_zh.md)

**当前版本：v1.1.0**

一个面向 **MiniMax H3 多段视频生产** 的 ComfyUI Director 节点。

把分段、Prompt、参考素材、跨段接续、选择重跑、后期处理、实时预览、结果检查和最终导出集中到一个导演台里。

独立模式：`T2V / I2V / FL2V / R2V / V2V / RV2V`  
Mixed 元模式：每个片段可独立选择 `T2V / I2V / FL2V / R2V / Source Video`。

![MiniMax H3 Motion Director](docs/images/director-node.webp)

## v1.1.0 — Mixed Mode

v1.1.0 新增原生 **Mixed** 时间线。现在同一个项目可以按片段混合不同生成方式，不再要求整个 Director 时间线只能使用一种任务类型。

例如：

```text
S1  T2V
S2  Source Video + Identity  -> 运行时 RV2V
S3  I2V + Segment Result
S4  FL2V
S5  R2V
```

Mixed 是 Director 的原生模式，拥有独立的 Mixed 时间线状态和本段素材，同时继续共用 Director 的输出参数、跨段接续、素材库、预览、后期处理和 Results。

<img width="1717" height="919" alt="螢幕擷取畫面 2026-08-17 060144" src="https://github.com/user-attachments/assets/9a78c6f6-e5af-4530-b702-db7c31f3024a" />

### Mixed 支持的片段模式

| Mixed 片段模式 | 主要输入 | 运行路径 | 说明 |
|---|---|---|---|
| `T2V` | Prompt | T2V | 普通文生视频 |
| `I2V` | 起始图 + Prompt | I2V | 起始图可以上传，也可以引用前面片段的 Segment Result |
| `FL2V` | 首帧/尾帧 + Prompt | FL2V | 首尾帧按槽位控制；适用槽位可引用 Segment Result |
| `R2V` | Prompt + 参考媒体 | R2V | 人物、场景、声音、动作等参考 |
| `Source Video` | Source Video + Prompt | V2V 或 RV2V | 无 Identity Pictures -> V2V；有 Identity Pictures -> RV2V |

### Mixed 的 Source Video

Mixed 不单独提供 V2V / RV2V 两个片段按钮，而是统一成 `Source Video`：

```text
Source Video + 0 张 Identity Pictures  -> V2V
Source Video + Identity Pictures       -> RV2V
```

真正的 Source Video 是**当前片段本地上传**，不会从素材库拿一支 Reference Video 冒充 Source Video。

`Start sec` 和 `End sec` 决定实际取用的 Source Range。**Source Range 本身决定该 Source Video 片段的时长**，Mixed 不会为了匹配另一个秒数去任意拉伸源视频。

<img width="1699" height="902" alt="螢幕擷取畫面 2026-08-17 060155" src="https://github.com/user-attachments/assets/767a9ca0-919c-4fbd-a3c7-dd34bb7d7478" />

<img width="1694" height="922" alt="螢幕擷取畫面 2026-08-17 060214" src="https://github.com/user-attachments/assets/38ce577a-20e7-48b4-9b80-cd20a4b79446" />
<img width="1724" height="924" alt="螢幕擷取畫面 2026-08-17 060204" src="https://github.com/user-attachments/assets/f32c928e-b519-4600-a809-36df60147c53" />


### Segment Result

Mixed 可以把前面已经生成完成的片段解码成一张静态帧，再给后面的片段使用。

支持：

```text
前面片段 -> 最后一帧
前面片段 -> 指定帧编号
```

典型用途：

- I2V：把前面片段的结果作为当前 Start Frame。
- FL2V：把前面片段的结果作为 First Frame 或 Last Frame。
- 只能引用时间线上更早的片段。

Segment Result 是**静态解码帧**，不是 Motion Context。因此在模式允许时，可以同时使用 Segment Result 帧和跨段 Motion Context。

### 片段边界连续性

Mixed 的连续性直接放在两个片段卡片之间：

```text
[S1]  S1->S2  [S2]  S2->S3  [S3]
       画面           画面
       声音           声音
```

边界按钮只负责“这一条 link 是否请求继承”。主节点外部仍保留全局总开关和参数：

- 运动上下文
- 上下文帧数
- 潜变量尺度锁定
- 延续生成音频
- 颜色重锚定

因此实际 Visual Context = **主节点 Motion Context 总开关 AND 当前边界画面请求**。Audio Context 也是同样的总开关 + 边界请求逻辑。

如果当前模式存在明确的重置条件，REPORT 会说明。例如：I2V 使用一张独立上传的 Start Frame 时，会重置视觉上下文，因此可以出现 `Visual requested: ON` 但 `Visual actual: OFF`，并给出原因，而不是静默失败。

### Mixed 输出参数与素材库

Mixed 的所有片段共用同一最终画布，顶部使用正常生成模式的输出方式：

```text
画幅比例 + 百万像素 + FPS
```

素材库只有顶部一个全局入口，作用于当前选中的 Mixed 片段，并按当前片段模式限制可使用的素材类型。真正的 Source Video 仍然只能在对应片段里上传。

### Mixed Results

Results 页面包括：

- `分段`：查看单一片段。
- `多段`：选择连续区间，例如 `1-2`、`1-3`、`2-4`、`3-4`，预览和导出都只处理该区间。
- `最终结果`：完整成片与编码/保存设置。

https://github.com/user-attachments/assets/a7a510f0-3214-48ec-bb4e-e6bdeea1a955

https://github.com/user-attachments/assets/5fe0ee9c-2822-462c-8a50-63adfb008e8a

https://github.com/user-attachments/assets/a9b1e6b1-7f59-4147-ac38-985fe3810659

<img width="1536" height="2730" alt="mat_9627ae4460244d498e13f870c9176b9a" src="https://github.com/user-attachments/assets/59939a5d-db6a-4f96-96b6-f3fcb77c1847" />
<img width="1024" height="1536" alt="mat_041ae9cc9fa543bb8fe8c0361422cdd1" src="https://github.com/user-attachments/assets/bfadb96d-cba7-4686-a095-158fe5795eaa" />
<img width="700" height="1050" alt="mat_6ab2eb041f5946da800d90fd12eb7763" src="https://github.com/user-attachments/assets/43f60d5f-ff03-4f11-9ec1-697095f79463" />

https://github.com/user-attachments/assets/e1807779-822c-4338-bffb-026ddc5c192d

### Mixed v1 当前限制

- Mixed v1 不使用外接 `Director Inputs` 组系统；Mixed 素材由原生 Director UI 管理。
- Mixed v1 不使用 Source Bridge。
- Source Video 本身不能从素材库提供。
- 任意 Segment Result 引用只允许向前引用更早的片段。

---

# Credits / License

本项目整体以 **GNU GPL v3.0** 发布。详细第三方版权与派生说明见 [`NOTICE`](NOTICE)、[`LICENSE`](LICENSE) 和 [`LICENSES`](LICENSES)。

本项目包含并修改了以下项目的代码或算法：

- [AIMixer / ComfyUI_MiniMaxH3_Director](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director) — Apache-2.0
- [NikoDemon80 / ComfyUI-H3-Motion-Context](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context) — GPL-3.0
- [Carasibana / ComfyUI-H3-FaceRefine](https://github.com/Carasibana/ComfyUI-H3-FaceRefine) — MIT
- [Kijai / ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) — GPL-3.0，部分 packed-latent preview / TAEHV 行为参考其实现

感谢所有上游项目和贡献者。

## 为什么用 Director

普通 H3 工作流很适合生成一个片段，但项目变成 30 秒、1 分钟甚至更长时，很快会遇到：

- 每一段都有自己的 Prompt 和素材。
- 某几段失败时，不想整条全部重跑。
- 后一段可能需要继承前一段的运动、画面或生成音频状态。
- 同一个人物、场景、声音会跨多段重复出现。
- R2V / RV2V 的参考素材很多，节点图容易失控。
- 生成后还要继续做人脸精修、放大、预览和最终编码。

Motion Director 把这些工作放回一个统一生产界面，同时保留 ComfyUI 节点图的可组合性。

## 核心功能

- 六种独立 MiniMax H3 模式：`T2V / I2V / FL2V / R2V / V2V / RV2V`。
- 原生 `Mixed` 元模式，每段可选 `T2V / I2V / FL2V / R2V / Source Video`。
- 多段时间线，每段有独立 Prompt、模式、时长/Source Range 和素材。
- `选择运行`：只重跑选中的片段。
- 跨段 Motion Context 与生成音频连续性。
- Mixed 支持 Segment Result 静态帧复用。
- 独立 V2V / RV2V 支持 Source Bridge。
- 公共素材与长期素材库。
- 独立模式可使用统一 `Director Inputs` / `Director Assets` 外接架构。
- 内置采样，也可外接 ComfyUI `SAMPLER + SIGMAS`。
- Global Refine 与 Face Refine。
- Director Live Preview。
- Results 支持单段 / 多段区间 / 最终结果。
- 主节点本身是 `OUTPUT_NODE`，同时输出 `images / audio / fps` 给其他节点继续处理。

---

## 快速开始

1. 放置 `MiniMax H3 Motion Director`。
2. 接入 MiniMax H3 `model`、`video_vae`、`audio_vae` 和 `clip`。
3. 打开 Director。
4. 选择一种独立模式，或选择 `Mixed`。
5. 建立需要的片段。
6. 为每段填写 Prompt，并加入当前片段模式需要的素材。
7. 需要跨段继承时，配置主节点总开关和对应片段边界按钮。
8. 只想修部分片段时使用 `选择运行`。
9. Queue 工作流。
10. 在 Live Preview 和 Results 查看过程与结果。

---

# Generation：独立任务模式

同一个 Director 可以直接切换六种独立 MiniMax H3 视频任务。

<img width="1709" height="902" alt="T2V generation mode" src="https://github.com/user-attachments/assets/89d1275a-fc5e-4d0e-aead-edfd82f8dae9" />
<img width="1717" height="894" alt="I2V generation mode" src="https://github.com/user-attachments/assets/c5eea561-fc53-460c-b010-36abe8a7d60f" />
<img width="1718" height="913" alt="FL2V generation mode" src="https://github.com/user-attachments/assets/e3a12dc8-0b6d-4f0a-9a6a-5b3076cdc0ca" />
<img width="1712" height="917" alt="R2V generation mode" src="https://github.com/user-attachments/assets/5553a223-41a8-49a8-a797-fb184bbe7b75" />
<img width="1719" height="900" alt="V2V generation mode" src="https://github.com/user-attachments/assets/5b1f49db-09d3-42c3-952f-c056b01e6c74" />
<img width="1721" height="907" alt="RV2V generation mode" src="https://github.com/user-attachments/assets/a28ea179-d9a1-40ca-b30b-570dd2bec188" />

| 模式 | 主要输入 | 外接 Director Inputs | Director Assets | Source Video | 典型用途 |
|---|---|---|---|---|---|
| `T2V` | Prompt | `prompt_N` | 不需要 | 无 | 文生分镜、多段短片 |
| `I2V` | Prompt + 起始图 | `image_prompt_N` + `image_N` | 不需要 | 无 | 从人物图或场景图起步 |
| `FL2V` | Prompt + 首帧/尾帧 | `fl_prompt_N` + `fl_assets_N` | `first_image / last_image` | 无 | 控制镜头起点和终点 |
| `R2V` | Prompt + 多模态参考 | `ref_prompt_N` + `ref_assets_N` | 9 图片 / 3 视频 / 3 音频 | 无 | 人物、声音、动作、道具、风格参考 |
| `V2V` | Source Video + Prompt | Director 管理 | 不需要 | Director 内上传 | 保留源动作的视频重绘/转换 |
| `RV2V` | Source Video + Prompt + 图片/音频参考 | `rv_prompt_N` + `rv_assets_N` | 9 图片 / 3 音频 | Director 内上传 | 源动作 + 身份/声音参考 |

### T2V

由 Prompt 驱动，多段时可以使用 Motion Context。

### I2V

每组可以提供独立起始图。

### FL2V

每组可以使用首帧、尾帧或同时使用。

### R2V

每组 Assets 最多：

```text
Picture 1-9
Video 1-3
Audio 1-3
```

### V2V

Source Video 在 Director 内管理。独立 V2V 使用自己的源视频时间线和 Source Bridge 逻辑。

### RV2V

以 Source Video 为主要运动/内容来源，同时加入身份和音频参考。

---

# 素材系统

![Common Assets and Material Library](docs/images/asset-system.webp)

## 公共素材

适合在多个独立模式片段之间复用同一个人物、场景、道具或声音。本段素材仍然只影响当前组。

## 素材库

长期素材库可以保存并复用：

- 图片
- 音频
- 视频
- Prompt

Mixed 下顶部只有一个全局素材库按钮，它作用于当前选中的片段，并按照该片段允许的输入类型分配素材。

---

# 外接 Director Inputs / Assets

其他 ComfyUI 节点可以通过以下架构向独立模式提供媒体：

```text
MiniMax H3 Motion Director Assets
        ↓
MiniMax H3 Motion Director Inputs
        ↓
MiniMax H3 Motion Director
```

![External Director Inputs and Assets](docs/images/external-inputs.webp)

仓库公开三个 Director 相关节点：

| 节点 | 作用 |
|---|---|
| `MiniMax H3 Motion Director` | 主导演台、执行、预览、后期、结果管理 |
| `MiniMax H3 Motion Director Inputs` | 动态 Prompt / 图片 / Assets 入口 |
| `MiniMax H3 Motion Director Assets` | 打包当前模式所需媒体 |

外接形态：

```text
T2V   prompt_N
I2V   image_prompt_N + image_N
FL2V  fl_prompt_N + fl_assets_N
R2V   ref_prompt_N + ref_assets_N
RV2V  rv_prompt_N + rv_assets_N
V2V   Source Video 由 Director 管理
```

Mixed v1 使用原生片段编辑器，不使用这套外接组系统。

---

# 主节点控制

## 采样设置

- 种子
- 生成后定制
- 采样步数
- 内置采样器
- 调度器
- 视频 Sigma Shift
- 音频 Sigma Shift

正确同时连接外部 `sampler + sigmas` 时使用外部采样，否则使用内部设置。

## 跨段接续

- 运动上下文
- 上下文帧数
- 潜变量尺度锁定
- 延续生成音频
- 颜色重锚定
- 独立 V2V / RV2V 适用时的 Source Bridge

Mixed 下这些主节点参数是全局总开关/全局调节值；每个片段边界再单独决定是否请求画面和声音继承。

## 后期处理

- 全局精修
- 人脸精修

## 性能

- 段间清理显存

---

# Post Processing / Live Preview / Results

<img width="1713" height="893" alt="Post Processing" src="https://github.com/user-attachments/assets/44c38e64-6efb-4bef-a348-40184af44eaf" />
<img width="1723" height="894" alt="Live Preview" src="https://github.com/user-attachments/assets/519b44c7-c1d6-4607-bed2-ef38e530f6b8" />
<img width="1734" height="889" alt="Results" src="https://github.com/user-attachments/assets/631a6278-c490-4ada-9a7c-b43e97934edb" />

## Post Processing

Global Refine 可执行整段二次采样/放大；Face Refine 负责检测、跟踪、裁切、局部去噪和回贴。两者可独立开启。

## Live Preview

Director 自己显示当前生成/后期阶段，完成的阶段可以保留静态快照方便比较。

## Results

Results 分为：

```text
分段
多段
最终结果
```

`多段` 可以选择连续的起始段和结束段；`最终结果` 提供保存路径、文件名前缀、格式、编码器和编码设置。

---

# 对外输出

| 输出 | 类型 | 说明 |
|---|---|---|
| `images` | `IMAGE` list | 最终视频帧 |
| `audio` | `AUDIO` list | 对应音频 |
| `fps` | `FLOAT` | 最终帧率 |

主节点同时是 `OUTPUT_NODE`，不连接右侧下游也可以执行。

---

# 多段连续性

```text
S1 -> S2 -> S3 -> S4
```

### Motion Context

把上一生成片段的视觉/运动上下文传给下一段。`Context Frames` 控制带入多少尾部上下文。

### Latent Scale Lock

减少跨段潜变量尺度变化带来的不稳定。

### Continue Generated Audio

在启用的边界上传递生成音频上下文。

### Color Re-anchor

帮助抑制长链路颜色漂移。

### Source Bridge

用于独立 V2V / RV2V 的源视频分段。Mixed v1 不使用 Source Bridge。

---

# 推荐使用方式

### 文生多镜头

`T2V` + 多段 Prompt + Motion Context。

### 从人物图开始的连续生成

`I2V` + 起始图 / 适用时的 Segment Result + Motion Context。

### 明确控制首尾状态

`FL2V` + 首尾图或前面片段的 Segment Result。

### 多人物 / 多参考短片

`R2V` + 可复用参考素材 + 素材库。

### 保留原视频动作做重绘

独立 `V2V`，或 Mixed `Source Video` 且不提供 Identity Pictures。

### 保留原动作并替换人物身份

独立 `RV2V`，或 Mixed `Source Video` + Identity Pictures。

### 真正的 Mixed 项目

按照每个镜头的需求选择不同模式，而不是强迫整条视频都用一种任务。比如：T2V 建立场景 -> Source Video/RV2V 表演 -> I2V 或 FL2V 控制结尾。

---

# 安装

进入 ComfyUI 的 `custom_nodes`：

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/j955229/ComfyUI-MiniMax-H3-Motion-Director.git
cd ComfyUI-MiniMax-H3-Motion-Director
python -m pip install -r requirements.txt
```

Windows 便携版请使用该 ComfyUI 实际使用的 Python。

安装后完整重启 ComfyUI。

### 更新

```bash
cd ComfyUI/custom_nodes/ComfyUI-MiniMax-H3-Motion-Director
git pull
```

更新包含前端文件时，重启 ComfyUI 并强制刷新浏览器。

### 依赖

- `opencv-python-headless`：源视频解码。
- `imageio-ffmpeg`：源音频提取。
- `scenedetect`：智能分割。

> 不要同时加载独立版 `ComfyUI-H3-Motion-Context`。本项目已经集成并修改相关 H3 runtime patch，同时加载可能发生冲突。

---

# 使用注意

- 外部 `sampler` 与 `sigmas` 应成对连接。
- 独立模式的 `Director Inputs` 是可选接口；Mixed v1 使用原生 Director UI。
- FL2V Assets 只提供首帧/尾帧，不使用 R2V 9/3/3 结构。
- RV2V Assets 不提供 Reference Video；Source Video 由 Director 管理。
- 同一个独立模式组不要同时使用内部和外部媒体来源。
- Mixed Source Video 片段时长由 Source Range 决定。
- 多段、后期处理和高分辨率任务会显著增加显存/内存压力。
- 更新后如果仍显示旧前端，完整重启 ComfyUI 并强制刷新浏览器缓存。
- 不要与独立版 `ComfyUI-H3-Motion-Context` 同时加载。
