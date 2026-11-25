// GET /api/status
// 쿠팡·카카오 API 키가 Cloudflare 환경변수에 들어 있는지만 알려 줍니다. (키 값은 절대 내보내지 않음)
export async function onRequestGet({ env }) {
  return Response.json({
    coupang: Boolean(env.COUPANG_ACCESS_KEY && env.COUPANG_SECRET_KEY),
    kakao: Boolean(env.KAKAO_REST_KEY),
  }, { headers: { 'cache-control': 'public, max-age=300' } });
}
