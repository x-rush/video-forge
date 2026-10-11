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
- **隐藏参数面 [live 2026-10-10] 批量探测实录**（非法值 + duration 保底触发 422 列举）：wan30 有 `seed:int`/`enable_prompt_expansion:bool`/`audio:bool`；seedance 双子有 `seed:int`/`generate_audio:bool`（原生音频！）；H3 全家 `seed:int`/`enable_prompt_expansion:bool`（expanded_prompt 的开关）；omni-1.1 无任何候选字段（极简 schema）；omni v1 行为不可测（本轮取消生效 499，未获数据）。已全部回填 registry，`--seed`/`--no-audio` 已 CLI 化
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

## 火山引擎 TTS（豆包 V3 seed-tts）[live 2026-10-10]

- 端点：`POST https://openspeech.bytedance.com/api/v3/tts/unidirectional`
- 鉴权三头：`X-Api-Key: <VOLC_TTS_API_KEY>` + `X-Api-Resource-Id: seed-tts-2.0`（复刻音色换 `seed-icl-2.0`）+ `X-Api-Request-Id: <uuid>`——**不是 Bearer，无需 appid**（v1 的 appid+token 与本通道无关）
- body：`{ req_params: { text, speaker }, audio_params: { format: "mp3", sample_rate: 24000 } }`
- 响应：HTTP chunked 多段 JSON（NDJSON），每段 `data` 为 base64 音频帧，**拼接后整体解码**
- 定位分工（用户定）：**豆包=中文配音，ElevenLabs=英文配音**
- [live] `zh_female_vv_uranus_bigtts` 全链出声（4.7s/24 字符）；**speaker 资源分层：`_uranus_bigtts`=seed-tts-2.0，`_moon_bigtts`=1.0 系，`_mars_bigtts`=旧版 v1**——配错报 `code 55000000 resource ID is mismatched with speaker related resource`
- [live] 本 key 仅授权 seed-tts-2.0：对 `seed-tts-1.0` 任意 speaker 均 403 `45000030 requested resource not granted`
- 音色全列表：官方 `ListSpeakers` 控制台 API（需 AK/SK 签名，ResourceIDs=["seed-tts-2.0"]）

## 冒烟测试清单
1. ✅ [live] fal `wan30` t2v 全链：181s 墙钟 → 854x480/5.0s/含音轨，账本 $0.25
2. ✅ [live] fal `h3-max-turbo` i2v 全链：13s 墙钟 → 1344x768/5.2s/含音轨，image_param=image_url 验证，账本 $0.09（默认 768P 实扣 ~$0.125）
3. ✅ [live] 全部 8 模型枚举 422-probe 回填（$0；工艺教训见 lessons.md）
4. ✅ [live] ElevenLabs：库音色 402 paid_plan_required（免费档政策）→ 自有音色"阿川"出声 3.8s
5. ✅ [live] assemble 双模式：视频+配音（0.1s）/ +BGM 闪避+fade（0.3s），5.0s 含音轨 ✓
6. ✅ [live] Replicate 通道：422 prompt-required（鉴权+通路 ✓），限速 <$5 余额 6 次/分钟
7. ✅ [live] 火山 TTS（豆包 V3 seed-tts）：`zh_female_vv_uranus_bigtts` 出声 4.7s/24 字符；复刻通道 seed-icl-2.0 待用户有复刻音色后验
8. ✅ [live] music-forge suno-v6 / v6-mini（另一仓库，见其 endpoints.md）
9. ⏸ seedance/h3/omni 出片未实测（schema 已 live；首跑按预算逐个来，单发 $0.09-2.9）

## 扩展端点全目录 [live 探测 2026-10-11]

> 全部端点已 422 探测必填字段（空 body → worker 校验错误，零扣费）。CLI：`--use <name>`（输入槽位按注册表 `input` 声明强制校验；长尾参数 `--advanced-json`）。

| 端点 | 必填/槽位 | 备注 |
|---|---|---|
| wan30 · reference-to-video | video_url + prompt（[docs] input_value_error 具体形态未验） | 参考视频驱动 |
| seedance20 · base/fast/mini 的 t2v+i2v+ref | t2v/ref: prompt · i2v: prompt+image_url | mini 档 $0.0721/s@480p 全场次低 |
| seedance25 · i2v | image_url 必填 | ref: body input_value_error（自定义校验，形态未验） |
| seedance25 · draft/complete | **draft_id** 必填 | video-to-video 成片，token 计费 |
| h3 · reference-to-video | prompt（image 参数未验） | |
| h3-max · extend / recast / insert / 3d | video_url（+prompt / +reference_image_urls / +start_time+resume_time / 单 video_url） | 编辑全家桶核心 |
| h3-max · relight | 空输入曾被接受并开跑（无必填校验，慎用防扣费） | |
| h3-max · camera-controls | image_url | |
| h3-max · lip-sync/image-to-video | image_url + audio_url | 口型对齐 |
| h3-max-turbo · extend-video | video_url + prompt | |
| omni v1/v1.1 · reference | prompt + image_urls（v1.1 ref 仅 prompt） | |
| omni v1/v1.1 · edit | prompt + video_url | |

⚠️ `minimax/h3-max/director` 端点不存在（404 Application not found）——fal 模型页列了但 API 无此路径。
