// GET /api/products?keyword=여행용 멀티 어댑터
//
// 쿠팡파트너스 상품 검색 API를 대신 호출하고, 결과를 KV에 저장해 둡니다.
// 검색 API는 호출 횟수 제한이 엄격하므로(시간당 약 10회), 같은 검색어는 캐시에서 꺼내 씁니다.
//
// 필요한 Cloudflare 설정 (README 참고)
//   환경변수(Secret): COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY
//   선택 환경변수:    COUPANG_SUB_ID   (실적을 채널별로 나눠 보고 싶을 때)
//   KV 바인딩:        PRODUCT_CACHE

const HOST = 'https://api-gateway.coupang.com';
const PATH = '/v2/providers/affiliate_open_api/apis/openapi/products/search';
const CACHE_TTL = 60 * 60 * 24;        // 정상 결과 24시간 보관
const HOURLY_LIMIT = 9;                // 시간당 실제 API 호출 상한 (여유 1회)

export async function onRequestGet({ request, env }) {
  if (!env.COUPANG_ACCESS_KEY || !env.COUPANG_SECRET_KEY) {
    return json({ enabled: false, products: [] }, 503);
  }

  const keyword = (new URL(request.url).searchParams.get('keyword') || '').trim().slice(0, 50);
  if (!keyword) return json({ error: 'keyword required' }, 400);

  const cacheKey = `search:${keyword}`;
  const kv = env.PRODUCT_CACHE;

  if (kv) {
    const cached = await kv.get(cacheKey, 'json');
    if (cached) return json({ enabled: true, cached: true, products: cached });

    // 시간당 호출 횟수 관리
    const hourKey = `quota:${new Date().toISOString().slice(0, 13)}`;
    const used = Number(await kv.get(hourKey)) || 0;
    if (used >= HOURLY_LIMIT) return json({ enabled: true, limited: true, products: [] }, 429);
    await kv.put(hourKey, String(used + 1), { expirationTtl: 3700 });
  }

  const params = new URLSearchParams({ keyword, limit: '5' });
  if (env.COUPANG_SUB_ID) params.set('subId', env.COUPANG_SUB_ID);
  const query = params.toString();

  try {
    const auth = await authorization('GET', PATH, query, env.COUPANG_ACCESS_KEY, env.COUPANG_SECRET_KEY);
    const res = await fetch(`${HOST}${PATH}?${query}`, {
      headers: { Authorization: auth, 'Content-Type': 'application/json;charset=UTF-8' },
    });
    const body = await res.json();
    if (!res.ok || body.rCode !== '0') {
      return json({ enabled: true, error: body.rMessage || `HTTP ${res.status}`, products: [] }, 502);
    }

    const products = (body.data?.productData || []).map(p => ({
      id: p.productId,
      name: p.productName,
      price: p.productPrice,
      image: p.productImage,
      url: p.productUrl,          // 제휴 링크로 내려옴
      rocket: Boolean(p.isRocket),
      freeShipping: Boolean(p.isFreeShipping),
    }));

    if (kv && products.length) await kv.put(cacheKey, JSON.stringify(products), { expirationTtl: CACHE_TTL });
    return json({ enabled: true, cached: false, products });
  } catch (err) {
    return json({ enabled: true, error: String(err), products: [] }, 502);
  }
}

// 쿠팡 Open API 서명 (CEA HmacSHA256)
async function authorization(method, path, query, accessKey, secretKey) {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const signedDate = `${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  const message = signedDate + method + path + query;

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const signature = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');

  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${signedDate}, signature=${signature}`;
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}
