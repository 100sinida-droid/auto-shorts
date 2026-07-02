// Cloudflare Pages Function → 자동으로 /api/quotes 경로가 됩니다.
// 야후 파이낸스 v8 chart 엔드포인트(인증 불필요)를 중계해 코스피/종목 시세를 반환합니다.

const SYMBOLS = [
  { sym: "^KS11",     name: "KOSPI",          kind: "index" },
  { sym: "005930.KS", name: "삼성전자",        kind: "stock" },
  { sym: "000660.KS", name: "SK하이닉스",      kind: "stock" },
  { sym: "373220.KS", name: "LG에너지솔루션",  kind: "stock" },
  { sym: "005380.KS", name: "현대차",          kind: "stock" },
  { sym: "035420.KS", name: "NAVER",           kind: "stock" },
  { sym: "035720.KS", name: "카카오",          kind: "stock" },
];

async function fetchOne(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`;
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    cf: { cacheTtl: 30, cacheEverything: true },
  });
  if (!r.ok) throw new Error(`yahoo ${sym} ${r.status}`);
  const data = await r.json();
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`no meta ${sym}`);
  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose ?? meta.previousClose;
  const changePct = (typeof price === "number" && typeof prev === "number" && prev !== 0)
    ? ((price - prev) / prev) * 100
    : 0;
  return { price, changePct };
}

export async function onRequestGet() {
  const out = {
    kospi: null,
    stocks: [],
    source: { name: "Yahoo Finance", url: "https://finance.yahoo.com" },
    ts: Date.now(),
  };
  const results = await Promise.allSettled(SYMBOLS.map((s) => fetchOne(s.sym)));
  results.forEach((res, i) => {
    if (res.status !== "fulfilled") return;
    const meta = SYMBOLS[i];
    const { price, changePct } = res.value;
    if (typeof price !== "number") return;
    if (meta.kind === "index") out.kospi = { value: price, changePct };
    else out.stocks.push({ name: meta.name, price, changePct });
  });
  return new Response(JSON.stringify(out), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
