#!/usr/bin/env node
/**
 * ElevenLabs TTS 通道 — REST 同步，返回 mp3 二进制
 *
 * 契约要点（2026-10-10 live 实测）：
 *  - POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
 *    Header: "xi-api-key: <ELEVENLABS_API_KEY>"（不是 Bearer）
 *    body: { text, model_id, voice_settings?: { speed } }
 *    query: output_format=mp3_44100_128
 *  - 响应 = audio/mpeg 二进制；响应头 x-character-cost? 以响应头 character 相关字段为参考，
 *    记账兜底按 text.length 估（1 credit/字符 multilingual_v2、0.5 flash/turbo 系）
 *  - 订阅查询 GET /user/subscription → { tier, character_count, character_limit,
 *    next_character_count_reset_unix }（免费档 10,000 字符/月实测）
 *  - 音色列表 GET /voices → { voices: [{ voice_id, name, labels, … }] }
 *  - HTTP 401 = key 无效；402 = 字符额度用尽；422 = 参数错误（detail.message）
 *  - 中文：multilingual_v2 质量最好（1 credit/字符）；flash_v2_5 快且半价（0.5）
 */
const BASE = "https://api.elevenlabs.io/v1";

export async function synthesize({ text, apiKey, voiceId, modelId, speed, outputFormat = "mp3_44100_128", onLog = () => {} }) {
  const body = { text, model_id: modelId };
  if (speed && speed !== 1) body.voice_settings = { speed };
  onLog(`elevenlabs 合成 ${text.length} 字符（${modelId}）…`);
  const r = await fetch(`${BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${outputFormat}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) {
    const t = await r.text();
    let detail = t.slice(0, 400);
    try { const j = JSON.parse(t); if (j.detail?.message) detail = `[${j.detail.code ?? j.detail.type}] ${j.detail.message}`; } catch {}
    if (r.status === 401) throw new Error(`ElevenLabs 401：key 无效（确认 ELEVENLABS_API_KEY）\n${detail}`);
    if (r.status === 402) throw new Error(`ElevenLabs 402：${detail}\n（常见原因：免费档 API 禁用库音色——用 --list-voices 找 category=generated 的自有音色；或字符额度用尽）`);
    throw new Error(`ElevenLabs HTTP ${r.status}: ${detail}`);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  return { audio: buf, chars: text.length };
}

export async function subscription(apiKey) {
  const r = await fetch(`${BASE}/user/subscription`, { headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`ElevenLabs 订阅查询 HTTP ${r.status}`);
  return r.json();
}

export async function listVoices(apiKey) {
  const r = await fetch(`${BASE}/voices`, { headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`ElevenLabs 音色列表 HTTP ${r.status}`);
  const j = await r.json();
  return (j.voices ?? []).map((v) => ({ voice_id: v.voice_id, name: v.name, labels: v.labels ?? {} }));
}
