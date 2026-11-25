// GET /api/admin/stats?days=30  (Authorization: Bearer <토큰>)
// 관리자 화면에 필요한 통계를 한 번에 돌려줍니다.

import { sign, tokenSecret } from './login.js';
import { ensureTable } from '../track.js';

async function verify(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'admin') return false;
  const exp = Number(parts[1]);
  if (!exp || exp < Date.now()) return false;
  const expected = await sign(tokenSecret(env), `admin.${exp}`);
  return expected === parts[2];
}

const kstDay = offsetDays => new Date(Date.now() + 9 * 3600000 - offsetDays * 86400000).toISOString().slice(0, 10);

export async function onRequestGet({ request, env }) {
  if (!(await verify(request, env))) return Response.json({ error: '로그인이 필요해요.' }, { status: 401 });
  if (!env.DB) return Response.json({ error: 'D1 데이터베이스(DB)가 연결되지 않았어요. README 8번을 확인하세요.', setup: true }, { status: 503 });

  const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 30));
  const from = kstDay(days - 1), today = kstDay(0), yesterday = kstDay(1);
  const db = env.DB;
  await ensureTable(db);

  const q = (sql, ...args) => db.prepare(sql).bind(...args);
  const dayAgg = `SUM(type='pv') pv, COUNT(DISTINCT CASE WHEN type='pv' THEN vid END) uv, SUM(type='plan') plans,
    SUM(type='click' AND k1='coupang') coupang, SUM(type='click' AND k1='coupang-search') search`;

  const res = await db.batch([
    q(`SELECT day, ${dayAgg} FROM events WHERE day >= ? GROUP BY day ORDER BY day`, from),
    q(`SELECT day, ${dayAgg} FROM events WHERE day IN (?, ?) GROUP BY day`, today, yesterday),
    q(`SELECT path k, COUNT(*) n FROM events WHERE type='pv' AND day >= ? GROUP BY path ORDER BY n DESC LIMIT 15`, from),
    q(`SELECT ref k, COUNT(*) n FROM events WHERE type='pv' AND ref != '' AND day >= ? GROUP BY ref ORDER BY n DESC LIMIT 10`, from),
    q(`SELECT k1 mode, k2 k, COUNT(*) n FROM events WHERE type='plan' AND day >= ? GROUP BY k1, k2 ORDER BY n DESC LIMIT 15`, from),
    q(`SELECT k2 k, COUNT(*) n FROM events WHERE type='click' AND k1='coupang' AND day >= ? GROUP BY k2 ORDER BY n DESC LIMIT 15`, from),
    q(`SELECT k3 k, k2 item, COUNT(*) n FROM events WHERE type='click' AND k1='coupang' AND day >= ? GROUP BY k3 ORDER BY n DESC LIMIT 15`, from),
    q(`SELECT k1 k, COUNT(*) n FROM events WHERE type IN ('click','tool') AND day >= ? GROUP BY k1 ORDER BY n DESC`, from),
    q(`SELECT device k, COUNT(DISTINCT vid || day) n FROM events WHERE type='pv' AND day >= ? GROUP BY device`, from),
    q(`SELECT hour k, COUNT(*) n FROM events WHERE type='pv' AND day >= ? GROUP BY hour ORDER BY hour`, from),
    q(`SELECT k3 k, COUNT(*) n FROM events WHERE type='plan' AND day >= ? GROUP BY k3 ORDER BY n DESC LIMIT 8`, from),
    q(`SELECT ts, type, path, device, k1, k2, k3 FROM events ORDER BY id DESC LIMIT 40`),
  ]);

  const rows = i => res[i].results || [];
  return Response.json({
    range: { from, to: today, days },
    daily: rows(0),
    today: rows(1).find(r => r.day === today) || { pv: 0, uv: 0, plans: 0, coupang: 0, search: 0 },
    yesterday: rows(1).find(r => r.day === yesterday) || { pv: 0, uv: 0, plans: 0, coupang: 0, search: 0 },
    pages: rows(2), refs: rows(3), dests: rows(4), items: rows(5), products: rows(6),
    clicks: rows(7), devices: rows(8), hours: rows(9), groups: rows(10), recent: rows(11),
  }, { headers: { 'cache-control': 'no-store' } });
}
