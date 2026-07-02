// Cloudflare Pages Function → 자동으로 /api/chat 경로가 됩니다.
// GET  : 최근 24시간 메시지 반환
// POST : 메시지 저장 ({n, t})
// KV 바인딩 이름은 CHAT (Cloudflare 대시보드에서 연결 — 배포가이드 참고)

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
  if (!env.CHAT) return json({ messages: [], warn: "KV 미연결" });
  const raw = await env.CHAT.get(CHAT_KEY);
  const msgs = raw ? prune(JSON.parse(raw)) : [];
  return json({ messages: msgs });
}

export async function onRequestPost({ request, env }) {
  if (!env.CHAT) return json({ error: "KV 미연결 — 대시보드에서 CHAT 네임스페이스를 연결하세요." }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const nick = String(body.n ?? "").trim().slice(0, 12);
  const text = String(body.t ?? "").trim().slice(0, 200);
  if (!nick || !text) return json({ error: "empty" }, 400);

  const raw = await env.CHAT.get(CHAT_KEY);
  const msgs = raw ? JSON.parse(raw) : [];
  msgs.push({ n: nick, t: text, ts: Date.now() });
  const pruned = prune(msgs);
  await env.CHAT.put(CHAT_KEY, JSON.stringify(pruned), { expirationTtl: 60 * 60 * 25 });
  return json({ messages: pruned });
}
