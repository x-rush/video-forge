#!/usr/bin/env node
// video-forge 合成入口 — ffmpeg 音画组装：视频 + 配音（+ 可选 BGM 闪避）
// 用法：
//   node assemble.mjs --video clip.mp4 --voiceover vo.mp3
//   node assemble.mjs --video clip.mp4 --voiceover vo.mp3 --bgm bgm.mp3 --duck --bgm-volume 0.15
//   node assemble.mjs --video clip.mp4 --voiceover vo.mp3 --vo-delay 0.8 --fade 0.5
//   node assemble.mjs --video clip.mp4 --voiceover vo.mp3 --clip-volume 0.3   # 保留原生音轨（veo/ltx 直出声）
// 依赖：ffmpeg/ffprobe 在 PATH。零 npm 依赖，Node >= 18。
//
// 行为约定：
//   输出 h264+aac，-movflags faststart；恒定 -shortest + apad 组合：
//   配音比视频长 → 裁到视频长；配音短 → 补静音到视频长（口播对齐，画面永不裁）。
//   默认丢弃原片音轨（哑片管线）；--clip-volume >0 且原片有音轨才混入。
//   无 --fade 时视频流直接 copy（快且无损）；加了 fade 才重编码。

import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const die = (msg, code = 2) => { console.error(`❌ ${msg}`); process.exit(code); };
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const hasFlag = (name) => process.argv.includes(`--${name}`);
const num = (name, dflt) => { const v = arg(name); return v === undefined ? dflt : Number(v); };

if (process.argv.includes("--help") || !process.argv[2]) {
  console.log(`video-forge assemble — 音画合成

必选:
  --video <path>      视频片（gen-video 的产物或任意 mp4/mov/webm）
  --voiceover <path>  配音音频（gen-tts 的 mp3 或任意音频）

可选:
  --bgm <path>        背景音乐（自动循环铺满）
  --duck              BGM 人声闪避（sidechaincompress，配音说话时 BGM 自动压低）
  --vo-delay <秒>     配音延迟（默认 0）
  --vo-volume <倍>    配音音量（默认 1.0）
  --bgm-volume <倍>   BGM 音量（默认 0.15）
  --clip-volume <倍>  保留原片音轨的音量（默认 0 = 丢弃）
  --fade <秒>         片尾视频淡出（默认 0；会触发视频重编码）
  --out <path>        输出（默认 <视频名>-assembled.mp4）`);
  process.exit(0);
}

const video = resolve(arg("video") ?? die("缺 --video"));
const vo = resolve(arg("voiceover") ?? die("缺 --voiceover"));
for (const f of [video, vo]) if (!existsSync(f)) die(`文件不存在：${f}`);
const bgm = arg("bgm") ? resolve(arg("bgm")) : null;
if (bgm && !existsSync(bgm)) die(`BGM 不存在：${bgm}`);

function probe(f) {
  try {
    const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", f], { encoding: "utf8" }));
    return { duration: Number(j.format?.duration) || 0, has_audio: !!j.streams?.some((s) => s.codec_type === "audio") };
  } catch { die("ffprobe 不可用或文件不可读——确认 ffmpeg/ffprobe 在 PATH"); }
}

const vInfo = probe(video);
const voInfo = probe(vo);
console.log(`视频 ${vInfo.duration.toFixed(1)}s${vInfo.has_audio ? "（含音轨）" : "（无音轨）"} · 配音 ${voInfo.duration.toFixed(1)}s`);

const voVolume = num("vo-volume", 1.0);
const voDelayMs = Math.max(0, Math.round(num("vo-delay", 0) * 1000));
const bgmVolume = num("bgm-volume", 0.15);
const clipVolume = num("clip-volume", 0);
const fade = num("fade", 0);
const keepClip = clipVolume > 0;
const duck = hasFlag("duck") && !!bgm;
const out = resolve(arg("out") || join(dirname(video), `${video.replace(/\.[^.]+$/, "").split(/[\\/]/).pop()}-assembled.mp4`));

// ---------- filter_complex ----------
const chains = [`[1:a]volume=${voVolume}${voDelayMs ? `,adelay=${voDelayMs}:all=1` : ""}[vo]`];
const mixInputs = [];

if (bgm) chains.push(`[2:a]volume=${bgmVolume}[bgm]`);
if (duck) {
  chains.push("[vo]asplit=2[voa][vob]");
  chains.push("[bgm][voa]sidechaincompress=threshold=0.06:ratio=12:attack=25:release=350[bgmd]");
  mixInputs.push("[bgmd]", "[vob]");
} else {
  if (bgm) mixInputs.push("[bgm]");
  mixInputs.push("[vo]");
}
if (keepClip) {
  if (!vInfo.has_audio) { console.error("⚠️ --clip-volume 已设但原片无音轨，忽略"); }
  else { chains.push(`[0:a]volume=${clipVolume}[clip]`); mixInputs.push("[clip]"); }
}

let audioMap;
if (mixInputs.length === 1) audioMap = mixInputs[0];
else {
  chains.push(`${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=longest:normalize=0[mix]`);
  audioMap = "[mix]";
}
chains.push(`${audioMap}apad[out]`);

let videoMap = "0:v";
if (fade > 0) {
  if (!vInfo.duration) die("--fade 需要 ffprobe 读到视频时长");
  chains.unshift(`[0:v]fade=t=out:st=${Math.max(0, vInfo.duration - fade).toFixed(2)}:d=${fade}[vout]`);
  videoMap = "[vout]";
}

const inputs = ["-i", video, "-i", vo];
if (bgm) inputs.push("-stream_loop", "-1", "-i", bgm); // BGM 自动循环铺满
const args = [
  ...inputs, "-filter_complex", chains.join(";"),
  "-map", videoMap, "-map", "[out]",
  "-c:v", ...(fade > 0 ? ["libx264", "-crf", "18", "-preset", "veryfast"] : ["copy"]),
  "-c:a", "aac", "-b:a", "192k",
  "-movflags", "+faststart", "-shortest", "-y", out,
];

console.log(`🎬 合成中 → ${out}`);
const t0 = Date.now();
const r = spawnSync("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
if (r.status !== 0) die(`ffmpeg 失败（exit ${r.status}）：\n${(r.stderr ?? "").split("\n").slice(-12).join("\n")}`);

const oInfo = probe(out);
console.log(`✅ 完成（${((Date.now() - t0) / 1000).toFixed(1)}s）→ ${out}`);
console.log(`   ${oInfo.duration.toFixed(1)}s · ${(statSync(out).size / 1024 / 1024).toFixed(1)}MB${oInfo.has_audio ? " · 含音轨" : ""}`);
