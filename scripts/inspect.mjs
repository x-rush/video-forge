#!/usr/bin/env node
// video-forge 看片工具 — ffprobe 摘要 + 均匀抽帧（交付前人工审片的标准动作）
// 用法：
//   node inspect.mjs --input clip.mp4                    # 摘要 + 默认抽 4 帧
//   node inspect.mjs --input clip.mp4 --frames 6         # 抽 6 帧
//   node inspect.mjs --input clip.mp4 --no-frames        # 只看摘要
// 输出：ffprobe 摘要（时长/分辨率/音轨/码率/大小）+ frames/ 目录下的等距 PNG。
// 零依赖，Node >= 18；需 ffmpeg/ffprobe 在 PATH。

import { mkdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const die = (msg, code = 2) => { console.error(`❌ ${msg}`); process.exit(code); };
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const hasFlag = (name) => process.argv.includes(`--${name}`);

if (process.argv.includes("--help") || !process.argv[2]) {
  console.log(`video-forge inspect — 看片：ffprobe 摘要 + 均匀抽帧

  --input <path>     视频文件（必填）
  --frames <n>       抽帧数量（默认 4；0 等价 --no-frames）
  --no-frames        只看摘要不抽帧
  --out <dir>        抽帧输出目录（默认 <视频目录>/<视频名>-frames/）`);
  process.exit(0);
}

const input = resolve(arg("input") ?? die("缺 --input"));
const n = hasFlag("no-frames") ? 0 : Number(arg("frames") ?? 4);

let j;
try {
  j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", input], { encoding: "utf8" }));
} catch { die("ffprobe 不可用或文件不可读"); }

const v = j.streams?.find((s) => s.codec_type === "video") ?? {};
const a = j.streams?.find((s) => s.codec_type === "audio");
const dur = Number(j.format?.duration) || 0;
const mb = (statSync(input).size / 1048576).toFixed(1);
console.log(`📄 ${input}`);
console.log(`   ${v.codec_name ?? "?"} ${v.width}x${v.height}@${v.avg_frame_rate ?? "?"}fps · ${dur.toFixed(2)}s · ${mb}MB · 码率 ${Math.round((j.format?.bit_rate ?? 0) / 1000)}kbps`);
console.log(`   音轨: ${a ? `${a.codec_name} ${a.sample_rate ?? "?"}Hz ${a.channels ?? "?"}ch` : "无"}`);

if (!n || !dur) { if (!dur && n) console.error("⚠️ 未读到时长，跳过抽帧"); process.exit(0); }

const outDir = resolve(arg("out") || join(dirname(input), basename(input).replace(/\.[^.]+$/, "") + "-frames"));
mkdirSync(outDir, { recursive: true });
for (let i = 0; i < n; i++) {
  const ts = Math.min(dur * 0.98, (dur * (i + 0.5)) / n).toFixed(3);
  const png = join(outDir, `frame-${String(i + 1).padStart(2, "0")}-${ts}s.png`);
  execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", ts, "-i", input, "-frames:v", "1", png]);
  console.log(`🖼️ ${png}`);
}
