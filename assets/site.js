/* 방문 기록 (자체 통계, 개인 식별 정보 없음) */
(function () {
  try {
    if (location.protocol.indexOf("http") !== 0 || /^(localhost|127\.)/.test(location.hostname)) return;
    function subName() {
      var id = decodeURIComponent((location.hash || "").slice(1));
      if (!id) return "";
      var el = document.getElementById(id), h = el && el.querySelector("h3, h2");
      return h ? h.textContent.replace(/\s+/g, " ").replace(/\s*(공설|사설)\s*$/, "").trim() : "";
    }
    function send(extra) {
      var d = { u: location.pathname + location.search, r: document.referrer || "", t: document.title, s: subName() };
      for (var k in extra) d[k] = extra[k];
      var body = JSON.stringify(d);
      var ok = navigator.sendBeacon && navigator.sendBeacon("/api/hit", new Blob([body], { type: "application/json" }));
      if (!ok && window.fetch) fetch("/api/hit", { method: "POST", body: body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(function () {});
    }
    var start = function () { send({}); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
    window.addEventListener("hashchange", function () { if (subName()) send({ h: 1 }); });
    window.__track = function (ev, label) { send({ ev: ev, s: label || "" }); };
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a, button");
      if (!a) return;
      var href = a.getAttribute("href") || "", ev = "";
      if (/^tel:/.test(href)) ev = "tel";
      else if (/map\.naver\.com|map\.kakao\.com|maps\.google/.test(href)) ev = "map";
      else if (/^sms:/.test(href)) ev = "sms";
      else if (a.id === "bg-copy" || a.id === "bg-copy2") ev = "copy";
      else if (a.id === "jb-print" || a.id === "ch-print") ev = "print";
      else if (/^https?:/.test(href) && href.indexOf(location.host) < 0) ev = a.closest(".facility-block, .fn-card") ? "home" : "ext";
      if (!ev) return;
      var box = a.closest(".facility-block, .fn-card, article"), h = box && box.querySelector("h1, h3, h2");
      var label = h ? h.textContent.replace(/\s+/g, " ").replace(/\s*(공설|사설)\s*$/, "").trim() : (ev === "ext" ? href.replace(/^https?:\/\//, "").split("/")[0] : document.title.split("|")[0].trim());
      send({ ev: ev, s: label });
    }, true);
  } catch (e) {}
})();

/* 글자 크기 */
(function () {
  var root = document.documentElement;
  var btns = Array.prototype.slice.call(document.querySelectorAll(".fs-ctl button"));
  function mark() {
    var cur = root.getAttribute("data-fs") || "";
    btns.forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-fs") === cur ? "true" : "false"); });
  }
  btns.forEach(function (b) {
    b.addEventListener("click", function () {
      var v = b.getAttribute("data-fs");
      if (v) root.setAttribute("data-fs", v); else root.removeAttribute("data-fs");
      try { localStorage.setItem("fs", v); } catch (e) {}
      mark();
    });
  });
  mark();
})();

/* 검색 */
(function () {
  if (!document.getElementById("search-form")) return;
  var AMEN = { parking_lot: "주차장", restaurant: "식당", store: "매점", waiting_room: "유족대기실", accessible: "장애인 편의" };
  var PAGE = 50;
  var data = [], shown = PAGE;
  var $ = function (id) { return document.getElementById(id); };
  var q = $("sq"), sido = $("ssido"), kind = $("skind"), pmax = $("spmax"), sort = $("ssort"), cat = $("scat");
  var CAT = { b: "봉안당", f: "장례식장", c: "화장장" };
  var boxes = Array.prototype.slice.call(document.querySelectorAll("#search-form input[type=checkbox]"));

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function won(n) { var m = n / 10000; return (m >= 1 ? (Math.round(m * 10) / 10).toLocaleString() + "만 원" : n.toLocaleString() + "원"); }
  function norm(s) { return String(s || "").replace(/\s+/g, "").toLowerCase(); }

  function readUrl() {
    var p = new URLSearchParams(location.search);
    q.value = p.get("q") || "";
    sido.value = p.get("sido") || "";
    kind.value = p.get("kind") || "";
    if (cat) cat.value = p.get("cat") || "";
    if (pmax) pmax.value = p.get("pmax") || "";
    if (sort) sort.value = p.get("sort") || "";
    var f = (p.get("f") || "").split(",");
    boxes.forEach(function (b) { b.checked = f.indexOf(b.value) >= 0; });
  }
  function writeUrl() {
    var p = new URLSearchParams();
    if (q.value) p.set("q", q.value);
    if (sido.value) p.set("sido", sido.value);
    if (kind.value) p.set("kind", kind.value);
    if (cat && cat.value) p.set("cat", cat.value);
    if (pmax && pmax.value) p.set("pmax", pmax.value);
    if (sort && sort.value) p.set("sort", sort.value);
    var f = boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
    if (f.length) p.set("f", f.join(","));
    var s = p.toString();
    history.replaceState(null, "", s ? "?" + s : location.pathname);
  }

  function render() {
    var terms = norm(q.value) ? q.value.trim().split(/\s+/).map(norm) : [];
    var need = boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
    var list = data.filter(function (d) {
      if (sido.value && d.s !== sido.value) return false;
      if (kind.value && d.k !== kind.value) return false;
      if (cat && cat.value && (d.c || "b") !== cat.value) return false;
      for (var i = 0; i < need.length; i++) if (d.f.indexOf(need[i]) < 0) return false;
      if (pmax && pmax.value && (d.c || !(d.pr && d.pr <= Number(pmax.value) * 10000))) return false;
      if (terms.length) {
        var hay = norm(d.n + d.s + d.g + d.a);
        for (var j = 0; j < terms.length; j++) if (hay.indexOf(terms[j]) < 0) return false;
      }
      return true;
    });
    if (sort && sort.value === "price") list.sort(function (a, b) { return (a.pr || 1e15) - (b.pr || 1e15); });
    $("result-count").textContent = "검색 결과 " + list.length.toLocaleString() + "곳";
    var html = list.slice(0, shown).map(function (d) {
      var badge = d.k === "공설" ? "pub" : d.k === "사설" ? "pri" : "etc";
      var chips = d.f.map(function (k) { return '<span class="chip">' + esc(AMEN[k] || k) + "</span>"; }).join("");
      var c = d.c || "b";
      var unit = c === "b" ? "부터" : c === "f" ? " (빈소 1일)" : " (관내 화장료)";
      return '<a class="result cat-' + c + '" href="../' + esc(d.u || ('facility/' + d.i + '.html')) + '"><span class="cat-tag">' + CAT[c] + '</span><strong>' + esc(d.n) + '</strong><span class="badge ' + badge + '">' + esc(d.k) +
        '</span><span class="addr">' + esc(d.a || (d.s + " " + d.g)) + (d.p ? " · 최초 안치 " + esc(d.p) + "년" : "") + (d.pr ? " · <strong>" + won(d.pr) + unit + "</strong>" : "") + "</span>" +
        (chips ? '<div style="margin-top:6px">' + chips + "</div>" : "") + "</a>";
    }).join("");
    if (list.length > shown) html += '<button class="more" type="button" id="more">더 보기 (' + (list.length - shown).toLocaleString() + "곳 남음)</button>";
    $("results").innerHTML = html || '<p class="muted">조건에 맞는 시설이 없습니다. 검색어를 줄이거나 조건을 바꿔 보세요.</p>';
    var more = $("more");
    if (more) more.onclick = function () { shown += PAGE; render(); };
  }

  function update() { shown = PAGE; writeUrl(); render(); }

  fetch("../assets/search.json").then(function (r) { return r.json(); }).then(function (d) {
    data = d; readUrl(); render();
    q.addEventListener("input", update);
    [sido, kind, pmax, sort, cat].filter(Boolean).concat(boxes).forEach(function (el) { el.addEventListener("change", update); });
  }).catch(function () {
    if (sort && sort.value === "price") list.sort(function (a, b) { return (a.pr || 1e15) - (b.pr || 1e15); });
    $("result-count").textContent = "데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
  });
})();

/* 업체별 가격 비교 표 */
(function () {
  var table = document.getElementById("cf-table");
  if (!table) return;
  var tbody = table.tBodies[0];
  var rows = Array.prototype.slice.call(tbody.rows);
  var sido = document.getElementById("cf-sido"), kind = document.getElementById("cf-kind"), q = document.getElementById("cf-q");
  var count = document.getElementById("cf-count");

  function filter() {
    var n = 0, t = (q.value || "").replace(/\s+/g, "").toLowerCase();
    rows.forEach(function (r) {
      var ok = (!sido.value || r.dataset.sido === sido.value) && (!kind.value || r.dataset.kind === kind.value) &&
        (!t || r.cells[0].textContent.replace(/\s+/g, "").toLowerCase().indexOf(t) >= 0);
      r.style.display = ok ? "" : "none";
      if (ok) n++;
    });
    count.textContent = n.toLocaleString() + "곳 표시 중";
  }

  var heads = Array.prototype.slice.call(table.tHead.rows[0].cells);
  heads.forEach(function (th, idx) {
    var type = th.getAttribute("data-sort");
    if (!type) return;
    th.style.cursor = "pointer";
    th.setAttribute("role", "button");
    th.title = "눌러서 정렬";
    var asc = true;
    th.addEventListener("click", function () {
      heads.forEach(function (h) { h.classList.remove("sorted-asc", "sorted-desc"); });
      th.classList.add(asc ? "sorted-asc" : "sorted-desc");
      rows.sort(function (a, b) {
        var x = a.cells[idx], y = b.cells[idx];
        if (type === "num") {
          var vx = x.dataset.v === "" ? Infinity : Number(x.dataset.v), vy = y.dataset.v === "" ? Infinity : Number(y.dataset.v);
          if (vx === Infinity && vy === Infinity) return 0;
          if (vx === Infinity) return 1;
          if (vy === Infinity) return -1;
          return asc ? vx - vy : vy - vx;
        }
        return asc ? x.textContent.localeCompare(y.textContent, "ko") : y.textContent.localeCompare(x.textContent, "ko");
      });
      rows.forEach(function (r) { tbody.appendChild(r); });
      asc = !asc;
    });
  });
  [sido, kind].forEach(function (el) { el.addEventListener("change", filter); });
  q.addEventListener("input", filter);
  filter();
})();

/* 예산 추천 */
(function () {
  if (!document.getElementById("rec-form")) return;
  var AMEN = { parking_lot: "주차장", restaurant: "식당", store: "매점", waiting_room: "유족대기실", accessible: "장애인 편의" };
  var $ = function (id) { return document.getElementById(id); };
  var budget = $("rb"), type = $("rt"), sido = $("rs"), kind = $("rk"), order = $("ro"), err = $("rerr");
  var boxes = Array.prototype.slice.call(document.querySelectorAll(".rec-amen input[type=checkbox]"));
  var data = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function won(n) { var m = n / 10000; return m >= 1 ? (Math.round(m * 10) / 10).toLocaleString() + "만 원" : n.toLocaleString() + "원"; }

  function pick(d) {
    var t = type.value;
    if (t === "single") return d.ps ? { p: d.ps, n: d.psn, l: "개인단" } : null;
    if (t === "couple") return d.pc ? { p: d.pc, n: d.pcn, l: "부부단" } : null;
    var c = [];
    if (d.ps) c.push({ p: d.ps, n: d.psn, l: "개인단" });
    if (d.pc) c.push({ p: d.pc, n: d.pcn, l: "부부단" });
    if (d.po) c.push({ p: d.po, n: d.pon, l: "기타" });
    c.sort(function (a, b) { return a.p - b.p; });
    return c[0] || null;
  }

  function card(x, limit) {
    var d = x.d, badge = d.k === "공설" ? "pub" : d.k === "사설" ? "pri" : "etc";
    var chips = d.f.map(function (k) { return '<span class="chip">' + esc(AMEN[k] || k) + "</span>"; }).join("");
    var gap = limit - x.m.p;
    var gapTxt = gap >= 0 ? "예산보다 " + won(gap) + " 적음" : "예산보다 " + won(-gap) + " 많음";
    var tel = d.t ? '<a class="btn" href="tel:' + esc(d.t.replace(/[^0-9+]/g, "")) + '">전화</a>' : "";
    return '<div class="result rec-card">' +
      '<div class="rec-top"><div><a class="rec-name" href="../' + esc(d.u) + '"><strong>' + esc(d.n) + '</strong></a> <span class="badge ' + badge + '">' + esc(d.k) + "</span>" +
      '<span class="addr">' + esc(d.s + " " + d.g) + (d.mp ? " · 최대 " + esc(d.mp) + "년" : "") + "</span></div>" +
      '<div class="rec-price"><span class="rec-amount">' + won(x.m.p) + '</span><span class="muted small">' + esc(x.m.l) + " · " + gapTxt + "</span></div></div>" +
      (x.m.n ? '<p class="small muted rec-item">상품: ' + esc(x.m.n) + "</p>" : "") +
      (d.mg ? '<p class="small rec-item">관리비 ' + won(d.mg) + " 별도 확인</p>" : "") +
      (chips ? '<div class="rec-chips">' + chips + "</div>" : "") +
      '<div class="actions"><a class="btn primary" href="../' + esc(d.u) + '">상세 가격표 보기</a>' + tel + "</div></div>";
  }

  function run() {
    err.textContent = "";
    var b = Number(budget.value);
    if (!budget.value || !(b > 0)) {
      err.textContent = "예산을 만 원 단위 숫자로 입력해 주세요. (예: 300)";
      budget.focus();
      return;
    }
    var limit = b * 10000;
    var need = boxes.filter(function (x) { return x.checked; }).map(function (x) { return x.value; });
    var pool = [];
    data.forEach(function (d) {
      if (sido.value && d.s !== sido.value) return;
      if (kind.value && d.k !== kind.value) return;
      for (var i = 0; i < need.length; i++) if (d.f.indexOf(need[i]) < 0) return;
      var m = pick(d);
      if (m) pool.push({ d: d, m: m });
    });
    var fit = pool.filter(function (x) { return x.m.p <= limit; });
    var over = pool.filter(function (x) { return x.m.p > limit && x.m.p <= limit * 1.15; }).sort(function (a, c) { return a.m.p - c.m.p; });
    fit.forEach(function (x) {
      var amen = x.d.f.length, mp = x.d.mp || 0;
      x.score = amen * 2 + (mp >= 45 ? 2 : mp >= 30 ? 1 : 0) + (x.m.p <= limit * 0.8 ? 1 : 0) + (x.d.mg ? 0.3 : 0);
    });
    if (order.value === "cheap") fit.sort(function (a, c) { return a.m.p - c.m.p; });
    else if (order.value === "near") fit.sort(function (a, c) { return (limit - a.m.p) - (limit - c.m.p); });
    else fit.sort(function (a, c) { return c.score - a.score || a.m.p - c.m.p; });

    var label = type.value === "couple" ? "부부단" : type.value === "single" ? "개인단" : "가장 저렴한 상품";
    var avg = fit.length ? Math.round(fit.reduce(function (s, x) { return s + x.m.p; }, 0) / fit.length) : 0;
    $("rec-summary").innerHTML = fit.length
      ? '<p class="lead">예산 ' + won(limit) + " 안에 드는 곳은 <strong>" + fit.length.toLocaleString() + "곳</strong>입니다. (" + label + " 기준, 평균 " + won(avg) + ")</p>"
      : '<p class="lead">예산 ' + won(limit) + " 안에 드는 곳이 없습니다. 예산을 늘리거나 지역·조건을 넓혀 보세요.</p>";
    $("rec-results").innerHTML = fit.slice(0, 30).map(function (x) { return card(x, limit); }).join("") +
      (fit.length > 30 ? '<p class="muted small">상위 30곳만 보여 줍니다. 조건을 좁히면 더 정확해집니다.</p>' : "");
    $("rec-over").innerHTML = over.length
      ? '<h2 class="rec-h">예산을 조금 넘는 곳 (15% 이내)</h2><div class="results">' + over.slice(0, 5).map(function (x) { return card(x, limit); }).join("") + "</div>"
      : "";
    var p = new URLSearchParams({ b: budget.value, t: type.value });
    if (sido.value) p.set("s", sido.value);
    if (kind.value) p.set("k", kind.value);
    if (need.length) p.set("f", need.join(","));
    if (order.value !== "best") p.set("o", order.value);
    history.replaceState(null, "", "?" + p.toString());
  }

  function readUrl() {
    var p = new URLSearchParams(location.search);
    if (p.get("b")) budget.value = p.get("b");
    if (p.get("t")) type.value = p.get("t");
    if (p.get("s")) sido.value = p.get("s");
    if (p.get("k")) kind.value = p.get("k");
    if (p.get("o")) order.value = p.get("o");
    var f = (p.get("f") || "").split(",");
    boxes.forEach(function (x) { x.checked = f.indexOf(x.value) >= 0; });
    return !!p.get("b");
  }

  budget.addEventListener("input", function () { err.textContent = ""; });
  budget.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); if (data) run(); } });
  fetch("../assets/search.json").then(function (r) { return r.json(); }).then(function (d) {
    data = d;
    $("rgo").addEventListener("click", run);
    [type, sido, kind, order].concat(boxes).forEach(function (el) { el.addEventListener("change", function () { if (budget.value) run(); }); });
    if (readUrl()) run();
  }).catch(function () { err.textContent = "데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."; });
})();
/* 음력 변환: korean-lunar-calendar 0.4.0 (MIT, (c) 2022 Jinil Lee) */
(function(){
var LUNAR_CALENDAR_DATA = {
KOREAN_LUNAR_MIN_VALUE: 10000101,KOREAN_LUNAR_MAX_VALUE: 20501118,KOREAN_SOLAR_MIN_VALUE: 10000213,KOREAN_SOLAR_MAX_VALUE: 20501231,KOREAN_LUNAR_BASE_YEAR: 1e3,SOLAR_LUNAR_DAY_DIFF: 43,LUNAR_SMALL_MONTH_DAY: 29,LUNAR_BIG_MONTH_DAY: 30,SOLAR_SMALL_YEAR_DAY: 365,SOLAR_BIG_YEAR_DAY: 366,SOLAR_DAYS: [31,28,31,30,31,30,31,31,30,31,30,31,29],KOREAN_CHEONGAN: [44049,51012,48337,51221,47924,44592,44221,49888,51076,44228].map((c) => String.fromCharCode(c)),KOREAN_GANJI: [51088,52629,51064,47896,51652,49324,50724,48120,49888,50976,49696,54644].map((c) => String.fromCharCode(c)),KOREAN_GAPJA_UNIT: [45380,50900,51068].map((c) => String.fromCharCode(c)),CHINESE_CHEONGAN: [30002,20057,19993,19969,25098,24049,24218,36763,22764,30328].map((c) => String.fromCharCode(c)),CHINESE_GANJI: [23376,19985,23493,21359,36784,24051,21320,26410,30003,37193,25100,20133].map((c) => String.fromCharCode(c)),CHINESE_GAPJA_UNIT: [24180,26376,26085].map((c) => String.fromCharCode(c)),INTERCALATION_STR: [50980, 38287].map((c) => String.fromCharCode(c)),KOREAN_LUNAR_DATA: [2194016855,2197734699,2193886506,2194017621,3271595437,2193884522,2194016621,2197837021,3267626157,2193885773,2197827149,2193885990,3271600982,2194016981,2193883994,2197842298,3267758427,2193884315,2197834395,2193885771,3271674533,2193884842,2194016981,2197852893,3267625653,2194016599,2197705902,2194017431,3267626571,2197759306,2194017705,2197857974,3267757677,2193883758,2197907758,2193885486,3267628182,2197835157,2193886538,2197867881,3267627864,2194148715,2197918315,2193883741,3267627307,2197838507,2193885845,2193886026,3271696043,2193883861,2197927258,2194015419,3267625563,2197845303,2193884459,2193884821,3271571285,2193884842,2198063797,2193883765,3267626166,2197850718,2193885782,2193886502,3271581350,2194017621,2193884586,2197822826,3267758445,2197861551,2193884317,2193885773,3271589165,2193885862,2194017109,2197833173,3267625818,2194016605,2197885299,2193884251,3271596623,2193884747,2193885861,2197842793,3267757749,2193883866,2197826230,2194016567,3271476375,2194017431,2193884747,2197718698,3267759525,2193884596,2198030957,2193883822,3267628641,2197826862,2193886358,2197855565,2193886538,2194017637,2197906837,2194015581,3267625581,2197826141,2193885483,2197858967,3267627669,2193886026,2197850970,2194016981,3267757403,2197832375,2193884247,2193884459,3271564587,2193884821,2197853997,2193884586,3267758773,2197837037,2193884342,2194016855,3271504974,2193886502,2197929618,2194017621,3267626410,2197850554,2194016621,2193884334,3271576221,2193885773,2193886501,2197827365,3267627860,2198056297,2193883866,2194016605,3271648411,2193884315,2193885771,2197834571,3267626661,2197863251,2193884852,2194016950,3271657814,2194016663,2193884311,2197833367,3267626315,2197735077,2194017701,2193884588,3271797429,2193883758,2193885486,2197843118,3267628182,2193886538,2197827402,2194017621,3271603563,2194015579,2193883741,2197846333,3267627303,2193885845,2197904661,2193886026,3267758933,2197885653,2194015451,2197721694,3267758679,2193884459,2197842603,2193884821,3267626666,2197830570,2194016949,2197861559,3267626158,2194016855,2197714222,2193886502,3267759763,2197837525,2193884586,2194016693,3271566701,2193884334,2197924429,2193885773,3267628326,2197843301,2193886034,2194017642,3271567066,2194016605,2197931165,2193884315,3267627595,2197850795,2193884837,2193886036,3271576500,2194016950,2194016603,2197824823,3267626135,2197853775,2193884491,2193884837,3271653061,2193884588,2194016950,2197895278,3267627310,2197867671,2193886358,2193886538,3271593386,2194017109,2193884522,2197969627,3267625565,2193885486,2197826859,2193885845,3271597389,2193885994,2194017109,2197845365,3267626202,2194016859,2197833047,2193884459,3271674515,2193884819,2193884842,2197850842,3267758821,2193884342,2197834414,2194016855,3267626279,2197759270,2194017875,2197857995,3267626410,2194015661,2197906605,2193884334,3267627598,2197835085,2193886502,2197863763,3267627858,2194017130,2197919082,2194015575,3267626141,2197903899,2193885771,2193885861,3271564965,2193886034,2197863258,2194016950,3267758427,2197841079,2193884311,2193884747,3271571275,2193884837,2197862067,2193884588,3267758774,2197914285,2193884318,2193885773,3271581003,2193885989,2193886034,2197892690,3267758938,2197858654,2194016603,2193884315,3271584343,2193885771,2193885861,2197834661,3267626708,2197867222,2194016950,2194016567,2197849247,2193884311,2193884747,2197706442,3267759525,2193884586,2197822828,2194016878,3271604527,2193885486,2193886358,2197847381,3267628362,2194017621,2197894485,2193884522,3267758701,2197822045,2193885483,2197850715,3267627669,2193885994,2197904170,2194016981,3267626202,2197822650,2194016855,2197853487,3267626279,2193884819,2197845683,2193884842,3267758773,2197828981,2193884342,2197867111,3267627566,2193886486,2197851798,2193886538,3267759530,2197837290,2194015597,2193884334,3271632989,2193885741,2197859607,2193885861,3267627858,2197847412,2194016986,2194015581,3271570747,2193884251,2193885739,2197887531,3267627685,2197855061,2193884850,2194016982,3271644470,2194016567,2193884247,2197830231,3267626283,2197727910,2194017685,2193884586,3271654060,2194016878,2193884462,2197830830,3267627606,2197863723,2193886506,2194017621,3271595437,2193884522,2194016877,2197837149,3267626283,2193885837,2197827157,2193885994,3271600982,2194016981,2193884378,2197842554,3267758679,2193884443,2197899799,2193884755,3271673513,2193884586,2194016949,2197852861,3267625654,2194016823,2197706030,2193886486,2194017867,2197698386,2194017706,2197927348,3267757421,2193883822,2197846589,2193885741,3267628309,2197835157,2193886034,2197867369,3267758810,2194015581,2197918299,2193884251,3267627563,2197838507,2193885845,2193886034,3271564970,2194016950,2197865819,2194015415,3267626071,2197845303,2193884459,2193884821,3271640725,2193884586,2197867189,2194016878,3267626158,2197850718,2193885782,2193886506,3271585450,2194017621,2193884522,2197891418,3267758429,2197861551,2193884315,2193885773,3271589165,2193885994,2194017109,2197833173,3267625690,2194016603,2197885271,2193884315,3271596623,2193884747,2193884841,2197842666,3267757749,2193883830,2197826222,2194016567,3271537814,2193886358,2194017867,2197714610,3267759530,2194015661,2197828461,2193883758,3267627310,2197826861,2193886357,2197855565,3267627850,2194017129,2197906778,2194015579,3267625565,2197826139,2193885483,2197858967,3267626645,2193885002,2197850970,2194016950,3267757371,2197832375,2193883735,2193884459,3271564587,2193884821,2197853869,2193884586,3267758773,2197837037,2193884334,2194016855,3271504974,2193886506,2197929364,2194017109,2193884522,2197846394,2194016605,2193884334,3271576219,2193885773,2193886501,2197887658,3267758933,2197853549,2193883866,2194016603,3271578807,2193884311,2193885771,2197834571,3267626665,2197867221,2194015669,2193883830,3271592286,2194016559,2193884311,2197702294,3267628362,2197868197,2194017641,2194015597,3271664309,2193883758,2193885486,2197843117,3267628181,2193886538,2197827402,2194017113,3271607661,2194015579,2193883741,2197846331,3267627307,2193885845,2197904149,2193884874,3267758805,2197885622,2194015419,2197852767,3267625559,2193884459,2197711530,2194017941,3267626666,2197830570,2194016949,2197861559,3267626158,2194016855,2197714221,2193886502,3267759509,2197837269,2193884522,2194016621,3271566685,2193884334,2197858895,2193885773,3267628325,2197843305,2194017109,2193883994,3271568058,2194016603,2197931163,2193884311,3267627595,2197850923,2193884837,2193884884,3271772853,2193883830,2194016567,2197824815,3267626135,2197722702,2193886538,2194017957,3271648937,2194015597,2193883830,2197895262,3267627310,2197863575,2193885845,2193886538,3271593386,2194017101,2194015595,2197832411,3267625565,2193885485,2197826859,2193885845,3271596877,2193884842,2194016981,2197841269,3267757243,2193883739,2197894231,2193884459,3271539348,2194017941,2193884842,2197850842,3267758517,2193884342,2197834414,2194016847,3267495206,2197892390,2194017621,2197923241,3267626346,2194016621,2197906589,2193884318,3267627597,2197835085,2193886501,2197863763,3267627860,2194017114,2197915994,2194016603,3267626139,2197834391,2193885771,2193885861,3271564965,2193884884,2197994203,2193883830,3267758391,2197841071,2193884311,2193884747,3271440202,2194017701,2197862069,2194015597,3267625646,2197846334,2193885486,2193886358,3271646485,2193886538,2194017701,2197894485,3267626346,2197846650,2194016861,2193885485,3271584427,2193885845,2193886026,2197834666,3267758805,2193884506,2197891258,2194016859,3271587127,2193884459,2193884819,2197903125,3267626666,2194016981,2197829045,2193884342,3271592542,2193885774,2193886502,2197843622,3267628370,2194017706,2197898858,2194015597,3267626158,2197830301,2193885773,2197847339,3267627813,2193886546,2197904724,2194017114,3267757405,2197828955,2193884315,2197845591,2193885771,2193885861,2197842789,2193884882,3267758810,2197833142,2194016567,2193884311,3271571095,2193884749,2197714602,2194017701,3267626410,2197838572,2194016942,2193885486,3271572782,2193886358,2197916997,2193886538,3267759445,2197906837,2193884522,2194016877,3271574877,2193884461,2193885845,2197896341,3267627850,2197912394,2194016981,2193884506,3271645754,2194016859,2193884459,2197899799,3267626643,2197853867,2193884842,2194016949,3271582965,2193884342,2194016855,2197701934,3267628310,2194017939,2197698386,2194017706,3271652778,2194015597,2193884334,2197903901,3267627565,2193886485,2197835173,2193886034,3271597418,2194016986,2194015581,2197906075,3267626075,2193885739,2197838635,2193885845,3267627858,2197891762,2194016982,2197910870,3267757367,2193884247,2197837399,2193884459,3267626645,2197829525,2193884586,2197858998,3267758701,2193884334,2197842542,2193885782,3267628330,2197839530,2194017621,2193884586,3271572330,2194016877,2197845181,2193884331,3267627661,2197839189,2193885994,2194017109,3271574997,2193884378,2194016605,2197824855,3267626139,2197842583,2193884747,2193884841,2197834666,2194015925,2193883834,2197826230,3267758391,2197710126,2193886486,2194017867,3271448274,2194017705,2194015669,2197828461,3267625646,2193885742,2197827117,2193886357,3271585109,2193886034,2194017129,2197833178,3267757405,2193883741,2197830235,2193885739,3271654027,2193885845,2193886026,2197904170,3267758805,2194015579,2197832375,2193883735,3271595311,2193884459,2193884821,2197841621,3267626410,2194016949,2197833069,2193884334,3267758679,2197763158,2193886506,2197913226,3267759445,2193884586,2197838554,2194016605,3267626158,2197834411,2193885773,2197851435,3267627817,2194017109,2197845365,2193883866,3267758429,2197837015,2193884315,2193885771,3271637579,2193884841,2197850841,2194015925,3267625654,2197903670,2194016567,2193884311,3271444118,2193886794,2197860006,2194017705,3267757485,2197906093,2193883822,2193885486,3271580845,2193886357,2193886538,2197896522,3267758953,2197845370,2194015579,2193883741,3271579995,2193885483,2193885845,2197835157,3267627850,2194017109,2197825237,2194015579,3271582327,2193883735,2193884459,2197707434,3267759765,2193884842,2197830570,2194016949,2197849277,2193884334,2194016855,2197706061,3267628326,2194017685,2197898837,2193884522,3267758509,2197824861,2193884334,2197842523,3267627597,2193886501,2197839273,2194017109,3267626346,2197826266,2194016605,2197845179,3267626139,2193885771,2197838667,2193884841,3267627732,2197965749,2193883830,2194016603,3271566647,2193884311,2197710422,2193886794,3267759781,2197903017,2194015669,2193883830,3271637166,2193885486,2197912717,2193886357,3267628362,2197908874,2194017129,2194015597,3271639643,2193883741,2193885485,2197826859,3267627669,2197847381,2193886026,2194017109,3271644501,2194015451,2193883739,2197895255,3267626283,2197850779,2193884821,2193884842,3271584490,2194016949,2193884342,2197834414,3267758679,2193884455,2197698342,2194017685,3271587509,2193884522,2194016685,2197837021,3267626158,2193885774,2197835085,2193886501,3271593305,2193886036,2194017642,2197907802,3267758427,2193884315,2197834395,2193885771,3271600935,2193884837,2193884884,2197973877,3267625654,2194016603,2197836983,2193884311,3267626571,2197698378,2194017957,2197849817,3267757485,2193883830,2197838190,2193885486,3267628182,2197835413,2193886538,2194017701,3271567189,2193884524,2197977787,2193883741,3267627309,2197839019,2193885845,2193886026,3271637834,2194017109,2197853533,2193884346,3267758683,2197837143,2193884459,2193885845,3271576469,2193884842,2194016981,2197825205,3267626166,2197842542,2194016855,2193884455,3271448230,2194017683,2193884586,2197830506,3267758445,2197861551,2193884334,2193885773,3271650573,2193886501,2193886546,2197839316,3267758954,2194016621,2197824859,2193884315,3271588439,2193885771,2193885989,2197904165,3267626708,2194016986,2197895350]
};
var GAPJA_OFFSET = {
YEAR_CHEONGAN: 6,YEAR_GANJI: 0,MONTH_CHEONGAN: 3,MONTH_GANJI: 1,DAY_CHEONGAN: 4,DAY_GANJI: 2
};
var KoreanLunarCalendar = class {
constructor() {
this.cumulativeLunarYearDays = /* @__PURE__ */ new Map();
this.cumulativeSolarYearDays = /* @__PURE__ */ new Map();
this.solarCalendar = {
year: 0,month: 0,day: 0
};
this.lunarCalendar = {
year: 0,month: 0,day: 0,intercalation: false
};
const today = /* @__PURE__ */ new Date();
this.setSolarDate(today.getFullYear(), today.getMonth() + 1, today.getDate());
}
getLunarData(year) {
return LUNAR_CALENDAR_DATA.KOREAN_LUNAR_DATA[year - LUNAR_CALENDAR_DATA.KOREAN_LUNAR_BASE_YEAR];
}
getLunarIntercalationMonth(lunarData) {
return lunarData >> 12 & 15;
}
getLunarYearDays(year) {
return this.getLunarData(year) >> 17 & 511;
}
getLunarMonthDays(year, month, isIntercalation) {
const lunarData = this.getLunarData(year);
return (isIntercalation && this.getLunarIntercalationMonth(lunarData) === month ? (lunarData >> 16 & 1) > 0 : (lunarData >> 12 - month & 1) > 0) ? LUNAR_CALENDAR_DATA.LUNAR_BIG_MONTH_DAY : LUNAR_CALENDAR_DATA.LUNAR_SMALL_MONTH_DAY;
}
getLunarDaysBeforeBaseYear(year) {
return this.accumulateYearDays(year, this.cumulativeLunarYearDays, (y) => this.getLunarYearDays(y));
}
getLunarDaysBeforeBaseMonth(year, month, isIntercalation) {
let days = 0;
if (year >= LUNAR_CALENDAR_DATA.KOREAN_LUNAR_BASE_YEAR && month > 0) {
for (let baseMonth = 1; baseMonth < month + 1; baseMonth++) days += this.getLunarMonthDays(year, baseMonth, false);
if (isIntercalation) {
const intercalationMonth = this.getLunarIntercalationMonth(this.getLunarData(year));
if (intercalationMonth > 0 && intercalationMonth < month + 1) days += this.getLunarMonthDays(year, intercalationMonth, true);
}
}
return days;
}
getLunarAbsDays(year, month, day, isIntercalation) {
let days = this.getLunarDaysBeforeBaseYear(year - 1) + this.getLunarDaysBeforeBaseMonth(year, month - 1, true) + day;
if (isIntercalation && this.getLunarIntercalationMonth(this.getLunarData(year)) === month) days += this.getLunarMonthDays(year, month, false);
return days;
}
isSolarIntercalationYear(lunarData) {
return (lunarData >> 30 & 1) > 0;
}
getSolarYearDays(year) {
return this.isSolarIntercalationYear(this.getLunarData(year)) ? LUNAR_CALENDAR_DATA.SOLAR_BIG_YEAR_DAY : LUNAR_CALENDAR_DATA.SOLAR_SMALL_YEAR_DAY;
}
getSolarMonthDays(year, month) {
if (month === 2 && this.isSolarIntercalationYear(this.getLunarData(year))) return LUNAR_CALENDAR_DATA.SOLAR_DAYS[12];
return LUNAR_CALENDAR_DATA.SOLAR_DAYS[month - 1];
}
getSolarDaysBeforeBaseYear(year) {
return this.accumulateYearDays(year, this.cumulativeSolarYearDays, (y) => this.getSolarYearDays(y));
}
accumulateYearDays(year, cache, perYear) {
const cached = cache.get(year);
if (cached !== void 0) return cached;
const baseYear = LUNAR_CALENDAR_DATA.KOREAN_LUNAR_BASE_YEAR;
const previous = cache.get(year - 1);
let days = 0;
if (previous !== void 0 && year > baseYear) days = previous + perYear(year);
else for (let y = baseYear; y < year + 1; y++) days += perYear(y);
cache.set(year, days);
return days;
}
getSolarDaysBeforeBaseMonth(year, month) {
let days = 0;
for (let baseMonth = 1; baseMonth < month + 1; baseMonth++) days += this.getSolarMonthDays(year, baseMonth);
return days;
}
getSolarAbsDays(year, month, day) {
return this.getSolarDaysBeforeBaseYear(year - 1) + this.getSolarDaysBeforeBaseMonth(year, month - 1) + day - LUNAR_CALENDAR_DATA.SOLAR_LUNAR_DAY_DIFF;
}
setSolarDateByLunarDate(lunarYear, lunarMonth, lunarDay, isIntercalation) {
const absDays = this.getLunarAbsDays(lunarYear, lunarMonth, lunarDay, isIntercalation);
const solarYear = absDays < this.getSolarAbsDays(lunarYear + 1, 1, 1) ? lunarYear : lunarYear + 1;
let solarMonth = 0;
let solarDay = 0;
for (let month = 12; month > 0; month--) {
const absDaysByMonth = this.getSolarAbsDays(solarYear, month, 1);
if (absDays >= absDaysByMonth) {
solarMonth = month;
solarDay = absDays - absDaysByMonth + 1;
break;
}
}
this.solarCalendar = {
year: solarYear,month: solarMonth,day: solarDay
};
}
setLunarDateBySolarDate(solarYear, solarMonth, solarDay) {
const absDays = this.getSolarAbsDays(solarYear, solarMonth, solarDay);
const lunarYear = absDays >= this.getLunarAbsDays(solarYear, 1, 1, false) ? solarYear : solarYear - 1;
let lunarMonth = 0;
let lunarDay = 0;
let isIntercalation = false;
for (let month = 12; month > 0; month--) if (absDays >= this.getLunarAbsDays(lunarYear, month, 1, false)) {
lunarMonth = month;
if (this.getLunarIntercalationMonth(this.getLunarData(lunarYear)) === month) isIntercalation = absDays >= this.getLunarAbsDays(lunarYear, month, 1, true);
lunarDay = absDays - this.getLunarAbsDays(lunarYear, lunarMonth, 1, isIntercalation) + 1;
break;
}
this.lunarCalendar = {
year: lunarYear,month: lunarMonth,day: lunarDay,intercalation: isIntercalation
};
}
checkValidDate(isLunar, isIntercalation, year, month, day) {
let isValid = false;
if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
const dateValue = year * 1e4 + month * 100 + day;
if ((isLunar ? LUNAR_CALENDAR_DATA.KOREAN_LUNAR_MIN_VALUE : LUNAR_CALENDAR_DATA.KOREAN_SOLAR_MIN_VALUE) <= dateValue && (isLunar ? LUNAR_CALENDAR_DATA.KOREAN_LUNAR_MAX_VALUE : LUNAR_CALENDAR_DATA.KOREAN_SOLAR_MAX_VALUE) >= dateValue) {
if (month > 0 && month < 13 && day > 0) {
if (isLunar && isIntercalation && this.getLunarIntercalationMonth(this.getLunarData(year)) !== month) return false;
const dayLimit = isLunar ? this.getLunarMonthDays(year, month, isIntercalation) : this.getSolarMonthDays(year, month);
if (!isLunar && year === 1582 && month === 10 && day > 4 && day < 15) return false;
if (day <= dayLimit) isValid = true;
}
}
return isValid;
}
setLunarDate(lunarYear, lunarMonth, lunarDay, isIntercalation) {
let isValid = false;
if (this.checkValidDate(true, isIntercalation, lunarYear, lunarMonth, lunarDay)) {
this.lunarCalendar = {
year: lunarYear,month: lunarMonth,day: lunarDay,intercalation: isIntercalation && this.getLunarIntercalationMonth(this.getLunarData(lunarYear)) === lunarMonth
};
this.setSolarDateByLunarDate(lunarYear, lunarMonth, lunarDay, isIntercalation);
isValid = true;
}
return isValid;
}
setSolarDate(solarYear, solarMonth, solarDay) {
let isValid = false;
if (this.checkValidDate(false, false, solarYear, solarMonth, solarDay)) {
this.solarCalendar = {
year: solarYear,month: solarMonth,day: solarDay
};
this.setLunarDateBySolarDate(solarYear, solarMonth, solarDay);
isValid = true;
}
return isValid;
}
computeGapJa() {
const lunar = this.lunarCalendar;
const absDays = this.getLunarAbsDays(lunar.year, lunar.month, lunar.day, !!lunar.intercalation);
if (absDays <= 0) return {
cheongan: {
year: 0,month: 0,day: 0
},ganji: {
year: 0,month: 0,day: 0
}
};
const baseYear = LUNAR_CALENDAR_DATA.KOREAN_LUNAR_BASE_YEAR;
const cheonganLen = LUNAR_CALENDAR_DATA.KOREAN_CHEONGAN.length;
const ganjiLen = LUNAR_CALENDAR_DATA.KOREAN_GANJI.length;
const monthCount = lunar.month + 12 * (lunar.year - baseYear);
return {
cheongan: {
year: (lunar.year + GAPJA_OFFSET.YEAR_CHEONGAN - baseYear) % cheonganLen,month: (monthCount + GAPJA_OFFSET.MONTH_CHEONGAN) % cheonganLen,day: (absDays + GAPJA_OFFSET.DAY_CHEONGAN) % cheonganLen
},ganji: {
year: (lunar.year + GAPJA_OFFSET.YEAR_GANJI - baseYear) % ganjiLen,month: (monthCount + GAPJA_OFFSET.MONTH_GANJI) % ganjiLen,day: (absDays + GAPJA_OFFSET.DAY_GANJI) % ganjiLen
}
};
}
getGapJaIndex() {
return this.computeGapJa();
}
getGapja(isChinese) {
const inx = this.getGapJaIndex();
const cheongan = !isChinese ? LUNAR_CALENDAR_DATA.KOREAN_CHEONGAN : LUNAR_CALENDAR_DATA.CHINESE_CHEONGAN;
const ganji = !isChinese ? LUNAR_CALENDAR_DATA.KOREAN_GANJI : LUNAR_CALENDAR_DATA.CHINESE_GANJI;
const unit = !isChinese ? LUNAR_CALENDAR_DATA.KOREAN_GAPJA_UNIT : LUNAR_CALENDAR_DATA.CHINESE_GAPJA_UNIT;
const intercalationStr = !isChinese ? `${LUNAR_CALENDAR_DATA.INTERCALATION_STR[0]}${LUNAR_CALENDAR_DATA.KOREAN_GAPJA_UNIT[1]}` : `${LUNAR_CALENDAR_DATA.INTERCALATION_STR[1]}${LUNAR_CALENDAR_DATA.CHINESE_GAPJA_UNIT[1]}`;
return {
year: `${cheongan[inx.cheongan.year]}${ganji[inx.ganji.year]}${unit[0]}`,month: `${cheongan[inx.cheongan.month]}${ganji[inx.ganji.month]}${unit[1]}`,day: `${cheongan[inx.cheongan.day]}${ganji[inx.ganji.day]}${unit[2]}`,intercalation: this.lunarCalendar.intercalation ? intercalationStr : ""
};
}
getKoreanGapja() {
return this.getGapja();
}
getChineseGapja() {
return this.getGapja(true);
}
getLunarCalendar() {
return { ...this.lunarCalendar };
}
getSolarCalendar() {
return { ...this.solarCalendar };
}
};
window.KoreanLunarCalendar = KoreanLunarCalendar;
})();

/* 장례 도우미 (지방·명정·축문·49재·음력·부고·나이) */
(function () {
  if (!document.getElementById("jb-form") && !document.getElementById("ch-form") && !document.getElementById("jae-form") &&
      !document.getElementById("bg-form") && !document.getElementById("age-form")) return;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function val(id) { var e = $(id); return e ? e.value.trim() : ""; }
  function parseDate(s) { if (!s) return null; var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  var WEEK = "일월화수목금토";
  function fmt(d) { return d.getFullYear() + "년 " + (d.getMonth() + 1) + "월 " + d.getDate() + "일 (" + WEEK[d.getDay()] + ")"; }
  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  var Cal = window.KoreanLunarCalendar;
  function lunarOf(d) {
    if (!Cal) return null;
    var c = new Cal();
    if (!c.setSolarDate(d.getFullYear(), d.getMonth() + 1, d.getDate())) return null;
    return { l: c.getLunarCalendar(), k: c.getKoreanGapja(), h: c.getChineseGapja() };
  }
  function solarOfLunar(y, m, dd, leap) {
    if (!Cal) return null;
    var c = new Cal();
    if (!c.setLunarDate(y, m, dd, !!leap)) return null;
    var s = c.getSolarCalendar();
    return new Date(s.year, s.month - 1, s.day);
  }
  function lunarText(d) {
    var x = lunarOf(d);
    return x ? "음력 " + (x.l.intercalation ? "윤" : "") + x.l.month + "월 " + x.l.day + "일" : "";
  }
  var HN = "〇一二三四五六七八九";
  function hanNum(n) {
    if (n <= 10) return n === 10 ? "十" : HN[n];
    if (n < 20) return "十" + HN[n - 10];
    return HN[Math.floor(n / 10)] + "十" + (n % 10 ? HN[n % 10] : "");
  }
  var KN = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
  function korNum(n) {
    if (n < 10) return KN[n];
    var t = Math.floor(n / 10), o = n % 10;
    return (t > 1 ? KN[t] : "") + "십" + KN[o];
  }
  function strip(g) { return String(g || "").slice(0, 2); }

  // 성씨·본관 한자
  var SUNG = { "김": "金", "이": "李", "박": "朴", "최": "崔", "정": "鄭", "강": "姜", "조": "趙", "윤": "尹", "장": "張", "임": "林", "한": "韓", "오": "吳", "서": "徐", "신": "申",
    "권": "權", "황": "黃", "안": "安", "송": "宋", "류": "柳", "유": "柳", "홍": "洪", "전": "全", "고": "高", "문": "文", "양": "梁", "손": "孫", "배": "裵", "백": "白", "허": "許",
    "남": "南", "심": "沈", "노": "盧", "하": "河", "곽": "郭", "성": "成", "차": "車", "주": "朱", "우": "禹", "구": "具", "민": "閔", "진": "陳", "나": "羅", "지": "池", "엄": "嚴",
    "변": "卞", "채": "蔡", "원": "元", "천": "千", "방": "方", "공": "孔", "현": "玄", "함": "咸", "염": "廉", "여": "呂", "추": "秋", "도": "都", "소": "蘇", "석": "石", "선": "宣",
    "설": "薛", "마": "馬", "길": "吉", "연": "延", "위": "魏", "표": "表", "명": "明", "기": "奇", "반": "潘", "왕": "王", "금": "琴", "옥": "玉", "육": "陸", "인": "印", "맹": "孟",
    "제": "諸", "모": "牟", "탁": "卓", "국": "鞠", "어": "魚", "은": "殷", "편": "片", "용": "龍", "예": "芮", "경": "景", "봉": "奉", "태": "太", "목": "睦", "피": "皮", "두": "杜",
    "감": "甘", "빈": "賓", "동": "董", "온": "溫", "범": "范", "좌": "左", "승": "承", "상": "尙", "갈": "葛", "남궁": "南宮", "황보": "皇甫", "제갈": "諸葛", "선우": "鮮于",
    "독고": "獨孤", "사공": "司空", "서문": "西門" };
  var BON = { "김해": "金海", "밀양": "密陽", "전주": "全州", "경주": "慶州", "광산": "光山", "진주": "晉州", "청주": "淸州", "안동": "安東", "파평": "坡平", "남양": "南陽",
    "해주": "海州", "평산": "平山", "수원": "水原", "순흥": "順興", "연안": "延安", "한산": "韓山", "여흥": "驪興", "창녕": "昌寧", "달성": "達城", "인동": "仁同", "함안": "咸安",
    "김녕": "金寧", "단양": "丹陽", "청송": "靑松", "문화": "文化", "남평": "南平", "의령": "宜寧", "진양": "晉陽", "영천": "永川", "나주": "羅州", "고령": "高靈", "제주": "濟州",
    "동래": "東萊", "반남": "潘南", "풍산": "豊山", "성주": "星州", "함양": "咸陽", "장흥": "長興", "능성": "綾城", "창원": "昌原", "광주": "廣州", "청풍": "淸風", "여산": "礪山",
    "평양": "平壤", "경산": "慶山", "신안": "新安", "남원": "南原", "보성": "寶城", "곡부": "曲阜", "덕수": "德水", "양천": "陽川", "기계": "杞溪", "영산": "靈山", "강릉": "江陵",
    "충주": "忠州", "상주": "尙州", "선산": "善山", "언양": "彦陽", "진천": "鎭川", "함평": "咸平", "남해": "南海", "하동": "河東", "칠원": "漆原", "죽산": "竹山", "원주": "原州",
    "청해": "靑海", "횡성": "橫城", "금성": "錦城", "신천": "信川", "봉화": "奉化", "예안": "禮安", "개성": "開城", "온양": "溫陽", "황주": "黃州", "장수": "長水", "창원": "昌原" };
  function autoH(srcId, dstId, map) {
    var s = $(srcId), d = $(dstId);
    if (!s || !d) return;
    s.addEventListener("input", function () { var v = s.value.trim(); if (map[v]) d.value = map[v]; else if (!v) d.value = ""; });
  }

  // ---------------- 지방 ----------------
  var JB = {
    f: [["顯考{T}府君神位", "현고{t}부군신위", 0]], m: [["顯妣孺人{B}{S}氏神位", "현비유인{b}{s}씨신위", 1]],
    fm: [["顯考{T}府君神位", "현고{t}부군신위", 0], ["顯妣孺人{B}{S}氏神位", "현비유인{b}{s}씨신위", 1]],
    gf: [["顯祖考{T}府君神位", "현조고{t}부군신위", 0]], gm: [["顯祖妣孺人{B}{S}氏神位", "현조비유인{b}{s}씨신위", 1]],
    gfm: [["顯祖考{T}府君神位", "현조고{t}부군신위", 0], ["顯祖妣孺人{B}{S}氏神位", "현조비유인{b}{s}씨신위", 1]],
    ggf: [["顯曾祖考{T}府君神位", "현증조고{t}부군신위", 0]], ggm: [["顯曾祖妣孺人{B}{S}氏神位", "현증조비유인{b}{s}씨신위", 1]],
    hus: [["顯辟{T}府君神位", "현벽{t}부군신위", 0]], wife: [["亡室孺人{B}{S}氏神位", "망실유인{b}{s}씨신위", 1]],
    bro: [["顯兄{T}府君神位", "현형{t}부군신위", 0]], bsil: [["顯兄嫂孺人{B}{S}氏神位", "현형수유인{b}{s}씨신위", 1]]
  };
  function vstrip(text, cls) { return '<div class="vstrip ' + (cls || "") + '">' + esc(text).split("").map(function (c) { return "<span>" + c + "</span>"; }).join("") + "</div>"; }
  function jibang() {
    var rel = val("jb-rel"), list = JB[rel] || [], t = (val("jb-title") || "學生|학생").split("|");
    var needW = list.some(function (x) { return x[2]; });
    Array.prototype.forEach.call(document.querySelectorAll(".jb-w"), function (e) { e.style.display = needW ? "" : "none"; });
    var b = val("jb-bon") || "○○", s = val("jb-sung") || "○", B = val("jb-bon-h") || val("jb-bon") || "○○", S = val("jb-sung-h") || val("jb-sung") || "○";
    function fill(tpl) { return tpl.replace("{T}", t[0]).replace("{t}", t[1]).replace("{B}", B).replace("{S}", S).replace("{b}", b).replace("{s}", s); }
    var han = list.map(function (x) { return vstrip(fill(x[0]), "han"); }).join("");
    var kor = list.map(function (x) { return vstrip(fill(x[1]), "kor"); }).join("");
    $("jb-out").innerHTML = '<div class="jb-col"><p class="jb-cap">한자 지방</p><div class="jb-row">' + han + '</div></div><div class="jb-col"><p class="jb-cap">한글 지방</p><div class="jb-row">' + kor + "</div></div>" +
      '<p class="small muted jb-read">읽는 법: ' + esc(list.map(function (x) { return fill(x[1]); }).join(" · ")) + "</p>";
  }
  if ($("jb-form")) {
    autoH("jb-sung", "jb-sung-h", SUNG); autoH("jb-bon", "jb-bon-h", BON);
    Array.prototype.forEach.call(document.querySelectorAll("#jb-form input, #jb-form select"), function (e) { e.addEventListener("input", jibang); e.addEventListener("change", jibang); });
    jibang();
    $("jb-print").onclick = function () { document.body.setAttribute("data-print", "jb-out"); window.print(); };
  }
  // ---------------- 명정 ----------------
  function myeongjeong() {
    var f = val("mj-sex") === "f", B = val("mj-bon-h") || val("mj-bon") || "○○", S = val("mj-sung-h") || val("mj-sung") || "○";
    var b = val("mj-bon") || "○○", s = val("mj-sung") || "○", T = val("mj-title") || "學生";
    var han = f ? "孺人" + B + S + "氏之柩" : T + B + S + "公之柩";
    var kor = f ? "유인 " + b + " " + s + "씨지구" : (T === "學生" ? "학생" : T) + " " + b + " " + s + "공지구";
    $("mj-out").innerHTML = '<div class="mj-cloth">' + vstrip(han, "mj") + '</div><p>읽는 법: <strong>' + esc(kor) + "</strong></p>";
  }
  if ($("mj-form")) {
    autoH("mj-sung", "mj-sung-h", SUNG); autoH("mj-bon", "mj-bon-h", BON);
    Array.prototype.forEach.call(document.querySelectorAll("#mj-form input, #mj-form select"), function (e) { e.addEventListener("input", myeongjeong); e.addEventListener("change", myeongjeong); });
    myeongjeong();
  }

  // ---------------- 축문 ----------------
  function chukmun() {
    var rel = val("ch-rel"), d = parseDate(val("ch-date"));
    var both = rel.indexOf("-") > 0, grand = rel.indexOf("g") === 0;
    var womanIn = rel === "m" || rel === "gm" || both;
    Array.prototype.forEach.call(document.querySelectorAll(".ch-w"), function (e) { e.style.display = womanIn ? "" : "none"; });
    var out = $("ch-out");
    if (!d) { out.innerHTML = '<p class="muted">돌아가신 날(기일)을 넣으면 축문이 만들어집니다.</p>'; return; }
    var x = lunarOf(d);
    if (!x) { out.innerHTML = '<p class="err">이 날짜는 음력으로 바꿀 수 없습니다 (1000~2050년만 가능).</p>'; return; }
    var leap = x.l.intercalation, ly = x.l.year, lm = x.l.month;
    var c1 = new Cal(); c1.setLunarDate(ly, lm, 1, leap);
    var sakH = strip(c1.getChineseGapja().day), sakK = strip(c1.getKoreanGapja().day);
    var yH = strip(x.h.year), yK = strip(x.k.year), dH = strip(x.h.day), dK = strip(x.k.day);
    var B = val("ch-bon-h") || val("ch-bon") || "○○", S = val("ch-sung-h") || val("ch-sung") || "○", b = val("ch-bon") || "○○", s = val("ch-sung") || "○";
    var nameH = val("ch-name-h") || val("ch-name") || "○○", nameK = val("ch-name") || "○○";
    var who = grand ? ["孝孫", "효손"] : ["孝子", "효자"];
    var man = grand ? ["顯祖考學生府君", "현조고학생부군"] : ["顯考學生府君", "현고학생부군"];
    var wom = grand ? ["顯祖妣孺人" + B + S + "氏", "현조비유인 " + b + " " + s + "씨"] : ["顯妣孺人" + B + S + "氏", "현비유인 " + b + " " + s + "씨"];
    var targets = [], dayOf;
    if (rel === "f" || rel === "gf") { targets = [man]; dayOf = man; }
    else if (rel === "m" || rel === "gm") { targets = [wom]; dayOf = wom; }
    else { targets = [man, wom]; dayOf = /-m$/.test(rel) ? wom : man; }
    var dayOfH = dayOf[0].replace(/學生府君$|孺人.*$/, ""), dayOfK = dayOf[1].replace(/학생부군$|유인.*$/, "");
    var feel = grand ? ["不勝永慕", "불승영모"] : ["昊天罔極", "호천망극"];
    var monH = (leap ? "閏" : "") + hanNum(lm) + "月", monK = (leap ? "윤" : "") + korNum(lm) + "월";
    var lines = [
      ["維", "유"],
      ["歲次 " + yH + " " + monH + " " + sakH + "朔 " + hanNum(x.l.day) + "日 " + dH, "세차 " + yK + " " + monK + " " + sakK + "삭 " + korNum(x.l.day) + "일 " + dK],
      [who[0] + " " + nameH + " 敢昭告于", who[1] + " " + nameK + " 감소고우"]
    ].concat(targets.map(function (t) { return [t[0], t[1]]; })).concat([
      ["歲序遷易 " + dayOfH + " 諱日復臨", "세서천역 " + dayOfK + " 휘일부림"],
      ["追遠感時 " + feel[0], "추원감시 " + feel[1]],
      ["謹以 淸酌庶羞 恭伸奠獻", "근이 청작서수 공신전헌"],
      ["尙", "상"], ["饗", "향"]
    ]);
    var vert = lines.map(function (l) { return '<div class="ch-line">' + esc(l[0]).split("").map(function (ch) { return ch === " " ? '<span class="sp"></span>' : "<span>" + ch + "</span>"; }).join("") + "</div>"; }).join("");
    out.innerHTML = '<p class="small">계산 결과: 양력 ' + esc(fmt(d)) + " = 음력 " + ly + "년 " + (leap ? "윤" : "") + lm + "월 " + x.l.day + "일 · " +
      esc(yK + "년 ") + esc(sakK) + "삭 " + esc(dK) + "일</p>" +
      '<div class="ch-paper">' + vert + "</div>" +
      '<h3>한글로 읽기</h3><p class="ch-kor">' + lines.map(function (l) { return esc(l[1]); }).join("<br>") + "</p>";
  }
  if ($("ch-form")) {
    autoH("ch-sung", "ch-sung-h", SUNG); autoH("ch-bon", "ch-bon-h", BON);
    Array.prototype.forEach.call(document.querySelectorAll("#ch-form input, #ch-form select"), function (e) { e.addEventListener("input", chukmun); e.addEventListener("change", chukmun); });
    chukmun();
    $("ch-print").onclick = function () { document.body.setAttribute("data-print", "ch-out"); window.print(); };
  }
  window.addEventListener("afterprint", function () { document.body.removeAttribute("data-print"); });

  // ---------------- 49재·삼우제·기일 ----------------
  function jae() {
    var d = parseDate(val("jae-death")), out = $("jae-out");
    if (!d) { out.innerHTML = '<p class="err">돌아가신 날을 넣어 주세요.</p>'; return; }
    var burial = parseDate(val("jae-burial")) || addDays(d, 2);
    var rows = [["돌아가신 날", d], ["장례일(발인)", burial], ["삼우제", addDays(burial, 2)]];
    var names = ["초재", "이재", "삼재", "사재", "오재", "육재", "칠재 (49재)"];
    for (var i = 0; i < 7; i++) rows.push([names[i], addDays(d, 7 * (i + 1) - 1)]);
    rows.push(["100일 탈상 (백일)", addDays(d, 99)]);
    var lunar = val("jae-basis") === "lunar", x = lunarOf(d), years = [];
    for (var k = 1; k <= 10; k++) {
      var g = null;
      if (lunar && x) {
        g = solarOfLunar(x.l.year + k, x.l.month, x.l.day, false) || solarOfLunar(x.l.year + k, x.l.month, x.l.day - 1, false);
      } else g = new Date(d.getFullYear() + k, d.getMonth(), d.getDate());
      if (g) years.push([k === 1 ? "첫 기일 (1주기)" : k + "주기", g]);
    }
    function table(list, title) {
      return "<h3>" + title + '</h3><div class="table-wrap"><table class="list"><thead><tr><th>구분</th><th>양력</th><th>음력</th></tr></thead><tbody>' +
        list.map(function (r) { return "<tr><td><strong>" + esc(r[0]) + "</strong></td><td>" + esc(fmt(r[1])) + "</td><td>" + esc(lunarText(r[1])) + "</td></tr>"; }).join("") + "</tbody></table></div>";
    }
    var gj = x ? " · " + esc(strip(x.k.day)) + "일(" + esc(strip(x.h.day)) + "日)" : "";
    out.innerHTML = '<p class="lead">' + esc(fmt(d)) + " 별세 · " + esc(lunarText(d)) + gj + "</p>" + table(rows, "삼우제·49재") +
      table(years, lunar ? "기일 (음력 기준, 해마다 양력 날짜가 바뀝니다)" : "기일 (양력 기준)");
  }
  if ($("jae-form")) {
    $("jae-go").onclick = jae;
    ["jae-death", "jae-burial", "jae-basis"].forEach(function (id) { $(id).addEventListener("change", function () { if (val("jae-death")) jae(); }); });
    $("lc-go").onclick = function () {
      var y = +val("lc-y"), m = +val("lc-m"), dd = +val("lc-d"), lp = $("lc-leap").checked, g = solarOfLunar(y, m, dd, lp);
      $("lc-out").innerHTML = g ? '<p class="lead">음력 ' + y + "년 " + (lp ? "윤" : "") + m + "월 " + dd + "일 = 양력 <strong>" + esc(fmt(g)) + "</strong></p>"
        : '<p class="err">없는 날짜입니다. 윤달이 없는 해이거나 그달이 29일까지인지 확인하세요.</p>';
    };
    $("sc-go").onclick = function () {
      var d = parseDate(val("sc-date")), x = d && lunarOf(d);
      $("sc-out").innerHTML = x ? '<p class="lead">양력 ' + esc(fmt(d)) + " = <strong>" + esc(lunarText(d)) + "</strong> · " + esc(x.k.year + " " + x.k.month + " " + x.k.day) + "</p>" : '<p class="err">날짜를 확인해 주세요.</p>';
    };
    $("lc-y").value = new Date().getFullYear();
  }

  // ---------------- 나이·띠 ----------------
  var TTI = ["원숭이", "닭", "개", "돼지", "쥐", "소", "호랑이", "토끼", "용", "뱀", "말", "양"];
  if ($("age-form")) {
    $("age-base").value = iso(new Date());
    $("age-go").onclick = function () {
      var b = parseDate(val("age-birth")), t = parseDate(val("age-base")) || new Date(), out = $("age-out");
      if (!b) { out.innerHTML = '<p class="err">생년월일을 넣어 주세요.</p>'; return; }
      var man = t.getFullYear() - b.getFullYear() - ((t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) ? 1 : 0);
      var x = lunarOf(b), ly = x ? x.l.year : b.getFullYear();
      out.innerHTML = '<ul class="tips"><li>만 나이: <strong>' + man + "세</strong></li><li>세는 나이(예전 한국식): <strong>" + (t.getFullYear() - b.getFullYear() + 1) + "세</strong></li>" +
        "<li>띠: <strong>" + TTI[((ly % 12) + 12) % 12] + "띠</strong>" + (x ? " (" + esc(x.k.year) + ", 음력 생일 " + esc(lunarText(b).replace("음력 ", "")) + ")" : "") + "</li></ul>";
    };
  }

  // ---------------- 부고 문자 ----------------
  if ($("bg-form")) {
    var halls = {};
    fetch("../assets/search.json").then(function (r) { return r.json(); }).then(function (d) {
      var dl = $("bg-halls"), html = "";
      d.forEach(function (x) { if (x.c === "f") { halls[x.n] = x; html += '<option value="' + esc(x.n) + '">' + esc(x.a) + "</option>"; } });
      dl.innerHTML = html;
    }).catch(function () {});
    function dt(s) {
      if (!s) return "";
      var p = s.split("T"), d = parseDate(p[0]), tm = (p[1] || "").split(":"), h = +tm[0], mi = tm[1] || "00";
      return fmt(d) + (p[1] ? " " + (h < 12 ? "오전 " : "오후 ") + ((h % 12) || 12) + "시" + (mi !== "00" ? " " + +mi + "분" : "") : "");
    }
    function bugo() {
      var h = halls[val("bg-hall")];
      if (h && !$("bg-addr").dataset.touched) $("bg-addr").value = h.a || "";
      var name = val("bg-name") || "○○○", rel = val("bg-rel"), from = val("bg-from"), age = val("bg-age"), tone = val("bg-tone");
      var death = parseDate(val("bg-death")), dText = death ? fmt(death).replace(/ \(.\)$/, "") : "○월 ○일";
      var who = (from ? from + "님의 " : "") + (rel || "");
      var head = tone === "family" ? "[부고]\n" + (who ? who + " " : "") + name + "님께서 " + dText + " 별세하셨습니다." :
        "[부고]\n" + (who ? who + " " : "") + "故 " + name + "님께서 " + (age ? "향년 " + age + "로 " : "") + dText + " 별세하셨기에 삼가 알려 드립니다.";
      var L = [head, ""];
      var chief = val("bg-chief");
      if (chief) L.push("■ 상주\n" + chief.split(/\n+/).map(function (x) { return "  " + x.trim(); }).join("\n"));
      if (val("bg-hall")) L.push("■ 빈소: " + val("bg-hall") + (val("bg-room") ? " " + val("bg-room") : "") + (val("bg-addr") ? "\n  " + val("bg-addr") : ""));
      if (val("bg-out")) L.push("■ 발인: " + dt(val("bg-out")));
      if (val("bg-place")) L.push("■ 장지: " + val("bg-place"));
      if (val("bg-tel")) L.push("■ 연락처: " + val("bg-tel"));
      if (tone === "family") L.push("\n유족의 뜻에 따라 가족끼리 조용히 장례를 치르고자 합니다.\n조문과 부의는 정중히 사양하오니 너른 마음으로 헤아려 주시기 바랍니다.");
      else {
        if (val("bg-bank")) L.push("■ 마음 전하실 곳: " + val("bg-bank"));
        L.push(tone === "simple" ? "\n삼가 고인의 명복을 빌어 주시기 바랍니다." : "\n직접 찾아뵙고 알려 드려야 하나 경황이 없어 문자로 대신함을 너그러이 양해해 주시기 바랍니다.");
      }
      var text = L.join("\n");
      $("bg-text").textContent = text;
      $("bg-sms").href = "sms:?&body=" + encodeURIComponent(text);
      $("bg-thanks").textContent = "[감사 인사]\n" + (who ? who + " " : "") + "故 " + name + "님의 장례에 보내 주신 따뜻한 위로와 조의에 깊이 감사드립니다.\n" +
        "덕분에 장례를 잘 마쳤습니다. 직접 찾아뵙고 인사드려야 하나 문자로 먼저 감사의 마음을 전합니다.\n" +
        "보내 주신 마음 잊지 않겠습니다. 늘 건강하시고 평안하시기 바랍니다.\n" + (from ? "\n" + from + " 올림" : "");
    }
    $("bg-addr").addEventListener("input", function () { this.dataset.touched = "1"; });
    Array.prototype.forEach.call(document.querySelectorAll("#bg-form input, #bg-form select, #bg-form textarea"), function (e) { e.addEventListener("input", bugo); e.addEventListener("change", bugo); });
    bugo();
    function copy(id, btn) {
      var t = $(id).textContent, done = function () { btn.textContent = "복사했습니다"; setTimeout(function () { btn.textContent = btn.dataset.l; }, 1800); };
      btn.dataset.l = btn.dataset.l || btn.textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(done, function () { prompt("아래 글을 길게 눌러 복사하세요", t); });
      else prompt("아래 글을 길게 눌러 복사하세요", t);
    }
    $("bg-copy").onclick = function () { copy("bg-text", this); };
    $("bg-copy2").onclick = function () { copy("bg-thanks", this); };
  }
})();

/* 가까운 봉안당 · 총비용 계산기 · 장례 후 할 일 · 다음 명절 */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function won(n) { if (!n && n !== 0) return "–"; var m = n / 10000; return m >= 1 ? (Math.round(m * 10) / 10).toLocaleString() + "만 원" : Math.round(n).toLocaleString() + "원"; }
  function hav(a, b, c, d) { var p = Math.PI / 180, x = Math.sin((c - a) * p / 2), y = Math.sin((d - b) * p / 2); return 12742 * Math.asin(Math.sqrt(x * x + Math.cos(a * p) * Math.cos(c * p) * y * y)); }
  var dataP = null;
  function data() { return dataP || (dataP = fetch("../assets/search.json").then(function (r) { return r.json(); })); }

  // ---- 가까운 봉안당 ----
  if ($("near-form")) {
    var SGG = JSON.parse($("near-sgg-data").textContent), here = null;
    var sido = $("near-sido"), sgg = $("near-sgg");
    sido.addEventListener("change", function () {
      sgg.innerHTML = '<option value="">시군구를 고르세요</option>' + SGG.filter(function (g) { return g.s === sido.value; })
        .map(function (g, i) { return '<option value="' + esc(g.n) + '">' + esc(g.n) + "</option>"; }).join("");
      if (sido.value === "세종특별자치시") { sgg.selectedIndex = 1; pick(); }
    });
    function pick() { var g = SGG.filter(function (x) { return x.s === sido.value && x.n === sgg.value; })[0]; if (g) { here = { la: g.la, lo: g.lo, label: g.s + " " + g.n }; run(); } }
    sgg.addEventListener("change", pick);
    ["near-km", "near-kind", "near-park"].forEach(function (id) { $(id).addEventListener("change", function () { if (here) run(); }); });
    $("near-gps").onclick = function () {
      if (!navigator.geolocation) { $("near-count").textContent = "이 기기에서는 위치를 쓸 수 없습니다. 시도와 시군구를 골라 주세요."; return; }
      $("near-count").textContent = "위치를 확인하는 중입니다…";
      navigator.geolocation.getCurrentPosition(function (p) { here = { la: p.coords.latitude, lo: p.coords.longitude, label: "지금 계신 곳" }; run(); },
        function () { $("near-count").textContent = "위치 사용이 허락되지 않았습니다. 시도와 시군구를 골라 주세요."; }, { timeout: 10000 });
    };
    function run() {
      data().then(function (d) {
        var km = +$("near-km").value, kind = $("near-kind").value, park = $("near-park").checked;
        var list = d.filter(function (x) { return !x.c && x.la && (!kind || x.k === kind) && (!park || x.f.indexOf("parking_lot") >= 0); })
          .map(function (x) { return { x: x, km: hav(here.la, here.lo, x.la, x.lo) }; })
          .filter(function (o) { return o.km <= km; }).sort(function (a, b) { return a.km - b.km; });
        $("near-count").textContent = here.label + "에서 " + (km < 9999 ? km + "km 안에 " : "") + "봉안당 " + list.length + "곳 (가까운 순)";
        $("near-out").innerHTML = list.slice(0, 60).map(function (o) {
          var x = o.x, badge = x.k === "공설" ? "pub" : x.k === "사설" ? "pri" : "etc", mins = Math.round(o.km * 1.3 / 45 * 60 / 5) * 5;
          return '<div class="result"><a class="rec-name" href="../' + esc(x.u) + '"><strong>' + esc(x.n) + '</strong></a> <span class="badge ' + badge + '">' + esc(x.k) + "</span>" +
            '<span class="addr">' + esc(x.a) + "</span>" +
            '<p class="near-dist"><strong>직선 약 ' + Math.max(1, Math.round(o.km)) + "km</strong> · 차로 대략 " + (mins < 60 ? Math.max(10, mins) + "분" : Math.floor(mins / 60) + "시간 " + (mins % 60 ? mins % 60 + "분" : "")) +
            (x.ps || x.pr ? " · 개인단 " + won(x.ps || x.pr) + "부터" : "") + "</p>" +
            '<div class="actions">' + (x.t ? '<a class="btn" href="tel:' + esc(x.t.replace(/[^0-9+]/g, "")) + '">전화 걸기</a>' : "") +
            '<a class="btn" href="https://map.naver.com/p/search/' + encodeURIComponent(x.a || x.n) + '" target="_blank" rel="noopener">지도 보기</a><a class="btn primary" href="../' + esc(x.u) + '">자세히 보기</a></div></div>';
        }).join("") || '<p class="muted">조건에 맞는 봉안당이 없습니다. 거리를 늘려 보세요.</p>';
      });
    }
  }

  // ---- 총비용 계산기 ----
  if ($("cc-years")) {
    var byName = {}, cols = Array.prototype.slice.call(document.querySelectorAll(".cc-col"));
    data().then(function (d) {
      var html = "";
      d.forEach(function (x) { if (!x.c && (x.ps || x.pr)) { byName[x.n] = x; html += '<option value="' + esc(x.n) + '">' + esc(x.s + " " + x.g) + "</option>"; } });
      $("cc-list").innerHTML = html;
    });
    function num(el) { var v = parseFloat(el.value); return isNaN(v) ? null : v; }
    function fill(col) {
      var x = byName[col.querySelector(".cc-name").value.trim()];
      if (!x) return;
      var set = function (cls, v) { var e = col.querySelector(cls); e.value = v == null || v === "" ? "" : v; };
      set(".cc-use", x.ps || x.pr || "");
      set(".cc-mg", x.mg || "");
      var m = /(\d+)\s*년/.exec(x.mgn || ""), per = m ? +m[1] : (x.mg ? "" : 0);
      if (/1년|매년|연간/.test(x.mgn || "")) per = 1;
      set(".cc-mgy", per);
      set(".cc-first", x.fp || "");
      set(".cc-ext", x.ey || "");
      col.querySelector(".cc-note").textContent = (x.psn ? "사용료 항목: " + x.psn + ". " : "") + (x.mgn ? "관리비 항목: " + x.mgn + ". " : "관리비 정보 없음. ") +
        (x.ec ? "연장은 최대 " + x.ec + "번까지. " : "") + "가격표 기준이라 실제와 다를 수 있습니다.";
      col.dataset.ec = x.ec || "";
      calc();
    }
    function calc() {
      var Y = +$("cc-years").value, res = [];
      cols.forEach(function (col, i) {
        var use = num(col.querySelector(".cc-use"));
        if (use == null) return;
        var mg = num(col.querySelector(".cc-mg")) || 0, mgy = num(col.querySelector(".cc-mgy")), first = num(col.querySelector(".cc-first")) || Y,
          ext = num(col.querySelector(".cc-ext")) || 0, fee = num(col.querySelector(".cc-extfee")) || 0, ec = +col.dataset.ec || 0;
        var need = Y > first ? (ext ? Math.ceil((Y - first) / ext) : null) : 0;
        var mgN = mg ? (mgy ? Math.ceil(Y / mgy) : 1) : 0;
        var total = use + mg * mgN + (need ? need * fee : 0);
        var warn = need === null ? "처음 계약 기간이 " + first + "년이라 " + Y + "년을 모시려면 연장 조건을 시설에 확인해야 합니다." :
          (ec && need > ec ? "이 시설은 최대 " + ec + "번까지 연장할 수 있어 " + Y + "년을 다 채우지 못할 수 있습니다." : "");
        res.push({ n: col.querySelector(".cc-name").value.trim() || "비교 " + (i + 1), use: use, mgT: mg * mgN, mgN: mgN, ext: need, extT: need ? need * fee : 0, fee: fee, total: total, warn: warn });
      });
      if (!res.length) { $("cc-out").innerHTML = '<p class="muted">봉안당 이름을 고르거나 사용료를 넣으면 총비용이 계산됩니다.</p>'; return; }
      var mx = Math.max.apply(null, res.map(function (r) { return r.total; }));
      $("cc-out").innerHTML = '<h3>' + Y + "년 모실 때 총비용</h3>" + res.map(function (r) {
        return '<div class="cc-res"><div class="cc-res-h"><strong>' + esc(r.n) + '</strong><span class="cc-total">' + won(r.total) + "</span></div>" +
          '<div class="bar-track"><span class="bar" style="width:' + Math.max(3, 100 * r.total / mx) + '%"></span></div>' +
          '<p class="small">사용료 ' + won(r.use) + " + 관리비 " + won(r.mgT) + (r.mgN ? " (" + r.mgN + "번)" : "") +
          (r.ext ? " + 연장 " + r.ext + "번" + (r.fee ? " " + won(r.extT) : " (연장 비용은 시설에 확인)") : "") + "</p>" +
          (r.warn ? '<p class="err">' + esc(r.warn) + "</p>" : "") + "</div>";
      }).join("") + '<p class="small muted">공개 가격표와 입력한 값으로 계산한 참고 금액입니다. 계약 전에는 시설의 최신 가격표를 꼭 확인하세요.</p>';
    }
    cols.forEach(function (col) {
      col.querySelector(".cc-name").addEventListener("change", function () { fill(col); });
      col.querySelector(".cc-name").addEventListener("input", function () { if (byName[this.value.trim()]) fill(col); });
      Array.prototype.forEach.call(col.querySelectorAll("input:not(.cc-name)"), function (e) { e.addEventListener("input", calc); });
    });
    $("cc-years").addEventListener("change", calc);
    calc();
  }

  // ---- 장례 후 할 일 ----
  if ($("ad-form")) {
    var KEY = "after-death";
    var st = {}; try { st = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) {}
    var boxes = Array.prototype.slice.call(document.querySelectorAll(".ad-list input[type=checkbox]"));
    function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
    function addM(d, m) { var x = new Date(d.getFullYear(), d.getMonth() + m, d.getDate()); if (x.getDate() !== d.getDate()) x.setDate(0); return x; }
    function eom(d, m) { return new Date(d.getFullYear(), d.getMonth() + 1 + m, 0); }
    var W = "일월화수목금토";
    function f(d) { return d.getFullYear() + "년 " + (d.getMonth() + 1) + "월 " + d.getDate() + "일(" + W[d.getDay()] + ")"; }
    function due() {
      var v = $("ad-date").value, d = v ? new Date(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)) : null, today = new Date();
      Array.prototype.forEach.call(document.querySelectorAll(".ad-item"), function (li) {
        var k = li.dataset.dl, el = li.querySelector(".ad-due"), t = null;
        if (d && k) t = k === "1m" ? addM(d, 1) : k === "3m" ? addM(d, 3) : k === "eom6m" ? eom(d, 6) : k === "eom1y" ? eom(d, 12) : k === "5y" ? addM(d, 60) : k === "3y" ? addM(d, 36) : null;
        if (!t) { el.textContent = ""; el.className = "ad-due"; return; }
        var left = Math.ceil((t - today) / 86400000);
        el.textContent = "마감 " + f(t) + (left >= 0 ? " · " + left + "일 남음" : " · 기한 지남");
        el.className = "ad-due" + (left < 0 ? " over" : left <= 14 ? " soon" : "");
      });
      var done = boxes.filter(function (b) { return b.checked; }).length;
      $("ad-progress").textContent = boxes.length + "가지 중 " + done + "가지를 마쳤습니다.";
      st.date = v; save();
    }
    boxes.forEach(function (b) {
      b.checked = !!st[b.dataset.k];
      b.addEventListener("change", function () { st[b.dataset.k] = b.checked; save(); due(); });
    });
    if (st.date) $("ad-date").value = st.date;
    $("ad-date").addEventListener("change", due);
    $("ad-print").onclick = function () { window.print(); };
    due();
  }

  // ---- 다음 명절 ----
  if ($("hd-next") && window.KoreanLunarCalendar) {
    var now = new Date(), y = now.getFullYear(), list = [];
    for (var yy = y; yy <= y + 2; yy++) [[1, 1, "설날"], [8, 15, "추석"]].forEach(function (h) {
      var c = new window.KoreanLunarCalendar(); if (!c.setLunarDate(yy, h[0], h[1], false)) return;
      var s = c.getSolarCalendar(), d = new Date(s.year, s.month - 1, s.day); if (d >= new Date(now.getFullYear(), now.getMonth(), now.getDate())) list.push([h[2], d]);
    });
    list.sort(function (a, b) { return a[1] - b[1]; });
    if (list[0]) {
      var d = list[0][1], left = Math.ceil((d - now) / 86400000), pre = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 14);
      $("hd-next").innerHTML = "<strong>다음 " + list[0][0] + "은 " + (d.getMonth() + 1) + "월 " + d.getDate() + "일(" + "일월화수목금토"[d.getDay()] + "), " + left + "일 남았습니다.</strong> " +
        "덜 붐비게 다녀오려면 " + (pre.getMonth() + 1) + "월 " + pre.getDate() + "일 무렵 주말을 추천합니다.";
    }
  }
})();

/* 제휴 시설 상담 신청 · 복사 단추 · 종류 거르기 */
(function () {
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-copy]");
    if (!b) return;
    var t = b.getAttribute("data-copy"), old = b.textContent;
    var done = function () { b.textContent = "복사됨"; setTimeout(function () { b.textContent = old; }, 1500); };
    try { navigator.clipboard.writeText(t).then(done, function () { prompt("아래 내용을 길게 눌러 복사하세요", t); }); } catch (er) { prompt("아래 내용을 길게 눌러 복사하세요", t); }
    if (window.__track) window.__track("copy", t);
  });
  var pf = document.querySelector(".p-filter");
  if (pf) pf.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var k = b.getAttribute("data-pf");
    [].forEach.call(pf.querySelectorAll("button"), function (x) { x.classList.toggle("on", x === b); });
    [].forEach.call(document.querySelectorAll(".p-sec"), function (sec) {
      var shown = 0;
      [].forEach.call(sec.querySelectorAll(".p-card"), function (c) { var on = !k || (c.getAttribute("data-kind") || "").indexOf(k) >= 0; c.hidden = !on; if (on) shown++; });
      sec.hidden = !shown;
    });
  });
  var src = "";
  try {
    var qs = new URLSearchParams(location.search);
    src = qs.get("utm_source") || qs.get("ref") || "";
    if (src) sessionStorage.setItem("lead_src", src + (qs.get("utm_campaign") ? " / " + qs.get("utm_campaign") : ""));
    else if (document.referrer && document.referrer.indexOf(location.host) < 0 && !sessionStorage.getItem("lead_src")) sessionStorage.setItem("lead_src", document.referrer.split("/")[2] || "");
    src = sessionStorage.getItem("lead_src") || "";
    var want = qs.get("p");
  } catch (er) {}
  [].forEach.call(document.querySelectorAll("form[data-lead]"), function (f) {
    var F = function (n) { return f.elements.namedItem(n); };
    F("page").value = location.pathname;
    if (want && F("partner")) { for (var i = 0; i < F("partner").options.length; i++) if (F("partner").options[i].value === want) F("partner").selectedIndex = i; }
    var msg = f.querySelector(".lf-msg"), btn = f.querySelector(".lf-submit");
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      [].forEach.call(f.querySelectorAll(".bad"), function (x) { x.classList.remove("bad"); });
      var err = "", digits = (F("phone").value || "").replace(/[^0-9]/g, "");
      if (!F("name").value.trim()) { err = "성함을 적어 주세요."; F("name").classList.add("bad"); }
      else if (digits.length < 9 || digits.length > 12) { err = "연락처를 정확히 적어 주세요. (예: 010-1234-5678)"; F("phone").classList.add("bad"); }
      else if (!F("agree_privacy").checked || !F("agree_third").checked) err = "필수 동의 두 가지에 체크해 주세요.";
      if (err) { msg.textContent = err; msg.className = "lf-msg err"; return; }
      var data = {}; [].forEach.call(f.elements, function (el) {
        if (!el.name) return;
        if (el.type === "radio") { if (el.checked) data[el.name] = el.value; }
        else if (el.type === "checkbox") data[el.name] = el.checked ? "1" : "";
        else data[el.name] = el.value;
      });
      if (F("partner") && F("partner").selectedIndex > 0) data.partner_name = F("partner").options[F("partner").selectedIndex].text;
      data.src = src;
      btn.disabled = true; msg.className = "lf-msg"; msg.textContent = "보내는 중입니다…";
      fetch("/api/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
        .then(function (res) { return res.json().catch(function () { return { ok: false }; }); })
        .then(function (j) {
          if (!j.ok) throw new Error(j.error || "");
          var done = f.nextElementSibling;
          f.hidden = true; if (done && done.classList.contains("lf-done")) { done.hidden = false; done.scrollIntoView({ behavior: "smooth", block: "center" }); }
          if (window.__track) window.__track("lead", data.partner_name || "상담 신청");
        })
        .catch(function (er) {
          btn.disabled = false; msg.className = "lf-msg err";
          msg.textContent = (er && er.message) || "지금 신청을 보내지 못했습니다. 잠시 뒤 다시 시도하시거나 shinnamho@naver.com 으로 연락해 주세요.";
        });
    });
  });
})();

/* 센터 배너 (프리미엄 파트너) 자동 넘김 */
(function () {
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  [].forEach.call(document.querySelectorAll(".center-banner"), function (cb) {
    var tr = cb.querySelector("[data-cb]"); if (!tr) return;
    var step = function (dir) {
      var s = tr.querySelector(".cb-slide"); if (!s) return;
      var w = s.getBoundingClientRect().width + 14, max = tr.scrollWidth - tr.clientWidth - 4;
      if (dir > 0 && tr.scrollLeft >= max) tr.scrollLeft = 0; else if (dir < 0 && tr.scrollLeft <= 0) tr.scrollLeft = max; else tr.scrollLeft += dir * w;
    };
    cb.querySelector(".cb-nav.prev").onclick = function () { step(-1); };
    cb.querySelector(".cb-nav.next").onclick = function () { step(1); };
    var hold = false, t = null;
    ["mouseenter", "touchstart", "focusin"].forEach(function (e) { cb.addEventListener(e, function () { hold = true; }, { passive: true }); });
    ["mouseleave", "focusout"].forEach(function (e) { cb.addEventListener(e, function () { hold = false; }); });
    cb.addEventListener("touchend", function () { setTimeout(function () { hold = false; }, 6000); }, { passive: true });
    if (!reduce && "IntersectionObserver" in window) {
      new IntersectionObserver(function (en) {
        if (en[0].isIntersecting) { if (!t) t = setInterval(function () { if (!hold && !document.hidden) step(1); }, 4500); }
        else { clearInterval(t); t = null; }
      }, { threshold: .3 }).observe(cb);
    }
    cb.addEventListener("click", function (e) {
      var a = e.target.closest("a"); if (!a || !window.__track) return;
      window.__track("banner", a.getAttribute("data-name") || a.textContent.trim().slice(0, 40));
    });
  });
})();

/* 휴대폰 '무료 상담' 단추: 조금 내려야 나타남 */
(function () {
  var b = document.querySelector(".qf-mobile"); if (!b) return;
  var on = function () { b.classList.toggle("show", window.scrollY > 500); };
  window.addEventListener("scroll", on, { passive: true }); on();
})();
