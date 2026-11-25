// 모든 요청에 먼저 적용: 서버 코드·생성기·안내 파일은 외부에서 열 수 없게 막습니다.
const BLOCKED = /^\/(functions|tools)(\/|$)|^\/README(\.md)?$|^\/\.git/i;

export async function onRequest({ request, next }) {
  const { pathname } = new URL(request.url);
  if (BLOCKED.test(pathname)) return new Response('Not found', { status: 404 });
  const res = await next();
  if (pathname === '/admin' || pathname === '/admin.html') {
    const r = new Response(res.body, res);
    r.headers.set('X-Robots-Tag', 'noindex, nofollow');
    r.headers.set('Cache-Control', 'no-store');
    return r;
  }
  return res;
}
