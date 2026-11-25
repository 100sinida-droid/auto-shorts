// GET /api/places
//   ?type=geo&q=해운대                       → 장소 이름을 좌표로 바꿈
//   ?type=near&cat=AT4&x=129.1&y=35.1&radius=10000 → 주변 관광명소(AT4)·음식점(FD6)·카페(CE7)
//
// 카카오 로컬 API를 대신 호출합니다. 키는 Cloudflare 환경변수(Secret) KAKAO_REST_KEY에 넣으세요.
// 같은 요청은 KV(PRODUCT_CACHE)가 연결돼 있으면 7일 동안 저장해 두고 다시 씁니다.

const BASE = 'https://dapi.kakao.com/v2/local/search';
const CACHE_TTL = 60 * 60 * 24 * 7;
const CATS = new Set(['AT4', 'FD6', 'CE7', 'AD5']);

export async function onRequestGet({ request, env }) {
  if (!env.KAKAO_REST_KEY) return json({ enabled: false }, 503);
  const u = new URL(request.url);
  const type = u.searchParams.get('type');
  let api, key;

  if (type === 'geo') {
    const q = (u.searchParams.get('q') || '').trim().slice(0, 60);
    if (!q) return json({ error: 'q required' }, 400);
    api = `${BASE}/keyword.json?size=1&query=${encodeURIComponent(q)}`;
    key = `kgeo:${q}`;
  } else if (type === 'near') {
    const cat = u.searchParams.get('cat');
    const x = Number(u.searchParams.get('x')), y = Number(u.searchParams.get('y'));
    const radius = Math.min(20000, Math.max(500, Number(u.searchParams.get('radius')) || 5000));
    if (!CATS.has(cat) || !Number.isFinite(x) || !Number.isFinite(y)) return json({ error: 'bad params' }, 400);
    // 좌표를 소수 셋째 자리로 묶어 캐시 효율을 높임
    const xr = x.toFixed(3), yr = y.toFixed(3);
    api = `${BASE}/category.json?category_group_code=${cat}&x=${xr}&y=${yr}&radius=${radius}&sort=accuracy&size=15`;
    key = `knear:${cat}:${xr}:${yr}:${radius}`;
  } else {
    return json({ error: 'type must be geo or near' }, 400);
  }

  const kv = env.PRODUCT_CACHE;
  if (kv) {
    const cached = await kv.get(key, 'json');
    if (cached) return json(cached);
  }

  const res = await fetch(api, { headers: { Authorization: `KakaoAK ${env.KAKAO_REST_KEY}` } });
  if (!res.ok) return json({ error: `kakao ${res.status}` }, 502);
  const body = await res.json();
  const docs = body.documents || [];

  let out;
  if (type === 'geo') {
    const d = docs[0];
    out = { place: d ? { name: d.place_name, lat: Number(d.y), lon: Number(d.x), address: d.road_address_name || d.address_name } : null };
  } else {
    out = {
      places: docs.map(d => ({
        name: d.place_name,
        category: (d.category_name || '').split(' > ').slice(-1)[0],
        address: d.road_address_name || d.address_name,
        url: d.place_url,
        distance: Number(d.distance) || null,
      })),
    };
  }

  if (kv) await kv.put(key, JSON.stringify(out), { expirationTtl: CACHE_TTL });
  return json(out);
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': status === 200 ? 'public, max-age=3600' : 'no-store' } });
}
