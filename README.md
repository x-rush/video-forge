# video-forge

Multi-channel AI video generation + voiceover assembly engine for AI coding agents —
text-to-video, image-to-video, video editing, TTS voiceover (zh/en) and ffmpeg
assembly. Same family as [image-forge](https://github.com/x-rush/image-forge) and
[music-forge](https://github.com/x-rush/music-forge): model routing, endpoints,
parameter enums and pricing live in one JSON registry — **adding a model is
configuration, not code**. Zero dependencies beyond Node >= 18 (ffmpeg/ffprobe
for assembly and duration checks).

| Channel | Models | Auth | Billing | Status |
|---|---|---|---|---|
| fal.ai (queue API) | `wan30`, `seedance20`, `seedance25`, `h3`, `h3-max`, `h3-max-turbo`, `omni-flash`, `omni-flash-11` | `FAL_KEY` | per second × resolution ($0.015-1.16/s) | **schemas live-verified**; wan30 + h3-max-turbo full-chain live |
| ElevenLabs (TTS, English) | flash/turbo/multilingual v2.5 | `ELEVENLABS_API_KEY` | free tier 10k chars/mo (library voices need paid plan via API) | live-verified (own generated voices) |
| Volcano 豆包 (TTS, Chinese) | seed-tts-2.0 voices (`_uranus_bigtts`) | `VOLC_TTS_API_KEY` | per char | live-verified (V3 unidirectional) |
| Replicate (video) | scaffold | `REPLICATE_API_TOKEN` | GPU time | auth-verified; first real run pending |

> fal.ai is an aggregator: vendor pricing may change (H3 promo rates end
> 2026-10-15). Generation costs real money per submit — budget gates via
> `budget.mjs`, overspend exits 2.

## Install

```bash
git clone https://github.com/x-rush/video-forge.git ~/.agents/skills/video-forge
```

Set keys as env vars (token-file alternatives in `models.json`):

```bash
export FAL_KEY=...               # fal.ai, required for video
export ELEVENLABS_API_KEY=...    # optional, English voiceover
export VOLC_TTS_API_KEY=...      # optional, Chinese voiceover (Doubao seed-tts V3)
```

Voiceover language split: **Chinese → volc (Doubao), English → ElevenLabs.**

## Usage

```bash
GEN=~/.agents/skills/video-forge/scripts/gen-video.mjs

# Cheapest t2v — wan-3.0 480p×5s ≈ $0.25 (silent)
node $GEN --model wan30 --prompt "雨夜霓虹街头，慢镜头" --resolution 480p --duration 5

# i2v first choice — H3 Max Turbo promo $0.015/s → 6s ≈ $0.09
node $GEN --model h3-max-turbo --image first-frame.png --prompt "镜头缓缓推进"

# Native audio — Gemini Omni Flash 1.1, 360p $0.03/s
node $GEN --model omni-flash-11 --prompt "海边日出，海浪与鸥鸣" --duration 5

# Video editing (docs) — wan-3.0 reference-to-video
node $GEN --model wan30 --video-input clip.mp4 --prompt "改成赛博朋克色调"

# Premium tiers — think before you spend
node $GEN --model seedance25 --prompt "史诗级航拍穿越峡谷"   # $0.22-1.16/s

# Re-fetch a finished request (download only, no re-charge)
node $GEN --model wan30 --resume <request_id>

# Voiceover + assembly
TTS=~/.agents/skills/video-forge/scripts/gen-tts.mjs
node $TTS --text "大家好，欢迎收看本期节目。" --model eleven_flash_v2_5 --out vo.mp3
node $TTS --quota          # ElevenLabs remaining chars
node ~/.agents/skills/video-forge/scripts/assemble.mjs \
  --video video.mp4 --voiceover vo.mp3 --bgm music.mp3 --duck --fade 0.5

# Spend / budget (dual axis: video USD + TTS chars)
node ~/.agents/skills/video-forge/scripts/budget.mjs --check
node ~/.agents/skills/video-forge/scripts/budget.mjs --set 10 --set-chars 5000
```

Selection rules (user-mandated 2026-10-10): **t2v & video editing → wan30;
i2v → h3-max-turbo; premium narrative → seedance; native audio → omni-flash-11;
2K/4K → h3.** Silent models get dubbed via gen-tts + assemble.

Every successful generation appends to `scripts/gen-log.jsonl` (gitignored).
Output lands in `./video-output/<timestamp>-<model>/video.mp4` plus `meta.json`
with the full task payload.

## Extending

- **Add a model**: read the fal model page → add an entry to `models.json`
  (`endpoint` / `image_endpoint` / `edit_endpoint` / enums / `price_per_second`) →
  one smoke generation → backfill live enums. No code changes.
- **Add a channel**: copy the contract in `providers/fal-video.mjs`, implement
  `generate()`, register `auth_env` / `auth_file` in `models.json` providers.

## License

MIT. Keys, generated videos and spend logs stay on your machine.
