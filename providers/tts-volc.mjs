#!/usr/bin/env node
/**
 * 火山引擎 TTS 通道 V3 — 豆包 seed-tts 单向流式（unidirectional）
 *
 * 契约要点（用户提供 + 2026-10-10 实测）：
 *  - POST https://openspeech.bytedance.com/api/v3/tts/unidirectional
 *  - 鉴权三头（⚠️ 不是 Bearer，也不需要 appid——v1 那套 appid+token 与本通道无关）：
 *      X-Api-Key: <VOLC_TTS_API_KEY>
 *      X-Api-Resource-Id: seed-tts-2.0        （普通音色；复刻音色换 seed-icl-2.0）
 *      X-Api-Request-Id: <每次新生成的 uuid>
 *  - body: { req_params: { text, speaker }, audio_params: { format, sample_rate } }
 *  - 响应：HTTP chunked 多段 JSON（NDJSON），每段 data 为 base64 音频帧——拼接后整体解码
 *  - 定位：豆包负责中文配音（ElevenLabs 负责英文，见 SKILL.md 分工）
 */

import { randomUUID } from "node:crypto";

const ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";

export async function synthesize({ text, apiKey, resource = "seed-tts-2.0", speaker, format = "mp3", sampleRate = 24000, onLog = () => {} }) {
  onLog(`火山 V3 合成 ${text.length} 字符（${speaker} @ ${resource}）…`);
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "X-Api-Key": apiKey,
      "X-Api-Resource-Id": resource,
      "X-Api-Request-Id": randomUUID(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      req_params: { text, speaker },
      audio_params: { format, sample_rate: sampleRate },
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!r.ok) {
    const t = await r.text();
    if (r.status === 401 || r.status === 403) throw new Error(`火山 V3 HTTP ${r.status}：鉴权被拒——确认 VOLC_TTS_API_KEY 与 X-Api-Resource-Id（${resource}）匹配\n${t.slice(0, 300)}`);
    throw new Error(`火山 V3 HTTP ${r.status}: ${t.slice(0, 500)}`);
  }

  // chunked NDJSON：逐行解析收集 data（base64 帧拼接）；兜底正则抽 data 字段
  const raw = Buffer.from(await r.arrayBuffer());
  const frames = [];
  let code = null, message = null;
  for (const line of raw.toString("utf8").split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    let j; try { j = JSON.parse(s); } catch { continue; }
    if (typeof j.code === "number") { code = j.code; if (j.message) message = j.message; }
    if (j.data) frames.push(Buffer.from(j.data, "base64"));
  }
  if (!frames.length) {
    for (const m of raw.toString("utf8").matchAll(/"data"\s*:\s*"([A-Za-z0-9+/=]+)"/g)) frames.push(Buffer.from(m[1], "base64"));
  }
  if (code !== null && code !== 0 && !frames.length) {
    throw new Error(`火山 V3 合成失败 code=${code}: ${message ?? "无错误详情"}`);
  }
  if (!frames.length) throw new Error(`火山 V3 响应无音频帧: ${raw.toString("utf8").slice(0, 300)}`);
  return { audio: Buffer.concat(frames), chars: text.length };
}
