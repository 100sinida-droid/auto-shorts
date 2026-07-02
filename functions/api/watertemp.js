// Cloudflare Pages Function → /api/watertemp
//
// 한강 실시간 수온. 인증키 없이 작동하는 hangang.life 공개 API를 1순위로 쓰고,
// 실패하면 서울시 열린데이터광장(WPOSInformationTime, SEOUL_API_KEY 필요)을 백업으로 씁니다.
// 두 소스 모두 탄천·중랑천·안양천·선유 자동측정소의 매시간 실측 수온을 제공합니다.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// ── 1순위: hangang.life (무인증) ──
async function fromHangangLife() {
  const r = await fetch("https://api.hangang.life/", {
    cf: { cacheTtl: 300, cacheEverything: true },
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!r.ok) throw new Error("hangang.life " + r.status);
  const data = await r.json();
  const han = data?.DATAs?.DATA?.HANGANG;
  if (!han || typeof han !== "object") throw new Error("hangang.life shape");
  const stations = [];
  let latest = null;
  for (const name in han) {
    const t = parseFloat(han[name]?.TEMP);
    if (!isNaN(t) && t > -5 && t < 45) {
      stations.push({ name, temp: t, ph: han[name]?.PH ?? null });
      const lu = han[name]?.LAST_UPDATE;
      if (lu && (!latest || lu > latest)) latest = lu;
    }
  }
  if (!stations.length) throw new Error("hangang.life no temp");
  return { stations, measuredAt: latest, sourceName: "hangang.life (한강라이프)", sourceUrl: "https://hangang.life/" };
}

// ── 2순위: 서울시 열린데이터광장 (SEOUL_API_KEY 필요) ──
const TEMP_KEYS = ["W_TEMP", "WTEMP", "TEMP", "WATER_TEMP", "수온"];
const NAME_KEYS = ["SITE_ID", "MSR_NM", "SITE_NM", "MSRSTE_NM", "PT_NM", "측정소명", "측정소"];
const TIME_KEYS = ["MSR_DATE", "MSRDT", "MEASURE_DATE", "측정일시", "MSR_DT"];
function pick(obj, keys) {
  for (const k of keys) if (obj[k] != null && String(obj[k]).trim() !== "") return obj[k];
  const l = {}; for (const k in obj) l[k.toLowerCase()] = obj[k];
  for (const k of keys) { const v = l[k.toLowerCase()]; if (v != null && String(v).trim() !== "") return v; }
  return null;
}
async function fromSeoul(env) {
  const key = (env && env.SEOUL_API_KEY) ? env.SEOUL_API_KEY : null;
  if (!key) throw new Error("no seoul key");
  const r = await fetch(`http://openAPI.seoul.go.kr:8088/${key}/json/WPOSInformationTime/1/25/`, {
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!r.ok) throw new Error("seoul " + r.status);
  const data = await r.json();
  const root = data.WPOSInformationTime || data[Object.keys(data)[0]];
  const rows = root && Array.isArray(root.row) ? root.row : [];
  const stations = [];
  for (const row of rows) {
    const t = pick(row, TEMP_KEYS), name = pick(row, NAME_KEYS);
    const temp = t !== null ? parseFloat(String(t).replace(/[^\d.\-]/g, "")) : NaN;
    if (!isNaN(temp) && temp > -5 && temp < 45) stations.push({ name: name ? String(name) : "측정소", temp });
  }
  if (!stations.length) throw new Error("seoul no temp");
  return { stations, measuredAt: pick(rows[0], TIME_KEYS), sourceName: "서울시 열린데이터광장", sourceUrl: "https://data.seoul.go.kr/dataList/OA-15488/S/1/datasetView.do" };
}

export async function onRequestGet({ env }) {
  let res = null, errors = [];
  for (const fn of [fromHangangLife, () => fromSeoul(env)]) {
    try { res = await fn(); break; } catch (e) { errors.push(String(e.message || e)); }
  }
  if (!res) return json({ ok: false, reason: "all_failed", errors }, 502);

  const avg = res.stations.reduce((s, x) => s + x.temp, 0) / res.stations.length;
  return json({
    ok: true,
    avgTemp: Math.round(avg * 10) / 10,
    stations: res.stations,
    measuredAt: res.measuredAt || null,
    source: { name: res.sourceName, url: res.sourceUrl },
    ts: Date.now(),
  });
}
