# 提示词工程与参数选型（video-forge）

> 写 prompt / 选参数前先读本文件对应模型节。状态：`[live]` 实测、`[docs]` 官方文档与社区经验。
> 模型"选哪个"看 SKILL.md 准则与 models.json 的 best_for；本文件管"怎么写"和"参数怎么配"。

## 通用五层结构（全模型适用，按需取舍）

```
[主体与动作] + [镜头语言] + [环境与光线] + [风格与媒介] + （平台约束走参数，别写进 prompt）
```

1. **主体与动作**：具体动词，别堆形容词。"一只橘猫跳上窗台，尾巴扫过花瓶" ✓；"一只美丽的猫" ✗
2. **镜头语言**（英文术语各模型通吃）：push in / pull back / pan left→right / orbit / crane shot / handheld / POV / low-angle / slow motion / timelapse / dolly zoom
3. **环境与光线**：时间+天气+光源。黄金时刻、霓虹湿路面反射、阴天柔光、体积光
4. **风格与媒介**：实拍感 / 35mm 胶片颗粒 / 浅景深 / 赛博朋克动画 / 水墨
5. **画幅时长**：用参数下发（`--aspect 9:16 --duration 5`），写进 prompt 不可靠

负面内容用模型的 negative 参数（有才用），别混进正向 prompt。

**画幅速查**：9:16 抖音/视频号/Reels · 16:9 B站/YouTube/横屏 · 1:1 头图 · 21:9 电影感
**时长速查**：5-6s 单镜头循环 · 10s 简单叙事 · 15s+ 分镜叙事（seedance25 独占 30s）

## 分模型最佳实践

### wan30 —— 文生+编辑优先，预算主力 [live]
- **中文 prompt 原生友好**（阿里模型）：可以直接写中文，结构按五层来
- `--seed` 复现：定稿前用同 seed 迭代细节
- `enable_prompt_expansion` 默认即可；想完全掌控措辞可 `--advanced-json {"enable_prompt_expansion":false}` 试
- `audio` 开关（实测输出含音轨）：要纯哑片后期配音，先 `--no-audio` 试
- 编辑模式（`--video-input`，docs）：指令句（"改成赛博朋克色调，保持运镜不变"）

### seedance20 / seedance25 —— 高质感叙事 [docs]
- **强项多镜头分镜**：prompt 直接写 shot list，`[Shot 1] 中景：女主推门回头。[Shot 2] 特写：指尖划过桌面。` 每镜一句主体动作+镜头
- `generate_audio` 字段存在（原生音频，默认值未验）——需要可控哑片先 `--advanced-json {"generate_audio":false}`
- 时长给足：2 镜 ≥8s、3 镜 ≥12s；25 系最长 30s 适合微短片
- 价格高一个数量级：**先用 480p 试构图，定稿再上 720p**（4k 只给 seedance20）

### h3-max-turbo —— 图生视频首选 [live]
- **内置 prompt 扩写**（默认开）：短 prompt 会被大幅脑补（实测"t"被扩成完整分镜脚本）——控制力来自具体度：主体外观/动作/镜头/光线逐项写全，或 `enable_prompt_expansion:false`
- **i2v 黄金法则：首帧管构图，prompt 只管"动"**。写运动（推进/流动/飘落）、镜头、氛围变化，别复述画面里已有的东西
- **竖屏姿势**：H3 系无 aspect 字段——画幅由首帧图比例决定，用 image-forge 先出 9:16 首帧
- `--seed` 复现；试错用 480P，定稿 768P/1080P
- 输出的 `expanded_prompt` 务必看：它告诉你模型怎么理解你的 prompt，是调 prompt 的最好反馈

### omni-flash-11 —— 原生音频（画面+声音一体）[docs]
- prompt 里**直接写对白**（引号内台词）与音效描述："海浪拍岸，海鸥鸣叫，男主说'我们到了'。"——音频随视频生成
- **token 计费：prompt 本身也是成本**（输入 $1.875/M）——精炼，别堆形容词
- 试错 360p（$0.03/s），定稿 720p/1080p；4K $0.30/s 只给最终交付

### omni-flash（v1）—— 兜底 [docs]
- 同 v1.1 写法，但 token 行为不可测（枚举探测 8 模型里唯一的漏网者）且计费不透明——**只在 v1.1 不够用时兜底**

### h3 / h3-max —— 分辨率与编辑特化 [docs]
- `h3`：唯一支持 2K/4K 的 H3 档——高分辨率需求专用；写法同 turbo
- `h3-max`：自带编辑全家桶（extend/relight/recast/insert/3d-to-video/camera-controls/director/lip-sync）——走 `--advanced-json` 或后续 CLI 化；写法同 turbo

## 参数选型速查表

| 需求 | 命令要素 |
|---|---|
| 抖音竖屏单镜头 | `--model h3-max-turbo --image 竖屏首帧.png --prompt "<运动描述>"` |
| 横屏 BGM 循环（最便宜） | `--model wan30 --resolution 480p --duration 5 --no-audio` |
| 中文实拍感短片 | `--model wan30 --prompt "<中文五层结构>" --duration 10` |
| 多镜头叙事 | `--model seedance20 --prompt "[Shot 1]…[Shot 2]…" --duration 12` |
| 带台词/音效的成片 | `--model omni-flash-11 --prompt "<画面+台词+音效>" --resolution 720p` |
| 高分辨率交付 | `--model h3 --resolution 4K`（$0.16/s，确认预算再上） |
| 同构图批量试风格 | 首选模型 `--seed 42` 固定种子 + 改风格段 |
| 试错省钱顺序 | 480P/360p 短时长 → 看构图运镜 → 定稿参数重跑 |

## 成本意识

- 每发前报估算价（gen-video 会打印）；预算门 `budget.mjs` 超支 exit 2
- 试错永远用最低分辨率档 + 最短时长；seedance25（$0.47/s@720p）和 4K 档必须先报总价
- 促销价 H3 系 **2026-10-15 截止**（40% off），过期改注册表
