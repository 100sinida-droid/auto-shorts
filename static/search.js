(function () {
  var AMEN = { parking_lot: "주차장", restaurant: "식당", store: "매점", waiting_room: "유족대기실", accessible: "장애인 편의" };
  var PAGE = 50;
  var data = [], shown = PAGE;
  var $ = function (id) { return document.getElementById(id); };
  var q = $("sq"), sido = $("ssido"), kind = $("skind");
  var boxes = Array.prototype.slice.call(document.querySelectorAll("#search-form input[type=checkbox]"));

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function norm(s) { return String(s || "").replace(/\s+/g, "").toLowerCase(); }

  function readUrl() {
    var p = new URLSearchParams(location.search);
    q.value = p.get("q") || "";
    sido.value = p.get("sido") || "";
    kind.value = p.get("kind") || "";
    var f = (p.get("f") || "").split(",");
    boxes.forEach(function (b) { b.checked = f.indexOf(b.value) >= 0; });
  }
  function writeUrl() {
    var p = new URLSearchParams();
    if (q.value) p.set("q", q.value);
    if (sido.value) p.set("sido", sido.value);
    if (kind.value) p.set("kind", kind.value);
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
      for (var i = 0; i < need.length; i++) if (d.f.indexOf(need[i]) < 0) return false;
      if (terms.length) {
        var hay = norm(d.n + d.s + d.g + d.a);
        for (var j = 0; j < terms.length; j++) if (hay.indexOf(terms[j]) < 0) return false;
      }
      return true;
    });
    $("result-count").textContent = "검색 결과 " + list.length.toLocaleString() + "곳";
    var html = list.slice(0, shown).map(function (d) {
      var badge = d.k === "공설" ? "pub" : d.k === "사설" ? "pri" : "etc";
      var chips = d.f.map(function (k) { return '<span class="chip">' + esc(AMEN[k] || k) + "</span>"; }).join("");
      return '<a class="result" href="../' + esc(d.u || ('facility/' + d.i + '.html')) + '"><strong>' + esc(d.n) + '</strong><span class="badge ' + badge + '">' + esc(d.k) +
        '</span><span class="addr">' + esc(d.a || (d.s + " " + d.g)) + (d.p ? " · 최초 안치 " + esc(d.p) + "년" : "") + "</span>" +
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
    [sido, kind].concat(boxes).forEach(function (el) { el.addEventListener("change", update); });
  }).catch(function () {
    $("result-count").textContent = "데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
  });
})();
