# MiniMax H3 Motion Director 用户操作指南

[English](USER_GUIDE.md) | **简体中文**

这份指南面向第一次使用 **MiniMax H3 Motion Director** 的用户。重点不是介绍内部实现，而是告诉你：**哪个按钮做什么、什么时候用，以及 T2V / I2V / FL2V / R2V / V2V / RV2V / Mixed 应该怎么操作。**

> 本文截图中的红色编号就是实际操作顺序。不同生成模式会隐藏不适用的输入，因此你只需要处理当前页面显示出来的项目。

---

## 1. 最短上手流程

无论使用哪种模式，完整流程都可以记成：

```text
生成模式 → 输出规格 → 片段/素材 → Prompt → 生成 → 实时预览 → 后期处理 → 结果 → 保存影片
```

第一次使用时建议先做一个 5–10 秒的 T2V：

1. 在 **生成** 页选择 `T2V — 文生视频`。
2. 选择画幅、百万像素和 FPS。
3. 添加一个 Prompt Group，填写 Prompt 和时长。
4. 执行 ComfyUI 工作流。
5. 在 **实时预览** 查看当前阶段。
6. 生成满意后再开启 **后期处理**，避免每次抽卡都支付放大/精修成本。
7. 在 **结果 → 最终结果** 检查并保存影片。

---

## 2. 六种独立生成模式怎么选

| 模式 | 你需要提供什么 | 什么时候用 |
|---|---|---|
| `T2V` | Prompt | 没有起始素材，完全从文字生成视频 |
| `I2V` | Prompt + 起始图片 | 已经有人物图、场景图或构图，希望让它动起来 |
| `FL2V` | Prompt + First / Last Image | 需要明确指定开头、结尾，或同时控制两端画面 |
| `R2V` | Prompt + 图片/视频/音频参考 | 需要人物身份、场景、道具、动作、声音等多模态参考 |
| `V2V` | Source Video + Prompt | 保留源视频的动作/时间结构，同时重新生成画面 |
| `RV2V` | Source Video + Prompt + References | 既要源视频动作，又要参考人物身份、音频等 |

如果一个项目中不同镜头需要不同模式，直接使用 **Mixed Mode**，不要为每一种模式拆成多个 Director 节点。

---

## 3. T2V：最基础的文生视频

![Standalone T2V controls](images/tutorial/01-standalone-t2v.svg)

| 编号 | 控件 | 用途 |
|---:|---|---|
| 1 | 生成模式 | 选择 `T2V / I2V / FL2V / R2V / V2V / RV2V / mixed` |
| 2 | 输出分辨率 / 画幅 | 选择 16:9、9:16 等目标画幅 |
| 3 | 百万像素 | 控制第一遍生成规模；界面右侧会显示计算后的实际尺寸 |
| 4 | FPS | 最终生成帧率，通常保持项目统一 |
| 5 | 导出方式 | 控制本次输出范围/方式 |
| 6 | 素材库 | 打开持久化 Material Library |
| 7 | 添加提示词组 | 新增一个独立生成片段 |
| 8 | 选择运行 | 开启后只执行被选中的 Prompt Group |
| 9 | 秒数 | 当前 Prompt Group 的目标时长 |
| 10 | 删除 | 删除当前 Prompt Group |
| 11 | Prompt | 当前片段的 MiniMax H3 Prompt |
| 12 | 片段间控制 | 用于片段边界/连续性相关操作；具体可用项取决于当前模式和全局设置 |

### 生成一个 30 秒、3 段的 T2V

1. 选择 `T2V`。
2. 点击 **添加提示词组** 两次，使页面共有 3 组。
3. 每组设为 10 秒。
4. 分别填写第 1、2、3 段 Prompt；如果剧情连续，后段 Prompt 应明确说明延续上一段的角色、环境、动作状态。
5. 设定输出画幅、百万像素与 FPS。
6. 执行工作流。
7. 某一段不满意时开启 **选择运行**，只重跑那一段，而不是整条视频全部重算。

---

## 4. I2V：从一张图片开始生成

适合“我已经有角色图/场景图，希望它动起来”。

操作：

1. 生成模式选择 `I2V`。
2. 在该组的图片输入区上传 **1 张起始图**。
3. Prompt 描述接下来发生什么，而不是重复堆砌整张图片里已经明确可见的内容。
4. 设置时长并生成。

常见用法：人物立绘转真人镜头、静态场景开始移动、产品图增加镜头运动、承接上一段导出的最后一帧。

---

## 5. FL2V：控制 First / Last Frame

FL2V 用于需要明确视觉起点或终点的镜头。

- 只有 First Image：从指定画面开始。
- 只有 Last Image：生成过程要落到指定结尾。
- First + Last：同时约束开头和结尾，中间由模型完成过渡。

操作：

1. 选择 `FL2V`。
2. 上传 First Image、Last Image，或者只上传你需要控制的一端。
3. Prompt 写清楚两端之间发生的动作和镜头变化。
4. 生成后检查过渡是否自然；首尾一致不代表中间运动一定完全按预期，需要时重抽当前片段即可。

---

## 6. R2V：人物、场景、动作和声音参考

![R2V controls](images/tutorial/02-r2v-assets.svg)

R2V 是最适合“同一角色反复出演”的独立模式。每个 Assets Group 最多可包含：

```text
Picture 1–9
Video 1–3
Audio 1–3
```

| 编号 | 控件 | 用途 |
|---:|---|---|
| 1 | R2V 模式选择 | 切换到参考主体生视频 |
| 2 | 添加素材组 | 新增一个独立 R2V 片段/素材组 |
| 3 | 输出画幅 | 设置项目画幅 |
| 4 | 导出方式 | 选择本次导出范围 |
| 5 | 公共素材 | 添加多个片段都要共用的参考 |
| 6 | 素材库 | 从持久化素材库快速分配图片/音频/视频/Prompt |
| 7 | 参考预览/上传区 | 上传或查看当前组使用的参考素材 |
| 8 | 素材组 | 当前 R2V 片段的完整输入范围 |
| 9 | 参考图片 | 人物、场景、道具等视觉参考，最多 9 张 |
| 10 | Prompt | 描述当前片段动作、镜头、对白和参考关系 |
| 11 | 秒数 | 当前组时长 |
| 12 | 删除 | 删除当前素材组 |

### 典型场景：固定同一个人物拍 3 个镜头

1. 进入 `R2V`。
2. 把人物的正面/半身/全身参考放入 **公共素材**，这样每段都可复用。
3. 创建 3 个素材组。
4. 每组只放该段专属素材，例如该镜头的动作参考、场景参考或声音。
5. 每段写独立 Prompt。
6. 生成后只重跑需要修改的段。

---

## 7. 公共素材：多个 R2V/RV2V 片段共享

![Common references](images/tutorial/04-common-references.svg)

| 编号 | 控件 | 用途 |
|---:|---|---|
| 1 | 参考图片 | 项目级共享 Picture，最多 9 张 |
| 2 | 参考视频 | 项目级共享 Reference Video，最多 3 个 |
| 3 | 参考音频 | 项目级共享 Reference Audio，最多 3 个 |

**公共素材**适合“每一段都要用”的东西，例如同一个主角、固定场景、固定道具或同一个声音参考。

**本段素材**只属于当前组。实际执行时，Director 会把公共素材与当前段素材组合成该段真正使用的参考序列。

一个简单原则：

- 每段都要用 → 放公共素材。
- 只有某一段需要 → 放本段素材。

---

## 8. 素材库：长期保存、跨项目复用

![Material Library](images/tutorial/05-material-library.svg)

Material Library 与“公共素材”不同：公共素材属于当前项目；素材库是长期保存的可复用资产。

| 编号 | 控件 | 用途 |
|---:|---|---|
| 1 | 图片 / 音频 / 视频 / Prompt | 切换素材类型 |
| 2 | 应用到 | 显示当前素材要分配给哪个 Segment/Group |
| 3 | 分类 | 按人物、场景、道具、其他等筛选 |
| 4 | 搜索 | 按标题查找素材 |
| 5 | 清除当页选取 | 清掉当前页的选中状态 |
| 6 | 清除所有页选取 | 清掉全部分页的选中状态 |
| 7 | 新增素材 | 将新素材保存进 Library |
| 8 | 素材卡片 | 点击选择要使用的素材 |
| 9 | 分配预览 | 预览选中的素材将如何分配 |
| 10 | 应用 | 把当前选择写入目标 Segment/Group |
| 11 | 关闭 | 关闭素材库 |
| 12 | X | 关闭窗口 |

### Mixed Mode 的重要规则

素材库会跟随**当前选中的 Segment**，并且只显示该模式合法的素材。

Mixed 的真正 `Source Video` 仍然需要在当前 Segment 本地上传。素材库里的 Video 是 Reference Video，不能代替 Mixed `Source Video`。

---

## 9. Reference Audio 与 Original Audio Drive

![Reference audio and drive timeline](images/tutorial/06-reference-audio.svg)

参考音频有两种角色：

- **Normal reference / 普通参考**：把音频作为参考信息交给 H3。
- **Original Audio Drive / 原音驱动**：把原始音频按指定时间放到当前片段的 Drive timeline，使音频时序成为该片段的一部分。

| 编号 | 控件 | 用途 |
|---:|---|---|
| 1 | Reference Video 区 | 添加视频参考 |
| 2 | Video slots | 每个参考视频槽位 |
| 3 | Reference Audio 区 | 当前音频参考集合 |
| 4–5 | Audio cards | 播放音频、打开编辑器、查看长度 |
| 6 | Audio Role | 切换普通参考 / Original Audio Drive |
| 7 | 空 Audio slot | 上传另一条音频 |
| 8 | Drive timeline | 拖动 Audio Drive 块，决定它在片段中出现的时间 |

Drive timeline 有两个直接限制：

1. 两个 Drive 区间不能互相重叠。
2. Drive 音频不能超出当前 Segment 的结束时间；超出时应向前拖动或裁短音频。

### 音频编辑器

![Audio editor](images/tutorial/07-audio-editor.svg)

| 编号 | 控件 | 用途 |
|---:|---|---|
| 1 | Waveform | 直接查看并调整保留范围 |
| 2 | Trim start | 裁切开始时间 |
| 3 | Trim end | 裁切结束时间 |
| 4 | Effective | 当前有效长度，只读结果 |
| 5 | Play | 试听当前选择 |
| 6 | Undo | 撤销一次编辑 |
| 7 | Redo | 重做 |
| 8 | Reset | 恢复原始裁切范围 |
| 9 | Trim | 应用当前裁切范围 |
| 10 | Done | 保存编辑并返回 Director |

典型做法：先把长录音裁成需要的对白，然后在 Drive timeline 拖到该句对白应该发生的位置。

---

## 10. V2V：保留源视频动作，重做画面

V2V 的核心输入是 `Source Video + Prompt`。

适合：

- 保留原视频人物的动作和节奏，但改变服装/环境/风格。
- 用实拍动作作为运动模板。
- 在不从零设计动作的情况下重新生成画面。

操作：

1. 选择 `V2V`。
2. 上传 Source Video。
3. 选择需要使用的 Source Range。
4. Prompt 明确“需要改变什么”和“必须保持什么”。
5. 生成并检查动作结构是否保持。

Standalone V2V/RV2V 还可以使用 Director 的 **Source Bridge** 处理符合条件的源视频分段边界，使过渡不只是简单硬切。

---

## 11. RV2V：源视频动作 + 身份/声音参考

RV2V = V2V 的 Source Video，再加参考素材。

例如“把源视频中的人物替换成参考图里的角色，但保留源视频动作”：

1. 选择 `RV2V`。
2. 上传 Source Video。
3. 加入人物 Identity Pictures。
4. 需要声音/对白参考时再加入 Audio。
5. Prompt 明确人物替换、服装、场景，以及哪些动作和镜头必须沿用源视频。
6. 生成。

Source Video 负责动作/时序结构；Identity / Reference 负责人物或其他参考特征。不要把两者当成同一种输入。

---

## 12. Mixed Mode：一条时间线混合多种生成方式

![Mixed Mode controls](images/tutorial/03-mixed-mode.svg)

Mixed 是制作完整项目时最实用的模式。

例如：

```text
S1  T2V
S2  I2V
S3  R2V
S4  Source Video
S5  T2V
```

| 编号 | 控件 | 用途 |
|---:|---|---|
| 1 | `mixed` | 进入 Mixed Mode |
| 2–5 | 输出规格 | 分辨率模式、宽、高、FPS |
| 6 | 导出方式 | 设置最终输出方式 |
| 7 | 素材库 | 给当前选中的 Segment 分配合法素材 |
| 8 | 添加片段 | 新增 Segment |
| 9 | 选择运行 | 只运行被选择的 Segment |
| 10 | Segment timeline | 查看、选择、复制、删除和排列各段 |
| 11 | Boundary controls | 决定相邻 Segment 是否传递画面/音频连续性 |
| 12 | 当前 Segment | 绿色边框表示正在编辑的 Segment |
| 13 | 生成模式 | 当前 Segment 单独选择 T2V / I2V / FL2V / R2V / Source Video |
| 14 | 时长 | 当前 Segment 时长；Source Video 模式由 Source Range 决定 |
| 15 | Prompt | 当前 Segment 的 Prompt |

### Mixed 的 Source Video 规则

Mixed 为了减少重复选项，只显示一个 `Source Video` 模式：

```text
Source Video + 0 Identity Pictures  → V2V
Source Video + Identity Pictures   → RV2V
```

`Start sec / End sec` 决定 Source Range，也直接决定该 Segment 的时长。

### Segment Result

后面的 Segment 可以引用前面已经完成的 Segment 的静态解码帧：

```text
Earlier Segment → last frame
Earlier Segment → explicit frame index
```

常见用途：

- S1 最后一帧 → S2 I2V 起始图。
- S2 某一帧 → S3 FL2V First Image。
- 前一段结果 → 后段 FL2V Last Image。

Segment Result 只能**向后引用**：后面的段可以引用前面的结果，不能引用尚未生成的未来 Segment。

### Boundary continuity

两个卡片之间的边界按钮控制该边界是否请求画面/生成音频连续性。节点级 Continuity 设置仍然是总开关。

需要连续剧情时打开；主动换场、换人物、换风格时可以让该边界重置。

---

## 13. Selective Run：只重抽不满意的片段

长视频最浪费时间的操作，是因为一个镜头不好就重新生成所有镜头。

正确流程：

1. 第一遍先把所有片段生成出来。
2. 找出不满意的片段。
3. 开启 **选择运行 / Selective Run**。
4. 只选择需要重跑的 Segment/Group。
5. 保留其他已经存在的缓存/Source Result。
6. 满意后再进行最终 Global Refine / Face Refine。

这也是推荐“低分辨率先抽卡，满意后再放大精修”的原因：后处理成本应该花在最终决定保留的片段上。

---

## 14. 后期处理：Global Refine、Upscale、Face Refine

![Post-processing](images/tutorial/08-postprocess.svg)

| 编号 | 控件 | 用途 |
|---:|---|---|
| 1 | 后期处理页 | 进入 Postprocess |
| 2 | Global Refine 总开关 | 控制是否执行全局精修管线 |
| 3 | 二次采样 | 第二遍 H3 sampling；可保持原 Seed、设置 denoise 和 steps |
| 4 | 放大 | 选择 H3 Learned Latent、普通 upscale 等可用路径 |
| 5 | 输出分辨率 | 设置后处理目标尺寸 |
| 6 | NVIDIA RTX Deblur | 可选 RTX 去模糊处理；需要对应 NVIDIA 运行环境 |
| 7 | Face Refine 总开关 | 控制人脸精修 |
| 8 | 检测 | 人脸检测模型、置信度和目标脸 |
| 9 | 精修 | 人脸重生成强度与画布质量 |
| 10 | 回贴 | Mask、Blend、Color Match 等回贴控制 |
| 11 | 高级设置 | 展开较少需要调整的参数 |

### 推荐生产流程

```text
低分辨率第一遍 → 检查内容/动作/构图 → 重抽失败片段 → 固定保留结果 → Global Refine / Upscale → Face Refine → Final Result
```

如果 Global Refine 失败，Director 会保留已经完成的第一遍结果；Face Refine 没有检测到可用人脸或执行失败时，也会保留已组装结果，而不是把整条管线作废。

---

## 15. 实时预览：看当前正在做什么

![Live Preview](images/tutorial/09-live-preview.svg)

| 编号 | 区域 | 用途 |
|---:|---|---|
| 1 | 实时预览页 | 打开 Director Live Preview |
| 2 | 一般 / 全局精修 / 脸部精修 | 切换要观察的阶段 |
| 3 | Preview | 显示当前阶段的中间画面 |
| 4 | 进度状态 | 当前 Segment、阶段、步数和整体进度 |
| 5 | 预览设置 | 控制预览帧数、FPS、最大分辨率、JPEG 品质和刷新间隔 |

Live Preview 只是观察当前管线，不会改变你的 Prompt 或生成结果。为了减少额外开销，预览分辨率/帧率可以低于最终输出。

---

## 16. 结果页：检查并保存最终影片

![Results](images/tutorial/10-results.svg)

| 编号 | 控件 | 用途 |
|---:|---|---|
| 1 | 结果页 | 进入 Results |
| 2 | 分段 / 多段 / 最终结果 | 在单段、连续区间和完整成片之间切换 |
| 3 | 播放器 | 检查最终画面与音频 |
| 4 | 保存影片 | 视频文件输出设置 |
| 5 | 自动保存最终结果 | 管线完成后自动写出最终影片 |
| 6 | 路径 | 保存目录 |
| 7 | 文件名前缀 | 输出文件名开头 |
| 8 | 格式 | 容器/格式选择，`auto` 让 Director 自动决定 |
| 9 | 编码器 | 视频编码器，`auto` 使用自动选择 |
| 10 | 编码模式 | 编码策略 |
| 11 | 保存影片 | 手动保存当前最终结果 |
| 12 | 最终成果信息 | 最终帧数、时长等结果信息 |
| 13 | 报告 | 真实执行配置、连续性、采样和后处理状态 |

结果分三层：

- **Segment**：检查单个片段。
- **Multi Segment**：检查或导出一段连续 Segment 范围。
- **Final Result**：完整最终成片。

---

## 17. 常见场景直接照着做

### 场景 A：纯文字生成 3 段连续剧情

```text
T2V
→ Add Prompt Group × 3
→ 每段填写 Prompt + Duration
→ 开启需要的跨段连续性
→ Generate
→ 检查每段
→ Selective Run 重抽失败段
→ Postprocess
→ Final Result
```

### 场景 B：有一张角色图，让她动起来

```text
I2V
→ 上传起始图
→ Prompt 描述动作/镜头
→ 设置 Duration
→ Generate
```

### 场景 C：必须从 A 画面走到 B 画面

```text
FL2V
→ First Image = A
→ Last Image = B
→ Prompt 描述 A 到 B 的过程
→ Generate
```

### 场景 D：同一个人物拍很多段

```text
R2V
→ 人物参考放 Common References
→ 每段建立独立 Assets Group
→ 段专属场景/动作/Audio 放本段素材
→ 每段 Prompt
→ Generate
```

### 场景 E：保留原视频动作，但重做画面

```text
V2V
→ 上传 Source Video
→ 选择 Source Range
→ Prompt 写需要改变/保留的内容
→ Generate
```

### 场景 F：把源视频人物换成参考图人物

```text
RV2V
→ Source Video
→ Identity Pictures
→ 可选 Reference / Drive Audio
→ Prompt 明确人物替换 + 保持源动作
→ Generate
```

### 场景 G：5 个镜头分别使用不同方法

```text
Mixed
→ Add Segment × 5
→ S1 T2V
→ S2 I2V
→ S3 R2V
→ S4 Source Video
→ S5 FL2V
→ 设置每个 Boundary 的 visual/audio continuity
→ Generate
→ Selective Run 只修失败镜头
```

### 场景 H：有对白录音，要精确安排出现时间

```text
R2V / RV2V
→ 上传 Audio
→ Audio Role = Original Audio Drive
→ Edit Audio 裁出需要区间
→ Drive timeline 拖到对白发生时间
→ 检查无重叠、未超出 Segment
→ Generate
```

---

## 18. 最容易搞混的几个概念

| 概念 | 它是什么 |
|---|---|
| Common References | 当前项目中，多段共享的参考素材 |
| Segment/Group Local Assets | 只给当前片段使用的素材 |
| Material Library | 持久化、可跨项目重复使用的素材库 |
| Source Video | V2V/RV2V 的运动/时间结构来源 |
| Reference Video | 参考信息，不等同于 Source Video |
| Segment Result | 前面片段解码出的静态帧，可给后面 I2V/FL2V 使用 |
| Motion Context | 跨段运动/上下文连续机制，与 Segment Result 是不同机制 |
| Selective Run | 只重跑选择的段，保留其他已有结果 |
| Global Refine | 第一遍生成后的全局二次采样/放大精修 |
| Face Refine | 对检测到的人脸区域做局部 H3 精修并回贴 |

---

## 19. 运行前检查

正式开始长视频前，快速检查：

- 当前生成模式是否正确。
- 画幅、百万像素、FPS 是否符合项目要求。
- 每段 Duration / Source Range 是否正确。
- I2V / FL2V 的图片有没有放错位置。
- V2V / RV2V 的 Source Video 是否是真正的 Source，而不是 Reference Video。
- R2V/RV2V 的公共素材与本段素材是否分配正确。
- Audio Drive 是否重叠或超出 Segment。
- Mixed 的 Boundary continuity 是否与剧情意图一致。
- Selective Run 是否误选/漏选片段。
- 第一遍内容尚未确定时，不要急着开启昂贵的放大与 Face Refine。

完成这些检查后再执行长任务，最能减少无意义的重跑。
