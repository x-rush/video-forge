#!/usr/bin/env node
/**
 * 火山引擎 TTS 通道 — openspeech /api/v1/tts，同步 base64 返回
 *
 * 契约要点（2026-10-10 文档核对 + probe 实录；⚠️ UNTESTED——等 VOLC_TTS_APPID）：
 *  - POST https://openspeech.bytedance.com/api/v1/tts
 *  - 鉴权 Header: Authorization: "Bearer;<token>"（⚠️ 官方格式带分号，不是空格）
 *    token = VOLC_TTS_API_KEY（UUID 形状，实测它不是方舟 Ark key——Ark 端点 401）
 *  - body.app 三件套：{ appid, token, cluster: "volcano_tts" }
 *    appid = VOLC_TTS_APPID（控制台-语音技术-应用管理，9 位数字，非机密）
 *    ⚠️ 缺 appid 实测报 {"code":3001,"message":"...Missing required: app.appid"}（2026-10-10）
 *  - body.request: { reqid: uuid, text, operation: "query" }（query=同步一次返回）
 *  - body.audio: { voice_type, encoding: "mp3", speed_ratio: 1.0 }
 *  - 成功响应 { code: 3000, data: "<base64 mp3>", duration? }；code != 3000 即失败
 *  - 音色枚举以控制台-音色管理页为准；常见 zh_female_* / zh_male_* / BVxxx_streaming
 */
import { randomUUID } from "node:crypto";

export async function synthesize({ text, apiKey, appid, voiceType, speed = 1.0, onLog = () => {} }) {
  if (!appid) {
    throw new Error(
      "缺火山 appid：本通道需要 appid+token 两个值。\n" +
        "  1. setx VOLC_TTS_APPID \"你的appid\"（9 位数字，火山控制台-语音技术-应用管理里，非机密）\n" +
        "  2. token 已由 VOLC_TTS_API_KEY 提供\n" +
        "  缺 appid 的请求实测报 code 3001（Missing required: app.appid）"
    );
  }
  onLog(`火山合成 ${text.length} 字符（${voiceType}）…`);
  const r = await fetch("https://openspeech.bytedance.com/api/v1/tts", {
    method: "POST",
    headers: { Authorization: `Bearer;${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      app: { appid, token: apiKey, cluster: "volcano_tts" },
      user: { uid: "video-forge" },
      audio: { voice_type: voiceType, encoding: "mp3", speed_ratio: speed },
      request: { reqid: randomUUID(), text, operation: "query" },
    }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json().catch(() => null);
  if (!j) throw new Error(`火山响应非 JSON: HTTP ${r.status}`);
  if (j.code !== 3000) {
    if (j.code === 3001) j.message += "（appid/token 不匹配或缺失——核对 VOLC_TTS_APPID 与 VOLC_TTS_API_KEY 是否同一应用）";
    throw new Error(`火山合成失败 code=${j.code}: ${j.message ?? "?"}`);
  }
  return { audio: Buffer.from(j.data, "base64"), chars: text.length };
}
