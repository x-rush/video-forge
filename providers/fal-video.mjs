#!/usr/bin/env node
/**
 * fal.ai 视频通道 — 队列 API（submit → poll → fetch response）
 *
 * 契约要点（2026-10-10 实测沉淀，勿改回）：
 *  - POST https://queue.fal.run/<endpoint>，Authorization: "Key <FAL_KEY>"（注意不是 Bearer）
 *    → 200 { request_id, status_url, response_url, cancel_url }
 *  - ⚠️ 提交时不校验 body：字段齐全的任何提交都会真实排队出片扣费；
 *    缺必填/非法枚举才被 worker 层 422 拒绝（不扣费）——零成本探测只能用非法值
 *  - 轮询 GET status_url：status ∈ IN_QUEUE / IN_PROGRESS / COMPLETED
 *  - 完成后 GET response_url：成功回模型输出；校验失败这里回 422 { detail:[…] }
 *  - HTTP 401 = key 无效；402 = 余额不足
 *  - 取消：PUT cancel_url（完成后回 400 ALREADY_COMPLETED，不报错处理）
 *  - 输出形态各模型不一，防御式解析 video.url / video_url / videos[].url / url
 */
const safeJson = (t) => { try { return JSON.parse(t); } catch { return null; } };

function readableError(head, j, text) {
  const d = j?.detail;
  const detail = Array.isArray(d)
    ? d.map((x) => `- [${(x.loc || []).join(".")}] ${x.msg}${x.ctx?.expected ? `（应为 ${x.ctx.expected}）` : ""}`).join("\n")
    : String(d ?? text.slice(0, 400));
  return `${head}\n${detail}`;
}

function parseVideoOutput(rt) {
  const out = safeJson(rt);
  const video_url =
    out?.video?.url ?? out?.video_url ??
    (Array.isArray(out?.videos) ? out.videos[0]?.url : undefined) ??
    out?.url;
  if (!video_url) throw new Error(`fal 输出无视频 URL: ${rt.slice(0, 300)}`);
  return { video_url, raw: out };
}

async function fetchResult(response_url, apiKey) {
  const rr = await fetch(response_url, { headers: { Authorization: `Key ${apiKey}` }, signal: AbortSignal.timeout(30000) });
  const rt = await rr.text();
  if (!rr.ok) {
    const e = new Error(readableError(`fal 任务失败 HTTP ${rr.status}`, safeJson(rt), rt));
    if (rr.status === 422) e.validation = true; // worker 校验拒绝（未扣费）
    throw e;
  }
  return parseVideoOutput(rt);
}

export async function generate({ endpoint, params, apiKey, onLog = () => {}, timeoutMs = 600000 }) {
  const res = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  const submit = safeJson(text);
  if (!res.ok) {
    const e = new Error(readableError(`fal 提交 HTTP ${res.status}`, submit, text));
    if (res.status === 401) e.auth = true;
    throw e;
  }
  const { request_id, status_url, response_url } = submit ?? {};
  if (!request_id || !status_url || !response_url) throw new Error(`fal 提交响应缺字段: ${text.slice(0, 300)}`);
  onLog(`request_id=${request_id}，每 5s 轮询（视频生成约 30s-3min）`);

  const deadline = Date.now() + timeoutMs;
  let st = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await fetch(status_url, { headers: { Authorization: `Key ${apiKey}` }, signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        st = await r.json();
        break;
      } catch (e) {
        // 瞬时网络抖动重试（2026-10-10 实测：90s 长轮询中一次 fetch failed 差点弄丢已付费任务）
        if (attempt >= 3) throw new Error(`轮询连续失败 3 次：${e.message}（request_id=${request_id}，稍后 --resume ${request_id} 重取）`);
        onLog(`⚠️ 轮询瞬时错误（${attempt}/3）: ${e.message}，5s 后重试`);
        await new Promise((r2) => setTimeout(r2, 5000));
      }
    }
    if (st.status === "COMPLETED") break;
    onLog(`… ${st.status}${st.queue_position != null ? `（队列第 ${st.queue_position} 位）` : ""}`);
  }
  if (!st || st.status !== "COMPLETED") {
    throw new Error(`轮询超时（${timeoutMs / 1000}s）：request_id=${request_id}，可稍后 --resume ${request_id} 重取`);
  }
  const { video_url, raw } = await fetchResult(response_url, apiKey);
  return { task_id: request_id, video_url, raw };
}

// 按 request_id 重取。⚠️ fal 应用命名空间 = 端点前两段（owner/model），
// 子路径端点（如 google/gemini-omni-flash/v1.1/text-to-video）的 ns 是 google/gemini-omni-flash
// ——2026-10-10 实测：取"去掉末段"会 405。
export async function resume({ request_id, endpoint, apiKey }) {
  const ns = endpoint.split("/").slice(0, 2).join("/");
  const base = `https://queue.fal.run/${ns}/requests/${encodeURIComponent(request_id)}`;
  const r = await fetch(`${base}/status`, { headers: { Authorization: `Key ${apiKey}` }, signal: AbortSignal.timeout(15000) });
  if (r.status === 404) throw new Error(`request 不存在：${request_id}`);
  if (!r.ok) throw new Error(`fal 状态查询 HTTP ${r.status}`);
  const j = await r.json();
  if (j.status !== "COMPLETED") throw new Error(`request 状态 ${j.status}，未完成不能取结果`);
  const { video_url, raw } = await fetchResult(base, apiKey);
  return { task_id: request_id, video_url, raw };
}
