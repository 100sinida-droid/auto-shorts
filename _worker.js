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
  await env.DB.prepare(`INSERT INTO hits (ts, day, vid, path, entry, src_type, src_name, ref_host, keyword, campaign, device, site_q)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(now, day, vid, page.pathname.slice(0, 200), c.type === "internal" ? 0 : 1,
    c.type, c.name.slice(0, 80), c.refHost.slice(0, 120), c.keyword, c.campaign.slice(0, 120), device, siteQ).run();
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
.note{background:#fbf3d8;border-radius:10px;padding:12px 16px;font-size:15px}
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

async function statsPage(request, env) {
  const url = new URL(request.url);
  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get("d") || "7", 10) || 7));
  const now = Date.now();
  const from = kstDay(now - (days - 1) * 86400e3);
  await ensure(env.DB);
  const q = (sql, ...b) => env.DB.prepare(sql).bind(from, ...b).all().then(r => r.results || []);
  const [tot] = await q(`SELECT COUNT(*) pv, COUNT(DISTINCT vid) uv, SUM(entry) visits FROM hits WHERE day>=?`);
  const [today] = await env.DB.prepare(`SELECT COUNT(DISTINCT vid) uv FROM hits WHERE day=?`).bind(kstDay(now)).all().then(r => r.results || [{}]);
  const daily = await q(`SELECT day, COUNT(DISTINCT vid) uv, COUNT(*) pv FROM hits WHERE day>=? GROUP BY day ORDER BY day`);
  const types = await q(`SELECT src_type t, COUNT(*) n FROM hits WHERE day>=? AND entry=1 GROUP BY src_type ORDER BY n DESC`);
  const sources = await q(`SELECT src_type t, src_name s, COUNT(*) n FROM hits WHERE day>=? AND entry=1 GROUP BY src_type, src_name ORDER BY n DESC LIMIT 30`);
  const kws = await q(`SELECT keyword k, src_name s, COUNT(*) n FROM hits WHERE day>=? AND keyword<>'' GROUP BY keyword, src_name ORDER BY n DESC LIMIT 30`);
  const camps = await q(`SELECT src_name s, campaign c, COUNT(*) n FROM hits WHERE day>=? AND src_type='campaign' AND entry=1 GROUP BY src_name, campaign ORDER BY n DESC LIMIT 20`);
  const pages = await q(`SELECT path p, COUNT(*) n FROM hits WHERE day>=? GROUP BY path ORDER BY n DESC LIMIT 20`);
  const landing = await q(`SELECT path p, COUNT(*) n FROM hits WHERE day>=? AND entry=1 GROUP BY path ORDER BY n DESC LIMIT 10`);
  const siteq = await q(`SELECT site_q k, COUNT(*) n FROM hits WHERE day>=? AND site_q<>'' GROUP BY site_q ORDER BY n DESC LIMIT 20`);
  const devices = await q(`SELECT device d, COUNT(DISTINCT vid) n FROM hits WHERE day>=? GROUP BY device ORDER BY n DESC`);
  const recent = await q(`SELECT ts, path, src_type, src_name, keyword, campaign, device FROM hits WHERE day>=? AND entry=1 ORDER BY ts DESC LIMIT 30`);

  const entries = types.reduce((s, r) => s + r.n, 0);
  const byDay = Object.fromEntries(daily.map(r => [r.day, r]));
  const allDays = [];
  for (let i = days - 1; i >= 0; i--) allDays.push(kstDay(now - i * 86400e3));
  const maxPv = Math.max(1, ...daily.map(r => r.pv));
  const chartDays = allDays.slice(-60);
  const chart = `<div class="legend"><span><i style="background:#1f4d3f"></i>방문자</span><span><i style="background:#cfe0d6"></i>페이지뷰</span></div><div class="chart">` +
    chartDays.map(d => { const r = byDay[d] || { uv: 0, pv: 0 }; return `<div class="c" title="${d} 방문자 ${r.uv}명, 페이지뷰 ${r.pv}회"><div class="p" style="height:${100 * (r.pv - r.uv) / maxPv}%"></div><div class="v" style="height:${100 * r.uv / maxPv}%"></div><small>${d.slice(5).replace("-", "/")}</small></div>`; }).join("") + `</div>`;
  const tag = t => `<span class="tag ${esc(t)}">${esc(TYPE_LABEL[t] || t)}</span>`;
  const tabs = [[1, "오늘"], [7, "최근 7일"], [30, "최근 30일"], [90, "최근 90일"]].map(([d, l]) => `<a class="${d === days ? "on" : ""}" href="/stats?d=${d}">${l}</a>`).join("");
  const time = ts => new Date(ts + 9 * 3600e3).toISOString().slice(5, 16).replace("T", " ");

  const body = `<h1>방문 통계</h1><p class="muted small">한국 시간 기준 · ${from} ~ ${kstDay(now)} · 검색엔진 로봇은 빼고 셉니다.</p>
<nav class="tabs">${tabs}</nav>
<section class="kpi"><div><span>오늘 방문자</span><strong>${num(today.uv)}명</strong></div><div><span>기간 방문자 (중복 제외)</span><strong>${num(tot.uv)}명</strong></div>
<div><span>방문 횟수</span><strong>${num(tot.visits)}회</strong></div><div><span>페이지뷰</span><strong>${num(tot.pv)}회</strong></div></section>
<section class="card"><h2>날짜별 방문자</h2>${chart}</section>
<div class="grid">
<section class="card"><h2>어떻게 들어왔나 (유입 경로)</h2>${rows(types, [["경로", r => tag(r.t)], ["방문", r => num(r.n) + "회", 1], ["비율", r => Math.round(100 * r.n / Math.max(1, entries)) + "%", 1]], Math.max(1, entries))}
<p class="small muted">검색 포털 = 네이버·구글·다음 등 검색 결과에서 클릭 · 직접 방문 = 주소를 직접 치거나 즐겨찾기·카톡 앱 안 링크 등 출처가 안 남는 경우 · 배너·광고 링크 = 아래 '추적 링크 만들기'로 만든 주소로 들어온 경우</p></section>
<section class="card"><h2>어디서 들어왔나 (포털·사이트별)</h2>${rows(sources, [["출처", r => `${tag(r.t)} ${esc(r.s)}`], ["방문", r => num(r.n) + "회", 1]], Math.max(1, sources[0] ? sources[0].n : 1))}</section>
</div>
<div class="grid">
<section class="card"><h2>검색어 (포털에서 친 말)</h2>${rows(kws, [["검색어", r => esc(r.k)], ["포털", r => esc(r.s)], ["방문", r => num(r.n) + "회", 1]])}
<p class="note">구글은 개인정보 보호 때문에 검색어를 넘겨주지 않습니다. 네이버·다음도 브라우저에 따라 빠질 수 있습니다. 정확한 검색어 통계는 <a href="https://search.google.com/search-console" target="_blank" rel="noopener">구글 서치 콘솔</a>과 <a href="https://searchadvisor.naver.com/" target="_blank" rel="noopener">네이버 서치어드바이저</a>에 사이트를 등록하면 '검색어별 노출·클릭 수'로 볼 수 있습니다.</p></section>
<section class="card"><h2>배너·광고 링크별</h2>${rows(camps, [["어디에 건 링크", r => esc(r.s)], ["배너 이름", r => esc(r.c || "-")], ["방문", r => num(r.n) + "회", 1]])}
<h2 style="margin-top:18px">추적 링크 만들기</h2><p class="small muted">블로그 글, 카페, 배너에 이 주소를 걸면 어느 배너로 들어왔는지 위 표에 따로 나옵니다.</p>
<div class="linkmaker"><input id="lm-p" value="/" placeholder="연결할 페이지 (예: /funeral/index.html)"><input id="lm-s" placeholder="어디에 거나요 (예: 네이버블로그)"><input id="lm-c" placeholder="배너 이름 (예: 10월_장례식장글)"><button type="button" id="lm-go">만들기</button></div>
<div id="lm-out" hidden></div></section>
</div>
<div class="grid">
<section class="card"><h2>많이 본 페이지</h2>${rows(pages, [["페이지", r => `<a href="${esc(r.p)}" target="_blank">${esc(r.p)}</a>`], ["조회", r => num(r.n) + "회", 1]])}</section>
<section class="card"><h2>처음 들어온 페이지</h2>${rows(landing, [["페이지", r => `<a href="${esc(r.p)}" target="_blank">${esc(r.p)}</a>`], ["방문", r => num(r.n) + "회", 1]])}
<h2 style="margin-top:18px">사이트 안에서 검색한 말</h2>${rows(siteq, [["검색어", r => esc(r.k)], ["횟수", r => num(r.n) + "회", 1]])}
<h2 style="margin-top:18px">기기</h2>${rows(devices, [["기기", r => esc(r.d)], ["방문자", r => num(r.n) + "명", 1]])}</section>
</div>
<section class="card"><h2>최근 방문 30건</h2>${rows(recent, [["시각", r => time(r.ts)], ["경로", r => `${tag(r.src_type)} ${esc(r.src_name)}`], ["검색어·배너", r => esc(r.keyword || r.campaign || "")], ["처음 본 페이지", r => esc(r.path)], ["기기", r => esc(r.device)]])}</section>
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
