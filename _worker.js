// 봉안당 길잡이 — 방문 통계 (Cloudflare Pages 고급 모드 워커)
//
// 하는 일
//   1) /api/hit   : 각 페이지가 보내는 방문 기록을 D1 데이터베이스에 저장
//   2) /stats     : 비밀번호로 들어가는 통계 페이지 (방문자 수, 유입 경로, 검색어, 배너 등)
//   3) /_builder/, /.github/ : 사이트 만드는 프로그램 폴더는 바깥에서 못 보게 막음
//   4) 2026-10 폴더 정리 전의 예전 주소(region/, pages/ 등)는 새 주소로 301 이동
//   5) /api/lead  : 제휴 시설 상담 신청 저장 + 카카오톡·이메일 알림, /stats/leads 에서 관리
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
  await db.prepare(`CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, day TEXT, vid TEXT, ev TEXT, label TEXT, path TEXT)`).run();
  for (const col of ["title", "sub", "from_path"]) {
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
  const siteQ = normPath(page.pathname) === "/info/search" ? (params.q || "").slice(0, 60) : "";
  await ensure(env.DB);
  if (d.ev) {
    await env.DB.prepare(`INSERT INTO events (ts, day, vid, ev, label, path) VALUES (?,?,?,?,?,?)`)
      .bind(now, day, vid, String(d.ev).slice(0, 20), String(d.s || "").slice(0, 80), normPath(page.pathname).slice(0, 200)).run();
    return new Response(null, { status: 204 });
  }
  let fromPath = "";
  try { const ru = new URL(String(d.r || "")); if (ru.hostname === host) fromPath = normPath(ru.pathname); } catch (e) {}
  const title = String(d.t || "").replace(/\s*\|\s*봉안당 길잡이$/, "").slice(0, 80);
  const sub = String(d.s || "").slice(0, 80);
  // 같은 페이지 안에서 시설로 이동(#)한 기록은 entry=0 으로만 남김
  const entry = d.h ? 0 : (c.type === "internal" ? 0 : 1);
  await env.DB.prepare(`INSERT INTO hits (ts, day, vid, path, entry, src_type, src_name, ref_host, keyword, campaign, device, site_q, title, sub, from_path)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(now, day, vid, normPath(page.pathname).slice(0, 200), entry,
    d.h ? "internal" : c.type, d.h ? "사이트 안 이동" : c.name.slice(0, 80), c.refHost.slice(0, 120), d.h ? "" : c.keyword, c.campaign.slice(0, 120), device, d.h ? "" : siteQ, title, sub, d.h ? "" : fromPath).run();
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
.kpi{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}.kpi div{background:var(--card);border:1px solid var(--line);border-top:4px solid var(--acc);border-radius:10px;padding:14px 16px}
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
.leadsum{border-left:6px solid var(--gold)}.leadsum h2{display:flex;justify-content:space-between;align-items:center}.leadsum .more{font-size:15px}.note{background:#fbf3d8;border-radius:10px;padding:12px 16px;font-size:15px}.bad{color:#b42318;font-weight:700}.chart.hrs{height:140px;gap:2px}.mkt{border-left:6px solid var(--acc)}.mkt ol{margin:0;padding-left:22px}.mkt li{margin-bottom:12px;line-height:1.7}.kpi em{display:block;font-style:normal;font-size:13px;color:var(--ink2)}.analysis{border-left:6px solid var(--gold)}.analysis ul{margin:0;padding-left:20px}.analysis li{margin-bottom:8px;line-height:1.7}.analysis h3{margin:16px 0 8px;font-size:17px}.sugg li::marker{content:'✔  ';color:var(--acc)}.hbars{display:grid;gap:10px}.hb{display:grid;grid-template-columns:minmax(120px,1.3fr) 2fr auto;gap:10px;align-items:center;font-size:15px}.hb-t{background:#e7efe9;border-radius:6px;height:14px;overflow:hidden}.hb-t i{display:block;height:100%;background:var(--acc);border-radius:6px}.hb-v{white-space:nowrap;font-variant-numeric:tabular-nums}.hb-v small{color:var(--ink2)}a.path,.path{display:block;font-size:12px;color:var(--ink2);margin-top:2px}.pdesc{display:block;font-size:14px;color:#444;margin-top:2px;line-height:1.5}@media(max-width:800px){.hb{grid-template-columns:1fr auto}.hb-t{grid-column:1/-1;grid-row:2}}
@media(max-width:800px){.kpi{grid-template-columns:1fr 1fr}.chart.hrs small{display:block;font-size:9px}.grid{grid-template-columns:1fr}.linkmaker{grid-template-columns:1fr}.chart small{display:none}}
</style></head><body><header><div class="in"><b>봉안당 길잡이 · 방문 통계</b><span><a href="/">사이트로 가기</a> · <a href="/stats/logout">나가기</a></span></div></header><main>${body}</main></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

async function authToken(env) {
  return (await sha("stats|" + env.STATS_PASSWORD)).slice(0, 32);
}

function loginPage(msg, next) {
  return page("로그인", `<div class="card" style="max-width:420px;margin:40px auto"><h1>방문 통계</h1><p class="muted">관리자 비밀번호를 넣어 주세요.</p>
${msg ? `<p style="color:#b42318">${esc(msg)}</p>` : ""}
<form method="post" action="/stats/login"><input type="hidden" name="next" value="${esc(next || "/stats")}"><input type="password" name="pw" placeholder="비밀번호" autofocus style="width:100%;margin-bottom:10px"><button style="width:100%">들어가기</button></form></div>`);
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
// 2026-10 폴더 정리: 예전 주소 → 새 주소
function migratePath(p) {
  const m = [
    [/^\/region\//, "/bongan/"], [/^\/type\/(public|private)/, "/bongan/$1"], [/^\/feature\//, "/bongan/"],
    [/^\/compare\/(facilities|types|regions)/, "/bongan/compare-$1"], [/^\/pages\/(ranking|recommend)/, "/bongan/$1"],
    [/^\/pages\/sitemap(\.html)?$/, "/"], [/^\/pages\//, "/info/"], [/^\/static\//, "/assets/"], [/^\/data\/search\.json$/, "/assets/search.json"],
    [/^\/og\.(png|jpg)$/, "/assets/og.jpg"], [/^\/rss\.xml$/, "/assets/rss.xml"],
  ];
  for (const [re, to] of m) if (re.test(p)) return p.replace(re, to);
  return p;
}
// 주소 정리: Cloudflare 는 .html 을 떼고 보여 주므로 /a/b.html, /a/b, /a/b/ 를 같은 페이지로 본다
function normPath(p) {
  p = migratePath(String(p || "/").split("?")[0].split("#")[0] || "/");
  p = p.replace(/\.html$/, "").replace(/\/index$/, "/");
  if (p.length > 1 && p.endsWith("/") && !/^\/(region|funeral|guides|tools)\/$/.test(p)) p = p.slice(0, -1);
  return p || "/";
}
// [페이지 이름, 한 줄 설명]
const PAGE_INFO = {
  "/": ["첫 화면", "사이트 대문. 봉안당·장례식장 찾기, 가격 비교, 장례 도우미로 가는 입구"],
  "/bongan/": ["지역별 봉안당 찾기", "전국 지도와 17개 시도 목록에서 지역을 고르는 페이지"],
  "/funeral/": ["전국 장례식장·화장장", "지역을 골라 장례식장·화장장을 찾고 화장료를 비교하는 페이지"],
  "/bongan/public": ["공설 봉안당 목록", "시·군·구가 운영하는 저렴한 공설 봉안당을 시도별로 모은 목록"],
  "/bongan/private": ["사설 봉안당 목록", "재단·종교단체가 운영하는 사설 봉안당을 시도별로 모은 목록"],
  "/bongan/price": ["봉안당 가격 비교", "가격대별·시도별로 봉안당 가격을 비교하는 가격 비교 첫 화면"],
  "/bongan/parking": ["주차장 있는 봉안당", "주차장을 갖춘 봉안당만 시도별로 모은 목록"],
  "/bongan/amenities": ["편의시설로 봉안당 찾기", "장애인 편의시설·유족대기실·식당이 있는 봉안당 목록"],
  "/bongan/long-period": ["안치기간 비교", "최대 몇 년까지 모실 수 있는지 봉안당별로 비교한 페이지"],
  "/bongan/compare-facilities": ["업체별 가격 비교표", "봉안당마다 개인단·부부단·관리비 가격을 한 표로 정렬해 보는 페이지"],
  "/bongan/compare-types": ["개인단·부부단 가격 비교", "개인단·부부단·가족단 종류별 가격 분포와 가장 싼 곳"],
  "/bongan/compare-regions": ["지역별 가격 비교", "시도별 봉안당 중간 가격을 막대그래프로 비교한 페이지"],
  "/bongan/recommend": ["예산으로 봉안당 추천", "예산과 지역을 넣으면 맞는 봉안당을 골라 주는 추천 기능"],
  "/bongan/ranking": ["봉안당 순위", "주차·가격·안치기간 등 기준별 봉안당 TOP 20"],
  "/info/search": ["이름으로 검색", "시설 이름이나 동네 이름으로 봉안당·장례식장을 찾는 검색"],
  "/info/about": ["사이트 소개", "이 사이트가 무엇이고 자료를 어디서 가져왔는지 설명"],
  "/info/contact": ["문의·광고 문의", "정보 수정 요청과 광고 자리·가격 안내"],
  "/info/privacy": ["개인정보처리방침", "개인정보·쿠키·광고에 관한 안내"],
  "/info/terms": ["이용약관", "이용약관과 면책 안내"],
  "/404": ["없는 페이지(404)", "주소가 틀렸거나 없어진 페이지에 들어온 경우"],
  "/partner/": ["프리미엄 파트너 목록", "상담을 연결해 드리는 프리미엄 파트너 봉안당·수목장 목록과 사은품·상담 신청"],
  "/partner": ["프리미엄 파트너 목록", "상담을 연결해 드리는 프리미엄 파트너 봉안당·수목장 목록과 사은품·상담 신청"],
  "/partner/thanks": ["상담 신청 완료", "상담 신청을 마친 사람이 보는 완료 화면"],
  "/partner/error": ["상담 신청 오류", "신청서를 보내지 못한 경우"],
  "/bongan/near": ["가까운 봉안당 찾기", "사는 곳을 고르면 가까운 봉안당을 거리순으로 보여 주는 기능 (서울·인천·부산 근교 목록 포함)"],
  "/bongan/cost": ["봉안당 총비용 계산기", "사용료·관리비·연장비를 더해 몇 년 모시면 모두 얼마인지 비교하는 계산기"],
  "/bongan/holiday": ["명절 성묘 안내", "설·추석 날짜, 붐비지 않게 다녀오는 법, 대형 봉안당 연락처"],
  "/tools/after-death": ["장례 후 할 일 체크리스트", "사망신고·상속·세금 등 장례 뒤 할 일과 마감 날짜를 계산해 주는 체크리스트"],
  "/tools/": ["장례 도우미 첫 화면", "지방·축문·부고·49재 도우미 모음과 나이 계산·부의금 안내"],
  "/tools/jibang": ["지방·명정 쓰기", "제사 지방과 명정 문구를 한자·한글로 만들어 인쇄하는 도구"],
  "/tools/chukmun": ["축문 쓰기", "제사 날짜를 넣으면 음력 간지까지 넣어 축문을 완성하는 도구"],
  "/tools/49jae": ["49재·삼우제 계산", "별세일로 삼우제·49재·100일·기일 날짜를 계산하고 음력을 바꾸는 도구"],
  "/tools/bugo": ["부고 문자 만들기", "빈소·발인 정보를 넣어 부고 문자와 답례 문자를 만드는 도구"],
  "/guides/": ["가이드 목록", "장례·봉안 안내글 13편 모음"],
  "/guides/procedure-after-cremation": ["가이드: 장례 절차", "임종부터 화장·봉안까지 장례 순서를 설명한 글"],
  "/guides/ehaneul-guide": ["가이드: 화장 예약 방법", "e하늘 장사정보시스템으로 화장장을 예약하는 법"],
  "/guides/how-to-choose": ["가이드: 봉안당 고르는 법", "봉안당을 고를 때 확인할 체크리스트 10가지"],
  "/guides/cost-structure": ["가이드: 봉안당 비용 구조", "사용료·관리비·부대비용 등 봉안당 가격표 읽는 법"],
  "/guides/public-vs-private": ["가이드: 공설과 사설 차이", "공설 봉안당과 사설 봉안당의 자격·가격 차이"],
  "/guides/contract-checklist": ["가이드: 계약 주의사항", "사설 봉안당 계약 전에 꼭 확인할 것"],
  "/guides/enshrinement-period": ["가이드: 안치기간·연장", "봉안당에 몇 년 모실 수 있고 어떻게 연장하는지"],
  "/guides/what-is-bongandang": ["가이드: 봉안당이란·단별 가격", "봉안당이 어떤 곳이고 안치단 높이·정면 측면·개인 부부단에 따라 가격이 왜 다른지 설명한 글"],
  "/guides/bongandang-vs-napgoldang": ["가이드: 봉안당과 납골당", "봉안당·납골당·봉안묘·봉안탑의 차이"],
  "/guides/natural-burial": ["가이드: 수목장·자연장", "수목장·잔디장 같은 자연장 비용과 방법"],
  "/guides/pre-planning": ["가이드: 미리 준비하기", "생전에 봉안당·장례를 미리 알아보는 법"],
  "/guides/reburial": ["가이드: 이장·개장", "묘를 옮기거나 봉안당으로 모시는 개장 절차"],
  "/guides/visiting-etiquette": ["가이드: 참배 예절", "봉안당 참배 순서와 예절"],
  "/guides/accessibility-visit": ["가이드: 어르신·장애인 참배", "거동이 불편한 분과 함께 참배할 때 확인할 것"],
};
function pageInfo(path, title) {
  const p = normPath(path);
  if (PAGE_INFO[p]) return PAGE_INFO[p];
  let m = p.match(/^\/bongan\/([a-z]+)$/);
  if (m && SIDO_SLUG[m[1]]) return [`${SIDO_SLUG[m[1]]} 봉안당 목록`, `${SIDO_SLUG[m[1]]} 봉안당·납골당을 시군구별로 보여 주고 시설마다 가격·주차·안치기간을 적은 페이지`];
  m = p.match(/^\/funeral\/([a-z]+)$/);
  if (m && SIDO_SLUG[m[1]]) return [`${SIDO_SLUG[m[1]]} 장례식장·화장장`, `${SIDO_SLUG[m[1]]} 장례식장의 빈소 사용료·전화번호와 화장장 화장료를 모은 페이지`];
  const tt = title ? String(title).replace(/\s*\|\s*봉안당 길잡이$/, "") : "";
  if (/^\/partner\/[a-z0-9-]+$/.test(p)) return [tt ? tt.replace(/\s*분양가·위치·상담.*$/, "") + " (프리미엄 파트너 상담 페이지)" : "프리미엄 파트너 상담 페이지", "프리미엄 파트너의 분양가·오시는 길·사은품 안내와 상담 신청서가 있는 페이지"];
  if (/^\/place\//.test(p)) return [tt ? tt.replace(/\s*참배시간·가격·위치·주차.*$/, "") + " (시설 상세)" : "봉안당 시설 상세 페이지", "봉안당 한 곳의 가격·위치·주차·참배 시간 안내 페이지"];
  if (/^\/area\//.test(p)) return [tt ? tt.replace(/\s*가격·위치·참배시간.*$/, "") : "시군구 봉안당 목록", "시군구 하나의 봉안당·납골당을 모아 보여 주는 페이지"];
  if (title) return [tt.slice(0, 40), ""];
  return [p, ""];
}
function pageName(path, title) { return pageInfo(path, title)[0]; }
const PURPOSE = [
  ["partner", "프리미엄 파트너·상담 신청", p => /^\/partner(\/|$)/.test(p)],
  ["price", "봉안당 가격 비교·추천·계산기", p => /^\/bongan\/(price|cost|compare-|recommend)/.test(p)],
  ["ranking", "봉안당 순위 보기", p => p === "/bongan/ranking"],
  ["place", "봉안당 한 곳 자세히 보기", p => /^\/place\//.test(p)],
  ["bongan", "봉안당 찾기 (지역·조건·가까운 곳)", p => /^\/(bongan|area)\//.test(p)],
  ["funeral", "장례식장·화장장 찾기", p => /^\/funeral\//.test(p)],
  ["tools", "장례 도우미 (지방·축문·부고·49재)", p => /^\/tools\//.test(p)],
  ["guide", "장례·봉안 정보 읽기 (가이드)", p => /^\/guides\//.test(p)],
  ["search", "이름으로 검색", p => p === "/info/search"],
  ["home", "첫 화면만 보기", p => p === "/"],
];
function purposeOf(p) { p = normPath(p); for (const [k, l, f] of PURPOSE) if (f(p)) return [k, l]; return ["etc", "기타 (소개·문의 등)"]; }
function regionOf(p) { const m = normPath(p).match(/^\/(?:(?:bongan|funeral)\/([a-z]+)$|(?:area|place)\/([a-z]+))/); if (m) { const k = m[1] || m[2]; return SIDO_SLUG[k] || ""; } return ""; }
function regionOfOld(p) { const m = normPath(p).match(/^\/(bongan|funeral)\/([a-z]+)$/); return m && SIDO_SLUG[m[2]] ? SIDO_SLUG[m[2]] : ""; }
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
  const pageRaw = await q(`SELECT path p, vid, MAX(title) t, COUNT(*) n, SUM(entry) e FROM hits WHERE day>=? GROUP BY path, vid`);
  const pageAgg = {};
  for (const r of pageRaw) {
    const k = normPath(r.p), a = (pageAgg[k] = pageAgg[k] || { p: k, t: "", n: 0, e: 0, v: new Set() });
    a.n += r.n; a.e += r.e || 0; a.v.add(r.vid); if (r.t && !a.t) a.t = r.t;
  }
  const pages = Object.values(pageAgg).map(a => ({ p: a.p, t: a.t, n: a.n, e: a.e, u: a.v.size })).sort((x, y) => y.u - x.u || y.n - x.n).slice(0, 60);
  const subs = await q(`SELECT sub s, path p, COUNT(*) n, COUNT(DISTINCT vid) u FROM hits WHERE day>=? AND sub<>'' GROUP BY sub, path ORDER BY u DESC LIMIT 20`);
  const visitPaths = await q(`SELECT vid, path FROM hits WHERE day>=? GROUP BY vid, path`);
  const siteq = await q(`SELECT site_q k, COUNT(*) n, COUNT(DISTINCT vid) u FROM hits WHERE day>=? AND site_q<>'' GROUP BY site_q ORDER BY n DESC LIMIT 30`);
  const devices = await q(`SELECT device d, COUNT(DISTINCT vid) n FROM hits WHERE day>=? GROUP BY device ORDER BY n DESC`);
  const recent = await q(`SELECT ts, path, title, src_type, src_name, keyword, campaign, device FROM hits WHERE day>=? AND entry=1 ORDER BY ts DESC LIMIT 30`);
  // ---- 구글 애널리틱스식 지표 ----
  const sessRaw = await q(`SELECT day, vid, COUNT(*) n FROM hits WHERE day>=? GROUP BY day, vid`);
  const landRaw = await q(`SELECT day, vid, path, src_type, src_name, MIN(ts) ts FROM hits WHERE day>=? AND entry=1 GROUP BY day, vid`);
  const hours = await q(`SELECT CAST(((ts/1000 + 32400) % 86400) / 3600 AS INTEGER) h, COUNT(DISTINCT day || vid) n FROM hits WHERE day>=? GROUP BY h`);
  const wdays = await q(`SELECT CAST(strftime('%w', day) AS INTEGER) w, COUNT(DISTINCT day || vid) n FROM hits WHERE day>=? GROUP BY w`);
  const flowsRaw = await q(`SELECT from_path f, path p, COUNT(*) n FROM hits WHERE day>=? AND from_path<>'' GROUP BY from_path, path ORDER BY n DESC LIMIT 60`);
  const evs = await q(`SELECT ev, label, path, COUNT(*) n, COUNT(DISTINCT vid) u FROM events WHERE day>=? GROUP BY ev, label ORDER BY n DESC LIMIT 40`).catch(() => []);
  const sessN = {};
  for (const r of sessRaw) sessN[r.day + r.vid] = r.n;
  const sessions = sessRaw.length, bounces = sessRaw.filter(r => r.n === 1).length;
  const bounceRate = pct(bounces, sessions);
  const landAgg = {}, srcAgg = {};
  for (const r of landRaw) {
    const n = sessN[r.day + r.vid] || 1, k = normPath(r.path);
    const a = (landAgg[k] = landAgg[k] || { p: k, s: 0, b: 0, pv: 0 }); a.s++; a.pv += n; if (n === 1) a.b++;
    const t = r.src_type === "search" ? `search|${r.src_name}` : r.src_type;
    const b = (srcAgg[t] = srcAgg[t] || { t: r.src_type, nm: r.src_type === "search" ? r.src_name : (TYPE_LABEL[r.src_type] || r.src_type), s: 0, b: 0, pv: 0 }); b.s++; b.pv += n; if (n === 1) b.b++;
  }
  const landing = Object.values(landAgg).sort((x, y) => y.s - x.s).slice(0, 15);
  const srcPerf = Object.values(srcAgg).sort((x, y) => y.s - x.s).slice(0, 12);
  const flowAgg = {};
  for (const r of flowsRaw) { const f = normPath(r.f), p = normPath(r.p); if (f === p) continue; const k = f + ">" + p; flowAgg[k] = (flowAgg[k] || { f, p, n: 0 }); flowAgg[k].n += r.n; }
  const flows = Object.values(flowAgg).sort((a, b) => b.n - a.n).slice(0, 15);
  const EV_LABEL = { lead: "상담 신청 완료", banner: "센터 배너 클릭(프리미엄 파트너)", tel: "전화 걸기", map: "지도 보기", home: "시설 홈페이지", ext: "바깥 사이트", copy: "복사(부고 문자·회원코드·주소)", print: "지방·축문 인쇄", sms: "문자로 보내기" };
  const evTotal = {}; for (const r of evs) evTotal[r.ev] = (evTotal[r.ev] || 0) + r.n;
  const telClicks = evTotal.tel || 0;

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
    if (themes.length) A.push(`검색어를 주제로 나누면 가장 많은 주제는 <b>${esc(themes[0].l)}</b>(${num(themes[0].n)}회)이고` +
      (themes[1] ? `, ${esc(themes[1].l)}(${num(themes[1].n)}회)` : "") + (themes[2] ? `, ${esc(themes[2].l)}(${num(themes[2].n)}회)` : "") + " 순입니다.");
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

  // ---- 마케팅 제안 (기록을 바탕으로) ----
  const M = [];
  const topKw = kws.slice(0, 5).map(r => r.k);
  const topThemes = themes.slice(0, 3).map(t => t.l);
  const bestSrc = srcPerf.filter(x => x.s >= 3).sort((a, b) => (b.pv / b.s) - (a.pv / a.s))[0];
  const weakLand = landing.filter(x => x.s >= 3 && pct(x.b, x.s) >= 70).slice(0, 3);
  const peakH = hours.slice().sort((a, b) => b.n - a.n)[0];
  const WD = "일월화수목금토";
  const peakW = wdays.slice().sort((a, b) => b.n - a.n)[0];
  if (topKw.length) M.push(["블로그 글 주제", `실제로 들어온 검색어(「${topKw.map(esc).join("」, 「")}」)를 제목에 넣어 네이버 블로그 글을 쓰고, 글 끝에 이 사이트의 해당 페이지 링크(추적 링크)를 거세요. 이미 사람들이 찾는 말이라 효과가 가장 빠릅니다.`]);
  else M.push(["블로그 글 주제", "아직 검색어 기록이 적습니다. 「지역+납골당 가격」(예: 김포 납골당 가격), 「지방 쓰는 법」, 「49재 날짜 계산」, 「부고 문자 양식」처럼 검색이 많고 이 사이트에 답이 있는 주제부터 블로그 글을 쓰세요."]);
  if (regions[0]) M.push(["지역 집중", `${esc(regions.slice(0, 2).map(r => r.l).join("·"))} 관심이 가장 큽니다. 「${esc(regions[0].l)} 납골당 추천」, 「${esc(regions[0].l)} 공설 봉안당」 같은 지역 글을 먼저 쓰고, 그 지역 맘카페·지역 카페에 정보글로 올리세요.`]);
  if (purposeVids.tools && purposeVids.tools.s.size) M.push(["장례 도우미로 사람 모으기", `장례 도우미를 ${num(purposeVids.tools.s.size)}명이 썼습니다. 지방·축문·부고 문자는 검색이 아주 많은 말입니다. 네이버 지식iN의 「지방 쓰는 법」, 「부고 문자 어떻게」 질문에 답을 달고 도구 링크를 붙이면 꾸준히 사람이 들어옵니다.`]);
  if (bestSrc) M.push(["잘 되는 유입 경로 키우기", `${esc(bestSrc.nm)}로 온 사람이 한 번에 평균 ${(bestSrc.pv / bestSrc.s).toFixed(1)}페이지를 봐서 가장 오래 머뭅니다. 이 경로에 글과 링크를 더 늘리세요.`]);
  if (weakLand.length) M.push(["바로 나가는 페이지 고치기", "처음 들어온 사람이 금방 나가는 페이지가 있습니다: " + weakLand.map(x => `「${esc(pageName(x.p))}」(들어온 ${x.s}회 중 ${pct(x.b, x.s)}%가 바로 나감)`).join(", ") + ". 페이지 위쪽에 다음에 볼 곳(가격 비교, 가까운 봉안당, 장례 도우미) 단추를 크게 두세요."]);
  if (telClicks) M.push(["제휴 영업 근거", `이 기간에 시설 전화 걸기 단추가 ${num(telClicks)}번 눌렸습니다. 아래 「전화·지도 클릭」 표의 상위 시설에 "우리 사이트에서 연락이 이만큼 갔다"는 자료로 광고·제휴를 제안해 보세요.`]);
  else M.push(["제휴 영업 근거 쌓기", "전화 걸기·지도 보기 클릭은 이번부터 기록됩니다. 한 달쯤 쌓이면 시설별 연락 수를 보여 주며 봉안당에 광고·제휴를 제안할 수 있습니다."]);
  if (peakH) M.push(["올리는 시간", `방문이 가장 많은 때는 ${peakW ? WD[peakW.w] + "요일, " : ""}${peakH.h}시 무렵입니다. 블로그·카페 글은 이 시간 1~2시간 전에 올리면 더 많이 읽힙니다.`]);
  M.push(["명절·계절 일정", "설과 추석 2~3주 전에는 성묘·봉안당 검색이, 한식(4월 초)과 윤달이 든 해에는 이장·개장 검색이 크게 늘어납니다. 그 전에 「명절 봉안당 참배 주차」, 「이장 비용」 글을 미리 올려 두세요."]);
  M.push(["오프라인 연결", "장례식장·상조 담당자에게 「부고 문자 만들기」와 「49재 계산」 페이지를 유족 안내용으로 소개해 달라고 부탁하세요. 유족이 직접 쓰는 도구라 자연스럽게 퍼집니다."]);
  M.push(["검색 등록 점검", "네이버 서치어드바이저·구글 서치 콘솔·다음 웹마스터도구에 사이트맵(sitemap.xml)과 RSS(rss.xml)를 제출했는지 확인하세요. 등록이 안 되면 검색 유입이 거의 생기지 않습니다."]);
  if (topThemes.length) M.push(["콘텐츠 보강 순서", `사람들이 가장 많이 찾는 주제는 ${topThemes.map(t => `「${esc(t)}」`).join(", ")}입니다. 이 주제의 가이드 글과 페이지 정보를 먼저 늘리세요.`]);
  // ------------------- 화면 -------------------
  const byDay = Object.fromEntries(daily.map(r => [r.day, r]));
  const allDays = [];
  for (let i = days - 1; i >= 0; i--) allDays.push(kstDay(now - i * 86400e3));
  const maxPv = Math.max(1, ...daily.map(r => r.pv));
  const chart = `<div class="legend"><span><i style="background:#1f4d3f"></i>방문자</span><span><i style="background:#cfe0d6"></i>페이지뷰</span></div><div class="chart">` +
    allDays.slice(-60).map(d => { const r = byDay[d] || { uv: 0, pv: 0 }; return `<div class="c" title="${d} 방문자 ${r.uv}명, 페이지뷰 ${r.pv}회"><div class="p" style="height:${100 * (r.pv - r.uv) / maxPv}%"></div><div class="v" style="height:${100 * r.uv / maxPv}%"></div><small>${d.slice(5).replace("-", "/")}</small></div>`; }).join("") + `</div>`;
  const tag = t => `<span class="tag ${esc(t)}">${esc(TYPE_LABEL[t] || t)}</span>`;
  const plink = (p, t) => { const [nm, ds] = pageInfo(p, t); return `<b>${esc(nm)}</b>${ds ? `<span class="pdesc">${esc(ds)}</span>` : ""}<a class="path" href="${esc(p)}" target="_blank">${esc(p)} ↗</a>`; };
  const tabs = [[1, "오늘"], [7, "최근 7일"], [30, "최근 30일"], [90, "최근 90일"]].map(([d, l]) => `<a class="${d === days ? "on" : ""}" href="/stats?d=${d}">${l}</a>`).join("");
  const time = ts => new Date(ts + 9 * 3600e3).toISOString().slice(5, 16).replace("T", " ");
  const barRows = (list, unit, total) => list.length ? `<div class="hbars">` + list.map(r => `<div class="hb"><span class="hb-l">${esc(r.l)}</span><span class="hb-t"><i style="width:${Math.max(2, pct(r.n, total))}%"></i></span><span class="hb-v">${num(r.n)}${unit} <small>${pct(r.n, total)}%</small></span></div>`).join("") + `</div>` : `<p class="muted small">아직 기록이 없습니다.</p>`;

  const L = await leadSummary(env, from);
  const leadCard = `<section class="card leadsum"><h2>상담 신청 현황 <a class="more" href="/stats/leads">상담 신청 관리 →</a></h2>
<div class="kpi"><div><span>기간 상담 신청</span><strong>${num(L.n)}건</strong><em>제휴 페이지 본 사람 ${num(L.pvTotal)}명${L.pvTotal ? " · 신청 전환율 " + pct(L.n, L.pvTotal) + "%" : ""}</em></div>
<div><span>아직 연락 안 한 신청 (신규)</span><strong class="${L.open ? "bad" : ""}">${num(L.open)}건</strong><em>전체 기간 기준</em></div>
<div><span>기간 계약</span><strong>${num(L.won)}건</strong><em>계약 금액 합계 ${num(L.amount)}원 · 사은품 보낼 차례 ${num(L.giftsDue)}건</em></div></div>
<div class="grid"><div>${rows(L.byP, [["시설", r => esc(r.p)], ["신청", r => num(r.n) + "건", 1], ["계약", r => num(r.w) + "건", 1]])}</div>
<div>${rows(L.bySrc, [["어디서 와서 신청했나", r => esc(r.s)], ["신청", r => num(r.n) + "건", 1]])}
${L.recent.length ? `<p class="small muted" style="margin-top:12px">최근 신청: ${L.recent.map(r => `#${r.id} ${esc(r.name)}(${esc(r.partner_name || "미정")}, ${esc(r.status)})`).join(" · ")}</p>` : ""}</div></div></section>`;
  const body = `<h1>방문 통계</h1><p class="muted small">한국 시간 기준 · ${from} ~ ${kstDay(now)} · 검색엔진 로봇은 빼고 셉니다. 같은 사람은 하루에 한 명으로 셉니다.</p>
<nav class="tabs">${tabs}<a href="/stats/check">배포 점검</a><a href="/stats/leads" style="margin-left:auto;background:#b08a3e;border-color:#b08a3e;color:#fff">상담 신청 관리${L.open ? " (신규 " + L.open + ")" : ""}</a></nav>
${leadCard}
<section class="kpi"><div><span>오늘 방문자</span><strong>${num(today.uv)}명</strong></div><div><span>기간 방문자</span><strong>${num(uv)}명</strong>${prev.uv ? `<em>앞 기간 ${num(prev.uv)}명</em>` : ""}</div>
<div><span>방문 횟수</span><strong>${num(tot.visits)}회</strong></div><div><span>바로 나간 비율 (이탈률)</span><strong>${bounceRate}%</strong><em>한 페이지만 보고 나감</em></div><div><span>전화 걸기 클릭</span><strong>${num(telClicks)}회</strong><em>지도 보기 ${num(evTotal.map || 0)}회</em></div><div><span>본 페이지 수</span><strong>${num(tot.pv)}회</strong><em>1회 방문당 ${perVisit.toFixed(1)}페이지</em></div></section>
<section class="card analysis"><h2>한눈에 보는 분석</h2><ul>${A.map(a => `<li>${a}</li>`).join("")}</ul>
${S.length ? `<h3>이렇게 해 보세요</h3><ul class="sugg">${S.map(a => `<li>${a}</li>`).join("")}</ul>` : ""}</section>
<div class="grid">
<section class="card"><h2>사람들은 무엇을 찾으러 왔나</h2>${barRows(purposes, "명", Math.max(1, uv))}
<p class="small muted">본 페이지를 주제별로 묶어, 그 주제를 본 사람 수를 셌습니다. 한 사람이 여러 주제를 보면 각각 셉니다. 비율은 전체 방문자 대비입니다.</p></section>
<section class="card"><h2>어느 지역을 많이 찾나</h2>${barRows(regions.slice(0, 12), "명", Math.max(1, uv))}
<p class="small muted">시도별 봉안당 목록과 장례식장 페이지를 본 사람 수입니다.</p></section>
</div>
<section class="card"><h2>날짜별 방문자</h2>${chart}</section>
<div class="grid">
<section class="card"><h2>몇 시에 많이 오나</h2>${(() => { const mx = Math.max(1, ...hours.map(h => h.n)); const by = Object.fromEntries(hours.map(h => [h.h, h.n]));
  return `<div class="chart hrs">` + Array.from({ length: 24 }, (_, h) => `<div class="c" title="${h}시 ${by[h] || 0}회"><div class="v" style="height:${100 * (by[h] || 0) / mx}%"></div><small>${h % 3 === 0 ? h + "시" : ""}</small></div>`).join("") + `</div>`; })()}
<p class="small muted">한국 시간 기준, 시간대별 방문 횟수입니다.</p></section>
<section class="card"><h2>무슨 요일에 많이 오나</h2>${barRows([0,1,2,3,4,5,6].map(w => ({ l: "일월화수목금토"[w] + "요일", n: (wdays.find(x => x.w === w) || { n: 0 }).n })), "회", Math.max(1, wdays.reduce((a, b) => a + b.n, 0)))}</section>
</div>
<section class="card"><h2>처음 들어온 페이지별 성과</h2>${rows(landing, [["처음 본 페이지", r => plink(r.p)], ["들어온 횟수", r => num(r.s) + "회", 1], ["1회 방문당 페이지", r => (r.pv / r.s).toFixed(1), 1], ["바로 나간 비율", r => `<span class="${pct(r.b, r.s) >= 70 ? "bad" : ""}">${pct(r.b, r.s)}%</span>`, 1]])}
<p class="small muted">바로 나간 비율이 70% 이상이면 빨간색입니다. 처음 들어온 사람이 다음 페이지로 넘어가지 않는다는 뜻이라, 그 페이지에 볼거리나 다음 단추를 보강하면 좋습니다.</p></section>
<section class="card"><h2>유입 경로별 성과</h2>${rows(srcPerf, [["경로", r => `${tag(r.t)} ${esc(r.nm)}`], ["방문", r => num(r.s) + "회", 1], ["1회 방문당 페이지", r => (r.pv / r.s).toFixed(1), 1], ["바로 나간 비율", r => pct(r.b, r.s) + "%", 1]])}
<p class="small muted">어디서 온 사람이 더 오래 머무는지 비교합니다. 페이지 수가 많고 바로 나간 비율이 낮은 경로가 좋은 경로입니다.</p></section>
<section class="card"><h2>사람들이 어디서 어디로 이동했나</h2>${rows(flows, [["이전 페이지", r => `<b>${esc(pageName(r.f))}</b>`], ["", r => "→"], ["다음 페이지", r => `<b>${esc(pageName(r.p))}</b>`], ["횟수", r => num(r.n) + "회", 1]])}
<p class="small muted">사이트 안에서 많이 다니는 길입니다. 많이 가는 길은 단추를 더 크게, 가야 하는데 안 가는 길은 링크를 새로 만들어 주세요.</p></section>
<section class="card"><h2>전화·지도 클릭 (관심 행동)</h2>${rows(evs, [["행동", r => `<span class="tag">${esc(EV_LABEL[r.ev] || r.ev)}</span>`], ["시설·대상", r => `<b>${esc(r.label || "-")}</b><span class="path">${esc(pageName(r.path))}</span>`], ["사람", r => num(r.u) + "명", 1], ["횟수", r => num(r.n) + "회", 1]])}
<p class="small muted">시설 전화 걸기, 지도 보기, 부고 문자 복사, 지방·축문 인쇄 같은 행동을 셉니다. 이번 업데이트 뒤부터 기록됩니다.</p></section>
<section class="card mkt"><h2>사람을 더 모으는 방법 (마케팅 제안)</h2><ol>${M.map(([t, d]) => `<li><b>${t}</b><br>${d}</li>`).join("")}</ol>
<p class="small muted">위 제안은 이 기간의 방문 기록을 바탕으로 자동으로 만들어집니다. 기간을 30일·90일로 바꾸면 더 안정된 제안이 나옵니다.</p></section>
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

// ---------------------------------------------------------------- 상담 신청 (제휴 시설)
// 설정 (Cloudflare Pages → 설정 → 변수 및 비밀) — 둘 중 하나만 해도 되고, 아무것도 안 해도 신청은 통계 페이지에 저장됨
//   카카오톡 알림 : KAKAO_REST_KEY (카카오 디벨로퍼스 앱의 REST API 키), 필요하면 KAKAO_CLIENT_SECRET
//                   → 통계 페이지 → 상담 신청 → '카카오톡 연결' 단추를 한 번 눌러 로그인
//   이메일 알림    : RESEND_API_KEY (resend.com, shinnamho@naver.com 으로 가입), 받는 주소 LEAD_EMAIL(기본 shinnamho@naver.com)
const LEAD_STATUS = ["신규", "상담 중", "업체 전달", "방문 예약", "계약 완료", "사은품 지급", "종료(미계약)"];
const LEAD_FIELDS = ["partner", "partner_name", "name", "phone", "deceased", "crematorium", "funeral_hall", "visit_date", "contact_way", "budget", "memo", "page", "src", "avoid_time"];
const LEAD_MAX = { name: 30, phone: 20, deceased: 30, crematorium: 60, funeral_hall: 60, visit_date: 10, contact_way: 10, budget: 30, memo: 1000, page: 200, src: 120, avoid_time: 40, partner: 40, partner_name: 80 };

let leadReady = false;
async function ensureLeads(db) {
  if (leadReady) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, day TEXT, partner TEXT, partner_name TEXT,
    name TEXT, phone TEXT, deceased TEXT, crematorium TEXT, funeral_hall TEXT, visit_date TEXT, contact_way TEXT, budget TEXT, memo TEXT,
    page TEXT, src TEXT, iph TEXT, agree TEXT, status TEXT DEFAULT '신규', visit_at TEXT DEFAULT '', amount INTEGER DEFAULT 0, gift TEXT DEFAULT '',
    admin_memo TEXT DEFAULT '', notified TEXT DEFAULT '', updated INTEGER)`).run();
  try { await db.prepare("ALTER TABLE leads ADD COLUMN avoid_time TEXT DEFAULT ''").run(); } catch (e) { /* 이미 있음 */ }
  await db.prepare("CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)").run();
  leadReady = true;
}
async function getSetting(db, k) { const r = await db.prepare("SELECT v FROM settings WHERE k=?").bind(k).first(); return r ? r.v : ""; }
async function setSetting(db, k, v) { await db.prepare("INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, String(v)).run(); }

async function partnerConfig(env, origin) {
  try { const r = await env.ASSETS.fetch(new Request(origin + "/assets/partner.json")); if (r.ok) return await r.json(); } catch (e) {}
  return { member_code: "", gifts: [], partners: [] };
}
function giftFor(cfg, amount) {
  if (!amount) return "";
  const g = (cfg.gifts || []).find(x => amount >= (x.min || 0) && (x.max == null || amount < x.max));
  return g ? g.label : "";
}

async function createLead(request, env, ctx) {
  const url = new URL(request.url);
  const isJson = (request.headers.get("content-type") || "").includes("application/json");
  const fail = (msg, code = 400) => isJson ? Response.json({ ok: false, error: msg }, { status: code }) : Response.redirect(url.origin + "/partner/error", 303);
  if (!env.DB) return fail("지금은 신청을 받을 수 없습니다. shinnamho@naver.com 으로 연락해 주세요.", 503);
  let d = {};
  try { d = isJson ? await request.json() : Object.fromEntries(await request.formData()); } catch (e) { return fail("신청 내용을 읽지 못했습니다."); }
  if (d.website) return isJson ? Response.json({ ok: true }) : Response.redirect(url.origin + "/partner/thanks", 303); // 스팸 로봇
  const v = {};
  for (const k of LEAD_FIELDS) v[k] = String(d[k] == null ? "" : d[k]).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, LEAD_MAX[k] || 100);
  const hh = x => { const n = parseInt(x, 10); return n >= 0 && n <= 24 ? (n === 24 ? "밤 12시" : (n < 12 ? "오전 " : "오후 ") + ((n % 12) || 12) + "시") : ""; };
  const af = hh(d.avoid_from), at = hh(d.avoid_to);
  if (!v.avoid_time && (af || at)) v.avoid_time = `${af || "?"} ~ ${at || "?"}`;
  v.memo = String(d.memo || "").trim().slice(0, 1000);
  const digits = v.phone.replace(/[^0-9]/g, "");
  if (!v.name) return fail("성함을 적어 주세요.");
  if (digits.length < 9 || digits.length > 12) return fail("연락처를 정확히 적어 주세요.");
  if (!d.agree_privacy || !d.agree_third) return fail("필수 동의 두 가지에 체크해 주세요.");
  if (v.visit_date && !/^\d{4}-\d{2}-\d{2}$/.test(v.visit_date)) v.visit_date = "";
  await ensureLeads(env.DB);
  const now = Date.now(), day = kstDay(now);
  const iph = (await sha(`${day}|${request.headers.get("cf-connecting-ip") || ""}|lead|${env.STATS_PASSWORD || ""}`)).slice(0, 16);
  const recent = await env.DB.prepare("SELECT COUNT(*) n FROM leads WHERE iph=? AND ts>?").bind(iph, now - 3600e3).first();
  if (recent && recent.n >= 5) return fail("짧은 시간에 신청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.", 429);
  const cfg = await partnerConfig(env, url.origin);
  if (v.partner && !v.partner_name) { const p = (cfg.partners || []).find(x => x.slug === v.partner); if (p) v.partner_name = p.name; }
  const res = await env.DB.prepare(`INSERT INTO leads (ts, day, partner, partner_name, name, phone, deceased, crematorium, funeral_hall, visit_date, contact_way, budget, memo, page, src, iph, agree, updated, avoid_time)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(now, day, v.partner, v.partner_name, v.name, v.phone, v.deceased, v.crematorium, v.funeral_hall, v.visit_date,
    v.contact_way, v.budget, v.memo, v.page, v.src, iph, `개인정보 수집·이용, 제3자 제공 동의 ${new Date(now + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ")}`, now, v.avoid_time).run();
  const id = res.meta && res.meta.last_row_id;
  ctx.waitUntil(notifyLead(env, url.origin, { id, ...v }).catch(() => {}));
  return isJson ? Response.json({ ok: true }) : Response.redirect(url.origin + "/partner/thanks", 303);
}

function leadText(l, short) {
  const t = [`[봉안당 길잡이] 새 상담 신청${l.id ? " #" + l.id : ""}`, `시설: ${l.partner_name || "미정(추천 요청)"}`, `신청자: ${l.name} / ${l.phone}`];
  if (l.contact_way) t.push(`연락 방법: ${l.contact_way}`);
  if (l.avoid_time) t.push(`피할 시간: ${l.avoid_time}`);
  if (l.deceased) t.push(`고인: ${l.deceased}`);
  if (l.funeral_hall) t.push(`장례식장: ${l.funeral_hall}`);
  if (l.crematorium) t.push(`화장: ${l.crematorium}`);
  if (l.visit_date) t.push(`희망 방문일: ${l.visit_date}`);
  if (l.budget) t.push(`예산: ${l.budget}`);
  if (l.memo) t.push(`문의: ${l.memo}`);
  const s = t.join("\n");
  return short ? (s.length > 190 ? s.slice(0, 187) + "…" : s) : s;
}

async function kakaoToken(env) {
  const db = env.DB;
  const access = await getSetting(db, "kakao_access"), exp = Number(await getSetting(db, "kakao_exp") || 0);
  if (access && exp > Date.now() + 60e3) return access;
  const refresh = await getSetting(db, "kakao_refresh");
  if (!refresh) throw new Error("카카오톡 연결이 필요합니다");
  const body = new URLSearchParams({ grant_type: "refresh_token", client_id: env.KAKAO_REST_KEY, refresh_token: refresh });
  if (env.KAKAO_CLIENT_SECRET) body.set("client_secret", env.KAKAO_CLIENT_SECRET);
  const r = await fetch("https://kauth.kakao.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" }, body });
  const j = await r.json();
  if (!j.access_token) throw new Error("카카오 토큰 갱신 실패: " + (j.error_description || j.error || r.status));
  await saveKakao(db, j);
  return j.access_token;
}
async function saveKakao(db, j) {
  await setSetting(db, "kakao_access", j.access_token);
  await setSetting(db, "kakao_exp", Date.now() + (j.expires_in || 21599) * 1000);
  if (j.refresh_token) {
    await setSetting(db, "kakao_refresh", j.refresh_token);
    await setSetting(db, "kakao_refresh_exp", Date.now() + (j.refresh_token_expires_in || 5184000) * 1000);
  }
}
async function kakaoSend(env, origin, text) {
  const token = await kakaoToken(env);
  const tpl = { object_type: "text", text, link: { web_url: origin + "/stats/leads", mobile_web_url: origin + "/stats/leads" }, button_title: "신청 보기" };
  const r = await fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
    method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams({ template_object: JSON.stringify(tpl) }) });
  const j = await r.json().catch(() => ({}));
  if (j.result_code !== 0) throw new Error("카카오톡 보내기 실패: " + (j.msg || r.status));
}
async function emailSend(env, origin, l) {
  const to = env.LEAD_EMAIL || "shinnamho@naver.com";
  const html = `<div style="font:16px/1.7 sans-serif"><h2 style="margin:0 0 12px">새 상담 신청${l.id ? " #" + l.id : ""}</h2>` +
    leadText(l, false).split("\n").slice(1).map(x => `<div>${esc(x)}</div>`).join("") +
    `<p style="margin-top:16px"><a href="${origin}/stats/leads">통계 페이지에서 보기</a> · 전화: <a href="tel:${esc(l.phone.replace(/[^0-9]/g, ""))}">${esc(l.phone)}</a></p></div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ from: env.RESEND_FROM || "봉안당 길잡이 <onboarding@resend.dev>", to: [to], subject: `[상담 신청] ${l.partner_name || "시설 미정"} · ${l.name}`, html, text: leadText(l, false) }) });
  if (!r.ok) throw new Error("이메일 보내기 실패: " + r.status + " " + (await r.text()).slice(0, 120));
}
async function notifyLead(env, origin, l) {
  const out = [];
  if (env.KAKAO_REST_KEY) { try { await kakaoSend(env, origin, leadText(l, true)); out.push("카톡 ✔"); } catch (e) { out.push("카톡 ✖ " + e.message); } }
  if (env.RESEND_API_KEY) { try { await emailSend(env, origin, l); out.push("메일 ✔"); } catch (e) { out.push("메일 ✖ " + e.message); } }
  if (!out.length) out.push("알림 설정 없음");
  if (l.id) await env.DB.prepare("UPDATE leads SET notified=? WHERE id=?").bind(out.join(" · ").slice(0, 300), l.id).run();
  return out;
}

async function kakaoState(env) { return (await sha("kakao|" + env.STATS_PASSWORD)).slice(0, 24); }
async function kakaoCallback(request, env, url) {
  if (url.searchParams.get("state") !== await kakaoState(env)) return page("카카오 연결", `<div class="card"><h1>연결하지 못했습니다</h1><p>잘못된 요청입니다. 통계 페이지에서 다시 눌러 주세요.</p></div>`);
  const code = url.searchParams.get("code");
  if (!code) return page("카카오 연결", `<div class="card"><h1>연결하지 못했습니다</h1><p>${esc(url.searchParams.get("error_description") || "동의가 취소되었습니다.")}</p><p><a href="/stats/leads">돌아가기</a></p></div>`);
  const body = new URLSearchParams({ grant_type: "authorization_code", client_id: env.KAKAO_REST_KEY, redirect_uri: url.origin + "/stats/kakao/callback", code });
  if (env.KAKAO_CLIENT_SECRET) body.set("client_secret", env.KAKAO_CLIENT_SECRET);
  const r = await fetch("https://kauth.kakao.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" }, body });
  const j = await r.json();
  if (!j.access_token) return page("카카오 연결", `<div class="card"><h1>연결하지 못했습니다</h1><p>${esc(j.error_description || j.error || r.status)}</p><p><a href="/stats/leads">돌아가기</a></p></div>`);
  await ensureLeads(env.DB);
  await saveKakao(env.DB, j);
  try { await kakaoSend(env, url.origin, "[봉안당 길잡이] 카카오톡 알림이 연결되었습니다. 앞으로 상담 신청이 들어오면 이 대화방으로 알려 드립니다."); } catch (e) {}
  return Response.redirect(url.origin + "/stats/leads?msg=kakao", 302);
}

async function leadsAdmin(request, env, url) {
  await ensureLeads(env.DB);
  const db = env.DB, origin = url.origin;
  const cfg = await partnerConfig(env, origin);
  if (url.pathname === "/stats/kakao") {
    if (!env.KAKAO_REST_KEY) return Response.redirect(origin + "/stats/leads?msg=nokey", 302);
    const q = new URLSearchParams({ client_id: env.KAKAO_REST_KEY, redirect_uri: origin + "/stats/kakao/callback", response_type: "code", scope: "talk_message", state: await kakaoState(env) });
    return Response.redirect("https://kauth.kakao.com/oauth/authorize?" + q, 302);
  }
  if (url.pathname === "/stats/leads/test" && request.method === "POST") {
    const out = await notifyLead(env, origin, { name: "테스트", phone: "010-0000-0000", partner_name: "알림 테스트", memo: "알림이 잘 오는지 확인하는 테스트입니다." });
    return Response.redirect(origin + "/stats/leads?msg=" + encodeURIComponent(out.join(" · ")), 302);
  }
  if (url.pathname === "/stats/leads/update" && request.method === "POST") {
    const f = await request.formData(), id = parseInt(f.get("id"), 10);
    if (f.get("del") === "1") await db.prepare("DELETE FROM leads WHERE id=?").bind(id).run();
    else {
      const amount = parseInt(String(f.get("amount") || "").replace(/[^0-9]/g, ""), 10) || 0;
      const status = LEAD_STATUS.includes(f.get("status")) ? f.get("status") : "신규";
      const gift = String(f.get("gift") || "").trim() || giftFor(cfg, amount);
      await db.prepare("UPDATE leads SET status=?, visit_at=?, amount=?, gift=?, admin_memo=?, updated=? WHERE id=?")
        .bind(status, String(f.get("visit_at") || "").slice(0, 16), amount, gift.slice(0, 60), String(f.get("admin_memo") || "").slice(0, 1000), Date.now(), id).run();
    }
    return Response.redirect(origin + "/stats/leads" + (f.get("back") ? "?" + String(f.get("back")).replace(/^\?/, "") : ""), 302);
  }
  // 보유 기간이 지난 신청은 지움 (종료·사은품 지급 후 1년)
  await db.prepare("DELETE FROM leads WHERE status IN ('종료(미계약)','사은품 지급') AND updated < ?").bind(Date.now() - 365 * 86400e3).run();
  if (url.pathname === "/stats/leads.csv") {
    const all = (await db.prepare("SELECT * FROM leads ORDER BY id DESC").all()).results || [];
    const cols = [["id", "번호"], ["ts", "접수"], ["status", "상태"], ["partner_name", "시설"], ["name", "신청자"], ["phone", "연락처"], ["deceased", "고인"], ["funeral_hall", "장례식장"], ["crematorium", "화장 장소"],
      ["visit_date", "희망 방문일"], ["visit_at", "방문 예약"], ["contact_way", "연락 방법"], ["avoid_time", "피할 시간"], ["budget", "예산"], ["amount", "계약 금액"], ["gift", "사은품"], ["memo", "문의"], ["admin_memo", "관리 메모"], ["src", "유입"], ["page", "신청 페이지"]];
    const cell = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const csv = "﻿" + cols.map(c => c[1]).join(",") + "\n" + all.map(r => cols.map(([k]) => cell(k === "ts" ? new Date(r.ts + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ") : r[k])).join(",")).join("\n");
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="leads-${kstDay(Date.now())}.csv"`, "cache-control": "no-store" } });
  }
  const st = url.searchParams.get("s") || "";
  const list = (await (st ? db.prepare("SELECT * FROM leads WHERE status=? ORDER BY id DESC LIMIT 300").bind(st) : db.prepare("SELECT * FROM leads ORDER BY id DESC LIMIT 300")).all()).results || [];
  const counts = Object.fromEntries(((await db.prepare("SELECT status s, COUNT(*) n FROM leads GROUP BY status").all()).results || []).map(r => [r.s, r.n]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const tabs = [["", `전체 ${total}`]].concat(LEAD_STATUS.map(s => [s, `${s} ${counts[s] || 0}`])).map(([s, l]) => `<a class="${s === st ? "on" : ""}" href="/stats/leads${s ? "?s=" + encodeURIComponent(s) : ""}">${esc(l)}</a>`).join("");
  const kakaoOn = !!(env.KAKAO_REST_KEY && await getSetting(db, "kakao_refresh"));
  const rexp = Number(await getSetting(db, "kakao_refresh_exp") || 0);
  const msg = url.searchParams.get("msg");
  const msgText = msg === "kakao" ? "카카오톡 알림이 연결되었습니다." : msg === "nokey" ? "먼저 Cloudflare에 KAKAO_REST_KEY 를 넣어 주세요. (아래 설정 방법 참고)" : msg;
  const time = ts => new Date(ts + 9 * 3600e3).toISOString().slice(5, 16).replace("T", " ");
  const giftOpts = (cfg.gifts || []).map(g => g.label);
  const back = st ? "s=" + encodeURIComponent(st) : "";
  const handoff = l => [`[봉안당 길잡이 고객 안내]`, `성함: ${l.name}`, `연락처: ${l.phone}`, l.deceased ? `고인: ${l.deceased}` : "", l.visit_at || l.visit_date ? `방문 예정: ${l.visit_at || l.visit_date}` : "",
    l.budget ? `예산: ${l.budget}` : "", cfg.member_code ? `회원코드: ${cfg.member_code}` : ""].filter(Boolean).join("\n");
  const cards = list.map(l => `<form class="lead" method="post" action="/stats/leads/update"><input type="hidden" name="id" value="${l.id}"><input type="hidden" name="back" value="${esc(back)}">
<div class="lh"><b>#${l.id} ${esc(l.name)}</b> <a class="tel" href="tel:${esc(String(l.phone).replace(/[^0-9]/g, ""))}">${esc(l.phone)}</a> <span class="tag">${esc(l.status)}</span>
<span class="muted small">${time(l.ts)} 접수 · ${esc(l.contact_way || "")}</span>${l.avoid_time ? ` <span class="tag avoid">피할 시간 ${esc(l.avoid_time)}</span>` : ""}</div>
<div class="lg"><div><span>관심 시설</span><b>${esc(l.partner_name || "미정(추천 요청)")}</b></div><div><span>고인</span>${esc(l.deceased || "-")}</div><div><span>장례식장</span>${esc(l.funeral_hall || "-")}</div>
<div><span>화장 장소</span>${esc(l.crematorium || "-")}</div><div><span>희망 방문일</span>${esc(l.visit_date || "-")}</div><div><span>예산</span>${esc(l.budget || "-")}</div></div>
${l.memo ? `<p class="lm">${esc(l.memo)}</p>` : ""}
<div class="le"><label>상태<select name="status">${LEAD_STATUS.map(s => `<option${s === l.status ? " selected" : ""}>${s}</option>`).join("")}</select></label>
<label>방문 예약 일시<input type="datetime-local" name="visit_at" value="${esc(l.visit_at || "")}"></label>
<label>계약 금액(원)<input name="amount" inputmode="numeric" value="${l.amount || ""}" placeholder="예: 6500000"></label>
<label>사은품<select name="gift"><option value="">계약 금액으로 자동</option>${giftOpts.map(g => `<option${g === l.gift ? " selected" : ""}>${esc(g)}</option>`).join("")}</select></label>
<label class="w">관리 메모<input name="admin_memo" value="${esc(l.admin_memo || "")}" placeholder="통화 내용, 업체 담당자 등"></label></div>
<div class="la"><button>저장</button><button type="button" class="ghost" data-copy="${esc(handoff(l))}">업체 전달용 문구 복사</button>
${l.gift ? `<span class="gift">사은품: <b>${esc(l.gift)}</b></span>` : ""}<span class="muted small">유입: ${esc(l.src || "-")} · 신청 페이지: ${esc(pageInfo(l.page)[0])} · 알림: ${esc(l.notified || "-")}</span>
<button name="del" value="1" class="del" onclick="return confirm('이 신청을 지울까요? 되돌릴 수 없습니다.')">삭제</button></div></form>`).join("");
  const setup = `<section class="card"><h2>알림 설정 (새 신청이 오면 바로 알려 받기)</h2>
<p><b>카카오톡</b> ${kakaoOn ? `<span class="tag">연결됨</span> <span class="muted small">${rexp ? "재연결 필요일 " + kstDay(rexp) : ""}</span>` : `<span class="tag referral">연결 안 됨</span>`}
${env.KAKAO_REST_KEY ? `<a class="btn" href="/stats/kakao">${kakaoOn ? "다시 연결" : "카카오톡 연결하기"}</a>` : ""}
 &nbsp; <b>이메일</b> ${env.RESEND_API_KEY ? `<span class="tag">사용 중 → ${esc(env.LEAD_EMAIL || "shinnamho@naver.com")}</span>` : `<span class="tag referral">설정 안 됨</span>`}</p>
<form method="post" action="/stats/leads/test" style="display:inline"><button>알림 테스트 보내기</button></form>
<details><summary>설정 방법 보기</summary><ol class="small">
<li><b>카카오톡 (sinnamho@nate.com 계정으로 받기)</b>: <a href="https://developers.kakao.com" target="_blank">developers.kakao.com</a>에 그 카카오 계정으로 로그인 → 내 애플리케이션 → 앱 만들기.
 → [앱 설정 → 플랫폼 → Web] 사이트 도메인에 <code>${esc(origin)}</code> 등록 → [카카오 로그인] 켜기, Redirect URI에 <code>${esc(origin)}/stats/kakao/callback</code> 등록
 → [동의항목] '카카오톡 메시지 전송' 사용(선택 동의) → [앱 키]의 REST API 키를 복사해 Cloudflare Pages → 설정 → 변수 및 비밀에 <b>KAKAO_REST_KEY</b>로 저장(클라이언트 시크릿을 켰다면 KAKAO_CLIENT_SECRET도) → 다시 배포 → 이 페이지에서 '카카오톡 연결하기'.
 카카오톡 '나와의 채팅'으로 알림이 옵니다. 두 달에 한 번쯤 재연결이 필요할 수 있으며, 날짜가 위에 표시됩니다.</li>
<li><b>이메일</b>: <a href="https://resend.com" target="_blank">resend.com</a>에 shinnamho@naver.com 으로 가입 → API Keys에서 키 만들기 → Cloudflare에 <b>RESEND_API_KEY</b>로 저장 → 다시 배포. (다른 주소로 받으려면 도메인 인증 뒤 LEAD_EMAIL, RESEND_FROM 설정)</li>
<li>알림이 안 와도 신청은 이 페이지에 모두 저장됩니다.</li></ol></details></section>`;
  const body = `<h1>상담 신청 관리</h1><p class="muted small">제휴 시설 상담 신청 목록입니다. 상태를 바꾸고 저장하면 통계 첫 화면의 상담 현황에 반영됩니다. 종료·사은품 지급 후 1년이 지난 신청은 자동으로 지워집니다.</p>
${msgText ? `<p class="note">${esc(msgText)}</p>` : ""}
<nav class="tabs"><a href="/stats">← 방문 통계</a>${tabs}<a href="/stats/leads.csv">엑셀(CSV) 받기</a></nav>
${cards || `<div class="card"><p class="muted">아직 상담 신청이 없습니다.</p></div>`}
${setup}
<style>.lead{background:#fff;border:1px solid var(--line);border-left:6px solid var(--gold);border-radius:12px;padding:16px 18px;margin-bottom:14px}.lh{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}.lh b{font-size:19px}.tel{font-weight:700;font-size:18px}
.lg{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 14px;font-size:15px}.lg span{display:block;font-size:12px;color:var(--ink2)}.lm{background:#f6f4ee;border-radius:8px;padding:8px 12px;margin:10px 0 0;white-space:pre-wrap}
.le{display:grid;grid-template-columns:repeat(4,1fr);gap:8px 12px;margin-top:12px}.le label{display:flex;flex-direction:column;font-size:13px;color:var(--ink2);gap:2px}.le .w{grid-column:1/-1}.le input,.le select{font:inherit;font-size:15px;padding:8px 10px;border:2px solid var(--line);border-radius:8px;min-width:0}
.la{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}.la .ghost{background:#fff;color:var(--acc)}.la .del{margin-left:auto;background:#fff;color:#b42318;border-color:#f0c9c4}.gift{background:#fbf3d8;padding:4px 10px;border-radius:6px}
a.btn{display:inline-block;padding:8px 14px;border-radius:8px;background:var(--acc);color:#fff;text-decoration:none;font-weight:700;margin-left:6px}
@media(max-width:800px){.lg{grid-template-columns:1fr 1fr}.le{grid-template-columns:1fr 1fr}}</style>
<script>document.addEventListener("click",function(e){var b=e.target.closest("[data-copy]");if(!b)return;var t=b.getAttribute("data-copy");try{navigator.clipboard.writeText(t).then(function(){var o=b.textContent;b.textContent="복사됨";setTimeout(function(){b.textContent=o},1500)})}catch(x){prompt("복사하세요",t)}});</script>`;
  return page("상담 신청 관리", body);
}

// 통계 첫 화면에 넣는 상담 현황 요약
async function leadSummary(env, from) {
  await ensureLeads(env.DB);
  const db = env.DB;
  const one = (sql, ...b) => db.prepare(sql).bind(...b).first();
  const all = (sql, ...b) => db.prepare(sql).bind(...b).all().then(r => r.results || []);
  const [n, open, won, gifts] = await Promise.all([
    one("SELECT COUNT(*) n FROM leads WHERE day>=?", from), one("SELECT COUNT(*) n FROM leads WHERE status='신규'"),
    one("SELECT COUNT(*) n, SUM(amount) a FROM leads WHERE day>=? AND status IN ('계약 완료','사은품 지급')", from),
    one("SELECT COUNT(*) n FROM leads WHERE status='계약 완료'")]);
  const byP = await all("SELECT COALESCE(NULLIF(partner_name,''),'미정(추천 요청)') p, COUNT(*) n, SUM(CASE WHEN status IN ('계약 완료','사은품 지급') THEN 1 ELSE 0 END) w FROM leads WHERE day>=? GROUP BY p ORDER BY n DESC LIMIT 15", from);
  const bySrc = await all("SELECT COALESCE(NULLIF(src,''),'직접·알 수 없음') s, COUNT(*) n FROM leads WHERE day>=? GROUP BY s ORDER BY n DESC LIMIT 8", from);
  const pv = await all("SELECT path p, COUNT(DISTINCT vid) u FROM hits WHERE day>=? AND path LIKE '/partner%' GROUP BY path", from);
  const views = {}; for (const r of pv) { const k = normPath(r.p); views[k] = (views[k] || 0) + r.u; }
  const pvTotal = Object.values(views).reduce((a, b) => a + b, 0);
  const recent = await all("SELECT id, ts, name, partner_name, status FROM leads ORDER BY id DESC LIMIT 5");
  return { n: n ? n.n : 0, open: open ? open.n : 0, won: won ? won.n : 0, amount: won ? won.a || 0 : 0, giftsDue: gifts ? gifts.n : 0, byP, bySrc, pvTotal, recent };
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
  if (url.pathname === "/stats/kakao/callback") return kakaoCallback(request, env, url);
  const token = await authToken(env);
  if (url.pathname === "/stats/login" && request.method === "POST") {
    const form = await request.formData();
    if (String(form.get("pw") || "") !== env.STATS_PASSWORD) return loginPage("비밀번호가 맞지 않습니다.");
    return new Response(null, { status: 302, headers: { location: String(form.get("next") || "/stats").startsWith("/stats") ? String(form.get("next") || "/stats") : "/stats", "set-cookie": `st=${token}; Path=/stats; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict` } });
  }
  if (cookieOf(request, "st") !== token) return loginPage("", url.pathname + url.search);
  if (url.pathname.startsWith("/stats/leads") || url.pathname === "/stats/kakao") return leadsAdmin(request, env, url);
  if (url.pathname === "/stats/check") return deployCheck();
  return statsPage(request, env);
}

// 배포 점검: 빌드 때 만든 파일 목록(assets/manifest.json)과 실제 서버에 올라간 파일을 브라우저에서 하나씩 비교
function deployCheck() {
  return page("배포 점검", `<div class="card"><h1>배포 점검</h1>
<p class="muted">사이트를 만들 때 올라가야 했던 이미지·스크립트·데이터 파일이 실제 서버에 다 있는지 확인합니다. 1~2분 걸립니다.</p>
<p id="st">확인 중…</p><div id="miss"></div><p><a href="/stats">← 통계로 돌아가기</a></p></div>
<script>
(async function(){
  var st=document.getElementById("st"), out=document.getElementById("miss");
  var m; try{ m=await (await fetch("/assets/manifest.json",{cache:"no-store"})).json(); }catch(e){ st.textContent="파일 목록(assets/manifest.json)을 찾지 못했습니다. 최신 버전이 올라가지 않은 것 같습니다."; return; }
  var files=m.files, bad=[], done=0, i=0;
  async function one(f){
    var u="/"+f[0].split("/").map(encodeURIComponent).join("/"), ok=false;
    try{
      var r=await fetch(u,{method:"GET",cache:"no-store"});
      var ct=(r.headers.get("content-type")||"").toLowerCase();
      var isHtml=/\.html$/.test(f[0]);
      ok=r.ok && (isHtml || ct.indexOf("text/html")<0);
      if(ok && f[0]==="404.html"){ var t=await r.text(); ok=t.indexOf("찾을 수 없")>=0 || t.indexOf("404")>=0; }
    }catch(e){}
    if(!ok) bad.push(f[0]);
    done++; if(done%20===0) st.textContent="확인 중… "+done+" / "+files.length;
  }
  async function worker(){ while(i<files.length){ var f=files[i++]; await one(f); } }
  await Promise.all([worker(),worker(),worker(),worker(),worker(),worker()]);
  st.innerHTML="<b>"+files.length+"개 중 "+(files.length-bad.length)+"개 정상, 빠진 파일 "+bad.length+"개</b> (빌드 "+m.built+")";
  out.innerHTML=bad.length?"<p>아래 파일이 서버에 없습니다. GitHub 저장소에 이 파일이 올라갔는지 확인해 주세요.</p><ul>"+bad.map(function(b){return "<li><code>"+b+"</code></li>";}).join("")+"</ul>":"<p>모든 파일이 정상입니다.</p>";
})();
</script>`);
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
    // 폴더 정리 전 예전 주소로 들어오면 새 주소로 보냄
    const moved = migratePath(p);
    if (moved !== p && (request.method === "GET" || request.method === "HEAD")) return Response.redirect(`${url.origin}${moved}${url.search}`, 301);
    if (p === "/api/hit" && request.method === "POST") {
      try { return await recordHit(request, env); } catch (e) { return new Response(null, { status: 204 }); }
    }
    if (p === "/api/lead" && request.method === "POST") {
      try { return await createLead(request, env, ctx); } catch (e) { return Response.json({ ok: false, error: "잠시 문제가 생겼습니다. 다시 시도해 주세요." }, { status: 500 }); }
    }
    if (p === "/stats" || p.startsWith("/stats/")) {
      try { return await stats(request, env, url); } catch (e) { return page("오류", `<div class="card"><h1>잠시 문제가 생겼습니다</h1><p class="muted">${esc(e.message)}</p></div>`); }
    }
    return env.ASSETS.fetch(request);
  },
};
