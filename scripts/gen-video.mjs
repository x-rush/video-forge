#!/usr/bin/env node
// video-forge 生成入口 — 单命令出片：提交 → 轮询 → 下载 → 校验 → 记账
// 用法：
//   node gen-video.mjs --model wan30 --prompt "雨夜霓虹街头，慢镜头" --resolution 480p --duration 5
//   node gen-video.mjs --model veo31-fast --prompt "……" --duration 6 --no-audio     # 音频档省钱
//   node gen-video.mjs --model wan30 --prompt "……" --image 首帧.png                # 图生视频（docs）
//   node gen-video.mjs --resume <request_id> --model wan30                        # 重取任务只下载
//   node gen-video.mjs --report                                                    # 本机账本报表
// 零依赖，Node >= 18（ffprobe 可选，用于时长校验）。账本：脚本旁 gen-log.jsonl。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, extname } from "node:path";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = dirname(HERE);
const REGISTRY = JSON.parse(readFileSync(join(SKILL, "models.json"), "utf8"));
const LOG = join(HERE, "gen-log.jsonl");
const BUDGET = join(HERE, "budget.json");

const die = (msg, code = 2) => { console.error(`❌ ${msg}`); process.exit(code); };
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const hasFlag = (name) => process.argv.includes(`--${name}`);

const VIDEO_MODELS = REGISTRY.video_models;
if (hasFlag("report")) { execFileSync(process.execPath, [join(HERE, "budget.mjs")], { stdio: "inherit" }); process.exit(0); }
if (process.argv.includes("--help") || !process.argv[2]) {
  console.log(`video-forge gen-video — 文生/图生视频（fal 队列；Replicate 待 token）

必选（二选一）:
  --model <alias>     模型别名，见 models.json（${Object.keys(VIDEO_MODELS).join(", ")}）
  --resume <req_id>   重取 fal 任务（配 --model <alias>，只下载不重新扣费）

生成参数:
  --prompt <text>     画面描述（必填，除非 --resume）
  --image <path>      首帧图（图生视频；吃 image-forge 的出图正好）
  --video-input <path> 参考视频（视频编辑，走 edit_endpoint，docs 状态；与 --image 互斥）
  --use <name>        调用注册表 extra_endpoints 里的扩展端点（reference/extend/relight/lipsync 等，docs 状态）
  --resolution <档>   分辨率，枚举见各模型（默认取注册表第一档=最便宜）
  --aspect <比例>     画幅，如 16:9 / 9:16 / adaptive
  --duration <秒>     时长（数字；注册表按模型自动转 int / '6' / '6s' 形态）
  --no-audio          关闭原生音频（veo 系 generate_audio / wan audio / seedance generate_audio）
  --seed N            复现种子（registry 登记了 seed 的模型：wan30/seedance/H3 系）
  --negative <text>   反向提示（仅 klingv3-turbo，docs）
  --advanced-json <p> 原样合并进请求体的 JSON 文件（长尾参数逃生口）
  --out <dir>         输出目录（默认 ./video-output/<时间戳>-<别名>/）
  --report            查看账本报表`);
  process.exit(0);
}

const alias = arg("model");
const modelDef = VIDEO_MODELS[alias];
if (!modelDef) die(`未知模型别名 "${alias}"，可选：${Object.keys(VIDEO_MODELS).join(", ")}`);
const providerName = arg("provider") || Object.keys(modelDef.availability)[0];
const channel = modelDef.availability[providerName];
const providerDef = REGISTRY.providers[providerName];
if (!channel || !providerDef) die(`模型 ${alias} 未在渠道 ${providerName} 上架（token 实测后往 models.json 加 availability）`);

const prompt = arg("prompt");
const imagePath = arg("image");
const videoInputPath = arg("video-input");
const audioInputPath = arg("audio");
if (imagePath && videoInputPath) die("--image 与 --video-input 互斥（一次任务要么首帧图要么参考视频）");
const useEndpoint = arg("use");
const extraDef = useEndpoint ? channel.extra_endpoints?.[useEndpoint] : null;
if (useEndpoint && !extraDef) die(`--use ${useEndpoint} 未在注册表 extra_endpoints 登记（可用：${Object.keys(channel.extra_endpoints ?? {}).join(", ") || "无"}）`);
const resumeId = arg("resume");
if (!resumeId && !prompt) die("缺 --prompt（总得告诉它拍什么）");
if (prompt && prompt.length > 2000) die(`prompt ${prompt.length} 字符过长（视频模型一般 ≤1500），先精简`);

// ---------- 鉴权（env 优先，退 gitignored token 文件；绝不写入任何文件/日志） ----------
const authEnvNames = Array.isArray(providerDef.auth_env) ? providerDef.auth_env : [providerDef.auth_env];
let apiKey = authEnvNames.map((n) => process.env[n]).find(Boolean);
if (!apiKey && providerDef.auth_file) {
  const p = join(SKILL, providerDef.auth_file);
  if (existsSync(p)) apiKey = readFileSync(p, "utf8").trim();
}
if (!apiKey) die(`缺少鉴权：设环境变量 ${authEnvNames.join(" 或 ")}，或写入 ${providerDef.auth_file}（已 gitignore）`);

// ---------- 预算门（超支 exit 2，与 image-forge/music-forge 同语义） ----------
function budgetCheck(estUsd) {
  const conf = existsSync(BUDGET) ? JSON.parse(readFileSync(BUDGET, "utf8")) : null;
  if (!conf?.monthly_usd || providerName !== "fal") return;
  const entries = existsSync(LOG)
    ? readFileSync(LOG, "utf8").split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e?.channel === "fal")
    : [];
  const now = new Date();
  const spent = entries.filter((e) => { const d = new Date(e.ts); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); }).reduce((s, e) => s + (e.est_usd ?? 0), 0);
  if (spent + estUsd > conf.monthly_usd) {
    console.error(`⛔ fal 通道本月已花 $${spent.toFixed(2)} / $${conf.monthly_usd}，这一发估算 $${estUsd.toFixed(2)} 会顶破月预算——继续须用户明示同意`); process.exit(2);
  }
}

// ---------- 参数组装（枚举校验 + duration 按模型形态转换） ----------
function buildParams() {
  const P = channel.params ?? {};
  const p = {};
  p.prompt = prompt;
  // ⚠️ 防误扣费守门：registry 登记了枚举的字段才下发（自动取默认档）；
  // 未登记（docs 状态）时用户显式传参 → 硬报错——合法请求会真实出片扣费，禁止盲传
  const wantRes = arg("resolution");
  if (wantRes) {
    if (!Array.isArray(P.resolution)) die(`--resolution 传入但 ${alias} 的 resolution 枚举未登记（docs 状态禁止盲传——用 --advanced-json 显式传，或首跑实测后回填 registry）`);
    p.resolution = P.resolution.includes(wantRes) ? wantRes : die(`--resolution ${wantRes} 不在 ${alias} 枚举 ${JSON.stringify(P.resolution)} 内`);
  } else if (Array.isArray(P.resolution)) {
    p.resolution = P.resolution[0]; // 已登记：默认取第一档（注册表按最便宜排序）
  }
  const wantAspect = arg("aspect");
  if (wantAspect) {
    if (!Array.isArray(P.aspect_ratio)) die(`--aspect 传入但 ${alias} 的 aspect_ratio 枚举未登记（docs 状态禁止盲传）`);
    p.aspect_ratio = P.aspect_ratio.includes(wantAspect) ? wantAspect : die(`--aspect ${wantAspect} 不在枚举 ${JSON.stringify(P.aspect_ratio)} 内`);
  } else if (Array.isArray(P.aspect_ratio)) {
    p.aspect_ratio = P.aspect_ratio.includes("16:9") ? "16:9" : P.aspect_ratio[0];
  }
  const wantDur = arg("duration") ? Number(arg("duration")) : undefined;
  if (wantDur !== undefined) {
    const dEnum = P.duration;
    if (Array.isArray(dEnum)) {
      const asStr = String(wantDur);
      const withS = `${wantDur}s`;
      if (dEnum.includes(asStr)) p.duration = asStr;
      else if (dEnum.includes(withS)) p.duration = withS;
      else die(`--duration ${wantDur} 不在 ${alias} 枚举 ${JSON.stringify(dEnum)} 内`);
    } else if (P.duration) p.duration = Math.round(wantDur);
    else die(`--duration 传入但 ${alias} 的 duration 形态未登记（docs 状态禁止盲传）`);
    if (channel.duration_max && p.duration > channel.duration_max) die(`--duration ${p.duration} 超过 ${alias} 上限 ${channel.duration_max}s（[live] 实测）`);
  } else if (P.duration) {
    p.duration = Math.round(modelDef.default_duration ?? 5); // 已登记 duration 字段才自动下发默认时长
  }
  if (hasFlag("no-audio")) {
    const noAudioParam = P.generate_audio ? "generate_audio" : P.audio ? "audio" : null;
    if (noAudioParam) p[noAudioParam] = false;
    else die(`--no-audio 传入但 ${alias} 未登记音频开关字段（audio / generate_audio）`);
  }
  if (P.seed && arg("seed")) {
    const s = Number(arg("seed"));
    p.seed = Number.isInteger(s) ? s : die("--seed 必须是整数");
  }
  if (arg("negative") && P.negative_prompt) p.negative_prompt = arg("negative");
  if (imagePath) {
    if (!channel.image_endpoint) die(`模型 ${alias} 未登记图生视频端点`);
    const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[extname(resolve(imagePath)).toLowerCase()];
    if (!mime) die("首帧图只支持 png/jpg/webp");
    p[channel.image_param ?? "image_url"] = `data:${mime};base64,${readFileSync(resolve(imagePath)).toString("base64")}`;
  }
  if (videoInputPath) {
    if (!channel.edit_endpoint) die(`模型 ${alias} 未登记视频编辑端点`);
    p[channel.edit_param ?? "video_url"] = `data:video/mp4;base64,${readFileSync(resolve(videoInputPath)).toString("base64")}`;
  }
  if (useEndpoint) {
    // 扩展端点：input 槽位按注册表声明填充（prompt 恒定）
    const slots = String(extraDef.input ?? "prompt");
    if (slots.includes("video") && !videoInputPath) die(`--use ${useEndpoint} 需要 --video-input`);
    if (slots.includes("image") && !imagePath) die(`--use ${useEndpoint} 需要 --image（或 --video-input 视语义）`);
    if (slots.includes("audio") && !arg("audio")) die(`--use ${useEndpoint} 需要 --audio <音频文件>`);
    if (slots.includes("audio")) p[extraDef.audio_param ?? "audio_url"] = `data:audio/mpeg;base64,${readFileSync(resolve(arg("audio"))).toString("base64")}`;
  }
  const advanced = arg("advanced-json") ? JSON.parse(readFileSync(resolve(arg("advanced-json")), "utf8")) : undefined;
  return { ...p, ...advanced };
}

// ---------- 成本估算（注册表价目；账面口径，实扣以 fal 控制台为准） ----------
function estUsd() {
  if (channel.price_per_second) {
    const res = String(arg("resolution") ?? (Array.isArray(channel.params?.resolution) ? channel.params.resolution[0] : "720p"));
    const noAudio = hasFlag("no-audio");
    let rate = channel.price_per_second[`${res}_${noAudio ? "noaudio" : "audio"}`] ?? channel.price_per_second[res] ?? channel.price_per_second.standard;
    if (rate == null) rate = Math.min(...Object.values(channel.price_per_second));
    return Math.round(rate * Number(arg("duration") ?? modelDef.default_duration) * 1000) / 1000;
  }
  if (channel.price_per_video) return channel.price_per_video[String(arg("duration") ?? modelDef.default_duration)] ?? Math.min(...Object.values(channel.price_per_video));
  return null;
}

// ---------- 下载与校验 ----------
function probeVideo(file) {
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8" });
    const j = JSON.parse(out);
    return {
      duration_s: Number(j.format?.duration) || undefined,
      width: j.streams?.find((s) => s.codec_type === "video")?.width,
      height: j.streams?.find((s) => s.codec_type === "video")?.height,
      has_audio: !!j.streams?.some((s) => s.codec_type === "audio"),
    };
  } catch { return {}; }
}

// ---------- 主流程 ----------
const provider = await import(`../providers/${providerName === "fal" ? "fal-video" : providerName + "-video"}.mjs`);
const onLog = (m) => console.log(`  ${m}`);
const started = Date.now();

try {
  let result;
  if (resumeId) {
    console.log(`♻️ 重取 fal request ${resumeId}`);
    result = await provider.resume({ request_id: resumeId, endpoint: channel.endpoint, apiKey });
  } else {
    const est = estUsd();
    if (est != null) console.log(`💳 本发估算 $${est.toFixed(2)}（账面口径，实扣以 fal 控制台为准）`);
    budgetCheck(est ?? 0);
    const useEndpointPath = useEndpoint ? extraDef.path : imagePath ? channel.image_endpoint : channel.endpoint;
    result = await provider.generate({ endpoint: videoInputPath ? (channel.edit_endpoint ?? die(`模型 ${alias} 未登记视频编辑端点`)) : useEndpointPath, params: buildParams(), apiKey, onLog });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = resolve(arg("out") || `video-output/${stamp}-${alias}`);
  mkdirSync(outDir, { recursive: true });
  const dest = join(outDir, "video.mp4");
  // [live 2026-10-11] v3b.fal.media CDN 有周期性 SSL 抖动（10-120s 自愈）——下载重试 3 次
  let buf = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(result.video_url, { signal: AbortSignal.timeout(180000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      buf = Buffer.from(await r.arrayBuffer());
      break;
    } catch (e) {
      if (attempt >= 3) die(`视频下载连续失败 3 次：${e.message}（产物仍在 CDN，稍后 --resume ${result.task_id} 重取）`);
      console.log(`⚠️ 下载瞬时错误（${attempt}/3）: ${e.message}，10s 后重试`);
      await new Promise((r2) => setTimeout(r2, 10000));
    }
  }
  if (buf.length < 100 * 1024) console.error(`⚠️ 仅 ${(buf.length / 1024).toFixed(0)}KB，疑似残片，请人工确认`);
  writeFileSync(dest, buf);
  const probe = probeVideo(dest);
  console.log(`💾 ${dest}（${(buf.length / 1024 / 1024).toFixed(1)}MB${probe.duration_s ? `，${probe.duration_s.toFixed(1)}s` : ""}${probe.width ? `，${probe.width}x${probe.height}` : ""}${probe.has_audio ? "，含音轨" : "，无音轨"}）`);

  writeFileSync(join(outDir, "meta.json"), JSON.stringify({
    skill: "video-forge", channel: providerName, model_alias: alias,
    endpoint: videoInputPath ? channel.edit_endpoint : imagePath ? channel.image_endpoint : channel.endpoint,
    task_id: result.task_id, requested: (imagePath || videoInputPath) ? buildParams() : undefined,
    video_url: result.video_url, file: dest, bytes: buf.length, probe,
    finished_at: new Date().toISOString(), raw: result.raw,
  }, null, 2));

  const entry = {
    ts: new Date().toISOString(), skill: "video-forge", purpose: "video", channel: providerName,
    model: alias, task_id: result.task_id, est_usd: resumeId ? 0 : estUsd(), seconds: Math.round((Date.now() - started) / 1000),
    video_seconds: probe.duration_s ?? null, resolution: probe.width ? `${probe.width}x${probe.height}` : null,
    prompt: (prompt ?? "").slice(0, 80), out_dir: outDir,
  };
  if (existsSync(LOG) && !readFileSync(LOG, "utf8").endsWith("\n")) {
    const c = readFileSync(LOG, "utf8"); writeFileSync(LOG, c.replace(/\n?$/, "\n"));
  }
  const { appendFileSync } = await import("node:fs");
  appendFileSync(LOG, JSON.stringify(entry) + "\n");

  console.log(`\n✅ 成片就绪（${entry.seconds}s 墙钟）→ ${outDir}`);
  console.log(`📒 记账：${providerName}/${alias}${entry.est_usd ? ` · 估算 $${entry.est_usd.toFixed(2)}` : ""} · 报表：node ${join(HERE, "budget.mjs")}`);
} catch (e) {
  const msg = String(e?.message ?? e);
  die(/\b(401|403)\b/.test(msg) && !e?.validation
    ? `${msg}\n   鉴权/权限被拒：确认 ${authEnvNames.join(" 或 ")} 有效，fal 余额与账单见 https://fal.ai/dashboard/billing`
    : msg);
}
