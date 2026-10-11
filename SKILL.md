---
name: video-forge
description: 多通道 AI 视频生成 + 配音合成引擎（fal.ai 队列：Wan 3.0 / Seedance 2.0+2.5 / MiniMax H3 / Gemini Omni Flash；TTS 用 ElevenLabs 英文 + 火山豆包中文；ffmpeg 合成）。当用户要求生成视频、文生视频、图生视频、视频编辑、配音、TTS、口播、短视频、BGM 混音，或提到 视频、视频配乐、视频号、抖音视频、短片、video clip、voiceover 时使用——即使没有说"生成"。需要 FAL_KEY（fal.ai）；可选 ELEVENLABS_API_KEY（英文配音）/ VOLC_TTS_API_KEY（中文配音，豆包 seed-tts V3）；REPLICATE_API_TOKEN 通道已脚手架化。零依赖，Node ≥ 18（合成与时长校验需要 ffmpeg/ffprobe）。模型路由、端点、参数枚举与定价集中在一个 JSON 注册表——加模型=改配置，不改代码。
---

# video-forge — 多通道视频生成 + 配音合成引擎

通过 fal.ai 队列 API 生成 AI 视频，用 TTS + ffmpeg 合成配音视频——零依赖 Node CLI，image-forge / music-forge 的同族成员。模型路由、端点、参数枚举与定价集中在一个 JSON 注册表——**加模型=改配置，不改代码**。

**密钥配置**：`FAL_KEY`（fal.ai，视频必需）。可选配音：`ELEVENLABS_API_KEY`（英文）或火山 `VOLC_TTS_API_KEY`（中文，豆包 seed-tts V3）。**配音分工：中文 → volc 通道，英文 → elevenlabs 通道。** Replicate 通道已脚手架化（`REPLICATE_API_TOKEN`）。**密钥绝不写入任何文件、提交、文档或日志。**

单一入口：宿主项目创建薄包装，把参数转发给本 skill 的 `scripts/`——绝不复制实现。

触发时系统会提供 Base 目录（下文记作 `<skill>`）：

- `<skill>/scripts/gen-video.js` — 视频 CLI（提交 → 轮询 → 下载 → 校验 → 记账）
- `<skill>/scripts/gen-tts.js` — 配音 CLI（ElevenLabs / 火山，字符记账 + 余量查询）
- `<skill>/scripts/assemble.js` — ffmpeg 合成（视频 + 配音 + BGM 闪避）
- `<skill>/scripts/inspect.js` — 交付前审看（ffprobe 摘要 + 均匀抽帧）
- `<skill>/scripts/gen-srt.js` — 语音识别生成字幕（whisper 中英双语，data URI 直塞无需存储）
- `<skill>/scripts/budget.js` — 花费报表 + 双轴月度预算（视频美元 / TTS 字符）
- `<skill>/providers/` — 渠道实现（fal 队列、replicate 脚手架、2× TTS）
- `<skill>/models.json` — 注册表：模型、端点、枚举、价格、TTS 配置
- `<skill>/reference/` — 端点契约、提示词指南、质量矩阵与经验教训

## 快速开始

```bash
GEN=<skill>/scripts/gen-video.js

# 最便宜的文生视频（wan-3.0 480p 5s ≈ $0.25，哑片——后期配音）
node $GEN --model wan30 --prompt "雨夜霓虹街头，慢镜头" --resolution 480p --duration 5

# 图生视频首选（H3 turbo 促销 $0.015/s → 6s ≈ $0.09）
node $GEN --model h3-max-turbo --image 首帧.png --prompt "镜头缓缓推进"

# 原生音频档（Gemini Omni Flash 1.1，360p $0.03/s）
node $GEN --model omni-flash-11 --prompt "海边日出，海浪声"

# 配音（ElevenLabs 免费档）→ BGM 闪避合成
node <skill>/scripts/gen-tts.js --text "大家好，欢迎收看本期节目。" --out vo.mp3
node <skill>/scripts/assemble.js --video video.mp4 --voiceover vo.mp3 --bgm bgm.mp3 --duck

# 花费 / 预算
node <skill>/scripts/budget.js --check
```

每次成功生成都会追加到 `scripts/gen-log.jsonl`（共享账本，已 gitignore；视频行带 est_usd，TTS 行带 chars）。

## 工作流

1. **预算检查**：每次会话首次生成前先 `budget.js --check`。视频单发 $0.09-3，比生图贵一个量级。
2. **确认意图**（用户已说清则跳过）：① 画面内容与画幅（16:9/9:16）② 时长 ③ 要不要原生音频/配音 ④ 用途平台。
3. **模型选择（选型准则，2026-10-10 实测校准）**: 文生视频与视频编辑 → `wan30`；**图生视频 → `h3-max-turbo`**（i2v 首选，性价比之王）；高质感叙事 → `seedance20`/`seedance25`（贵，确认再上）；带原生音频 → `omni-flash-11`（360p $0.03/s）；2K/4K → `h3`。哑片模型配音走 gen-tts + assemble。
4. **提示词与参数**：遵循 `reference/prompting.md` — 五层 prompt 结构、分模型 do/don't、参数手册（seed / 音频开关 / 分辨率档位成本策略）。
5. **一次生成 → 校验（ffprobe 时长/分辨率/音轨）→ 交付，让用户确认再迭代。** 每次迭代 = 一次提交 + 一次反馈，不要连环重生成。
6. **合成**：默认丢弃原片音轨；`--clip-volume` 保留原生音轨（omni/带声模型混配音时用）；`--srt` 烧录字幕（口播标配）。交付前用 `inspect.js` 抽帧审看；各模型画质基准见 `reference/quality-matrix.md`。
7. **扩展端点**：`--use <name>` 调用注册表 `extra_endpoints`（h3-max 的 extend/relight/recast/lipsync、seedance 的 draft/mini/fast 档、omni 的 reference/edit 等，全目录见 endpoints.md）——input 槽位强制校验，防误扣费。
8. **配音语言分工**：中文配音 → `--channel volc`（豆包 seed-tts，`_uranus_bigtts` 系音色，复刻加 `--clone`）；英文配音 → `--channel elevenlabs`（免费档只能用自有 generated 音色）。

## 关键规则

阅读 `reference/lessons.md` — 状态标记：`[live]` 实测，`[docs]` 文档核对：

- ⚠️ **fal 队列提交不校验 body**：字段齐全的提交必然真实出片扣费；只有缺必填/非法枚举才被 worker 拒（不扣费）。**永远不要拿"试探请求"去打队列端点**——除非确认其参数非法，且必须挂"立即 cancel"保险。
- H3 促销价（40% off）**2026-10-15 截止**，过期后注册表 price 要改。
- `omni-flash`（v1）是 token 计费（输入文本/音频/视频也计费），预算难估——优先 `omni-flash-11`。
- 视频编辑（`--video-input`）与 H3-max 的编辑端点仍为 docs 状态，首跑先小片试水。
- 全部 8 模型枚举已实测回填 registry（2026-10-10）；长尾参数走 `--advanced-json`。
- ASR 用 fal-ai/whisper（中英双语，data URI 直塞无需存储上传）；音频 >8MB 先 ffmpeg 切半。
- ElevenLabs 免费档 API 禁库音色（402）——配音前先 `--list-voices` 选 category=generated 的自有音色。
- 内容合规：真人肖像/版权素材/商标的使用需获授权；平台要求的 AI 生成标识由使用方负责——提交前自检。
- 预算双轴独立：fal 按美元、TTS 按字符，超支 exit 2 与 image/music-forge 同语义。

## 注册表与扩展

`models.json` 保存视频模型（endpoint / image_endpoint / edit_endpoint / 枚举 / 价格）与 TTS 配置。加模型：读 fal 模型页 → 加一条 JSON → 跑一次冒烟生成 → 回填实测枚举。加渠道：复制 `providers/fal-video.js` 契约，实现 `generate()`，在 providers 注册。

## 边界

- 仅用于内容生产——不要把密钥或渠道调用接进交付的产品代码。
- 商用发布注意各模型厂商商用授权条款；中转/聚合渠道产出权益可能与官方订阅不同。
- AI 生成视频的平台合规（标识 AI 生成内容）由使用方负责。
- 音乐/BGM 生成属于 music-forge（另行安装）；封面图属于 image-forge。
