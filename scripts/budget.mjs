#!/usr/bin/env node
// video-forge 预算工具 — 汇总 gen-log.jsonl（视频 + TTS 同账本），双轴月预算
// 用法：
//   node budget.mjs                # 报表：视频今日/本月/累计（美元）+ TTS 各通道字符
//   node budget.mjs --set 10       # fal 视频通道月预算 $10（写 budget.json）
//   node budget.mjs --set-chars 5000   # TTS 月配额 5000 字符/通道
//   node budget.mjs --check        # 单行结论（超支 exit 2，与 image/music-forge 同语义）
//   node budget.mjs --balance      # fal 真实余额（Account API 需 Admin key，普通 key 会 403）
// 零依赖，Node >= 18。fal 无公开按条账单 API，实扣以 https://fal.ai/dashboard/billing 为准。

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOG = join(HERE, "gen-log.jsonl");
const CONF = join(HERE, "budget.json");
const usd = (n) => "$" + n.toFixed(2);

function loadEntries() {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, "utf8").split(/\r?\n/).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e?.skill === "video-forge");
}
function loadBudget() {
  if (!existsSync(CONF)) return null;
  try { return JSON.parse(readFileSync(CONF, "utf8")); } catch { return null; }
}
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const sameMonth = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

async function fetchFalBalance() {
  const key = process.env.FAL_ADMIN_KEY || process.env.FAL_KEY;
  if (!key) return { err: "FAL_ADMIN_KEY / FAL_KEY 均未设置" };
  try {
    const r = await fetch("https://api.fal.ai/v1/account/billing?expand=credits", {
      headers: { Authorization: `Key ${key}` }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { err: `HTTP ${r.status}${r.status === 403 ? "（key 非 Admin 级）" : ""}` };
    const bal = (await r.json())?.credits?.current_balance;
    return typeof bal === "number" ? { balance: bal } : { err: "响应无 credits 字段" };
  } catch (e) { return { err: String(e.message || e) }; }
}

const args = process.argv.slice(2);
if (args[0] === "--set") {
  const v = Number(args[1]);
  if (!Number.isFinite(v) || v <= 0) { console.error("用法: budget.mjs --set <正数月预算美元>"); process.exit(1); }
  const cur = loadBudget() ?? {};
  writeFileSync(CONF, JSON.stringify({ ...cur, monthly_usd: v, set_at: new Date().toISOString() }, null, 2));
  console.log(`✅ fal 视频通道月预算已设为 ${usd(v)}`);
  process.exit(0);
}
if (args[0] === "--set-chars") {
  const v = Number(args[1]);
  if (!Number.isFinite(v) || v <= 0) { console.error("用法: budget.mjs --set-chars <正数字符数/月/通道>"); process.exit(1); }
  const cur = loadBudget() ?? {};
  writeFileSync(CONF, JSON.stringify({ ...cur, monthly_tts_chars: v, set_at: new Date().toISOString() }, null, 2));
  console.log(`✅ TTS 月配额已设为 ${v} 字符/通道`);
  process.exit(0);
}

const now = new Date();
const all = loadEntries();
const today = all.filter((e) => sameDay(new Date(e.ts), now));
const month = all.filter((e) => sameMonth(new Date(e.ts), now));
const videoSum = (arr) => arr.filter((e) => e.purpose === "video").reduce((s, e) => s + (e.est_usd ?? 0), 0);
const ttsChars = (arr, ch) => arr.filter((e) => e.purpose === "tts" && (ch ? e.channel === ch : true)).reduce((s, e) => s + (e.chars ?? 0), 0);
const budget = loadBudget();

if (args[0] === "--balance") {
  const bal = await fetchFalBalance();
  if (bal.balance !== undefined) console.log(`fal 真实余额：${usd(bal.balance)}`);
  else console.log(`fal 真实余额查询失败：${bal.err}（手动查：https://fal.ai/dashboard/billing）`);
  process.exit(bal.balance !== undefined ? 0 : 1);
}

if (args[0] === "--check") {
  const v = videoSum(month), cE = ttsChars(month, "elevenlabs"), cV = ttsChars(month, "volc");
  const parts = [`本月视频 ${usd(v)}（${month.filter((e) => e.purpose === "video").length} 发）· TTS ${cE}+${cV} 字符`];
  const overV = budget?.monthly_usd && v >= budget.monthly_usd;
  const overT = budget?.monthly_tts_chars && Math.max(cE, cV) >= budget.monthly_tts_chars;
  if (budget?.monthly_usd) parts.push(`视频 ${usd(v)}/${usd(budget.monthly_usd)}`);
  if (budget?.monthly_tts_chars) parts.push(`TTS ${Math.max(cE, cV)}/${budget.monthly_tts_chars}字/通道`);
  console.log(`[预算] ${parts.join(" · ")}`);
  process.exit(overV || overT ? 2 : 0);
}

const bal = await fetchFalBalance();
console.log("══ video-forge 预算报表 ══");
console.log(`视频 今日：${usd(videoSum(today))}（${today.filter((e) => e.purpose === "video").length} 发）`);
console.log(`视频 本月：${usd(videoSum(month))}（${month.filter((e) => e.purpose === "video").length} 发）`);
console.log(`视频 累计：${usd(videoSum(all))}（${all.filter((e) => e.purpose === "video").length} 发）`);
const byModel = {};
for (const e of month.filter((x) => x.purpose === "video")) (byModel[`${e.channel}/${e.model}`] ??= { n: 0, usd: 0 }), byModel[`${e.channel}/${e.model}`].n++, byModel[`${e.channel}/${e.model}`].usd += e.est_usd ?? 0;
if (Object.keys(byModel).length) {
  console.log("本月视频明细：");
  for (const [m, v] of Object.entries(byModel)) console.log(`  ${m.padEnd(18)} ${String(v.n).padStart(3)} 发  ${usd(v.usd)}`);
}
for (const ch of ["elevenlabs", "volc"]) {
  const c = ttsChars(month, ch);
  if (c) console.log(`TTS 本月 ${ch}：${c} 字符（${month.filter((e) => e.purpose === "tts" && e.channel === ch).length} 稿）`);
}
if (budget?.monthly_usd || budget?.monthly_tts_chars) {
  if (budget.monthly_usd) {
    const pct = (videoSum(month) / budget.monthly_usd) * 100;
    console.log(`fal 月预算：${usd(videoSum(month))}/${usd(budget.monthly_usd)}（${pct.toFixed(0)}%）`);
    if (pct >= 100) console.log("⛔ 视频已超月预算：继续生成须用户明示同意");
    else if (pct >= 80) console.log("⚠️ 已用 ≥80%：生成前提醒余量");
  }
  if (budget.monthly_tts_chars) {
    const cE = ttsChars(month, "elevenlabs"), cV = ttsChars(month, "volc");
    console.log(`TTS 月配额：${budget.monthly_tts_chars} 字符/通道（elevenlabs ${cE} · volc ${cV}）`);
  }
} else {
  console.log("月预算：未设置（--set <美元> 设视频、--set-chars <字符> 设 TTS）");
}
console.log(bal.balance !== undefined
  ? `fal 真实余额：${usd(bal.balance)}（Account API）`
  : `fal 真实余额：查询失败（${bal.err}）— 手动查 https://fal.ai/dashboard/billing`);
