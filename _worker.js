// 봉안당 길잡이 — 방문 통계 (Cloudflare Pages 고급 모드 워커)
//
// 하는 일
//   1) /api/hit   : 각 페이지가 보내는 방문 기록을 D1 데이터베이스에 저장
//   2) /stats     : 비밀번호로 들어가는 통계 페이지 (방문자 수, 유입 경로, 검색어, 배너 등)
//   3) /_builder/, /.github/ : 사이트 만드는 프로그램 폴더는 바깥에서 못 보게 막음
//   나머지 주소는 원래대로 사이트 파일을 보여 줌
//
// 설정 (Cloudflare 대시보드, 한 번만)
//   - D1 데이터베이스를 만들고 이 Pages 프로젝트에 변수 이름 DB 로 연결
//   - 환경 변수(비밀) STATS_PASSWORD 에 통계 페이지 비밀번호 입력
// 개인정보: IP 주소는 저장하지 않음. 같은 사람 구분은 날짜별로 바뀌는 해시값만 사용

const SEARCH = [
  // [호스트에 들어간 글자, 이름, 검색어 파라미터]
  ["search.naver.com", "네이버", ["query", "oquery"]],
  ["search.daum.net", "다음", ["q"]],
  ["google.", "구글", ["q"]],
  ["bing.com", "빙", ["q"]],
  ["search.zum.com", "줌", ["query"]],
  ["search.yahoo.", "야후", ["p"]],
  ["duckduckgo.com", "덕덕고", ["q"]],
  ["search.nate.com", "네이트", ["q"]],
  ["chatgpt.com", "챗GPT", []],
  ["perplexity.ai", "퍼플렉시티", []],
];
const SOCIAL = [
  ["blog.naver.com", "네이버 블로그"], ["cafe.naver.com", "네이버 카페"], ["kin.naver.com", "네이버 지식iN"],
  ["band.us", "밴드"], ["kakao.com", "카카오"], ["facebook.com", "페이스북"], ["instagram.com", "인스타그램"],
  ["youtube.com", "유튜브"], ["youtu.be", "유튜브"], ["tistory.com", "티스토리"], ["t.co", "엑스(트위터)"],
  ["x.com", "엑스(트위터)"], ["threads.net", "스레드"], ["brunch.co.kr", "브런치"], ["daum.net", "다음 카페·블로그"],
];
const TYPE_LABEL = { search: "검색 포털", direct: "직접 방문", social: "블로그·SNS", referral: "다른 사이트 링크", campaign: "배너·광고 링크", internal: "사이트 안 이동" };

function classify(ref, host, params) {
  const out = { type: "direct", name: "직접 방문(주소 입력·즐겨찾기)", refHost: "", keyword: "", campaign: "" };
  const utmSource = params.utm_source || params.ref || "";
  if (utmSource) {
    out.type = "campaign";
    out.name = utmSource;
    out.campaign = [params.utm_campaign, params.utm_content].filter(Boolean).join(" / ");
    out.keyword = params.utm_term || "";
  }
  if (!ref) return out;
  let u;
  try { u = new URL(ref); } catch (e) { return out; }
  const h = u.hostname.toLowerCase();
  out.refHost = h;
  if (h === host) {
    if (out.type !== "campaign") { out.type = "internal"; out.name = "사이트 안 이동"; }
    return out;
  }
  if (out.type === "campaign") return out;
  for (const [needle, name, keys] of SEARCH) {
    if (h.includes(needle)) {
      out.type = "search";
      out.name = name;
      for (const k of keys) { const v = u.searchParams.get(k); if (v) { out.keyword = v.trim().slice(0, 100); break; } }
      return out;
    }
  }
  for (const [needle, name] of SOCIAL) {
    if (h === needle || h.endsWith("." + needle)) { out.type = "social"; out.name = name; return out; }
  }
  out.type = "referral";
  out.name = h.replace(/^www\./, "");
  return out;
}

const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|facebookexternalhit|yeti|daumoa/i;

async function sha(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function kstDay(ts) {
  return new Date(ts + 9 * 3600e3).toISOString().slice(0, 10);
}

let ready = false;
async function ensure(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hits (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, day TEXT, vid TEXT, path TEXT,
      entry INTEGER, src_type TEXT, src_name TEXT, ref_host TEXT, keyword TEXT, campaign TEXT, device TEXT, site_q TEXT)`),
    db.prepare("CREATE INDEX IF NOT EXISTS hits_day ON hits(day)"),
  ]);
  for (const col of ["title", "sub"]) {
    try { await db.prepare(`ALTER TABLE hits ADD COLUMN ${col} TEXT DEFAULT ''`).run(); } catch (e) { /* 이미 있음 */ }
  }
  ready = true;
}

async function recordHit(request, env) {
  if (!env.DB) return new Response(null, { status: 204 });
  const ua = request.headers.get("user-agent") || "";
  if (BOT.test(ua)) return new Response(null, { status: 204 });
  let d;
  try { d = await request.json(); } catch (e) { return new Response(null, { status: 204 }); }
  const host = new URL(request.url).hostname;
  const page = new URL(String(d.u || "/"), request.url);
  if (page.hostname !== host) return new Response(null, { status: 204 });
  const params = Object.fromEntries(page.searchParams);
  const c = classify(String(d.r || ""), host, params);
  const now = Date.now();
  const day = kstDay(now);
  const ip = request.headers.get("cf-connecting-ip") || "";
  const vid = (await sha(`${day}|${ip}|${ua}|${env.STATS_PASSWORD || "salt"}`)).slice(0, 16);
  const device = /mobile|android|iphone|ipad/i.test(ua) ? "모바일" : "PC";
  const siteQ = page.pathname.endsWith("/pages/search.html") ? (params.q || "").slice(0, 60) : "";
  await ensure(env.DB);
  const title = String(d.t || "").replace(/\s*\|\s*봉안당 길잡이$/, "").slice(0, 80);
  const sub = String(d.s || "").slice(0, 80);
  // 같은 페이지 안에서 시설로 이동(#)한 기록은 entry=0 으로만 남김
  const entry = d.h ? 0 : (c.type === "internal" ? 0 : 1);
  await env.DB.prepare(`INSERT INTO hits (ts, day, vid, path, entry, src_type, src_name, ref_host, keyword, campaign, device, site_q, title, sub)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(now, day, vid, page.pathname.slice(0, 200), entry,
    d.h ? "internal" : c.type, d.h ? "사이트 안 이동" : c.name.slice(0, 80), c.refHost.slice(0, 120), d.h ? "" : c.keyword, c.campaign.slice(0, 120), device, d.h ? "" : siteQ, title, sub).run();
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------- 통계 페이지
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = n => Number(n || 0).toLocaleString("ko-KR");

function page(title, body) {
  return new Response(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)} | 봉안당 길잡이</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>
:root{--bg:#f4f3ef;--card:#fff;--ink:#1d2320;--ink2:#5a615d;--line:#e2ddd2;--acc:#1f4d3f;--gold:#b08a3e}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 "Pretendard Variable",Pretendard,"Malgun Gothic",sans-serif;word-break:keep-all}
header{background:#15211c;color:#fff}header .in{max-width:1180px;margin:0 auto;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
header b{font-size:20px}header a{color:#e9d7ae}
main{max-width:1180px;margin:0 auto;padding:24px 20px 60px}
h1{font-size:26px;margin:0 0 6px}h2{font-size:19px;margin:0 0 12px;padding-bottom:10px;border-bottom:1px solid var(--line)}
.muted{color:var(--ink2)}.small{font-size:14px}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0 22px}.tabs a{padding:9px 16px;border-radius:999px;background:#fff;border:1px solid var(--line);color:var(--ink);text-decoration:none;font-weight:600}
.tabs a.on{background:var(--acc);border-color:var(--acc);color:#fff}
.kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}.kpi div{background:var(--card);border:1px solid var(--line);border-top:4px solid var(--acc);border-radius:10px;padding:14px 16px}
.kpi span{display:block;color:var(--ink2);font-size:14px}.kpi strong{font-size:30px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:16px;min-width:0;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:15px}td,th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--ink2);font-size:13px;font-weight:600}
td.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.bar{height:10px;border-radius:5px;background:var(--acc);min-width:2px}.bartd{width:38%}
.chart{display:flex;align-items:flex-end;gap:4px;height:180px;padding-top:10px}.chart .c{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0}
.chart .v{width:100%;background:var(--acc);border-radius:4px 4px 0 0;min-height:2px}.chart .p{width:100%;background:#cfe0d6;border-radius:4px 4px 0 0}
.chart small{font-size:11px;color:var(--ink2);margin-top:4px;white-space:nowrap}.legend{display:flex;gap:14px;font-size:13px;color:var(--ink2)}.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:4px;vertical-align:-1px}
.tag{display:inline-block;font-size:12px;font-weight:700;padding:1px 8px;border-radius:5px;background:#e7efe9;color:var(--acc)}
.tag.search{background:#e3ecfb;color:#1f5b8f}.tag.direct{background:#eee;color:#444}.tag.social{background:#efe8f8;color:#5a4a8a}.tag.referral{background:#fbefe0;color:#9a4f12}.tag.campaign{background:#fbf3d8;color:#80620a}
input,button{font:inherit;padding:11px 14px;border-radius:8px;border:2px solid var(--line)}button{background:var(--acc);color:#fff;border-color:var(--acc);font-weight:700;cursor:pointer}
.linkmaker{display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px}.linkmaker input{min-width:0}#lm-out{margin-top:10px;word-break:break-all;background:#f6f4ee;padding:10px 12px;border-radius:8px;font-size:15px}
.note{background:#fbf3d8;border-radius:10px;padding:12px 16px;font-size:15px}.kpi em{display:block;font-style:normal;font-size:13px;color:var(--ink2)}.analysis{border-left:6px solid var(--gold)}.analysis ul{margin:0;padding-left:20px}.analysis li{margin-bottom:8px;line-height:1.7}.analysis h3{margin:16px 0 8px;font-size:17px}.sugg li::marker{content:'✔  ';color:var(--acc)}.hbars{display:grid;gap:10px}.hb{display:grid;grid-template-columns:minmax(120px,1.3fr) 2fr auto;gap:10px;align-items:center;font-size:15px}.hb-t{background:#e7efe9;border-radius:6px;height:14px;overflow:hidden}.hb-t i{display:block;height:100%;background:var(--acc);border-radius:6px}.hb-v{white-space:nowrap;font-variant-numeric:tabular-nums}.hb-v small{color:var(--ink2)}a.path,.path{font-size:12px;color:var(--ink2)}@media(max-width:800px){.hb{grid-template-columns:1fr auto}.hb-t{grid-column:1/-1;grid-row:2}}
@media(max-width:800px){.kpi{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}.linkmaker{grid-template-columns:1fr}.chart small{display:none}}
</style></head><body><header><div class="in"><b>봉안당 길잡이 · 방문 통계</b><span><a href="/">사이트로 가기</a> · <a href="/stats/logout">나가기</a></span></div></header><main>${body}</main></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

async function authToken(env) {
  return (await sha("stats|" + env.STATS_PASSWORD)).slice(0, 32);
}

function loginPage(msg) {
  return page("로그인", `<div class="card" style="max-width:420px;margin:40px auto"><h1>방문 통계</h1><p class="muted">관리자 비밀번호를 넣어 주세요.</p>
${msg ? `<p style="color:#b42318">${esc(msg)}</p>` : ""}
<form method="post" action="/stats/login"><input type="password" name="pw" placeholder="비밀번호" autofocus style="width:100%;margin-bottom:10px"><button style="width:100%">들어가기</button></form></div>`);
}

function setupPage(env) {
  const steps = [];
  if (!env.DB) steps.push("Cloudflare 대시보드 → Workers 및 Pages → D1 SQL 데이터베이스 → 데이터베이스 만들기 (이름 예: bongan-stats)",
    "Pages 프로젝트(auto-shorts) → 설정 → 바인딩 → 추가 → D1 데이터베이스: 변수 이름 <b>DB</b>, 방금 만든 데이터베이스 선택");
  if (!env.STATS_PASSWORD) steps.push("Pages 프로젝트 → 설정 → 변수 및 비밀 → 추가: 이름 <b>STATS_PASSWORD</b>, 값은 원하는 비밀번호 (유형: 비밀)");
  steps.push("배포 → 가장 최근 배포 → 다시 배포(재시도). 설정은 새 배포부터 적용됩니다.");
  return page("설정 필요", `<div class="card"><h1>통계 설정이 아직 안 끝났습니다</h1><ol>${steps.map(s => `<li>${s}</li>`).join("")}</ol></div>`);
}

function rows(list, cols, total) {
  if (!list.length) return `<p class="muted small">아직 기록이 없습니다.</p>`;
  return `<table><thead><tr>${cols.map(c => `<th${c[2] ? ' class="n"' : ""}>${c[0]}</th>`).join("")}${total ? "<th></th>" : ""}</tr></thead><tbody>` +
    list.map(r => `<tr>${cols.map(c => `<td${c[2] ? ' class="n"' : ""}>${c[1](r)}</td>`).join("")}${total ? `<td class="bartd"><div class="bar" style="width:${Math.max(1, Math.round(100 * r.n / total))}%"></div></td>` : ""}</tr>`).join("") +
    `</tbody></table>`;
}

// ---------------------------------------------------------------- 페이지 이름·관심사 분류
const SIDO_SLUG = { seoul: "서울", busan: "부산", daegu: "대구", incheon: "인천", gwangju: "광주", daejeon: "대전", ulsan: "울산", sejong: "세종",
  gyeonggi: "경기도", gangwon: "강원도", chungbuk: "충북", chungnam: "충남", jeonbuk: "전북", jeonnam: "전남", gyeongbuk: "경북", gyeongnam: "경남", jeju: "제주" };
const PAGE_NAME = {
  "/": "첫 화면", "/index.html": "첫 화면", "/region/index.html": "지역별 봉안당 찾기", "/funeral/index.html": "전국 장례식장·화장장",
  "/type/public.html": "공설 봉안당 목록", "/type/private.html": "사설 봉안당 목록", "/feature/price.html": "봉안당 가격 비교",
  "/feature/parking.html": "주차장 있는 봉안당", "/feature/amenities.html": "편의시설로 봉안당 찾기", "/feature/long-period.html": "안치기간 비교",
  "/compare/facilities.html": "업체별 가격 비교표", "/compare/types.html": "개인단·부부단 가격 비교", "/compare/regions.html": "지역별 가격 비교",
  "/pages/recommend.html": "예산으로 봉안당 추천", "/pages/ranking.html": "봉안당 순위", "/pages/search.html": "이름으로 검색",
  "/pages/about.html": "사이트 소개", "/pages/contact.html": "문의·광고 문의", "/pages/privacy.html": "개인정보처리방침", "/pages/terms.html": "이용약관",
  "/tools/index.html": "장례 도우미 (나이·부의금)", "/tools/jibang.html": "지방·명정 쓰기", "/tools/chukmun.html": "축문 쓰기",
  "/tools/49jae.html": "49재·삼우제 계산", "/tools/bugo.html": "부고 문자 만들기", "/guides/index.html": "가이드 목록",
  "/guides/procedure-after-cremation.html": "가이드: 장례 절차", "/guides/ehaneul-guide.html": "가이드: 화장 예약(e하늘)",
  "/guides/how-to-choose.html": "가이드: 봉안당 고르는 법", "/guides/cost-structure.html": "가이드: 봉안당 비용 구조",
  "/guides/public-vs-private.html": "가이드: 공설과 사설 차이", "/guides/contract-checklist.html": "가이드: 계약 주의사항",
  "/guides/enshrinement-period.html": "가이드: 안치기간·연장", "/guides/bongandang-vs-napgoldang.html": "가이드: 봉안당과 납골당",
  "/guides/natural-burial.html": "가이드: 수목장·자연장", "/guides/pre-planning.html": "가이드: 미리 준비하기", "/guides/reburial.html": "가이드: 이장·개장",
  "/guides/visiting-etiquette.html": "가이드: 참배 예절", "/guides/accessibility-visit.html": "가이드: 어르신·장애인 참배", "/404.html": "없는 페이지(404)",
};
function pageName(path, title) {
  if (PAGE_NAME[path]) return PAGE_NAME[path];
  let m = path.match(/^\/region\/([a-z]+)\.html$/);
  if (m && SIDO_SLUG[m[1]]) return `${SIDO_SLUG[m[1]]} 봉안당 목록`;
  m = path.match(/^\/funeral\/([a-z]+)\.html$/);
  if (m && SIDO_SLUG[m[1]]) return `${SIDO_SLUG[m[1]]} 장례식장·화장장`;
  if (title) return String(title).replace(/\s*\|\s*봉안당 길잡이$/, "").slice(0, 40);
  return path;
}
const PURPOSE = [
  ["price", "봉안당 가격 비교·추천", p => /^\/(feature\/price|compare\/|pages\/recommend)/.test(p)],
  ["bongan", "봉안당 찾기 (지역·조건)", p => /^\/(region|type|feature)\//.test(p)],
  ["funeral", "장례식장·화장장 찾기", p => /^\/funeral\//.test(p)],
  ["tools", "장례 도우미 (지방·축문·부고·49재)", p => /^\/tools\//.test(p)],
  ["guide", "장례·봉안 정보 읽기 (가이드)", p => /^\/guides\//.test(p)],
  ["ranking", "봉안당 순위 보기", p => p === "/pages/ranking.html"],
  ["search", "이름으로 검색", p => p === "/pages/search.html"],
  ["home", "첫 화면만 보기", p => p === "/" || p === "/index.html"],
];
function purposeOf(p) { for (const [k, l, f] of PURPOSE) if (f(p)) return [k, l]; return ["etc", "기타 (소개·문의 등)"]; }
function regionOf(p) { const m = p.match(/^\/(region|funeral)\/([a-z]+)\.html$/); return m && SIDO_SLUG[m[2]] ? SIDO_SLUG[m[2]] : ""; }
const KW_THEME = [
  ["가격·비용", /가격|비용|얼마|시세|요금|관리비|저렴|싼/],
  ["지방·축문·제사", /지방|축문|제사|명정|기일|49재|사십구재|삼우제|탈상|제사상/],
  ["부고·부의금", /부고|부의|조의|답례|조문/],
  ["장례식장·화장", /장례식장|빈소|화장|발인|장례/],
  ["공설·사설", /공설|사설|시립|구립|군립/],
  ["추천·순위", /추천|순위|좋은|유명|베스트/],
  ["수목장·자연장", /수목장|자연장|잔디장/],
  ["지역 이름", /서울|경기|인천|부산|대구|광주|대전|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주|김포|파주|고양|용인|수원|성남|남양주|화성|평택|양주|이천|안산|안양|부천|의정부|포천|가평|양평|여주|시흥|하남|구리|안성|청주|천안|아산|전주|포항|창원|김해|진주|양산|구미|경주|원주|춘천|강릉|목포|여수|순천/],
  ["시설 이름", /추모|공원|봉안|납골|사찰|성당|교회|원$/],
];
function kwTheme(k) { for (const [l, re] of KW_THEME) if (re.test(k)) return l; return "기타"; }
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;

async function statsPage(request, env) {
  const url = new URL(request.url);
  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get("d") || "7", 10) || 7));
  const now = Date.now();
  const from = kstDay(now - (days - 1) * 86400e3);
  const prevFrom = kstDay(now - (2 * days - 1) * 86400e3);
  await ensure(env.DB);
  const q = (sql, ...b) => env.DB.prepare(sql).bind(from, ...b).all().then(r => r.results || []);
  const [tot] = await q(`SELECT COUNT(*) pv, COUNT(DISTINCT vid) uv, SUM(entry) visits FROM hits WHERE day>=?`);
  const [prev] = await env.DB.prepare(`SELECT COUNT(DISTINCT vid) uv FROM hits WHERE day>=? AND day<?`).bind(prevFrom, from).all().then(r => r.results || [{}]);
  const [today] = await env.DB.prepare(`SELECT COUNT(DISTINCT vid) uv FROM hits WHERE day=?`).bind(kstDay(now)).all().then(r => r.results || [{}]);
  const daily = await q(`SELECT day, COUNT(DISTINCT vid) uv, COUNT(*) pv FROM hits WHERE day>=? GROUP BY day ORDER BY day`);
  const types = await q(`SELECT src_type t, COUNT(*) n FROM hits WHERE day>=? AND entry=1 GROUP BY src_type ORDER BY n DESC`);
  const sources = await q(`SELECT src_type t, src_name s, COUNT(*) n, COUNT(DISTINCT vid) u FROM hits WHERE day>=? AND entry=1 GROUP BY src_type, src_name ORDER BY n DESC LIMIT 30`);
  const kws = await q(`SELECT keyword k, src_name s, COUNT(*) n, COUNT(DISTINCT vid) u, MAX(path) p FROM hits WHERE day>=? AND keyword<>'' GROUP BY keyword, src_name ORDER BY n DESC LIMIT 40`);
  const camps = await q(`SELECT src_name s, campaign c, COUNT(*) n, COUNT(DISTINCT vid) u FROM hits WHERE day>=? AND src_type='campaign' AND entry=1 GROUP BY src_name, campaign ORDER BY n DESC LIMIT 20`);
  const pages = await q(`SELECT path p, MAX(title) t, COUNT(*) n, COUNT(DISTINCT vid) u, SUM(entry) e FROM hits WHERE day>=? GROUP BY path ORDER BY u DESC, n DESC LIMIT 40`);
  const subs = await q(`SELECT sub s, path p, COUNT(*) n, COUNT(DISTINCT vid) u FROM hits WHERE day>=? AND sub<>'' GROUP BY sub, path ORDER BY u DESC LIMIT 20`);
  const visitPaths = await q(`SELECT vid, path FROM hits WHERE day>=? GROUP BY vid, path`);
  const siteq = await q(`SELECT site_q k, COUNT(*) n, COUNT(DISTINCT vid) u FROM hits WHERE day>=? AND site_q<>'' GROUP BY site_q ORDER BY n DESC LIMIT 30`);
  const devices = await q(`SELECT device d, COUNT(DISTINCT vid) n FROM hits WHERE day>=? GROUP BY device ORDER BY n DESC`);
  const recent = await q(`SELECT ts, path, title, src_type, src_name, keyword, campaign, device FROM hits WHERE day>=? AND entry=1 ORDER BY ts DESC LIMIT 30`);

  const entries = types.reduce((s, r) => s + r.n, 0);
  const uv = tot.uv || 0;
  // 관심사별 방문자 (한 사람이 여러 관심사를 보면 각각 셈)
  const purposeVids = {}, regionVids = {};
  for (const r of visitPaths) {
    const [k, l] = purposeOf(r.path);
    (purposeVids[k] = purposeVids[k] || { l, s: new Set() }).s.add(r.vid);
    const rg = regionOf(r.path);
    if (rg) (regionVids[rg] = regionVids[rg] || new Set()).add(r.vid);
  }
  const purposes = Object.entries(purposeVids).map(([k, v]) => ({ k, l: v.l, n: v.s.size })).filter(x => x.k !== "home").sort((a, b) => b.n - a.n);
  const homeOnly = purposeVids.home ? [...purposeVids.home.s].filter(v => !purposes.some(p => purposeVids[p.k].s.has(v))).length : 0;
  const regions = Object.entries(regionVids).map(([l, s]) => ({ l, n: s.size })).sort((a, b) => b.n - a.n);
  // 검색어 주제
  const themeMap = {};
  for (const r of kws) { const t = kwTheme(r.k); themeMap[t] = (themeMap[t] || 0) + r.n; }
  for (const r of siteq) { const t = kwTheme(r.k); themeMap[t] = (themeMap[t] || 0) + r.n; }
  const themes = Object.entries(themeMap).map(([l, n]) => ({ l, n })).sort((a, b) => b.n - a.n);
  const kwTotal = themes.reduce((s, r) => s + r.n, 0);
  const typeN = t => (types.find(r => r.t === t) || { n: 0 }).n;
  const mobile = (devices.find(r => r.d === "모바일") || { n: 0 }).n;
  const perVisit = tot.visits ? (tot.pv / tot.visits) : 0;

  // ------------------- 자동 분석 -------------------
  const A = [], S = [];
  if (!uv) A.push("아직 기록된 방문이 없습니다. 사이트에 방문이 생기면 여기에 분석이 나옵니다.");
  else {
    const diff = prev.uv ? Math.round(100 * (uv - prev.uv) / prev.uv) : null;
    A.push(`이 기간 동안 <b>${num(uv)}명</b>이 들어와 모두 <b>${num(tot.pv)}페이지</b>를 봤습니다. 한 번 들어올 때 평균 <b>${perVisit.toFixed(1)}페이지</b>를 봅니다.` +
      (diff !== null ? ` 바로 앞 같은 기간(${num(prev.uv)}명)보다 <b>${diff >= 0 ? "+" : ""}${diff}%</b> ${diff >= 0 ? "늘었습니다" : "줄었습니다"}.` : ""));
    if (purposes.length) {
      const t = purposes.slice(0, 3);
      A.push(`사람들이 가장 많이 찾은 것은 <b>${esc(t[0].l)}</b>(${num(t[0].n)}명, 방문자의 ${pct(t[0].n, uv)}%)` +
        (t[1] ? `이고, 그다음은 <b>${esc(t[1].l)}</b>(${num(t[1].n)}명)` : "") + (t[2] ? `, <b>${esc(t[2].l)}</b>(${num(t[2].n)}명)` : "") + " 순입니다." +
        (homeOnly ? ` 첫 화면만 보고 나간 사람은 ${num(homeOnly)}명(${pct(homeOnly, uv)}%)입니다.` : ""));
    }
    if (regions.length) A.push(`지역으로는 <b>${regions.slice(0, 3).map(r => `${esc(r.l)}(${num(r.n)}명)`).join(", ")}</b>에 관심이 많습니다.`);
    if (entries) {
      const parts = Object.keys(TYPE_LABEL).filter(t => t !== "internal" && typeN(t)).map(t => `${TYPE_LABEL[t]} ${pct(typeN(t), entries)}%`);
      const portals = sources.filter(r => r.t === "search").slice(0, 3).map(r => `${esc(r.s)} ${num(r.n)}회`);
      A.push(`들어온 길은 ${parts.join(", ")}입니다.` + (portals.length ? ` 검색으로는 ${portals.join(", ")} 들어왔습니다.` : ""));
    }
    if (themes.length) A.push(`검색어를 주제로 나누면 <b>${esc(themes[0].l)}</b>(${num(themes[0].n)}회)를 가장 많이 찾았고` +
      (themes[1] ? `, ${esc(themes[1].l)}(${num(themes[1].n)}회)` : "") + (themes[2] ? `, ${esc(themes[2].l)}(${num(themes[2].n)}회)` : "") + "가 뒤를 잇습니다.");
    A.push(`휴대폰으로 들어온 사람이 <b>${pct(mobile, uv)}%</b>입니다.`);

    if (uv < 30) S.push("아직 방문자가 적어 숫자가 크게 흔들립니다. 30명 이상 쌓인 뒤의 흐름을 보는 것이 정확합니다.");
    if (entries && pct(typeN("search"), entries) < 30) S.push("검색으로 들어오는 비율이 낮습니다. 네이버 서치어드바이저·구글 서치 콘솔 등록과 사이트맵 제출을 먼저 확인하세요.");
    if (perVisit && perVisit < 1.6) S.push("한 페이지만 보고 나가는 경우가 많습니다. 많이 들어오는 첫 페이지에 다음에 볼 페이지(가격 비교, 지역 목록) 링크를 더 눈에 띄게 두면 좋습니다.");
    if (regions[0]) S.push(`${esc(regions[0].l)} 지역 관심이 가장 큽니다. 이 지역 봉안당·장례식장에 먼저 제휴나 광고를 제안해 보세요.`);
    const top = purposes[0] && purposes[0].k;
    if (top === "price") S.push("가격을 보러 오는 사람이 많습니다. 가격이 비어 있는 시설의 가격을 채우면 체류 시간과 문의가 늘어납니다.");
    if (top === "tools" || (purposeVids.tools && pct(purposeVids.tools.s.size, uv) >= 20)) S.push("장례 도우미(지방·축문·부고) 이용이 많습니다. 블로그에 같은 주제의 글을 올리고 이 페이지로 연결하면 유입이 더 늘어납니다.");
    if (top === "funeral") S.push("장례식장을 찾는 사람이 많습니다. 상조·장례식장 제휴 배너 자리를 먼저 판매해 볼 만합니다.");
    if (mobile && pct(mobile, uv) >= 70) S.push("대부분 휴대폰으로 봅니다. 새 기능은 휴대폰 화면 기준으로 먼저 확인하세요.");
  }

  // ------------------- 화면 -------------------
  const byDay = Object.fromEntries(daily.map(r => [r.day, r]));
  const allDays = [];
  for (let i = days - 1; i >= 0; i--) allDays.push(kstDay(now - i * 86400e3));
  const maxPv = Math.max(1, ...daily.map(r => r.pv));
  const chart = `<div class="legend"><span><i style="background:#1f4d3f"></i>방문자</span><span><i style="background:#cfe0d6"></i>페이지뷰</span></div><div class="chart">` +
    allDays.slice(-60).map(d => { const r = byDay[d] || { uv: 0, pv: 0 }; return `<div class="c" title="${d} 방문자 ${r.uv}명, 페이지뷰 ${r.pv}회"><div class="p" style="height:${100 * (r.pv - r.uv) / maxPv}%"></div><div class="v" style="height:${100 * r.uv / maxPv}%"></div><small>${d.slice(5).replace("-", "/")}</small></div>`; }).join("") + `</div>`;
  const tag = t => `<span class="tag ${esc(t)}">${esc(TYPE_LABEL[t] || t)}</span>`;
  const plink = (p, t) => `<b>${esc(pageName(p, t))}</b><br><a class="path" href="${esc(p)}" target="_blank">${esc(p)}</a>`;
  const tabs = [[1, "오늘"], [7, "최근 7일"], [30, "최근 30일"], [90, "최근 90일"]].map(([d, l]) => `<a class="${d === days ? "on" : ""}" href="/stats?d=${d}">${l}</a>`).join("");
  const time = ts => new Date(ts + 9 * 3600e3).toISOString().slice(5, 16).replace("T", " ");
  const barRows = (list, unit, total) => list.length ? `<div class="hbars">` + list.map(r => `<div class="hb"><span class="hb-l">${esc(r.l)}</span><span class="hb-t"><i style="width:${Math.max(2, pct(r.n, total))}%"></i></span><span class="hb-v">${num(r.n)}${unit} <small>${pct(r.n, total)}%</small></span></div>`).join("") + `</div>` : `<p class="muted small">아직 기록이 없습니다.</p>`;

  const body = `<h1>방문 통계</h1><p class="muted small">한국 시간 기준 · ${from} ~ ${kstDay(now)} · 검색엔진 로봇은 빼고 셉니다. 같은 사람은 하루에 한 명으로 셉니다.</p>
<nav class="tabs">${tabs}</nav>
<section class="kpi"><div><span>오늘 방문자</span><strong>${num(today.uv)}명</strong></div><div><span>기간 방문자</span><strong>${num(uv)}명</strong>${prev.uv ? `<em>앞 기간 ${num(prev.uv)}명</em>` : ""}</div>
<div><span>방문 횟수</span><strong>${num(tot.visits)}회</strong></div><div><span>본 페이지 수</span><strong>${num(tot.pv)}회</strong><em>1회 방문당 ${perVisit.toFixed(1)}페이지</em></div></section>
<section class="card analysis"><h2>한눈에 보는 분석</h2><ul>${A.map(a => `<li>${a}</li>`).join("")}</ul>
${S.length ? `<h3>이렇게 해 보세요</h3><ul class="sugg">${S.map(a => `<li>${a}</li>`).join("")}</ul>` : ""}</section>
<div class="grid">
<section class="card"><h2>사람들은 무엇을 찾으러 왔나</h2>${barRows(purposes, "명", Math.max(1, uv))}
<p class="small muted">본 페이지를 주제별로 묶어, 그 주제를 본 사람 수를 셌습니다. 한 사람이 여러 주제를 보면 각각 셉니다. 비율은 전체 방문자 대비입니다.</p></section>
<section class="card"><h2>어느 지역을 많이 찾나</h2>${barRows(regions.slice(0, 12), "명", Math.max(1, uv))}
<p class="small muted">시도별 봉안당 목록과 장례식장 페이지를 본 사람 수입니다.</p></section>
</div>
<section class="card"><h2>날짜별 방문자</h2>${chart}</section>
<section class="card"><h2>많이 본 페이지</h2>${rows(pages, [["페이지", r => plink(r.p, r.t)], ["본 사람", r => num(r.u) + "명", 1], ["조회수", r => num(r.n) + "회", 1], ["여기로 처음 들어옴", r => num(r.e) + "회", 1]])}
<p class="small muted">본 사람 = 그 페이지를 한 번 이상 연 사람 수 · 여기로 처음 들어옴 = 검색이나 다른 사이트에서 바로 이 페이지로 들어온 횟수</p></section>
${subs.length ? `<section class="card"><h2>많이 본 시설</h2>${rows(subs, [["시설", r => `<b>${esc(r.s)}</b><br><span class="path">${esc(pageName(r.p))}</span>`], ["본 사람", r => num(r.u) + "명", 1], ["조회수", r => num(r.n) + "회", 1]])}</section>` : ""}
<div class="grid">
<section class="card"><h2>어떻게 들어왔나 (유입 경로)</h2>${rows(types, [["경로", r => tag(r.t)], ["방문", r => num(r.n) + "회", 1], ["비율", r => pct(r.n, entries) + "%", 1]], Math.max(1, entries))}
<p class="small muted">검색 포털 = 네이버·구글·다음 등 검색 결과에서 클릭 · 직접 방문 = 주소를 직접 치거나 즐겨찾기·카톡 앱 안 링크 등 출처가 안 남는 경우 · 배너·광고 링크 = 아래 '추적 링크 만들기'로 만든 주소로 들어온 경우</p></section>
<section class="card"><h2>어디서 들어왔나 (포털·사이트별)</h2>${rows(sources, [["출처", r => `${tag(r.t)} ${esc(r.s)}`], ["사람", r => num(r.u) + "명", 1], ["방문", r => num(r.n) + "회", 1]], Math.max(1, sources[0] ? sources[0].n : 1))}</section>
</div>
<div class="grid">
<section class="card"><h2>검색어 주제</h2>${barRows(themes, "회", Math.max(1, kwTotal))}<p class="small muted">포털 검색어와 사이트 안 검색어를 주제별로 묶었습니다.</p></section>
<section class="card"><h2>사이트 안에서 검색한 말</h2>${rows(siteq, [["검색어", r => `${esc(r.k)} <span class="tag">${esc(kwTheme(r.k))}</span>`], ["사람", r => num(r.u) + "명", 1], ["횟수", r => num(r.n) + "회", 1]])}</section>
</div>
<section class="card"><h2>포털에서 어떤 검색어로 들어왔나</h2>${rows(kws, [["검색어", r => `<b>${esc(r.k)}</b> <span class="tag">${esc(kwTheme(r.k))}</span>`], ["포털", r => esc(r.s)], ["들어온 페이지", r => esc(pageName(r.p))], ["사람", r => num(r.u) + "명", 1], ["횟수", r => num(r.n) + "회", 1]])}
<p class="note">구글은 개인정보 보호 때문에 검색어를 넘겨주지 않습니다. 네이버·다음도 브라우저에 따라 빠질 수 있습니다. 정확한 검색어 통계는 <a href="https://search.google.com/search-console" target="_blank" rel="noopener">구글 서치 콘솔</a>과 <a href="https://searchadvisor.naver.com/" target="_blank" rel="noopener">네이버 서치어드바이저</a>의 '검색어별 노출·클릭 수'에서 볼 수 있습니다.</p></section>
<div class="grid">
<section class="card"><h2>배너·광고 링크별</h2>${rows(camps, [["어디에 건 링크", r => esc(r.s)], ["배너 이름", r => esc(r.c || "-")], ["사람", r => num(r.u) + "명", 1], ["방문", r => num(r.n) + "회", 1]])}
<h2 style="margin-top:18px">추적 링크 만들기</h2><p class="small muted">블로그 글, 카페, 배너에 이 주소를 걸면 어느 배너로 들어왔는지 위 표에 따로 나옵니다.</p>
<div class="linkmaker"><input id="lm-p" value="/" placeholder="연결할 페이지 (예: /funeral/index.html)"><input id="lm-s" placeholder="어디에 거나요 (예: 네이버블로그)"><input id="lm-c" placeholder="배너 이름 (예: 10월_장례식장글)"><button type="button" id="lm-go">만들기</button></div>
<div id="lm-out" hidden></div></section>
<section class="card"><h2>기기</h2>${rows(devices, [["기기", r => esc(r.d)], ["방문자", r => num(r.n) + "명", 1], ["비율", r => pct(r.n, uv) + "%", 1]])}</section>
</div>
<section class="card"><h2>최근 방문 30건</h2>${rows(recent, [["시각", r => time(r.ts)], ["경로", r => `${tag(r.src_type)} ${esc(r.src_name)}`], ["검색어·배너", r => esc(r.keyword || r.campaign || "")], ["처음 본 페이지", r => esc(pageName(r.path, r.title))], ["기기", r => esc(r.device)]])}</section>
<script>
document.getElementById("lm-go").onclick=function(){var p=document.getElementById("lm-p").value.trim()||"/",s=document.getElementById("lm-s").value.trim(),c=document.getElementById("lm-c").value.trim();
if(!s){alert("어디에 거는 링크인지 적어 주세요.");return}var u=new URL(p,location.origin);u.searchParams.set("utm_source",s);if(c)u.searchParams.set("utm_campaign",c);
var t=decodeURI(u.toString()),o=document.getElementById("lm-out");o.hidden=false;o.textContent=t;try{navigator.clipboard.writeText(t).then(function(){o.textContent=t+"  (복사됨)"})}catch(e){}};
</script>`;
  return page("방문 통계", body);
}

function cookieOf(request, name) {
  const m = (request.headers.get("cookie") || "").match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? m[1] : "";
}

async function stats(request, env, url) {
  if (!env.DB || !env.STATS_PASSWORD) return setupPage(env);
  if (url.pathname === "/stats/logout") {
    return new Response(null, { status: 302, headers: { location: "/stats", "set-cookie": "st=; Path=/stats; Max-Age=0; HttpOnly; Secure; SameSite=Strict" } });
  }
  const token = await authToken(env);
  if (url.pathname === "/stats/login" && request.method === "POST") {
    const form = await request.formData();
    if (String(form.get("pw") || "") !== env.STATS_PASSWORD) return loginPage("비밀번호가 맞지 않습니다.");
    return new Response(null, { status: 302, headers: { location: "/stats", "set-cookie": `st=${token}; Path=/stats; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict` } });
  }
  if (cookieOf(request, "st") !== token) return loginPage("");
  return statsPage(request, env);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p.startsWith("/_builder") || p.startsWith("/.github") || p === "/_worker.js") {
      return new Response("Not found", { status: 404 });
    }
    // 이 주소를 예전에 쓰던 사이트가 남긴 서비스 워커(오프라인 캐시)를 지워 옛 화면이 뜨지 않게 함
    if (["/sw.js", "/service-worker.js", "/serviceworker.js", "/firebase-messaging-sw.js", "/OneSignalSDKWorker.js", "/ngsw-worker.js"].includes(p)) {
      return new Response(`self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil((async()=>{for(const k of await caches.keys())await caches.delete(k);await self.registration.unregister();
for(const c of await self.clients.matchAll({type:"window"}))c.navigate(c.url);})()));`,
        { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } });
    }
    if (p === "/api/hit" && request.method === "POST") {
      try { return await recordHit(request, env); } catch (e) { return new Response(null, { status: 204 }); }
    }
    if (p === "/stats" || p.startsWith("/stats/")) {
      try { return await stats(request, env, url); } catch (e) { return page("오류", `<div class="card"><h1>잠시 문제가 생겼습니다</h1><p class="muted">${esc(e.message)}</p></div>`); }
    }
    return env.ASSETS.fetch(request);
  },
};
