---
name: video-forge
description: Multi-channel AI video generation + voiceover assembly engine (fal.ai queue: Wan 3.0 / Seedance 2.0+2.5 / MiniMax H3 / Gemini Omni Flash; TTS via ElevenLabs + Volcano Doubao; ffmpeg assembly). Use whenever the user asks to generate video, 文生视频, 图生视频, 视频编辑, 配音, TTS, 口播, 短视频, BGM 混音, or mentions 视频, 视频配乐, 视频号, 抖音视频, short video, video clip, voiceover — even without saying "generate". Requires FAL_KEY (fal.ai); optional ELEVENLABS_API_KEY / VOLC_TTS_API_KEY+VOLC_TTS_APPID for voiceover; REPLICATE_API_TOKEN channel scaffolded. Zero dependencies beyond Node >= 18 (ffmpeg/ffprobe needed for assembly and duration checks). Model routing, endpoints, parameter enums and pricing live in one JSON registry — adding a model is configuration, not code.
---

# video-forge — Multi-Channel Video Generation + Voiceover Assembly

Generate AI video through the fal.ai queue API and assemble narrated videos with
TTS + ffmpeg — a zero-dependency Node CLI family member of
[image-forge](https://github.com/x-rush/image-forge) / [music-forge](https://github.com/x-rush/music-forge).
Model routing, endpoints, parameter enums and pricing live in one JSON registry —
**adding a model is configuration, not code**.

**Key setup**: `FAL_KEY` (fal.ai, required for video). Optional voiceover:
`ELEVENLABS_API_KEY`, or 火山 doubles `VOLC_TTS_API_KEY` + `VOLC_TTS_APPID`.
Replicate channel scaffolded (`REPLICATE_API_TOKEN`). **Never write keys to any
file, commit, document, or log.**

Single entry points: host projects create thin wrappers that forward arguments to
this skill's `scripts/` — never copy the implementation.

When triggered, the system provides a Base directory (referenced as `<skill>` below):

- `<skill>/scripts/gen-video.mjs` — video CLI (submit → poll → download → validate → ledger)
- `<skill>/scripts/gen-tts.mjs` — voiceover CLI (ElevenLabs / 火山，chars ledger + quota)
- `<skill>/scripts/assemble.mjs` — ffmpeg assembly (video + voiceover + BGM ducking)
- `<skill>/scripts/budget.mjs` — spend report + dual-axis monthly budget (video USD / TTS chars)
- `<skill>/providers/` — channel implementations (fal queue, replicate scaffold, 2× TTS)
- `<skill>/models.json` — registry: models, endpoints, enums, prices, TTS config
- `<skill>/reference/` — endpoint contracts and lessons

## Quick Start

```bash
GEN=<skill>/scripts/gen-video.mjs

# Cheapest t2v (wan-3.0 480p 5s ≈ $0.25, silent — dub later)
node $GEN --model wan30 --prompt "雨夜霓虹街头，慢镜头" --resolution 480p --duration 5

# Cheapest i2v, user-mandated first choice (H3 turbo 促销 $0.015/s → 6s ≈ $0.09)
node $GEN --model h3-max-turbo --image 首帧.png --prompt "镜头缓缓推进"

# Native-audio tier (Gemini Omni Flash 1.1, 360p $0.03/s)
node $GEN --model omni-flash-11 --prompt "海边日出，海浪声"

# Voiceover (ElevenLabs free tier) → assemble with ducking BGM
node <skill>/scripts/gen-tts.mjs --text "大家好，欢迎收看本期节目。" --out vo.mp3
node <skill>/scripts/assemble.mjs --video video.mp4 --voiceover vo.mp3 --bgm bgm.mp3 --duck

# Spend / budget
node <skill>/scripts/budget.mjs --check
```

Every successful generation appends to `scripts/gen-log.jsonl` (shared ledger,
gitignored; video rows carry `est_usd`, TTS rows carry `chars`).

## Workflow

1. **Budget check**: `budget.mjs --check` before the first generation of a session. 视频单发 $0.09-3，比生图贵一个量级。
2. **Confirm intent** (skip if user already stated all): ① 画面内容与画幅（16:9/9:16）② 时长 ③ 要不要原生音频/配音 ④ 用途平台。
3. **Model selection（用户准则 2026-10-10）**: 文生视频与视频编辑 → `wan30`；**图生视频 → `h3-max-turbo`**（i2v 首选，性价比之王）；高质感叙事 → `seedance20`/`seedance25`（贵，确认再上）；带原生音频 → `omni-flash-11`（360p $0.03/s）；2K/4K → `h3`。哑片模型配音走 gen-tts + assemble。
4. **Generate once → validate（ffprobe 时长/分辨率/音轨）→ 交付，让用户确认再迭代。** 每次迭代 = 一次提交 + 一次反馈，不要连环重生成。
5. **Assembly**: 默认丢弃原片音轨；`--clip-volume` 保留原生音轨（omni/带声模型混配音时用）。

## Critical Rules

Read `reference/lessons.md` — status markers: `[live]` 实测，`[docs]` 文档核对：

- ⚠️ **fal 队列提交不校验 body**：字段齐全的提交必然真实出片扣费；只有缺必填/非法枚举才被 worker 拒（不扣费）。**永远不要拿"试探请求"去打队列端点**——除非确认其参数非法，且必须挂"立即 cancel"保险。
- H3 促销价（40% off）**2026-10-15 截止**，过期后注册表 price 要改。
- `omni-flash`（v1）是 token 计费（输入文本/音频/视频也计费），预算难估——优先 `omni-flash-11`。
- 视频编辑（`--video-input`）与 H3-max 的编辑端点仍为 docs 状态，首跑先小片试水。
- 全部 8 模型枚举已实测回填 registry（2026-10-10）；长尾参数走 `--advanced-json`。
- ElevenLabs 免费档 API 禁库音色（402）——配音前先 `--list-voices` 选 category=generated 的自有音色。
- 预算双轴独立：fal 按美元、TTS 按字符，超支 exit 2 与 image/music-forge 同语义。

## Registry & Extending

`models.json` holds video models (endpoint / image_endpoint / edit_endpoint / enums /
prices) and TTS config. To add a model: read the fal model page → add a JSON entry →
one smoke generation → backfill live enums. To add a channel: copy
`providers/fal-video.mjs` contract, implement `generate()`, register in providers.

## Boundaries

- Content-production tool only — do not wire keys or channel calls into shipped product code.
- 商用发布注意各模型厂商商用授权条款；中转/聚合渠道产出权益可能与官方订阅不同。
- AI 生成视频的平台合规（标识 AI 生成内容）由使用方负责。
- 音乐/BGM 生成属于 music-forge（另行安装）；封面图属于 image-forge。
