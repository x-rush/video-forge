# Lessons（每条都花了真金白银/踩了坑才进这里）

> 格式约定：`[docs]` 文档核对所得（动手前必读），`[live]` 真实调用验证所得。新教训往上加，带日期。

## 渠道与计费

- `[live 2026-10-10]` **fal 队列提交不校验 body**：9 次探测提交（空 body + 非法枚举）全部入队后由 worker 校验拒绝——幸运全部 422 零扣费，但若字段齐全就真出片了。结论：fal 视频模型**没有零风险的"试探请求"**，唯一安全的探测是"故意非法"（缺必填/非法枚举值），worker 会拒且不扣费；schema 拿到后立即回填 registry。
- `[live 2026-10-10]` fal 余额 API（/v1/account/billing）需要 Admin 级 key，普通 FAL_KEY 403。月预算只能靠本地账本 est_usd 自管。
- `[live 2026-10-10]` fal 月预算 $10 时，一发视频（$0.25-2）就能顶破——视频单发比生图贵一个量级，**每发前报估算价**是硬规矩。
- `[docs 2026-10-10]` H3 促销价 40% off（h3-max-turbo $0.015/s@480p）2026-10-15 截止，过期 registry 必须改价，否则账本失真。
- `[docs 2026-10-10]` omni-flash v1 是 token 计费（输入文本/音频/视频都计 token），预算难估算——优先 omni-flash-11（按秒按分辨率透明计费）。
- `[live 2026-10-10]` ElevenLabs 免费档实测：10,000 字符/月、月度重置、flash 系 0.5 credit/字符。
- `[live 2026-10-10]` 火山 TTS 走 V3（`X-Api-Key` 三头鉴权，**无需 appid**）——早前"缺 appid code 3001"的结论只适用旧版 v1 端点，是我拿 Bearer 头打 v3 才误判成 key 无效。**speaker 按资源分层：uranus=seed-tts-2.0 / moon=1.0 / mars=旧版**，配错报 55000000 mismatch；全列表要 AK/SK 签名的 ListSpeakers。中文配音归豆包、英文归 ElevenLabs（用户定的分工）。

## 提示词与参数

- `[live 2026-10-10]` 同名字段跨模型类型不一致：duration 在 wan/ltx 是 int、kling 是 '3'-'15' 字符串、veo 是 '4s' 带后缀字符串、hailuo 是 '6'/'10' 字符串——registry 按模型存枚举，CLI 收数字自动转目标形态。
- `[docs]` 视频模型 prompt 一般 ≤1500 字符，超长先精简分镜。

## 工程工艺

- `[live 2026-10-10]` **防误扣费守门（$0.16 学费）**：docs 状态模型上"看起来合法"的参数会被静默丢弃或直通——h3-max-turbo 一发 `--prompt t` 真实出片 6.59s/768p ≈$0.158。gen-video 现已强制：**registry 未登记枚举的字段，用户显式传参即硬报错**（--advanced-json 才是逃生口）。CLI 自测也必须走"死路径"（缺必填/未知别名/非法枚举），绝不能用合法参数打真实提交。
- `[live 2026-10-10]` **非法枚举探测法在本目录 8/8 模型上有效**（worker 先入队、校验失败 422 不扣费），但**提交到拒绝有几秒窗口**——探测必须带"立即 cancel"保险（本轮 6 连探全 422 零扣费，2 个取消请求来得及）。别假设同族行为一致：同一轮里 h3/h3-max 拒绝而 h3-max-turbo 入队。
- `[live 2026-10-10]` **fal 队列命名空间 = 端点前两段**（owner/model）：omni-flash-1.1 的 status/response 在 `google/gemini-omni-flash/requests/{id}`，带 `/v1.1` 子路径 405——fal-video.mjs 的 --resume 已按此修正。
- `[live 2026-10-10]` ElevenLabs 免费档 API **禁用库音色**（402 paid_plan_required，premade/professional 全被拒，与 10k 字符余量无关）；`category=generated` 的自有音色可正常合成。402 ≠ 额度用尽——错误文案必须透传响应体，别想当然。
- `[live 2026-10-10]` "哑片"假设不可靠：wan30 文档未提音频，实测 t2v 输出含音轨；H3 全系实测含音轨。audio 声明以 ffprobe 实测为准。
- `[live 2026-10-10]` **wan30 duration 上限 30s**（31 被 worker 422 "less than or equal to 30"，$0 学费）——int 型时长必须登记 duration_max 防呆；枚举型（seedance/kling/veo）天然免疫。
- `[live 2026-10-10]` 探测/测试前先确认矩阵和预算已获用户确认——本仓库首日就因抢跑被用户叫停一次（wan30 那发已批但矩阵未确认）。
- `[docs]` 图生视频输入：fal 各模型 image 参数名不一（多数 image_url），registry 用 image_param 字段声明；参考视频输入（edit）参数名同样未全验证，首跑小文件试水。
- `[docs]` BGM 循环铺满用 `-stream_loop -1`；配音对齐视频恒用 `-shortest + apad` 组合（配音短补静音、配音长裁到视频长，画面永不裁）。
- `[docs]` 预算双轴：视频按 est_usd（注册表价×时长）、TTS 按字符，两把尺子独立，超支 exit 2 与 image/music-forge 同语义。
- `[live 2026-10-11]` **fal 家族级路由故障判别法**（小拾/MV 场景亲历）：seedance-2.5 全端点曾出现"提交 200 → worker 0.02-0.12s 秒 COMPLETED → response_url 404（Path not found）"，小时级自愈。判别：**用最小合法参数对照重测**——若 worker 返回 422 校验错误 = 平台已恢复（参数/权限问题排除）；若仍 COMPLETED 假象 + 404 = 故障持续。fal 队列把拒绝类也标 COMPLETED 是语义陷阱，必须再 GET response_url 才能定性。
- `[live 2026-10-11]` seedance-2.5 的 first-last-frame 变体为 **Early Access/B2B**（官方页标注，不在公开 7 变体清单）——首尾帧变形需求用 H3 通道降级方案。family 变体以 fal 模型页实时清单为准（会重构：10-11 出现 us/* 区域档与 draft/complete 新划分）。
- `[live 2026-10-11]` v3b.fal.media CDN 有周期性 SSL 抖动（10-120s 自愈）——gen-video 下载已加重试 3 次；轮询重试此前已加。同类瞬时错误模式：先重试、后 resume，别急着定性失败。
