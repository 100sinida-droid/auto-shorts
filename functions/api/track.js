// POST /api/track — 방문·이용 기록을 D1(DB)에 저장
// 필요한 Cloudflare 설정: D1 데이터베이스를 변수 이름 DB로 연결 (README 8번)
// IP 주소는 저장하지 않고, "IP+브라우저+날짜"를 섞은 해시(하루 단위 익명 방문자 값)만 저장합니다.

const TYPES = new Set(['pv', 'plan', 'click', 'tool']);
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse/i;
let ready = false;

export async function ensureTable(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, day TEXT, hour INTEGER, type TEXT,
      path TEXT, ref TEXT, vid TEXT, device TEXT, k1 TEXT, k2 TEXT, k3 TEXT)`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_events_day ON events(day)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_events_type_day ON events(type, day)'),
  ]);
  ready = true;
}

const cut = (v, n = 120) => (v == null ? '' : String(v)).slice(0, n);

export async function onRequestPost({ request, env }) {
  if (!env.DB) return new Response(null, { status: 204 });
  const ua = request.headers.get('user-agent') || '';
  if (BOT.test(ua)) return new Response(null, { status: 204 });

  let body;
  try { body = JSON.parse(await request.text()); } catch { return new Response(null, { status: 400 }); }
  if (!body || !TYPES.has(body.type)) return new Response(null, { status: 400 });

  // 한국 시간 기준 날짜·시
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const day = kst.toISOString().slice(0, 10);
  const hour = kst.getUTCHours();

  const ip = request.headers.get('cf-connecting-ip') || '';
  const salt = env.ADMIN_PASSWORD || 'jimkkurim';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}|${ua}|${day}|${salt}`));
  const vid = [...new Uint8Array(digest)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
  const device = /Mobi|Android|iPhone|iPad/i.test(ua) ? 'mobile' : 'desktop';

  let ref = '';
  try {
    if (body.ref) {
      const h = new URL(body.ref).hostname.replace(/^www\./, '');
      if (h && h !== new URL(request.url).hostname) ref = h;
    }
  } catch { /* 잘못된 주소는 무시 */ }

  await ensureTable(env.DB);
  await env.DB.prepare('INSERT INTO events (ts, day, hour, type, path, ref, vid, device, k1, k2, k3) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(now.getTime(), day, hour, body.type, cut(body.path, 200), ref, vid, device, cut(body.k1, 40), cut(body.k2), cut(body.k3, 200))
    .run();

  // 가끔 오래된 기록 정리 (400일 넘은 것)
  if (Math.random() < 0.01) {
    const old = new Date(kst.getTime() - 400 * 86400000).toISOString().slice(0, 10);
    await env.DB.prepare('DELETE FROM events WHERE day < ?').bind(old).run();
  }
  return new Response(null, { status: 204 });
}
