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

  fetch("../data/search.json").then(function (r) { return r.json(); }).then(function (d) {
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
  fetch("../data/search.json").then(function (r) { return r.json(); }).then(function (d) {
    data = d;
    $("rgo").addEventListener("click", run);
    [type, sido, kind, order].concat(boxes).forEach(function (el) { el.addEventListener("change", function () { if (budget.value) run(); }); });
    if (readUrl()) run();
  }).catch(function () { err.textContent = "데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."; });
})();
