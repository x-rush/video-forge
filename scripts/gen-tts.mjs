#!/usr/bin/env node
// video-forge TTS 入口 — 文本/文稿 → mp3 配音（ElevenLabs / 火山豆包）
// 用法：
//   node gen-tts.mjs --text "大家好，欢迎收看本期节目。" --model eleven_flash_v2_5
//   node gen-tts.mjs --text-file narration.txt --voice <voice_id> --out vo.mp3
//   node gen-tts.mjs --channel volc --text "你好世界"          # 豆包 seed-tts V3，中文配音
//   node gen-tts.mjs --channel volc --text "……" --clone        # 复刻音色（seed-icl-2.0）
//   node gen-tts.mjs --list-voices                             # ElevenLabs 音色清单
//   node gen-tts.mjs --quota                                   # ElevenLabs 余量
//   node gen-tts.mjs --report                                  # 账本报表
// 零依赖，Node >= 18（ffprobe 可选）。账本：脚本旁 gen-log.jsonl（与 gen-video 同账本）。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = dirname(HERE);
const REGISTRY = JSON.parse(readFileSync(join(SKILL, "models.json"), "utf8"));
const LOG = join(HERE, "gen-log.jsonl");
const BUDGET = join(HERE, "budget.json");

const die = (msg, code = 2) => { console.error(`❌ ${msg}`); process.exit(code); };
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const hasFlag = (name) => process.argv.includes(`--${name}`);

const channelName = arg("channel") ?? "elevenlabs";
if (!REGISTRY.tts[channelName]) die(`未知 TTS 通道 "${channelName}"，可选：${Object.keys(REGISTRY.tts).join(", ")}`);
const ttsDef = REGISTRY.tts[channelName];
const providerDef = REGISTRY.providers[channelName];

if (hasFlag("report")) { execFileSync(process.execPath, [join(HERE, "budget.mjs")], { stdio: "inherit" }); process.exit(0); }

// ---------- 鉴权 ----------
const authEnvNames = Array.isArray(providerDef.auth_env) ? providerDef.auth_env : [providerDef.auth_env];
let apiKey = authEnvNames.map((n) => process.env[n]).find(Boolean);
if (!apiKey && providerDef.auth_file) {
  const p = join(SKILL, providerDef.auth_file);
  if (existsSync(p)) apiKey = readFileSync(p, "utf8").trim();
}
if (!apiKey) die(`缺少鉴权：设环境变量 ${authEnvNames.join(" 或 ")}，或写入 ${providerDef.auth_file}（已 gitignore）`);

async function main() {
  const provider = await import(`../providers/tts-${channelName}.mjs`);

  if (hasFlag("list-voices")) {
    if (channelName !== "elevenlabs") die("--list-voices 目前仅支持 elevenlabs");
    const voices = await provider.listVoices(apiKey);
    for (const v of voices) console.log(`${v.voice_id}  ${v.name}  ${Object.values(v.labels).join(", ")}`);
    return;
  }
  if (hasFlag("quota")) {
    if (channelName !== "elevenlabs") die("--quota 目前仅支持 elevenlabs");
    const s = await provider.subscription(apiKey);
    const reset = new Date((s.next_character_count_reset_unix ?? 0) * 1000).toISOString().slice(0, 10);
    console.log(`[ElevenLabs] ${s.tier} 档 · 已用 ${s.character_count}/${s.character_limit} 字符 · ${reset} 重置`);
    return;
  }

  const text = (arg("text") ?? (arg("text-file") ? readFileSync(resolve(arg("text-file")), "utf8") : "")).trim();
  if (!text) die("缺 --text 或 --text-file");
  if (text.length > 5000) die(`文本 ${text.length} 字符超单次上限（ElevenLabs 5k/请求，长稿先分段）`);
  const voice = arg("voice") ?? ttsDef.default_voice;
  const modelId = arg("model") ?? ttsDef.default_model ?? ttsDef.default_voice;
  const speed = arg("speed") ? Number(arg("speed")) : undefined;
  // 预算门（TTS 按字符，两通道共月配额；超支 exit 2）
  const conf = existsSync(BUDGET) ? JSON.parse(readFileSync(BUDGET, "utf8")) : null;
  if (conf?.monthly_tts_chars) {
    const entries = existsSync(LOG) ? readFileSync(LOG, "utf8").split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e?.purpose === "tts") : [];
    const now = new Date();
    const used = entries.filter((e) => e.channel === channelName && ((d) => d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth())(new Date(e.ts))).reduce((s, e) => s + (e.chars ?? 0), 0);
    if (used + text.length > conf.monthly_tts_chars) {
      console.error(`⛔ ${channelName} 本月已用 ${used} / ${conf.monthly_tts_chars} 字符，这稿 ${text.length} 字符会超——继续须用户明示同意`); process.exit(2);
    }
  }

  const started = Date.now();
  let result;
  try {
    result = channelName === "elevenlabs"
      ? await provider.synthesize({ text, apiKey, voiceId: voice, modelId, speed })
      : await provider.synthesize({ text, apiKey, resource: hasFlag("clone") ? ttsDef.clone_resource_id : ttsDef.resource_id, speaker: voice, format: ttsDef.encoding ?? "mp3", sampleRate: ttsDef.sample_rate ?? 24000 });
  } catch (e) {
    die(String(e?.message ?? e));
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const out = resolve(arg("out") || `tts-output/${stamp}-${channelName}.mp3`);
  mkdirSync(dirname2(out), { recursive: true });
  writeFileSync(out, result.audio);
  if (result.audio.length < 1024) console.error("⚠️ 音频不足 1KB，疑似空结果，请试听确认");

  let duration;
  try {
    duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], { encoding: "utf8" }).trim()) || undefined;
  } catch {}

  const { appendFileSync } = await import("node:fs");
  const entry = {
    ts: new Date().toISOString(), skill: "video-forge", purpose: "tts", channel: channelName,
    voice, model: modelId, chars: text.length, est_usd: null, seconds: Math.round((Date.now() - started) / 1000),
    audio_seconds: duration ?? null, text: text.slice(0, 60), file: out,
  };
  if (existsSync(LOG) && !readFileSync(LOG, "utf8").endsWith("\n")) {
    const c = readFileSync(LOG, "utf8"); writeFileSync(LOG, c.replace(/\n?$/, "\n"));
  }
  appendFileSync(LOG, JSON.stringify(entry) + "\n");

  console.log(`✅ 配音就绪 → ${out}${duration ? `（${duration.toFixed(1)}s）` : ""}`);
  console.log(`📒 记账：${channelName} · ${text.length} 字符 · 报表：node ${join(HERE, "budget.mjs")}`);
}
function dirname2(p) { return p.replace(/[\\/][^\\/]+$/, "") || "."; }
main().catch((e) => die(String(e?.message ?? e)));
