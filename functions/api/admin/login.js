// POST /api/admin/login  { password }
// 비밀번호가 맞으면 7일짜리 로그인 토큰을 돌려줍니다.
// 비밀번호는 Cloudflare 환경변수(Secret) ADMIN_PASSWORD에 넣습니다.

export async function sign(secret, payload) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c]));
}

function same(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD) return Response.json({ error: 'ADMIN_PASSWORD가 설정되지 않았어요.' }, { status: 503 });
  let pw = '';
  try { pw = String((await request.json()).password || ''); } catch { /* 빈 값 */ }
  if (!same(pw, env.ADMIN_PASSWORD)) {
    await new Promise(r => setTimeout(r, 800));
    return Response.json({ error: '비밀번호가 맞지 않아요.' }, { status: 401 });
  }
  const exp = Date.now() + 7 * 86400000;
  const payload = `admin.${exp}`;
  const token = `${payload}.${await sign(env.ADMIN_PASSWORD, payload)}`;
  return Response.json({ token, exp }, { headers: { 'cache-control': 'no-store' } });
}
