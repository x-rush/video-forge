#!/usr/bin/env node
// video-forge gen-srt — 语音识别生成字幕（fal-ai/whisper，中英文皆可）
// 用法：
//   node gen-srt.mjs --input video.mp4            # 视频自动抽音轨 → SRT
//   node gen-srt.mjs --input vo.mp3 --txt         # 音频 → SRT + 纯文本稿
//   node gen-srt.mjs --input clip.mp4 --lang en   # 指定语言（默认 auto）
// 输出：<输入名>.srt（默认与输入同目录）。成本：whisper 按时长计费（fal，量级 $0.005/min）。
// 实现：音频经 ffmpeg 压成 16kHz 单声道 mp3 → data URI 直塞 fal-ai/whisper 队列
//   → chunks[{timestamp:[start,end], text}] → SRT。零依赖，Node >= 18。

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const die = (msg, code = 2) => { console.error(`❌ ${msg}`); process.exit(code); };
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const hasFlag = (name) => process.argv.includes(`--${name}`);

if (process.argv.includes("--help") || !process.argv[2]) {
  console.log(`video-forge gen-srt — 语音识别生成字幕（whisper，中英文皆可）

  --input <path>    视频/音频文件（必填）
  --lang <代码>     语言提示 en/zh/…（默认 auto）
  --prompt <文本>   专有名词提示（提高人名/品牌识别）
  --txt             同时输出纯文本稿
  --out <path>      输出 SRT 路径（默认 <输入名>.srt）`);
  process.exit(0);
}

const input = resolve(arg("input") ?? die("缺 --input"));
if (!statSync(input).isFile()) die(`文件不存在：${input}`);
const KEY = process.env.FAL_KEY;
if (!KEY) die("缺 FAL_KEY（环境变量）");

// ---------- 1) 音频预处理：一律压 16kHz 单声道 mp3（大幅缩小 data URI 体积） ----------
const tmpAudio = join(dirname(input), `.${basename(input)}.srt-audio.mp3`);
try {
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", tmpAudio], { timeout: 120000 });
} catch (e) { die(`ffmpeg 抽音轨失败：${(e.stderr ?? e.message ?? "").slice(0, 200)}`); }
const audioBuf = readFileSync(tmpAudio);
const MAX = 8 * 1024 * 1024; // base64 后约 10.7MB，留余量
if (audioBuf.length > MAX) die(`音频 ${(audioBuf.length / 1048576).toFixed(1)}MB 超过 data URI 上限（约 8MB 原始）——先用 ffmpeg 切半再逐段识别`);

// ---------- 2) 提交 fal 队列 ----------
const dataUri = `data:audio/mpeg;base64,${audioBuf.toString("base64")}`;
const body = { audio_url: dataUri, task: "transcribe" };
if (arg("lang")) body.language = arg("lang");
if (arg("prompt")) body.prompt = arg("prompt");

const res = await fetch("https://queue.fal.run/fal-ai/whisper", {
  method: "POST",
  headers: { Authorization: `Key ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(30000),
});
const submitText = await res.text();
let submit;
try { submit = JSON.parse(submitText); } catch { die(`fal 提交响应非 JSON: ${submitText.slice(0, 300)}`); }
if (!res.ok) throw new Error(`fal 提交 HTTP ${res.status}: ${submitText.slice(0, 300)}`);
const { request_id, status_url, response_url } = submit;
if (!request_id) die(`fal 提交响应缺 request_id: ${submitText.slice(0, 200)}`);
console.log(`🎯 request_id=${request_id}，每 4s 轮询…`);

// ---------- 3) 轮询（瞬时错误重试 3 次，与家族一致） ----------
const deadline = Date.now() + 600000;
let j = null;
let st = null;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 4000));
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(status_url, { headers: { Authorization: `Key ${KEY}` }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      st = await r.json();
      break;
    } catch (e) {
      if (attempt >= 3) throw new Error(`轮询连续失败 3 次：${e.message}（request_id=${request_id}）`);
      console.log(`⚠️ 轮询瞬时错误（${attempt}/3）: ${e.message}`);
      await new Promise((r2) => setTimeout(r2, 5000));
    }
  }
  if (st.status === "COMPLETED") break;
  console.log(`… ${st.status}`);
  j = null;
}
if (!st || st.status !== "COMPLETED") die(`轮询超时：request_id=${request_id}`);
const rr = await fetch(response_url, { headers: { Authorization: `Key ${KEY}` }, signal: AbortSignal.timeout(30000) });
if (!rr.ok) die(`取结果 HTTP ${rr.status}`);
j = await rr.json();

const chunks = j.chunks ?? [];
if (!chunks.length) die(`识别结果无 chunks（whisper 未检出语音？）：${JSON.stringify(j).slice(0, 200)}`);

// ---------- 4) SRT 组装 ----------
const fmt = (sec) => {
  const ms = Math.round(sec * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  const milli = String(ms % 1000).padStart(3, "0");
  return `${h}:${m}:${s},${milli}`;
};
const srt = chunks.map((c, i) => {
  const [start, end] = c.timestamp ?? [0, 0];
  return `${i + 1}\n${fmt(start)} --> ${fmt(end ?? start + 2)}\n${String(c.text ?? "").trim()}\n`;
}).join("\n");

const out = resolve(arg("out") || join(dirname(input), basename(input).replace(/\.[^.]+$/, "") + ".srt"));
writeFileSync(out, srt);
console.log(`✅ SRT 就绪（${chunks.length} 条字幕）→ ${out}`);
if (hasFlag("txt")) {
  const txtOut = out.replace(/\.srt$/, ".txt");
  writeFileSync(txtOut, chunks.map((c) => String(c.text ?? "").trim()).join("\n") + "\n");
  console.log(`📝 文本稿 → ${txtOut}`);
}
console.log(`🌐 识别语言: ${(j.inferred_languages ?? ["auto"]).join(",")}${j.diarization_segments?.length ? ` · 说话人分段 ${j.diarization_segments.length} 段` : ""}`);
