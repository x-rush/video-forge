#!/usr/bin/env node
/**
 * Replicate 视频通道 — 异步预测式 API（与 image-forge 同款通路）
 *
 * ═══════════ REPLICATE_API_TOKEN 配置（三选一）═══════════
 *  1. 环境变量：setx REPLICATE_API_TOKEN "r8_xxx"（Windows 用户级，重开终端生效）
 *  2. Token 文件：本文件同级 token.txt 第一行放 token（已 gitignore）
 *  3. 创建：https://replicate.com/account/api-tokens（r8_ 开头）
 * ═════════════════════════════════════════════════════════
 *
 * API 形态（2026-10-10 文档核对；⚠️ UNTESTED——首跑先用便宜模型小参数验证）：
 *   POST https://api.replicate.com/v1/models/<owner>/<name>/predictions  body { input }
 *   GET  https://api.replicate.com/v1/predictions/<id>                   → { status, output }
 *   status: starting → processing → succeeded / failed / canceled
 *   鉴权 Header: Authorization: "Bearer <token>"（注意与 fal 的 "Key" 前缀不同）
 *   Prefer: wait 头可挂起 ~60s，超时转轮询
 *
 * 视频模型 output 兼容三种形态：url 字符串 / 字符串数组 / { video: url }
 * 模型 slug 与 input schema 以 https://replicate.com/<owner>/<name>/api 为准，
 * 接入新模型 = models.json 该模型加 availability.replicate 段（slug + params）。
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveToken() {
  if (process.env.REPLICATE_API_TOKEN) return process.env.REPLICATE_API_TOKEN;
  const tokenFile = join(dirname(fileURLToPath(import.meta.url)), "token.txt");
  if (existsSync(tokenFile)) {
    const t = readFileSync(tokenFile, "utf8").trim().split(/\r?\n/)[0].trim();
    if (t) return t;
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function generate({ endpoint, params, apiKey, onLog = () => {}, timeoutMs = 600000 }) {
  if (!apiKey) {
    throw new Error(
      "未找到 REPLICATE_API_TOKEN。配置（三选一）：\n" +
        "  1. setx REPLICATE_API_TOKEN \"r8_xxx\"（Windows 用户级，重开终端生效）\n" +
        "  2. providers/token.txt 第一行放 token（已 gitignore）\n" +
        "  3. 到 https://replicate.com/account/api-tokens 创建"
    );
  }

  const createRes = await fetch(`https://api.replicate.com/v1/models/${endpoint}/predictions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Prefer: "wait" },
    body: JSON.stringify({ input: params }),
    signal: AbortSignal.timeout(70000),
  });
  if (createRes.status === 404) throw new Error(`模型不存在：${endpoint}（slug 见 replicate.com 模型页）`);
  if (createRes.status === 401) throw new Error("Replicate 401：token 无效或过期");
  if (!createRes.ok) throw new Error(`Replicate 创建预测 HTTP ${createRes.status}: ${(await createRes.text()).slice(0, 500)}`);
  let pred = await createRes.json();

  const deadline = Date.now() + timeoutMs;
  while (!["succeeded", "failed", "canceled"].includes(pred.status)) {
    if (Date.now() > deadline) throw new Error(`Replicate 轮询超时（${timeoutMs / 1000}s），prediction ${pred.id}`);
    onLog(`… ${pred.status}`);
    await sleep(3000);
    const poll = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!poll.ok) throw new Error(`Replicate 轮询 HTTP ${poll.status}`);
    pred = await poll.json();
  }
  if (pred.status !== "succeeded") {
    throw new Error(`Replicate 预测 ${pred.status}: ${(pred.error || "无错误详情").toString().slice(0, 400)}`);
  }

  // 视频输出防御式解析：string / string[] / { video: url } / { output: … }
  const out = pred.output;
  const video_url = typeof out === "string" ? out
    : Array.isArray(out) ? out.find((u) => typeof u === "string" && /\.(mp4|webm)/i.test(u)) ?? out[0]
    : out?.video?.url ?? out?.url;
  if (!video_url) throw new Error(`Replicate output 无视频 URL: ${JSON.stringify(out).slice(0, 300)}`);
  return { task_id: pred.id, video_url, raw: pred };
}
