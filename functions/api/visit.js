// Cloudflare Pages Function → /api/visit
// 오늘(KST) 이 사이트에 들어온 방문 수와 누적 방문 수를 세어 반환합니다.
// POST: 방문 1 증가 후 최신 카운트 반환 / GET: 증가 없이 현재 카운트만 반환
// KV 바인딩 CHAT 를 함께 사용합니다(채팅과 동일 네임스페이스).

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// KST 기준 오늘 날짜 문자열 (YYYY-MM-DD)
function todayKST() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

async function readCounts(env) {
  const day = todayKST();
  if (!env || !env.CHAT) return { today: 0, total: 0, day, kv: false };
  const [t, tot] = await Promise.all([
    env.CHAT.get("visit:" + day),
    env.CHAT.get("visit:total"),
  ]);
  return { today: parseInt(t || "0", 10), total: parseInt(tot || "0", 10), day, kv: true };
}

export async function onRequestGet({ env }) {
  const c = await readCounts(env);
  return json(c);
}

export async function onRequestPost({ env }) {
  const day = todayKST();
  if (!env || !env.CHAT) return json({ today: 0, total: 0, day, kv: false });
  const [tRaw, totRaw] = await Promise.all([
    env.CHAT.get("visit:" + day),
    env.CHAT.get("visit:total"),
  ]);
  const today = parseInt(tRaw || "0", 10) + 1;
  const total = parseInt(totRaw || "0", 10) + 1;
  await Promise.all([
    env.CHAT.put("visit:" + day, String(today), { expirationTtl: 60 * 60 * 48 }),
    env.CHAT.put("visit:total", String(total)),
  ]);
  return json({ today, total, day, kv: true });
}

// 안전망: 어떤 메서드로 오든 처리 (405 방지)
export async function onRequest(context) {
  const m = context.request.method;
  if (m === "POST") return onRequestPost(context);
  if (m === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Origin": "*" } });
  return onRequestGet(context);
}
