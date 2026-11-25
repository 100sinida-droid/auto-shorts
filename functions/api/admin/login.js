// POST /api/admin/login  { id, password }
// 맞으면 7일짜리 로그인 토큰을 돌려줍니다.
//
// 기본 관리자 계정은 아래 ADMIN_ID / ADMIN_HASH로 정해져 있어요.
// 비밀번호 원문은 저장하지 않고, 되돌릴 수 없는 해시값만 넣어 두었습니다.
// Cloudflare 환경변수 ADMIN_PASSWORD를 넣으면 그 비밀번호(아이디는 같음)로도 로그인할 수 있어요.

export const ADMIN_ID = 'sinida';
const ADMIN_HASH = '99edd298b5efb00719b4d35c1753ba5c95f98c94471d8769c5034282c71bf790';
const SALT = 'jimkkurim-admin-v1';

async function pbkdf2(text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(text), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(SALT), iterations: 100000 }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function same(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// 토큰 서명용 비밀값: ADMIN_SECRET → ADMIN_PASSWORD → 내장 해시 순서로 사용
export function tokenSecret(env) {
  return env.ADMIN_SECRET || env.ADMIN_PASSWORD || ADMIN_HASH;
}

export async function sign(secret, payload) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c]));
}

export async function onRequestPost({ request, env }) {
  let id = '', pw = '';
  try { const j = await request.json(); id = String(j.id || '').trim(); pw = String(j.password || ''); } catch { /* 빈 값 */ }

  let ok = false;
  if (id === ADMIN_ID) {
    ok = same(await pbkdf2(`${id}:${pw}`), ADMIN_HASH) || (!!env.ADMIN_PASSWORD && same(pw, env.ADMIN_PASSWORD));
  }
  if (!ok) {
    await new Promise(r => setTimeout(r, 800));
    return Response.json({ error: '아이디나 비밀번호가 맞지 않아요.' }, { status: 401 });
  }
  const exp = Date.now() + 7 * 86400000;
  const payload = `admin.${exp}`;
  const token = `${payload}.${await sign(tokenSecret(env), payload)}`;
  return Response.json({ token, exp }, { headers: { 'cache-control': 'no-store' } });
}
