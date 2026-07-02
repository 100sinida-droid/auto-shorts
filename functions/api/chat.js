// Cloudflare Pages Function → /api/chat
// GET  : 최근 24시간 메시지 반환  { messages, kv }
// POST : 메시지 저장 후 최신 목록 반환  { messages, kv }
// KV 바인딩 이름은 CHAT.  (kv:false 로 오면 대시보드에서 CHAT 바인딩을 안 한 것)

const CHAT_KEY = "messages";
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_MSGS = 500;

function prune(msgs) {
  const cutoff = Date.now() - RETENTION_MS;
  return msgs
    .filter((m) => m && m.ts > cutoff && typeof m.n === "string" && typeof m.t === "string")
    .sort((a, b) => a.ts - b.ts)
    .slice(-MAX_MSGS);
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function onRequestGet({ env }) {
  if (!env || !env.CHAT) return json({ messages: [], kv: false, warn: "KV(CHAT) 미연결" });
  const raw = await env.CHAT.get(CHAT_KEY);
  const msgs = raw ? prune(JSON.parse(raw)) : [];
  return json({ messages: msgs, kv: true });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const nick = String(body.n ?? "").trim().slice(0, 12);
  const text = String(body.t ?? "").trim().slice(0, 200);
  if (!nick || !text) return json({ error: "empty" }, 400);

  if (!env || !env.CHAT) {
    // KV 미연결 — 저장은 못 하지만, 보낸 메시지는 그대로 돌려줘 화면에는 남게 함
    return json({ messages: [{ n: nick, t: text, ts: Date.now() }], kv: false, warn: "KV(CHAT) 미연결 — 저장되지 않음" });
  }

  const raw = await env.CHAT.get(CHAT_KEY);
  const msgs = raw ? JSON.parse(raw) : [];
  msgs.push({ n: nick, t: text, ts: Date.now() });
  const pruned = prune(msgs);
  await env.CHAT.put(CHAT_KEY, JSON.stringify(pruned), { expirationTtl: 60 * 60 * 25 });
  return json({ messages: pruned, kv: true });
}
