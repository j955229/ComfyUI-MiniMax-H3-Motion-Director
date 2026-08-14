# ComfyUI MiniMax H3 Motion Director

一个给 **MiniMax H3 多段视频生成** 用的 ComfyUI Director 节点。

它的重点不是“多一个采样节点”，而是把多段视频真正需要的东西集中在一起：

- 每一段分别写 Prompt
- 每一段分别放图片、音频、视频参考
- 让后一段续接前一段
- 只重跑出问题的那几段
- 管理常用素材
- 最后整段导出，或一段一段导出

支持：`T2V / I2V / FL2V / R2V / V2V / RV2V`。

> 本项目是第三方实现，不是 MiniMax、ComfyUI、AIMixer 或 ComfyUI-H3-Motion-Context 的官方发行版。

---

## 这个节点能做什么

- 支持 6 种 MiniMax H3 视频模式。
- 在 Director 里建立多个片段，并分别填写 Prompt。
- 支持完整运行，也可以只勾选某几段重新生成。
- 支持图片、音频、视频参考。
- R2V 可以把常用角色或素材设成“公共素材”，不用每一段重复上传。
- Prompt 输入框支持 `@` 选择当前任务已经加入的参考素材。
- 内置长期保存用的素材库，可管理图片、音频、视频和 Prompt。
- 多段视频可以使用“续接上一段”（Motion Context）。
- V2V / RV2V 还可以使用 Source Bridge，让原视频动作在两段边界重新过渡。
- 支持内部采样，也支持外接 ComfyUI `SAMPLER + SIGMAS`。
- 支持全部合并导出，或按片段分别导出。

---

# 安装

把仓库放进 ComfyUI 的 `custom_nodes`：

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/j955229/ComfyUI-MiniMax-H3-Motion-Director.git
```

安装依赖：

```bash
python -m pip install -r ComfyUI/custom_nodes/ComfyUI-MiniMax-H3-Motion-Director/requirements.txt
```

Windows 便携版可以这样：

```powershell
python\python.exe -m pip install -r ComfyUI\custom_nodes\ComfyUI-MiniMax-H3-Motion-Director\requirements.txt
```

重启 ComfyUI 后搜索：

```text
MiniMax H3 Motion Director
```

### 更新

```bash
cd ComfyUI/custom_nodes/ComfyUI-MiniMax-H3-Motion-Director
git pull
```

> 不建议同时启用独立版 `ComfyUI-H3-Motion-Context`。本项目已经内置并修改了相关 H3 runtime patch，两套一起加载可能冲突。

---

# 基本连接

通常需要：

- MiniMax H3 `MODEL`
- MiniMax H3 video VAE
- MiniMax H3 audio VAE
- MiniMax 兼容的 CLIP / Text Encoder
- `MiniMax H3 Motion Director`

主要输出：

| 输出 | 是什么 |
|---|---|
| `images` | 生成的视频帧 |
| `audio` | 对应音频 |
| `fps` | 导出帧率 |
| `frame_count` | 最终可见总帧数 |
| `source_images` | 可选的原片对比输出 |
| `report` | 当前设置、缓存、续接、采样等诊断信息 |

---

# 最快上手

1. 连接 H3 模型、video VAE、audio VAE 和 CLIP。
2. 在 Director 里选择生成模式。
3. 建立第 1 段、第 2 段、第 3 段……
4. 给每一段填写 Prompt。
5. 按模式加入图片、源视频或参考素材。
6. 如果想让多段连续，开启“续接上一段”（Motion Context）或使用对应的 V2V / RV2V 衔接方式。
7. 如果只想修某几段，开启“选择运行”并勾选要重新生成的段。
8. Queue 工作流。
9. 把 `images` 和 `audio` 接到你自己的保存或合成节点。

---

# 六种生成模式

| 模式 | 白话说明 |
|---|---|
| `T2V` | 只用文字生成视频。 |
| `I2V` | 用一张图片作为起点生成视频。 |
| `FL2V` | 指定首帧、尾帧，或首尾两张图生成中间视频。 |
| `R2V` | 用角色图、参考图、参考音频、参考视频来生成新视频。 |
| `V2V` | 让一段原视频作为动作/内容来源，再生成新视频。 |
| `RV2V` | 以原视频为主要来源，再额外加入参考图片和参考音频。 |

## T2V

每一段主要靠 Prompt 生成。

如果有多段，可以开启“续接上一段”，让第 2 段接第 1 段、第 3 段接第 2 段。

## I2V

不开启“续接上一段”时：

- 每一段都要有自己的起始图片。

开启“续接上一段”时：

- 一条连续链的第 1 段需要图片。
- 后面的片段可以不放图片，直接接着上一段生成。
- 如果中途某一段重新放了一张新图片，就从那一段开始建立新的连续链。

例如：

```text
S1：图片 A
S2：空白 → 接 S1
S3：空白 → 接 S2
S4：图片 B → 从这里重新开始
S5：空白 → 接 S4
```

## FL2V

每个片段可以使用：

- 只有首帧
- 首帧 + 尾帧
- 只有尾帧

只有尾帧时，Director 不会偷偷复制一张假首帧。

## R2V

R2V 是“参考素材生成视频”。

你可以给每一段加入：

- 参考图片
- 参考音频
- 参考视频
- Prompt

R2V 还有一个很实用的“公共素材”功能，下面单独说明。

## V2V

每一段都有自己的 Source Video（源视频）。

第 1 段使用第 1 段的原视频，第 2 段使用第 2 段的原视频，不会把第一段视频重复塞给后面所有片段。

## RV2V

当前 RV2V 的主要结构是：

```text
源视频 + 参考图片 + 参考音频
```

技术上，当前片段的源视频会作为 `<Video 1>`。

当前素材库不会给 RV2V 再加入额外的 Reference Video，也不会用素材库视频替换 RV2V 的 Source Video。

RV2V 的 Source Video 仍然从 Director 本地上传。

---

# 公共素材

界面和代码里有时会写 `Common References`。

它的用途很简单：

> 同一个角色、道具或声音要连续出现在很多段里，就只放一次，不用每一段重新上传。

例如你要生成 5 段同一个角色的视频：

```text
公共素材：
角色 A
角色 B

第 1 段自己的素材：道具 X
第 2 段自己的素材：道具 Y
第 3 段自己的素材：没有
```

那么：

```text
第 1 段 = 角色 A + 角色 B + 道具 X
第 2 段 = 角色 A + 角色 B + 道具 Y
第 3 段 = 角色 A + 角色 B
```

每一段自己的素材，技术上叫 `Local References`。

执行时，Director 会把：

```text
公共素材 → 当前片段自己的素材
```

重新排成连续的官方编号：

```text
<Picture 1>
<Picture 2>
<Picture 3>
...
```

---

# 素材库

Director 内置了一个长期保存用的素材库。

它适合放你经常重复使用的：

- 角色图片
- 场景图片
- 音色
- 台词音频
- 音效
- 视频
- 常用 Prompt

素材库和当前任务是分开的。素材放进库里以后，下次重新打开 ComfyUI 仍然可以继续使用。

| 大分类 | 默认小分类 |
|---|---|
| 图片 | 人物 / 场景 / 道具 / 其他 |
| 音频 | 音色 / 台词 / 音效 / 音乐 / 其他 |
| 视频 | 人物 / 场景 / 动作 / 镜头 / 其他 |
| Prompt | 人物 / 场景 / 动作 / 运镜 / 风格 / 对白 / 其他 |

小分类直接显示在第二层 Tab。

你可以：

- 新增小分类
- 修改小分类名称
- 默认小分类也可以改名

改分类名称时，里面的素材不会消失，只是一起改到新的分类名称下。

当前版本暂时不提供“删除小分类”。

## 不同模式能从素材库拿什么

| 模式 | 可以用的素材 |
|---|---|
| T2V | Prompt |
| I2V | 图片、Prompt |
| FL2V | 图片、Prompt |
| R2V | 图片、音频、视频、Prompt |
| V2V | 视频、Prompt |
| RV2V | 图片、音频、Prompt |

RV2V 的 Source Video 仍然用 Director 自己的本地上传，不从素材库选择。

## 怎么选择素材

每一种素材都自己编号，不会混在一起。

例如：

```text
图片：1、2、3...
音频：1、2、3...
视频：1、2、3...
Prompt：1、2、3...
```

操作：

- 左键素材：选一次。
- 同一个素材可以重复选很多次。
- 右键素材：撤销这个素材最近的一次选择。
- 撤销以后会自动重新编号。

### 清除选择

`清除当页选取`：

只清当前第二层小分类里的选择。

例如你现在在：

```text
图片 → 人物
```

那么只会清掉“人物”页选中的图片，其他“场景 / 道具 / 其他”不会被清掉。

`清除所有页选取`：

清空当前生成模式下，素材库里所有类型的选择。

---

# Previous Context（续接上一段）

Director 现在把“是否读取上一段”保存为**每个分段边界自己的状态**，不再要求整条时间线只能统一开启或统一关闭。

例如：

```text
S1 → S2 → S3 × S4 → S5
```

表示 S2 读取 S1，S3 读取 S2；S4 与旧链完全断开；S5 再从 S4 建立一条新链。Segment 1 没有上一段，所以永远是断开的。

在提示词组卡片之间会看到 `🔗` 或 `×`。在视频时间线上，相同状态显示在两个分段的边界处：

- 点击主图标：在“Visual + Audio 都继承”与“全部断开”之间切换。
- 点击卡片连接器旁的 `⋯`，或在视频时间线连接图标上按右键：分别设置 Visual 与 Audio。
- 所有启用状态统一使用绿色；`V`、`A`、`↔` 文字区分 Visual、Audio 或两者。灰色 `×` 表示完全断开。

旧 workflow 没有这些边界字段。第一次加载时，Director 会依据旧的全局 `Motion Context`、`Audio Context`、音频模式与 Source Bridge 设置推导相同行为，不会让旧项目突然全部断链，也不会突然开启以前没有的声音续接。新 workflow 中，节点级 Motion/Audio 开关是 master；每段 Context Link 决定该边界是否使用已经开启的能力。关闭 master 不会删除已保存的每边界选择，重新打开后会恢复。

## Visual Previous Context

Visual Context 会把上一段最终有效输出的 video latent tail 交给下一段，让人物动作和镜头运动不要完全从零开始。H3 支持的上下文长度仍然是：

```text
1 / 5 / 22 / 39
```

Director 优先使用保存的 video latent；只有无法使用 latent 时才走 RGB fallback。开启 Color Re-anchor 时会明确使用 `RGB re-anchor → VAE encode` 路径。这个路径只负责最近一段的动作状态，不会把生成结果自动加入人物参考素材，也不会建立 recent generated memory bank。

如果 I2V 当前段明确上传了新图片，这张图片仍是当前段的首帧基准，Visual Previous Context 会在该边界 reset。Audio 可以独立保持开启，所以可以做到“换场景，但 BGM / ambience 继续”。

当前 Previous Context 要求 H3 原生 `24 fps`。如果缓存缺失、已经过期、画布尺寸不一致或无法覆盖请求的上下文长度，Director 会明确报错，不会静默读取错误历史结果。

## Audio Previous Context

Audio Context 的意思是：

> 把上一段模型生成音频的有效 audio latent tail 交给下一段。

它不是“是否生成音频”的总开关。只有输出音频模式为 `generate` 时才可继承；`source` 与 `mute` 会关闭该段的 Audio Previous Context。Visual 与 Audio 已经分开，因此支持四种组合：

| Visual | Audio | 实际效果 |
|---|---|---|
| ON | ON | 动作、镜头与连续声音都读取上一段 |
| ON | OFF | 动作继续，声音从当前段重新开始 |
| OFF | ON | 场景或镜头切换，但 BGM、环境声或连续声音继续 |
| OFF | OFF | 当前段完全独立 |

Audio 路径优先使用上一段保存的 H3 audio latent，必要时才使用完整 generated waveform 重新编码。它不会修改 Voice Ref，也不会把声音素材自动转成跨项目记忆。

## 选择运行与过期缓存

每个 Segment cache 与 Motion/Audio Context cache 都会记录当前段身份、生成环境以及实际启用的上游依赖。重新修改或生成中间段后，下游缓存会沿着仍开启 Visual 或 Audio 的边界变成 stale，直到遇到第一个 Visual、Audio 都关闭的边界为止。

例如：

```text
S1 → S2 → S3 × S4 → S5
```

改变 S2 会让 S3 失效，但不会让 S4、S5 失效。即使 S3 是 `Visual OFF / Audio ON`，它仍依赖 S2 的声音，所以 S2 改变后 S3 仍会失效。选择运行单独执行依赖段时，上一段 cache 有效就读取；cache 缺失或 stale 就明确要求先运行上一段或完整序列。

## pin_renorm（Experimental）

UI 中显示为“潜变量尺度锁定”，位于“跨段续接”的上下文帧数与音频续接之间，默认关闭。底层 `pin_renorm_enabled` widget 仍保留在原序列化列表末尾；前端使用独立、`serialize=false` 的专用代理控件。`source_overlap_frames` 只代表 Source Bridge，不再冒充潜变量尺度锁定，因此旧 workflow 的 widget index 不会发生错位。

执行后，Director Report 会显示每次 handoff 的 baseline 来源、校正前后标准差、scale、`mean_abs_delta` 与 `max_abs_delta`。RGB fallback 与 Color Re-anchor 的 VAE 重编码 latent 也能继续执行尺度锁定；只有 Source Bridge、视觉续接关闭或没有可用 Visual Previous Context 时才会显示 `SKIPPED`。

开启后，第一份 Visual handoff 会记录该连续链的 video latent 标准差作为 baseline。后续每次把 video latent tail 注入下一段前，只把它的尺度重新校准到这个 baseline 附近：保留 latent 的平均值、内容、姿势与运动方向，只抑制长链中的统计尺度漂移。

它绝不会处理：

- audio latent
- 用户 Picture Ref
- Source Video
- RGB Color Re-anchor 输入

当 Visual 边界断开时，旧链 baseline 同时结束。下一次重新开启 Visual inheritance 时，会从新链的第一份 handoff 建立新 baseline。baseline 会跟随 versioned latent cache 保存、恢复与验证，所以完整顺序运行、选择运行和重启 ComfyUI 后的行为一致。

---

# Source Bridge 

Source Bridge 只用于：

```text
V2V
RV2V
```

可以把它理解成：

> 两段原视频在交界处，不直接硬切，而是拿边界附近的原视频动作再生成一次过渡。

当前实现固定使用 5 帧窗口。

V2V / RV2V 每个边界的视觉衔接方式是三选一：

```text
Source Bridge
Motion Context
关闭视觉续接
```

Source Bridge 和 Motion Context 不会同时叠加视觉上下文。

Source Bridge 只拥有视觉路径；如果该边界另外开启 Audio Previous Context，生成音频仍可独立续接，不会把 Source Bridge 误当成上一段画面记忆。

---

# Color Re-anchor 

长链连续生成时，有时颜色会一段一段慢慢漂掉，例如：

- 越来越黄
- 越来越蓝
- 白平衡变化
- 亮度变化
- 饱和度变化
- 对比度变化

Color Re-anchor 用来降低多段链式生成中的累积性色彩漂移。

它只会处理“准备交给下一段的画面上下文”，不会回头修改已经生成好的视频。

Source Bridge 路径不会使用 Color Re-anchor。

Color Re-anchor 的长期基准与 visual chain 绑定：T2V/R2V 使用链根第一段生成结果；I2V 使用链根 source image；FL2V 优先使用链根 First Frame；V2V/RV2V 使用链根 source video。R2V/RV2V 的 Picture 1 只负责人设，不再被当成整段场景的颜色基准。Visual Context Link 断开后旧基准立即结束，新链会建立并持久化自己的 RGB mean/std。Seam Color Match 只在同一条启用的 Visual link 上处理相邻接缝。

Color Re-anchor 与潜变量尺度锁定可以同时开启，执行顺序是：`exported RGB tail → Color Re-anchor → VAE encode → pin_renorm → H3`。

---

# 内部采样和外接采样

## 内部采样

不接外部 `sampler` 和 `sigmas` 时，使用 Director 自己的：

- `steps`
- `sampler_name`
- `scheduler`
- `shift_video`
- `shift_audio`

## 外接采样

如果同时连接标准 ComfyUI：

```text
SAMPLER
SIGMAS
```

Director 就会改用外接采样。

只接其中一个会报错，不会一半用内部、一半用外部。

---

# 导出

可以选择：

- 把所有片段合并成完整结果
- 每一段分别导出

“怎么导出”和“怎么生成”是两件事。

选择分段导出，不代表原本连续生成的多段视频会自动变成彼此独立的生成任务。

---


# 后期处理与 Output 成果中心

Motion Director 仍然只有一个节点、一个 Director 弹窗。打开 Director 后，顶部可以直接点击
`Generation`、`后期处理`、`Output`，也可以用左右箭头循环切换。Generation 继续负责六种模式的
素材、提示词、原片播放器、切片和时间轴编辑；原片的播放、逐帧和 seek bar 没有搬走。

主节点的「后期处理」分组只有两个开关与摘要。完整参数位于同一个 Director 的「后期处理」页：

- 「全局精修」在每段第一次 H3 生成成功后执行低 denoise 二次采样。Upscale 模式会先解码视频
  latent，在像素空间严格使用所选 Lanczos、Upscale Model 或 NVIDIA RTX VSR，再 VAE encode，
  与原 audio latent 重新组成 AV latent 后进行 H3 二次采样。Steps 设为 0 时取第一次 steps 的
  约 40%，最少 8 steps。
- 「人脸精修」在有效多段结果组合后执行一次跨段 tracking，再建立平滑 crop、注入 H3 video
  latent、按人脸大小控制逐帧 denoise，最后用 Rect、Ellipse 或可选 SAM mask stitch 回原视频。
  因此 tracking 不会在每个 Segment 边界重新开始。

后期处理遵循严格的保底规则：所选算法失败、依赖缺失或 CUDA OOM 时，不会偷偷换算法、降低
分辨率或改变 mask。Global Refine 失败就保留该段 first-pass result；Face Refine 失败或没有检测到
脸就保留进入人脸精修前的 assembled result。主生成已有可用结果时，最终状态为
`SUCCESS_WITH_WARNING`，而不是让整条 Queue 报废。

Output 是唯一的模型成果中心，包含「实时 / 分段 / 多段 / 最终结果」四个视图、成果播放器、两条
独立的运行进度条和 report。Preview Settings 只显示在「实时」；「最终结果」改为显示原生 VIDEO
保存卡片，可手动保存，也可按每个 run 自动保存一次。保存直接复用 ComfyUI `VIDEO` 与文件计数器，
包含最终音频，不会重新执行 H3。Generation 中的原片 seek bar 是编辑工具；Output 中的 result seek
bar 才是生成成果播放器。播放时音频是画面主时钟，拖动 seek 会同时跳动画面与音频；无音频时使用
monotonic RAF 时钟，避免独立 timer 造成漂移。

Director 采样期间始终抑制 ComfyUI 默认 sampler preview。实时预览通过 sampling wrapper 取得
`latent_shapes`，还原 packed H3 video latent，并优先使用 temporal `taeh3` / TAEHV 解码；失败才回退
Latent2RGB。异步编码 queue 只保留小型 CPU/PIL 预览帧，不复制完整 H3 latent。Director Preview
关闭时不显示采样画面，但正常 ComfyUI 执行与进度仍然工作。

所有设置（含预览与保存选项）保存在追加于旧 widget 序列末尾的一份内部 JSON 中。旧 workflow
打开时两项后期处理和自动保存默认关闭，Generation 行为和旧 `widgets_values` 索引保持不变。正式输出仍然只有
`images / audio / fps / frame_count / source_images / report`，不会额外输出或长期保留多份中间
IMAGE batch。

# 当前限制

- Motion Context 当前要求 24 fps。
- Segment 1 永远不能读取 Previous Context。
- pin_renorm 是默认关闭的实验功能，只作用于 video latent handoff。
- Source Bridge 只用于 V2V / RV2V，并固定为 5 帧策略。
- RV2V 素材库当前只开放图片、音频和 Prompt。
- RV2V 的 Source Video 仍从 Director 本地上传。
- RV2V 当前不会从素材库加入额外 Reference Video。
- 素材库支持新增和重命名小分类，目前不支持删除小分类。
- 不同 H3 模型版本、量化、Turbo / LoRA 和采样配置的真实效果可能不同。

---

# Demo

仓库中保留了现有演示视频：

| 测试 | A | B |
|---|---|---|
| T2V Test 1 | [查看 A](demo/t2v_test_1_a.mp4) | [查看 B](demo/t2v_test_1_b.mp4) |
| T2V Test 2 | [查看 A](demo/t2v_test_2_a.mp4) | [查看 B](demo/t2v_test_2_b.mp4) |
| I2V Test 1 | [查看 A](demo/i2v_test_1_a.mp4) | [查看 B](demo/i2v_test_1_b.mp4) |

这些 Demo 主要用来观察多段行为，不代表所有模型、采样器或加速配置下的最高画质。

---

# 项目关系与许可

本项目基于并大幅修改了：

- [AIMixer/ComfyUI_MiniMaxH3_Director](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director)
- [NikoDemon80/ComfyUI-H3-Motion-Context](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context)
- [Carasibana/ComfyUI-H3-FaceRefine](https://github.com/Carasibana/ComfyUI-H3-FaceRefine)（MIT，算法整合）

本仓库使用 GPL-3.0 发布。

第三方来源、原始许可与派生说明见：

- `LICENSE`
- `NOTICE`
- `LICENSES/`

---

# 遇到问题时建议提供

提交 Issue 时，最好附上：

- ComfyUI 版本 / commit
- H3 模型版本
- 使用哪一种生成模式
- 是否开启“续接上一段”（Motion Context）
- V2V / RV2V 是否使用 Source Bridge
- 一共有几段
- 大概用了哪些图片 / 音频 / 视频素材
- 完整报错日志
- 能复现问题的 workflow

这样比较容易判断问题出在模型、素材、缓存、续接还是 Director 本身。
