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

## 先认识一个词：片段

Director 会把整支视频拆成一段一段来做。

界面和代码里有时会写 `Segment`，这里直接把它叫做 **片段**。

例如：

```text
S1 = 第 1 段
S2 = 第 2 段
S3 = 第 3 段
```

你可以让每一段有不同 Prompt、不同素材，也可以让它们连续生成。

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

# R2V 的“公共素材”是什么

技术名称是 `Common References`，这里直接叫 **公共素材**。

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

### Prompt 不放在公共素材里

公共素材区只负责参考素材。

每一段的 Prompt 仍然自己写自己的，不存在“所有片段共用一个公共 Prompt”的机制。

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

## 素材库有哪些类型

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

## 放大预览

图片、视频和 Prompt 卡片可以打开较大的预览。

图片缩略图会尽量完整显示，不会为了塞满卡片强行裁掉人物头部或身体。

## 点“应用”以后会发生什么

在素材库里点选素材时，不会马上修改时间轴。

只有点“应用”，Director 才会真正把这些素材放进当前任务。

同一批选择已经成功应用过以后，再按一次“应用”不会重复塞一遍。

如果你改变了：

- 选择的素材
- 要应用到第几段
- Prompt 使用“追加”还是“替换”

才会形成新的应用操作。

---

# 素材库怎么分配到各片段

## T2V / I2V / FL2V / V2V

这几种模式按选择顺序往后排。

例如选择 3 张图片：

```text
第 1 张 → S1
第 2 张 → S2
第 3 张 → S3
```

如果当前片段数量不够，Director 会自动补出需要的片段。

### I2V 例子

```text
图片 1 → 第 1 段起始图片
图片 2 → 第 2 段起始图片
图片 3 → 第 3 段起始图片

Prompt 1 → 第 1 段
Prompt 2 → 第 2 段
Prompt 3 → 第 3 段
```

### V2V

素材库里的视频在 V2V 中会作为 Source Video，按顺序分给各段。

### FL2V

FL2V 的图片分成两个独立用途：

```text
首帧
尾帧
```

你可以分别选择。

同一张图片也可以同时用作首帧和尾帧。

## R2V / RV2V

这两种模式不会猜“你现在想把素材放到哪一段”。

在点“应用”前，先明确选择：

```text
应用到：S1 / S2 / S3 ...
```

R2V 还多一个：

```text
应用到：公共素材
```

Prompt 不能放到公共素材区，只能放到某一个具体片段。

## Prompt 素材

Prompt 有两种用法：

- `追加`：接在原本 Prompt 后面。
- `替换`：直接替换原本 Prompt。

R2V / RV2V 如果一次选了多个 Prompt，会先按选择顺序组合，再一起追加或替换到目标片段。

素材库里的 Prompt 是复制过去的文字，不是永久链接。

之后修改素材库原本的 Prompt，不会自动改掉已经放进当前任务的那一份。

---

# 素材库实际保存在哪里

长期保存的素材库位于：

```text
<ComfyUI>/user/minimax_h3_motion_director/material_library/
```

结构大致是：

```text
material_library/
├─ library.json
├─ files/
└─ .uploads/
```

说明：

- `library.json`：素材标题、分类等资料。
- `files/`：真正保存的图片、音频、视频。
- `.uploads/`：上传时使用的临时目录。

应用素材以后，为了让 ComfyUI 工作流读取，还会复制一份到：

```text
<ComfyUI>/input/minimax_material_library/
```

如果你要备份整个素材库，主要备份：

```text
<ComfyUI>/user/minimax_h3_motion_director/material_library/
```

---

# Prompt 里的 `@` 是什么

在 Prompt 输入框输入 `@`，可以选择 **当前任务已经加入的参考素材**。

注意：

> `@` 不是用来搜索整个长期素材库的。

正确流程是：

```text
先从素材库选择素材
→ 应用到当前任务
→ 它变成当前任务的参考素材
→ 才能在 Prompt 中用 @ 引用
```

Director 内部会记住“你引用的是哪一个素材”，而不是死记 `<Picture 2>` 这种编号。

所以即使前面删除了一张图，后面素材的编号发生变化，Prompt 也不会莫名其妙改绑到另一张图。

真正执行时，Director 才会重新整理成 MiniMax H3 需要的官方标签：

```text
<Picture 1>
<Picture 2>
<Video 1>
<Audio 1>
...
```

---

# 怎么让第 2 段接着第 1 段

Director 提供几种不同的衔接方式。

## 续接上一段（Motion Context）

`Motion Context` 可以理解成：

> 把上一段结尾的生成状态交给下一段，让下一段不要完全从零开始。

它主要用于多段连续生成。

例如：

```text
S1 生成
→ 把 S1 结尾状态交给 S2
→ S2 接着生成
→ 再把 S2 结尾交给 S3
```

这比单纯在 Prompt 里写“继续上一段”更直接，因为模型真的会拿到上一段的上下文。

当前 Motion Context 要求：

```text
24 fps
```

可用的 H3 上下文长度是：

```text
1 / 5 / 22 / 39
```

一般用户不需要理解为什么是这些数字，只需要知道 Director 会按 H3 支持的长度处理。

## 延续上一段生成的声音

Audio Context 的意思是：

> 把上一段模型生成音频的尾巴也交给下一段。

它不是“有没有声音”的总开关。

T2V / I2V / FL2V / R2V 本身可以由 H3 生成音频。

V2V / RV2V 还会涉及：

- 模型生成音频
- 使用原视频声音
- 静音

只有走模型生成音频并使用 Motion Context 时，才会继续上一段 generated audio。

---

# Source Bridge 是什么

Source Bridge 只用于：

```text
V2V
RV2V
```

可以把它理解成：

> 两段原视频在交界处，不直接硬切，而是拿边界附近的原视频动作再生成一次过渡。

当前实现固定使用 5 帧窗口。

V2V / RV2V 的视觉衔接方式是三选一：

```text
Source Bridge
Motion Context
关闭视觉续接
```

Source Bridge 和 Motion Context 不会同时叠加视觉上下文。

---

# Color Re-anchor 是什么

长链连续生成时，有时颜色会一段一段慢慢漂掉，例如：

- 越来越黄
- 越来越蓝
- 白平衡变化
- 亮度变化
- 饱和度变化
- 对比度变化

Color Re-anchor 用来减轻这种累积偏色。

它只会处理“准备交给下一段的画面上下文”，不会回头修改已经生成好的视频。

Source Bridge 路径不会使用 Color Re-anchor。

---

# 只重跑某几段

开启 `选择运行` 后，可以只勾选想重新生成的片段。

例如：

```text
S1 没问题
S2 人脸坏了
S3 没问题
S4 动作不对
```

你可以只重跑：

```text
S2 + S4
```

适合：

- 修改某一段 Prompt
- 换某一段参考图
- 修长视频里的少数坏段
- 不想整条视频重新跑一次

如果后面的片段需要前面的 Motion Context，而这一次没有重新生成前段，Director 会尝试读取之前保存的上下文缓存。

如果必要缓存不存在，会直接报错，不会偷偷改成另一种生成方式。

---

# 缓存是干什么的

Director 会保存一些用于“局部重跑”和“跨 Queue 续接”的缓存。

主要包括：

- 完整片段缓存
- Motion Context 的画面 / 声音备用缓存
- Motion Context 的 H3 latent 尾部

这些缓存不是你最终导出的视频文件。

当 Prompt、素材、源视频或真正影响某段生成结果的设置发生变化，对应缓存会失效并重新生成。

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

# 下面是比较技术的说明

如果你只是想正常使用，看到这里基本已经够了。

下面主要给排错、调工作流或研究 H3 行为的人看。

## 32 像素尺寸规则

所有 MiniMax H3 路径统一使用 32 像素空间网格：

```text
width % 32 == 0
height % 32 == 0
```

适用于：

- T2V
- I2V
- FL2V
- R2V
- V2V
- RV2V
- Motion Context
- Reference Video
- Source Bridge

Director 会统一处理相关画布，避免同一工作流换模式以后突然使用不同的尺寸规则。

## H3 Reference Video 的 `17k + 5`

H3 Reference Video 支持的合法帧数类似：

```text
5, 22, 39, 56, 73, 90, 107, 124, 141, ...
```

Director 会先为 H3 conditioning 准备合法长度，最后仍然按用户真正需要的片段长度裁切输出。

也就是说，为模型准备的参考帧数和最终导出的可见帧数不一定完全一样。

## Motion Context 内部数据

正常连续运行优先使用 latent-first handoff。

简单说就是：

```text
上一段生成出的 H3 AV latent 尾部
→ 直接交给下一段
```

而不是每一段都必须：

```text
解码成 RGB
→ 保存
→ 再重新 VAE encode
```

为了支持以后只重跑后面的片段，Director 仍会保存有限的 RGB / waveform fallback 和 AV latent tail。

## R2V 官方标签

R2V 的公共素材和当前片段素材会在执行前重新压成连续编号。

例如：

```text
公共素材：A、B、C
当前片段自己的素材：D
```

最后可能变成：

```text
A = <Picture 1>
B = <Picture 2>
C = <Picture 3>
D = <Picture 4>
```

素材身份使用稳定 asset ID，所以可见编号变化时，Prompt 引用仍然能跟着正确素材。

## V2V / RV2V 的 `<Video 1>`

每一个片段只把自己对应的 Source Video 范围作为当前 `<Video 1>`。

Director 不会把整支第一段视频重复当成后面所有片段的 `<Video 1>`。

## External Groups / Reroute

`i2v_groups` / `r2v_groups` 可以连接外部 Group / Groups Combine。

也支持经过：

- 标准 ComfyUI Reroute
- rgthree Reroute
- 明确的虚拟直通节点

External R2V Group 提供的是各片段自己的素材；R2V 公共素材仍然由 Director 管理。

---

# 当前限制

- Motion Context 当前要求 24 fps。
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