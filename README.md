# ComfyUI MiniMax H3 Motion Director

一个面向 **MiniMax H3 多段视频生成** 的 ComfyUI Director 节点。

它把时间轴、分段 Prompt、图片/音频/视频参考、Material Library、Motion Context、Source Bridge、局部重跑、缓存、内部/外接采样和导出集中到同一个节点里，目标是让 T2V / I2V / FL2V / R2V / V2V / RV2V 都能用同一套分段工作方式完成。

> 本项目是独立的第三方实现，不是 MiniMax、ComfyUI、AIMixer 或 ComfyUI-H3-Motion-Context 的官方发行版。

## 主要功能

- 支持 `T2V`、`I2V`、`FL2V`、`R2V`、`V2V`、`RV2V` 六种任务。
- 在节点内部编辑多段时间轴，每段拥有自己的 Prompt 和素材。
- 支持完整运行、`选择运行`、全部导出和逐 Segment 导出。
- 支持内部采样，也支持外接标准 ComfyUI `SAMPLER` + `SIGMAS`。
- 支持多段 `Motion Context`，用于延续上一段生成的视频状态和生成音频。
- V2V / RV2V 支持固定 5 帧的 `Source Bridge`。
- 可选 `Color Re-anchor`，用于降低长链生成中的累积性色彩漂移。
- R2V 支持 `Common References + Local References`。
- Prompt 中的参考素材使用稳定 asset ID；显示标签会根据当前有效素材重新编译成 `<Picture N>` / `<Video N>` / `<Audio N>`。
- 支持 `@` 当前任务素材选择菜单。
- 内置持久化 `Material Library`，可管理图片、音频、视频和 Prompt。
- 支持局部重跑所需的 Segment / Motion Context 缓存。
- 所有 MiniMax H3 路径统一使用 32 像素空间网格。

## 安装

将仓库克隆到 ComfyUI 的 `custom_nodes`：

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/j955229/ComfyUI-MiniMax-H3-Motion-Director.git
```

使用启动 ComfyUI 的同一个 Python 环境安装依赖：

```bash
python -m pip install -r ComfyUI/custom_nodes/ComfyUI-MiniMax-H3-Motion-Director/requirements.txt
```

Windows 便携版示例：

```powershell
python\python.exe -m pip install -r ComfyUI\custom_nodes\ComfyUI-MiniMax-H3-Motion-Director\requirements.txt
```

重启 ComfyUI 后，搜索：

```text
MiniMax H3 Motion Director
```

### 更新

```bash
cd ComfyUI/custom_nodes/ComfyUI-MiniMax-H3-Motion-Director
git pull
```

> 不建议同时启用独立版 `ComfyUI-H3-Motion-Context`。本项目已经内置并修改了相关 H3 runtime patch，同时加载两套 patch 可能冲突。

## 基本连接

通常需要：

- MiniMax H3 `MODEL`
- MiniMax H3 video VAE
- MiniMax H3 audio VAE
- MiniMax 兼容 CLIP / Text Encoder
- `MiniMax H3 Motion Director`

Director 主要输出：

| 输出 | 说明 |
|---|---|
| `images` | 生成的视频帧 |
| `audio` | 对应音频 |
| `fps` | 导出帧率 |
| `frame_count` | 可见导出总帧数 |
| `source_images` | 可选原片对比输出 |
| `report` | 当前任务、尺寸、采样、续接、缓存等诊断信息 |

## 最快使用流程

1. 连接 H3 模型、video VAE、audio VAE 和 CLIP。
2. 在 Director 中选择 `task_type`。
3. 新建一个或多个 Segment。
4. 为每段填写 Prompt，并按模式添加图片、源视频或参考素材。
5. 多段任务按需要选择 `Motion Context`、`Source Bridge` 或关闭视觉续接。
6. 如果只想重跑部分 Segment，开启 `选择运行` 后勾选需要运行的段。
7. Queue 工作流。
8. 将 `images` / `audio` 接到自己的保存或合成节点。

## 六种任务模式

| 模式 | 用途 | Director 中的主要语义 |
|---|---|---|
| `T2V` | Text to Video | 每段由 Prompt 生成视频和音频。 |
| `I2V` | Image to Video | 每条连续链从初始图片开始；开启 Motion Context 后，后续空图片段可以延续上一段。 |
| `FL2V` | First / Last Frame to Video | 支持仅首帧、首帧+尾帧、仅尾帧。 |
| `R2V` | Reference to Video | 每段使用 Picture / Audio / Video References；支持 R2V Common + Local。 |
| `V2V` | Video to Video | 当前 Segment 的 source video 作为该段 `<Video 1>`。 |
| `RV2V` | Reference Video to Video | 当前 Segment 的 source video 为 `<Video 1>`，再叠加 Picture / Audio References。 |

### I2V

- Motion Context 关闭时，每个 Segment 都需要自己的图片。
- Motion Context 开启时，连续链的第一段需要图片；后续段可以留空并延续上一段。
- 后续某段显式上传新图片时，会建立新的 I2V anchor，从该段开始形成新的连续链。

### FL2V

每个镜头可使用：

- First Frame
- First + Last Frame
- Last Frame only

仅尾帧时不会伪造首图；尾图仍按官方 last-frame conditioning 处理。

### R2V

R2V 同时支持：

- `Common References`：多个 Segment 共用的参考素材池。
- `Local References`：只属于当前 Segment 的参考素材。

执行时按：

```text
Common → Local
```

重新压成连续官方槽位，不保留空洞。

例如：

```text
Common: A, B, C
S1 Local: D

S1 effective refs: A, B, C, D
→ <Picture 1>, <Picture 2>, <Picture 3>, <Picture 4>
```

Common 不包含 Common Prompt；每个 Segment 的 Prompt 始终独立。

### V2V / RV2V

V2V / RV2V 的 `<Video 1>` 是**当前 Segment 对应的 source video**，不是把第一段视频重复给所有 Segment。

当前 RV2V runtime 以：

```text
<Video 1> Source Video + Picture References + Audio References
```

为主。Material Library 当前不会给 RV2V 分配额外 Video Reference，也不会从素材库替换 RV2V Source Video；Source Video 仍从 Director 本地上传。

## Material Library / 素材库

Director 内置独立素材库，用来长期保存常用素材。它不是当前任务的临时引用列表，也不依赖其他素材库插件。

### 支持的素材类型

| 类型 | 默认小分类 |
|---|---|
| 图片 | 人物 / 场景 / 道具 / 其他 |
| 音频 | 音色 / 台词 / 音效 / 音乐 / 其他 |
| 视频 | 人物 / 场景 / 动作 / 镜头 / 其他 |
| Prompt | 人物 / 场景 / 动作 / 运镜 / 风格 / 对白 / 其他 |

小分类使用第二层 Tab 显示。

- 可以新增小分类。
- 可以重命名小分类，包括默认分类。
- 分类改名时，该分类中的素材会一起迁移到新分类名称；素材文件和素材 ID 不变。
- 当前版本不提供删除小分类。

### 各模式可使用的素材库类型

| 模式 | 素材库可用类型 |
|---|---|
| T2V | Prompt |
| I2V | 图片、Prompt |
| FL2V | 图片、Prompt |
| R2V | 图片、音频、视频、Prompt |
| V2V | 视频、Prompt |
| RV2V | 图片、音频、Prompt |

RV2V 的 Source Video 仍使用 Director 自己的本地视频上传，不从 Material Library 选取。

### 选择方式

不同素材类型拥有独立编号队列：

```text
图片: 1, 2, 3...
音频: 1, 2, 3...
视频: 1, 2, 3...
Prompt: 1, 2, 3...
```

- 左键素材卡：添加一次选择。
- 同一素材可以重复添加多次。
- 右键素材卡：撤销该素材在当前队列中的最后一次选择。
- 撤销后当前类型会重新连续编号。
- `清除当页选取`：只清当前第二层小分类 Tab 中的选择。
- `清除所有页选取`：清空当前 task_type 下 Material Library 的所有选择队列。

FL2V 的图片额外分成两个独立角色队列：

```text
First Frame
Last Frame
```

同一图片可以同时作为 First Frame 和 Last Frame，也可以重复选择。

### 放大预览

图片、视频和 Prompt 卡片可以打开较大的素材预览层。

卡片预览使用 `contain`，不会为了填满卡片而强制裁切竖图。

### Apply / 应用

Material Library 的选择不会在点击卡片时立刻改时间轴，只有按 `应用` 才写入 Director。

相同的：

- 素材队列
- 目标 Segment
- Prompt 追加 / 替换模式

在已经成功应用后，再次点击 Apply 不会重复写入。只有真正改变选择、目标或 Prompt 应用方式后，才会形成新的应用操作。

### Sequence 型模式的分配

T2V / I2V / FL2V / V2V 使用顺序映射：

```text
第 1 个素材 → S1
第 2 个素材 → S2
第 3 个素材 → S3
...
```

如果 Segment 数量不足，Director 会按该模式建立需要的 Segment。

例：I2V

```text
图片 1 → S1 Start Image
图片 2 → S2 Start Image
图片 3 → S3 Start Image

Prompt 1 → S1 Prompt
Prompt 2 → S2 Prompt
Prompt 3 → S3 Prompt
```

V2V 中，素材库视频属于 Source Video 序列。

### R2V / RV2V 的分配

R2V / RV2V 不根据鼠标焦点、当前滚动位置或“最近编辑的 Segment”猜目标。

必须明确选择：

```text
应用到: S1 / S2 / S3 ...
```

R2V 额外支持：

```text
应用到: 公共素材
```

但 Prompt 不能应用到 R2V Common References。

### Prompt 素材

Prompt 支持：

- `追加`
- `替换`

Sequence 型模式按 Prompt 队列顺序分配到各 Segment。

R2V / RV2V 如果一次选中多个 Prompt，会先按选择顺序组合，再整体追加或替换目标 Segment 的 Prompt。

Prompt 是复制到当前任务中的文本，不是与素材库建立永久实时链接。

### 素材库实际保存路径

持久化素材库位于：

```text
<ComfyUI>/user/minimax_h3_motion_director/material_library/
```

结构大致为：

```text
material_library/
├─ library.json
├─ files/
└─ .uploads/
```

其中：

- `library.json`：素材元数据、分类、标题等。
- `files/`：真正保存的图片、音频和视频文件。
- `.uploads/`：上传过程的临时目录。

素材真正应用给 ComfyUI 工作流时，还会 materialize 到：

```text
<ComfyUI>/input/minimax_material_library/
```

如果要备份素材库，主要备份：

```text
<ComfyUI>/user/minimax_h3_motion_director/material_library/
```

## `@` Prompt 素材引用

在 Prompt 输入框中输入 `@` 可以选择**当前任务已经加载的 Reference Asset**。

`@` 菜单不是整个持久化 Material Library 的搜索器。

流程是：

```text
Material Library
→ 应用到当前任务
→ 成为当前任务的 Reference Asset
→ 才能在 @ 菜单中引用
```

内部 Prompt 使用稳定的 semantic token / asset ID 记录素材身份；真正执行时再根据当前有效顺序编译为：

```text
<Picture 1>
<Picture 2>
<Video 1>
<Audio 1>
...
```

因此前面某个参考素材被禁用或删除后，后面的显示编号可以变化，但 Prompt 仍然跟着同一个素材身份，不会因为编号变化自动绑到另一张图。

## Motion Context

Motion Context 用于多段生成之间的状态延续。

正常连续运行采用 latent-first handoff：上一段生成的 AV latent tail 会优先直接送入下一段，而不是每段都先保存 RGB 再重新 VAE encode。

持久化缓存同时保留有限的像素 / waveform fallback，用于以后只运行后续 Segment 时恢复上下文。

### 合法上下文长度

MiniMax H3 Motion Context 使用合法长度：

```text
1 / 5 / 22 / 39
```

请求值会根据可用帧数选择不超过请求值的合法长度。

### 帧率

Motion Context 当前要求：

```text
24 fps
```

### Audio Context

T2V / I2V / FL2V / R2V 的 H3 路径本身可以生成音频。

`Audio Context` 表示把上一段模型生成音频的尾部继续交给下一段，它不是“是否生成声音”的总开关。

V2V / RV2V 还可以有原声 / 生成音频 / 静音等输出语义；只有模型生成音频并采用 Motion Context 时，才会使用 generated-audio continuation。

## Color Re-anchor

Color Re-anchor 用于降低多段链式生成中的累积性色彩漂移，例如：

- 白平衡偏移
- 色温变化
- 色相变化
- RGB 通道比例逐段漂移
- 亮度 / 饱和度 / 对比度逐段变化

它只修正**即将作为下一段 Motion Context 输入的 visual context**，不会回头修改已经生成或已经导出的视频。

Source Bridge 路径不会执行 Color Re-anchor。

## Source Bridge

Source Bridge 仅用于：

```text
V2V
RV2V
```

当前实现固定使用 5 帧 H3 source window，在 Segment 边界重新生成过渡区域。

它和 visual Motion Context 互斥：

```text
Source Bridge
Motion Context
关闭视觉续接
```

三者属于不同的边界策略，不会同时叠加 visual conditioning。

## 选择运行 / 局部重跑

开启 `选择运行` 后，可以只运行指定 Segment。

这适合：

- 修改某一段 Prompt 后只重跑该段。
- 调整某段参考素材。
- 长时间轴中只修一小段。
- 复用已有前段 Motion Context / Segment cache。

`选择运行` 关闭后恢复正常完整序列运行。

如果后续 Segment 的 Motion Context 依赖前段，而当前 Queue 没有重新生成前段，Director 会尝试读取对应持久化上下文缓存；缺少必要缓存时会明确报错，而不是静默换成另一种语义。

## 缓存

Director 使用版本化磁盘缓存支持局部重跑和跨 Queue 连续性。

主要包括：

- Segment cache
- Motion Context RGB / waveform fallback
- Motion Context AV latent tail

缓存只服务于重跑和连续性恢复，不等于最终视频导出文件。

修改真正影响某 Segment 生成结果或其有效上游上下文的内容时，对应缓存会失效并重新生成。

## 内部与外接采样

采样方式根据连接自动决定。

### 内部采样

不连接 `sampler` / `sigmas` 时，使用 Director 内部设置：

- `steps`
- `sampler_name`
- `scheduler`
- `shift_video`
- `shift_audio`

### 外接采样

同时连接标准 ComfyUI：

```text
SAMPLER
SIGMAS
```

时使用外接采样。

只连接其中一个会报错，不会静默混用内部 / 外部配置。

## 尺寸与 H3 时间长度

### 32 像素空间网格

所有 MiniMax H3 任务统一使用：

```text
width % 32 == 0
height % 32 == 0
```

这适用于 T2V、I2V、FL2V、R2V、V2V、RV2V，也适用于 Motion Context、Reference Video、Source Bridge 等相关 visual conditioning。

### `17k + 5`

H3 Reference Video 的合法时间长度遵守：

```text
5, 22, 39, 56, 73, 90, 107, 124, 141, ...
```

Director 会为 conditioning 准备合法长度，再按用户真正需要的可见 Segment 长度裁切最终输出。

## External Groups / Reroute

`i2v_groups` / `r2v_groups` 可以连接外部 Group / Groups Combine，也支持经过标准 ComfyUI Reroute、rgthree Reroute 和明确的虚拟直通节点。

R2V External Group 的 Local 素材仍来自对应 Group；Common References 继续由 Director 自己管理。

## 导出

Director 支持：

- 合并全部 Segment 导出。
- 按 Segment 分开导出。

生成语义和导出方式是两件事：选择“分段导出”不会自动把本来连续的生成链改成互相独立的生成任务。

## 当前限制

- Motion Context 当前要求 24 fps。
- Source Bridge 仅用于 V2V / RV2V，并固定为 5 帧策略。
- RV2V Material Library 当前只开放图片、音频、Prompt；Source Video 仍使用 Director 本地上传。
- 当前 RV2V 路径不会从 Material Library 添加额外 Reference Video。
- Material Library 目前支持新增 / 重命名小分类，但不支持删除小分类。
- 自动测试和静态检查只能验证实现与回归路径，不能保证所有模型版本、量化方式、Turbo / LoRA 组合和素材都获得相同生成效果。

## Demo

仓库中保留了现有演示视频：

| 测试 | A | B |
|---|---|---|
| T2V Test 1 | [查看 A](demo/t2v_test_1_a.mp4) | [查看 B](demo/t2v_test_1_b.mp4) |
| T2V Test 2 | [查看 A](demo/t2v_test_2_a.mp4) | [查看 B](demo/t2v_test_2_b.mp4) |
| I2V Test 1 | [查看 A](demo/i2v_test_1_a.mp4) | [查看 B](demo/i2v_test_1_b.mp4) |

这些 Demo 用来观察多段行为，不应视为当前所有模型、采样器或加速配置下的最高画质基准。

## 项目关系与许可

本项目基于并大幅修改了：

- [AIMixer/ComfyUI_MiniMaxH3_Director](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director)
- [NikoDemon80/ComfyUI-H3-Motion-Context](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context)

本仓库使用 GPL-3.0 发布；第三方来源、原始许可与派生说明见：

- `LICENSE`
- `NOTICE`
- `LICENSES/`

## 开发状态

这个项目仍在快速迭代。Director 的时间轴、Motion Context、缓存、Material Library 和多模态参考路径会继续根据真实 MiniMax H3 测试结果调整。

如果遇到问题，提交 Issue 时建议附上：

- ComfyUI 版本 / commit
- 使用的 H3 模型版本
- task_type
- 是否开启 Motion Context / Source Bridge
- Segment 数量与大致素材类型
- 完整报错日志
- 能复现问题的 workflow
