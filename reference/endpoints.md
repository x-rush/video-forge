# 端点契约备忘（fal 官方目录/价格 2026-10-10 核对；wan30 schema 实测）

> 状态标记：`[docs]` = 文档核对未实测；`[live]` = 真实调用验证过。实测后把本文件对应条目升级并写日期。

## fal.ai 队列 API（视频通道）[live 2026-10-10]

- 提交：`POST https://queue.fal.run/<endpoint>`，Header `Authorization: Key <FAL_KEY>`（**不是 Bearer**）
  → 200 `{ request_id, status_url, response_url, cancel_url }`
- 轮询：`GET status_url` → `status ∈ IN_QUEUE / IN_PROGRESS / COMPLETED`（视频约 10s-3min）
- 取结果：`GET response_url` → 成功回输出；worker 校验失败回 **422** `{ detail:[{loc,msg,ctx.expected}] }`（**不扣费**）
- 取消：`PUT cancel_url`（完成后 400 ALREADY_COMPLETED）
- ⚠️ **提交不预校验 body**：字段齐全的任何提交都真实排队出片扣费。零成本探测只能用缺必填/非法枚举值
- HTTP 401 = key 无效；402 = 余额不足
- 余额 API：`GET https://api.fal.ai/v1/account/billing?expand=credits` 需要 **Admin 级 key**，普通 key 403（实测）

### 模型矩阵（2026-10-10 与用户确认；**全部模型 schema 已 422-probe 实测**，价格=fal 目录现价）

使用准则：**文生视频与视频编辑 → wan30；图生视频 → h3-max-turbo；高质感 → seedance；原生音频 → omni-flash-11；2K/4K → h3**

| alias | t2v endpoint | i2v | edit | 价格 | schema [live 2026-10-10] |
|---|---|---|---|---|---|
| wan30 | alibaba/wan-3.0/text-to-video | …/image-to-video | …/reference-to-video（video-to-video） | $0.05/s@480p · $0.10@720p · $0.20@1080p | prompt 必填 · resolution 480p/720p/1080p · aspect adaptive/16:9/4:3/1:1/3:4/9:16 · **duration int** · **输出含音轨（实测）** |
| seedance20 | bytedance/seedance-2.0/text-to-video | …/image-to-video | — | $0.3034/s@720p（fast $0.2419 · mini $0.0721@480p · us $0.37） | resolution 480p/720p/1080p/4k · **duration 'auto','4'-'15' 字符串** · aspect auto/21:9/16:9/4:3/1:1/3:4/9:16 |
| seedance25 | bytedance/seedance-2.5/text-to-video | …/image-to-video | …/draft/complete（$1.164/s） | $0.2205/s@480p · $0.473@720p · $1.164@1080p | resolution 480p/720p/1080p · **duration 'auto','4'-'30' 字符串（最长 30s）** · aspect 同 2.0 |
| h3 | minimax/h3/text-to-video | …/image-to-video | — | $0.05/s@480P · $0.06@768P · $0.13@2K · $0.16@4K | **resolution 大写 480P/768P/2K/4K** · duration int · 无 aspect 字段 |
| h3-max | minimax/h3-max/text-to-video | …/image-to-video | extend/relight/recast/insert/3d-to-video/camera-controls/director/lip-sync | 促销 $0.03/s@480P · $0.048@768P · $0.096@1080P（10-15 后 $0.05/$0.08/…） | **resolution 大写 480P/768P/1080P** · **duration float（小数）** |
| h3-max-turbo | minimax/h3-max-turbo/text-to-video | …/image-to-video | extend-video | 促销 **$0.015/s@480P** · $0.024@768P · $0.048@1080P（10-15 后 $0.025/$0.04/$0.08） | resolution 大写 480P/768P/1080P · duration float · **输出 {video:{url,…}, expanded_prompt}，默认 ~6.6s/768P 含音轨，内置 prompt 扩写** · **i2v 全链实测（13s 墙钟）** |
| omni-flash | google/gemini-omni-flash | …/image-to-video | …/edit | token 计费 ≈$0.125/s@720p（输入也计 $1.875/M） | aspect 16:9/9:16 · duration int · **无 resolution 字段** |
| omni-flash-11 | google/gemini-omni-flash/v1.1/text-to-video | …/v1.1/image-to-video | …/v1.1/edit | $0.03/s@360p · $0.10@720p · $0.15@1080p · $0.30@4K | resolution 360p/720p/1080p/4k · aspect 16:9/9:16 · duration int |

- ⚠️ 队列命名空间 = 端点**前两段**：omni-flash-1.1 的 status/response 在 `google/gemini-omni-flash/requests/{id}`，带 `/v1.1` 会 405（实测，--resume 已修）
- ⚠️ 探测工艺实录：非法枚举值探测对全部 8 模型有效（worker 先入队后校验，422 不扣费）——但**提交到拒绝有几秒窗口**，必须带"立即 cancel"保险；h3-max-turbo 同族内行为也可能不同（h3/h3-max 拒绝与 turbo 入队在同一轮发生）
- hailuo-2.3 / hailuo-02 家族未入矩阵（用户指定 H3）；需要时加 JSON 即可

## Replicate 视频通道 [auth-verified 2026-10-10]

- `POST https://api.replicate.com/v1/models/<owner>/<name>/predictions`，Header `Authorization: Bearer <token>` + `Prefer: wait`（挂起 ~60s）
- 轮询 `GET /v1/predictions/{id}` → `status ∈ starting/processing/succeeded/failed/canceled`
- 视频输出形态：url 字符串 / 字符串数组 / {video:url}；按 GPU 时长计费
- [live 2026-10-10] 鉴权+校验通路实测：`minimax/hailuo-02` 空 input → 422 `"prompt is required"`（token 有效、端点形状正确）；账户余额 <$5 时创建限速 6 次/分钟（429 实录）
- token 配置：`REPLICATE_API_TOKEN` 环境变量或 `providers/token.txt`（gitignored）

## ElevenLabs TTS [live 2026-10-10]

- 合成：`POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`，Header `xi-api-key`（非 Bearer），body `{ text, model_id, voice_settings?:{speed} }` → audio/mpeg 二进制
- 模型：`eleven_flash_v2_5` / `eleven_turbo_v2_5`（0.5 credit/字符）· `eleven_multilingual_v2`（1 credit/字符，中文最佳）
- 订阅：`GET /v1/user/subscription` → `{ tier, character_count, character_limit, next_character_count_reset_unix }`；**免费档 10,000 字符/月**（实测 tier=free）
- 音色：`GET /v1/voices`；⚠️ **免费档 API 禁用库音色**（premade/professional 全部 402 `paid_plan_required`，与字符余量无关）——**category=generated 的自有音色可用**（实测"阿川"全链出声 3.8s/24 字符）
- HTTP 401 key 无效 · 402 库音色或额度 · 422 参数

## 火山引擎 TTS（豆包）[docs；probe 实录 2026-10-10]

- `POST https://openspeech.bytedance.com/api/v1/tts`
- Header：`Authorization: Bearer;<token>`（⚠️ 官方格式带**分号**）+ `Content-Type: application/json`
- body：`{ app:{appid, token, cluster:"volcano_tts"}, user:{uid}, audio:{voice_type, encoding:"mp3", speed_ratio}, request:{reqid:uuid, text, operation:"query"} }`
- 成功：`{ code:3000, data:"<base64 mp3>" }`；失败 code≠3000
- ⚠️ **appid 必填**：缺 appid 实测 `{"code":3001,"message":"...Missing required: app.appid"}`；UUID 形状的 VOLC_TTS_API_KEY 是 openspeech token，**不是**方舟 Ark key（Ark 端点实测 401 "API key doesn't exist"）
- appid = 火山控制台-语音技术-应用管理，9 位数字，非机密；音色枚举以控制台-音色管理页为准

## 冒烟测试清单
1. ✅ [live] fal `wan30` t2v 全链：181s 墙钟 → 854x480/5.0s/含音轨，账本 $0.25
2. ✅ [live] fal `h3-max-turbo` i2v 全链：13s 墙钟 → 1344x768/5.2s/含音轨，image_param=image_url 验证，账本 $0.09（默认 768P 实扣 ~$0.125）
3. ✅ [live] 全部 8 模型枚举 422-probe 回填（$0；工艺教训见 lessons.md）
4. ✅ [live] ElevenLabs：库音色 402 paid_plan_required（免费档政策）→ 自有音色"阿川"出声 3.8s
5. ✅ [live] assemble 双模式：视频+配音（0.1s）/ +BGM 闪避+fade（0.3s），5.0s 含音轨 ✓
6. ✅ [live] Replicate 通道：422 prompt-required（鉴权+通路 ✓），限速 <$5 余额 6 次/分钟
7. ⏸ 火山 TTS：等 VOLC_TTS_APPID
8. ✅ [live] music-forge suno-v6 / v6-mini（另一仓库，见其 endpoints.md）
9. ⏸ seedance/h3/omni 出片未实测（schema 已 live；首跑按预算逐个来，单发 $0.09-2.9）
