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

### 模型矩阵（2026-10-10 与用户确认；价格为 fal 目录现价）

使用准则：**文生视频与视频编辑 → wan30；图生视频 → h3-max-turbo；高质感 → seedance；原生音频 → omni-flash-11；2K/4K → h3**

| alias | endpoint (t2v) | i2v | edit | 价格 | schema 状态 |
|---|---|---|---|---|---|
| wan30 | alibaba/wan-3.0/text-to-video | …/image-to-video | …/reference-to-video（video-to-video） | $0.05/s@480p · $0.10@720p · $0.20@1080p | **[live]** prompt 必填；resolution 480p/720p/1080p；aspect adaptive/16:9/4:3/1:1/3:4/9:16；duration int |
| seedance20 | bytedance/seedance-2.0/text-to-video | …/image-to-video | — | $0.3034/s@720p（fast $0.2419 · mini $0.0721@480p · us $0.37） | [docs] |
| seedance25 | bytedance/seedance-2.5/text-to-video | …/image-to-video | …/draft/complete（$1.164/s） | $0.2205/s@480p · $0.473@720p · $1.164@1080p（us 档 $0.5676@720p） | [docs] |
| h3 | minimax/h3/text-to-video | …/image-to-video | — | $0.05/s@480p · $0.06@768p · $0.13@2K · $0.16@4K | [docs] |
| h3-max | minimax/h3-max/text-to-video | …/image-to-video | extend/relight/recast/insert/3d-to-video/camera-controls/director/lip-sync | 促销 $0.03/s@480p · $0.048@768p · $0.096@1080p（10-15 后 $0.05/$0.08/…） | [docs] |
| h3-max-turbo | minimax/h3-max-turbo/text-to-video | …/image-to-video | extend-video | 促销 **$0.015/s@480p** · $0.024@768p · $0.048@1080p（10-15 后 $0.025/$0.04/$0.08） | **[live]** 成片全链实测：默认 ~6.59s/1344x768/**含音轨**；输出 `{video:{url,content_type,file_name,file_size}, expanded_prompt}`（H3 内置 prompt 扩写）；其余枚举待回填 |
| omni-flash | google/gemini-omni-flash | …/image-to-video | …/edit | token 计费：输出 $21.875/M ≈ $0.125/s@720p；输入文本/音频/视频 $1.875/M | [docs] |
| omni-flash-11 | google/gemini-omni-flash/v1.1/text-to-video | …/v1.1/image-to-video | …/v1.1/edit | $0.03/s@360p · $0.10@720p · $0.15@1080p · $0.30@4K | [docs] |

- 枚举待实测的模型：registry 只声明 prompt，实测后回填（wan30 为范本：探非法枚举值让 worker 422 列出合法档）
- H3 促销价 2026-10-15 截止，过期同步注册表
- hailuo-2.3 / hailuo-02 家族未入矩阵（用户指定 H3）；需要时加 JSON 即可

## Replicate 视频通道 [docs；UNTESTED]

- `POST https://api.replicate.com/v1/models/<owner>/<name>/predictions`，Header `Authorization: Bearer <token>` + `Prefer: wait`（挂起 ~60s）
- 轮询 `GET /v1/predictions/{id}` → `status ∈ starting/processing/succeeded/failed/canceled`
- 视频输出形态：url 字符串 / 字符串数组 / {video:url}；按 GPU 时长计费
- token 配置：`REPLICATE_API_TOKEN` 环境变量或 `providers/token.txt`（gitignored）

## ElevenLabs TTS [live 2026-10-10]

- 合成：`POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`，Header `xi-api-key`（非 Bearer），body `{ text, model_id, voice_settings?:{speed} }` → audio/mpeg 二进制
- 模型：`eleven_flash_v2_5` / `eleven_turbo_v2_5`（0.5 credit/字符）· `eleven_multilingual_v2`（1 credit/字符，中文最佳）
- 订阅：`GET /v1/user/subscription` → `{ tier, character_count, character_limit, next_character_count_reset_unix }`；**免费档 10,000 字符/月**（实测 2026-10-10：tier=free，已用 844）
- 音色：`GET /v1/voices`；HTTP 401 key 无效 · 402 额度用尽

## 火山引擎 TTS（豆包）[docs；probe 实录 2026-10-10]

- `POST https://openspeech.bytedance.com/api/v1/tts`
- Header：`Authorization: Bearer;<token>`（⚠️ 官方格式带**分号**）+ `Content-Type: application/json`
- body：`{ app:{appid, token, cluster:"volcano_tts"}, user:{uid}, audio:{voice_type, encoding:"mp3", speed_ratio}, request:{reqid:uuid, text, operation:"query"} }`
- 成功：`{ code:3000, data:"<base64 mp3>" }`；失败 code≠3000
- ⚠️ **appid 必填**：缺 appid 实测 `{"code":3001,"message":"...Missing required: app.appid"}`；UUID 形状的 VOLC_TTS_API_KEY 是 openspeech token，**不是**方舟 Ark key（Ark 端点实测 401 "API key doesn't exist"）
- appid = 火山控制台-语音技术-应用管理，9 位数字，非机密；音色枚举以控制台-音色管理页为准

## 冒烟测试清单（重启后新会话执行）

1. fal 视频：`--model wan30 --prompt <测试> --resolution 480p --duration 5` → 全链 + ffprobe + 账本 est_usd（≈$0.25）
2. fal i2v：`--model h3-max-turbo --image <测试图> --prompt <短>` → 验证 image_param 名（docs 猜 image_url）+ 促销价
3. 新模型枚举回填：逐个用 wan30 同款 422 探测法（非法枚举值）实录 resolution/duration/aspect
4. ElevenLabs：`gen-tts --text <40字>` → mp3 + 账本 chars
5. assemble：ffmpeg testsrc 本地片 + 4 的 mp3 → 合成 → ffprobe 验证音轨与时长
6. Replicate：token 就绪后先 `flux-schnell` 类便宜模型验通路，再视频模型
7. 火山：VOLC_TTS_APPID 就绪后 `gen-tts --channel volc --text <短句>`
8. music-forge：`gen-music --model suno-v6 --prompt "轻快测试曲" --instrumental`（ACEDATA key 持久化后）
