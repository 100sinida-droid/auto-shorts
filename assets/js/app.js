(function () {
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const DAY = 86400000;
const MAX_TRIP_DAYS = 30;

// ── 저장소 (브라우저마다 따로 저장됨) ──
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 불가 환경은 무시 */ }
  },
};

const state = {
  owned: new Set(store.get('jk:owned', [])),
  ctx: null,
  list: [],
  apiEnabled: false,
  kakaoEnabled: false,
  route: null,
};

// ── 날짜 도우미 ──
const toISO = d => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = d => `${d.getMonth() + 1}월 ${d.getDate()}일`;
const shiftYears = (d, y) => new Date(d.getFullYear() + y, d.getMonth(), d.getDate());

// ── 창밖 풍경 ──
let frontView = 'a';
function setScene(dest, label) {
  const next = frontView === 'a' ? 'b' : 'a';
  const nextEl = $(`#view-${next}`), curEl = $(`#view-${frontView}`);
  nextEl.innerHTML = sceneSVG(dest);
  nextEl.style.opacity = '1';
  curEl.style.opacity = '0';
  frontView = next;
  const name = label || (dest && dest.name);
  $('#window-caption').textContent = name ? `창밖은 ${name}` : '구름 위에서';
  $('#dest').classList.toggle('empty', !$('#dest').value);
}

const mode = () => ($('input[name=mode]:checked') || {}).value || 'abroad';

function applyMode() {
  const m = mode();
  $('#route-abroad').hidden = m !== 'abroad';
  $('#route-domestic').hidden = m !== 'domestic';
  $('#dom-picks').hidden = m !== 'domestic';
  $('#dest').required = m === 'abroad';
  const want = m === 'abroad' ? 'flight' : 'car';
  const r = $(`input[name=transport][value=${want}]`);
  if (r) r.checked = true;
  if (m === 'abroad') setScene(DESTINATIONS.find(x => x.id === $('#dest').value));
  else domesticScene();
}

function domesticScene() {
  const to = $('#to').value.trim();
  const gid = findDomesticGuide(to);
  setScene({ id: gid || 'domestic', domestic: true, name: to }, to || null);
}

// ── 폼 준비 ──
function initForm() {
  const sel = $('#dest');
  const groups = {};
  DESTINATIONS.filter(d => !d.domestic).forEach(d => { (groups[d.group] ||= []).push(d); });
  sel.innerHTML = '<option value="">여행지 선택</option>' + Object.entries(groups).map(([g, list]) =>
    `<optgroup label="${esc(g)}">${list.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</optgroup>`
  ).join('');

  $('#dom-picks').innerHTML = '<span class="picks-label">많이 가는 곳</span>' +
    DOMESTIC_PICKS.map(p => `<button type="button" class="pick-chip" data-name="${esc(p.name.split('·')[0])}">${esc(p.name)}</button>`).join('');
  $('#dom-picks').addEventListener('click', e => {
    const b = e.target.closest('.pick-chip');
    if (!b) return;
    $('#to').value = b.dataset.name;
    domesticScene();
  });

  const today = new Date();
  $('#start').value = toISO(new Date(today.getTime() + 30 * DAY));
  $('#end').value = toISO(new Date(today.getTime() + 33 * DAY));
  $('#start').min = toISO(today);

  $$('.counter').forEach(c => {
    c.addEventListener('click', e => {
      const b = e.target.closest('.cbtn');
      if (!b) return;
      const out = $('output', c);
      const v = Math.min(9, Math.max(0, Number(out.value || out.textContent) + Number(b.dataset.d)));
      out.textContent = v;
      out.value = v;
    });
  });

  sel.addEventListener('change', () => setScene(DESTINATIONS.find(x => x.id === sel.value)));
  $('#to').addEventListener('change', domesticScene);
  $$('input[name=mode]').forEach(r => r.addEventListener('change', applyMode));

  $('#start').addEventListener('change', () => {
    if ($('#end').value < $('#start').value) $('#end').value = $('#start').value;
    $('#end').min = $('#start').value;
  });

  // 지난번 입력 복원
  const last = store.get('jk:trip', null);
  if (last) {
    if (last.mode) { const r = $(`input[name=mode][value=${last.mode}]`); if (r) r.checked = true; }
    if (last.dest) sel.value = last.dest;
    if (last.from) $('#from').value = last.from;
    if (last.to) $('#to').value = last.to;
    if (last.start && last.start >= toISO(today)) { $('#start').value = last.start; $('#end').value = last.end; }
    ['adults', 'kids', 'infants', 'seniors'].forEach(k => {
      const out = $(`.counter[data-name=${k}] output`);
      if (out && Number.isFinite(last[k])) { out.textContent = last[k]; out.value = last[k]; }
    });
    if (Array.isArray(last.purposes)) $$('input[name=purpose]').forEach(i => { i.checked = last.purposes.includes(i.value); });
  }

  // 가이드 페이지에서 넘어온 경우 (?dest=osaka 또는 ?to=부산)
  const q = new URLSearchParams(location.search);
  if (q.get('dest') && DESTINATIONS.some(d => d.id === q.get('dest'))) {
    $('input[name=mode][value=abroad]').checked = true;
    sel.value = q.get('dest');
  } else if (q.get('to')) {
    $('input[name=mode][value=domestic]').checked = true;
    $('#to').value = q.get('to');
  }

  applyMode();
  if (last && last.transport) { const r = $(`input[name=transport][value=${last.transport}]`); if (r) r.checked = true; }
  $('#trip-form').addEventListener('submit', onSubmit);
}

function readForm() {
  const count = k => Number($(`.counter[data-name=${k}] output`).textContent) || 0;
  return {
    mode: mode(),
    dest: $('#dest').value,
    from: $('#from').value.trim(),
    to: $('#to').value.trim(),
    start: $('#start').value,
    end: $('#end').value,
    adults: count('adults'),
    kids: count('kids'),
    infants: count('infants'),
    seniors: count('seniors'),
    purposes: $$('input[name=purpose]:checked').map(i => i.value),
    transport: ($('input[name=transport]:checked') || {}).value || 'flight',
  };
}

function validate(f) {
  if (f.mode === 'abroad' && !f.dest) return '여행지를 골라 주세요.';
  if (f.mode === 'domestic' && !f.to) return '도착지를 입력해 주세요. 예: 강릉, 해운대, 전주한옥마을';
  if (!f.start || !f.end) return '출발일과 돌아오는 날을 입력해 주세요.';
  if (f.end < f.start) return '돌아오는 날이 출발일보다 빠릅니다.';
  const len = (parseISO(f.end) - parseISO(f.start)) / DAY + 1;
  if (len > MAX_TRIP_DAYS) return `여행 기간은 ${MAX_TRIP_DAYS}일까지 분석할 수 있어요.`;
  if (f.adults + f.seniors < 1) return '어른이나 어르신이 한 명 이상 있어야 해요.';
  return '';
}

// ── 장소 이름 → 좌표 ──
async function geocode(text) {
  if (!text) return null;
  if (state.kakaoEnabled) {
    try {
      const j = await fetchJSON(`/api/places?type=geo&q=${encodeURIComponent(text)}`, 5000);
      if (j.place) return j.place;
    } catch { /* 다음 방법으로 */ }
  }
  try {
    const j = await fetchJSON(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=kr&limit=1&accept-language=ko&q=${encodeURIComponent(text)}`, 6000);
    if (j[0]) return { name: text, lat: +j[0].lat, lon: +j[0].lon };
  } catch { /* 다음 방법으로 */ }
  try {
    const first = text.split(/\s+/)[0];
    const j = await fetchJSON(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=ko&countryCode=KR&name=${encodeURIComponent(first)}`, 6000);
    if (j.results && j.results[0]) return { name: text, lat: j.results[0].latitude, lon: j.results[0].longitude };
  } catch { /* 다음 방법으로 */ }
  const city = cityFallback(text);
  if (city) return { name: text, lat: city.lat, lon: city.lon, approx: true };
  const gid = findDomesticGuide(text);
  const pick = gid && DOMESTIC_PICKS.find(p => p.id === gid);
  return pick ? { name: text, lat: pick.lat, lon: pick.lon, approx: true } : null;
}

function distanceKm(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function resolveDomestic(f) {
  const [to, from] = await Promise.all([geocode(f.to), geocode(f.from)]);
  const guideId = findDomesticGuide(f.to);
  const pick = guideId && DOMESTIC_PICKS.find(p => p.id === guideId);
  const at = to || (pick && { lat: pick.lat, lon: pick.lon }) || { lat: 36.5, lon: 127.8, unknown: true };
  const dest = {
    id: guideId || 'domestic', guideId, name: f.to, country: '대한민국', group: '국내',
    lat: at.lat, lon: at.lon, plug: 'ok', voltage: 220, domestic: true,
    flight: f.transport === 'flight' ? 1 : 0,
    climate: at.lat < 34 ? 'mild' : (at.lat > 37.2 && at.lon > 128.2 ? 'cold' : 'temperate'),
    located: !at.unknown,
  };
  const route = from && to ? { from: { name: f.from, ...from }, km: Math.round(distanceKm(from, to)) } : null;
  return { dest, route };
}

// ── 날씨 ──
async function fetchJSON(url, ms = 7000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

function summarizeDaily(daily, useProb) {
  const max = daily.temperature_2m_max.filter(v => v != null);
  const min = daily.temperature_2m_min.filter(v => v != null);
  if (!max.length || !min.length) throw new Error('empty');
  const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
  let rainDays = 0;
  daily.time.forEach((_, i) => {
    const p = daily.precipitation_sum?.[i] ?? 0;
    const prob = daily.precipitation_probability_max?.[i] ?? 0;
    if (p >= 1 || (useProb && prob >= 60)) rainDays++;
  });
  return {
    tmax: Math.round(avg(max)),
    tmin: Math.round(avg(min)),
    lowest: Math.round(Math.min(...min)),
    rainDays,
  };
}

async function getWeather(dest, start, end) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const base = `latitude=${dest.lat}&longitude=${dest.lon}&timezone=auto`;
  try {
    // 15일 이내 여행: 일기예보
    if ((end - today) / DAY <= 15) {
      const url = `https://api.open-meteo.com/v1/forecast?${base}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max&start_date=${toISO(start)}&end_date=${toISO(end)}`;
      const j = await fetchJSON(url);
      return { ...summarizeDaily(j.daily, true), source: '일기예보' };
    }
    // 그 이후: 작년(필요하면 재작년) 같은 기간의 실제 날씨
    let y = -1;
    while (shiftYears(end, y) > new Date(today.getTime() - 7 * DAY)) y--;
    const s = shiftYears(start, y), e = shiftYears(end, y);
    const url = `https://archive-api.open-meteo.com/v1/archive?${base}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&start_date=${toISO(s)}&end_date=${toISO(e)}`;
    const j = await fetchJSON(url);
    return { ...summarizeDaily(j.daily, false), source: `${s.getFullYear()}년 같은 기간 실제 날씨` };
  } catch {
    return climateGuess(dest, start, end);
  }
}

// 날씨 조회가 안 될 때 쓰는 대략적인 계절 평균
const TEMPERATE = [[-3, 5], [-1, 8], [4, 14], [9, 20], [14, 25], [19, 28], [23, 30], [23, 31], [18, 27], [11, 21], [4, 13], [-2, 6]];
function climateGuess(dest, start, end) {
  const days = Math.round((end - start) / DAY) + 1;
  let m = start.getMonth();
  let tmin, tmax, rainRatio;
  if (dest.climate === 'tropical') {
    tmin = 24; tmax = 31; rainRatio = (m >= 4 && m <= 9) ? 0.5 : 0.2;
  } else {
    if (dest.climate === 'southern') m = (m + 6) % 12;
    [tmin, tmax] = TEMPERATE[m];
    if (dest.climate === 'cold') { tmin -= 6; tmax -= 6; }
    if (dest.climate === 'mild') { tmin += 4; tmax += 3; }
    rainRatio = (m >= 5 && m <= 7) ? 0.4 : 0.2;
  }
  return { tmin, tmax, lowest: tmin - 2, rainDays: Math.round(days * rainRatio), source: '계절 평균으로 추정 (날씨 조회 실패)' };
}

// ── 컨텍스트 ──
function buildContext(f, dest, w) {
  const start = parseISO(f.start), end = parseISO(f.end);
  const nights = Math.round((end - start) / DAY);
  const days = nights + 1;
  const kidsAll = f.kids + f.infants;
  const people = f.adults + f.seniors + kidsAll;
  const flight = f.transport === 'flight';
  const purposes = new Set(f.purposes);
  return {
    ...f, start, end, dest, w, nights, days, people, kidsAll, purposes, flight,
    intl: !dest.domestic,
    longFlight: flight && dest.flight >= 6,
    cold: w.tmin <= 3 || w.lowest <= 0,
    cool: w.tmin <= 14,
    hot: w.tmax >= 28,
    rainy: w.rainDays >= Math.max(1, Math.ceil(days * 0.3)),
    bags: Math.max(1, Math.ceil(people / 2) + (nights >= 6 && people >= 3 ? 1 : 0)),
  };
}

function pickItems(c) {
  const val = (v) => typeof v === 'function' ? v(c) : v;
  return ITEMS.filter(it => { try { return it.when(c); } catch { return false; } })
    .map(it => ({ ...it, ...(ITEM_GUIDE[it.id] || { stage: 'prep' }), level: val(it.level), qtyText: it.qty ? it.qty(c) : '', whyText: it.why(c) }));
}

// ── 화면 그리기 ──
const won = n => `${Number(n).toLocaleString('ko-KR')}원`;

function whoText(c) {
  return [
    c.adults && `어른 ${c.adults}명`, c.seniors && `어르신 ${c.seniors}명`,
    c.kids && `어린이 ${c.kids}명`, c.infants && `영유아 ${c.infants}명`,
  ].filter(Boolean).join(', ');
}

function renderSummary(c) {
  const w = c.w;
  const mood = c.cold ? '추운' : c.cool ? '선선한' : c.hot ? '더운' : '걷기 좋은';
  const lines = [`${fmtDate(c.start)}부터 ${c.days}일 동안, ${mood} ${esc(c.dest.name)}에 다녀오시는군요.`];
  if (c.infants) lines.push('영유아와 함께라 이동이 편한 물건이 가장 중요해요.');
  else if (c.kids) lines.push('아이와 함께라 이동 중 지루함과 날씨 대비가 중요해요.');
  else if (c.seniors) lines.push('어르신과 함께라 많이 걷는 일정에 대비하는 게 좋아요.');
  $('#summary').innerHTML = `
    <div class="summary-bg">${sceneSVG(c.dest)}</div>
    <p class="sum-dates">${state.route ? `${esc(state.route.from.name)} 출발 · ` : ''}${fmtDate(c.start)} ~ ${fmtDate(c.end)} · ${esc(whoText(c))}</p>
    <h2 class="sum-title">${esc(c.dest.name)} ${c.nights}박 ${c.days}일</h2>
    <p class="sum-lead">${lines.join(' ')}</p>`;
}

function renderBrief(c) {
  const w = c.w;
  const cards = [];

  cards.push({
    title: '날씨와 옷차림',
    big: `${w.tmin}℃ ~ ${w.tmax}℃`,
    sub: w.rainDays ? `비 오는 날 ${w.rainDays}일쯤` : '비 소식은 거의 없어요',
    body: clothingAdvice(w),
    foot: `기준: ${w.source}`,
  });

  if (c.dest.domestic) {
    cards.push({ title: '전기', big: '그대로 사용', sub: '220V, 한국 콘센트', body: '국내 여행이라 충전기와 드라이기를 그대로 쓰면 돼요. 대신 숙소 콘센트가 부족할 수 있으니 멀티탭이나 멀티 충전기가 있으면 편해요.' });
  } else {
    const shape = c.dest.plug === 'ok' ? '한국 플러그가 들어가는 곳이 많아요.'
      : c.dest.plug === 'mixed' ? '숙소마다 콘센트 모양이 달라요. 어떤 모양이 나와도 쓸 수 있게 멀티 어댑터를 챙기세요.'
      : '콘센트 모양이 달라서 어댑터 없이는 충전기를 꽂을 수 없어요.';
    const volt = c.dest.voltage < 200
      ? ` 전압이 ${c.dest.voltage}V라 한국 220V 전용 제품(드라이기, 고데기)은 고장 날 수 있어요. 휴대폰 충전기는 대부분 100~240V라 괜찮아요.`
      : ' 전압은 한국과 비슷해서 기기를 그대로 써도 돼요.';
    cards.push({ title: '전기', big: PLUG_TEXT[c.dest.plug], sub: `${c.dest.voltage}V`, body: shape + volt });
  }

  if (c.flight && c.dest.flight) {
    const h = c.dest.flight;
    const body = h >= 8 ? '긴 비행이에요. 기내에서 잘 자 두면 도착 첫날 일정이 훨씬 가벼워져요. 목베개, 슬리퍼, 압박 양말이 이때 힘을 발휘해요.'
      : h >= 4 ? '반나절 가까이 이동해요. 아이와 함께라면 기내에서 할 거리를 꼭 챙기세요.'
      : '짧은 비행이지만 공항 대기까지 합치면 반나절이 걸려요. 보조배터리는 1인 2개까지 기내에만 들고 탈 수 있고, 기내에서는 쓸 수 없어요.';
    cards.push({ title: '이동', big: `비행 약 ${h}시간`, sub: '인천 출발 기준', body });
  } else if (c.dest.domestic && c.flight) {
    cards.push({ title: '이동', big: '국내선 비행기', sub: '비행 1시간 안팎', body: '국내선은 신분증이 꼭 필요해요. 보조배터리는 1인 2개까지 기내에만 가지고 탈 수 있고, 기내에서는 쓸 수 없어요.' });
  } else if (c.transport === 'car') {
    const km = state.route ? state.route.km : null;
    cards.push({ title: '이동', big: km ? `직선거리 약 ${km}km` : '자동차', sub: '짐 무게 제한 없음', body: '짐 제한이 없어서 오히려 많이 싣게 돼요. 휴게소에서 바로 꺼낼 작은 가방을 따로 꾸리고, 아이와 함께라면 1~2시간마다 쉬어 가세요.' });
  } else {
    cards.push({ title: '이동', big: '기차·버스', sub: '짐 칸이 좁아요', body: '좌석 위 선반에 올릴 수 있는 크기로 짐을 나누면 이동이 훨씬 수월해요.' });
  }

  const tips = COUNTRY_TIPS[c.dest.country] || [];
  if (tips.length) cards.push({ title: `${c.dest.country}에서 알아 두면 좋은 것`, list: tips });

  $('#brief').innerHTML = cards.map(card => `
    <article class="brief-card">
      <h3>${esc(card.title)}</h3>
      ${card.big ? `<p class="brief-big">${esc(card.big)}</p>` : ''}
      ${card.sub ? `<p class="brief-sub">${esc(card.sub)}</p>` : ''}
      ${card.body ? `<p class="brief-body">${esc(card.body)}</p>` : ''}
      ${card.list ? `<ul class="brief-list">${card.list.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${card.foot ? `<p class="brief-foot">${esc(card.foot)}</p>` : ''}
    </article>`).join('');
}

function shopHTML(it) {
  if (!it.buy) return '';
  const links = PRODUCTS[it.id];
  if (Array.isArray(links) && links.length) {
    const [top, ...rest] = links;
    return `<div class="shop">
      <p class="shop-label">짐꾸림이 고른 상품</p>
      ${productCard(top)}
      ${rest.length ? `<details class="more"><summary>비교해 볼 상품 ${rest.length}개</summary>${rest.map(productCard).join('')}</details>` : ''}
    </div>`;
  }
  if (state.apiEnabled) {
    return `<div class="shop" data-api="${esc(it.keyword)}"><span class="shop-loading">추천 상품을 불러오는 중…</span></div>`;
  }
  return `<div class="shop">${searchLink(it.keyword)}</div>`;
}

function productCard(p) {
  const meta = [
    p.price ? `<b>${won(p.price)}</b>` : '',
    p.rating && p.reviews ? `★ ${p.rating} (${Number(p.reviews).toLocaleString('ko-KR')})` : '',
    p.rocket ? '<span class="rocket">로켓배송</span>' : '',
    p.note ? esc(p.note) : '',
  ].filter(Boolean).join(' ');
  return `
    <a class="product" href="${esc(p.url)}" target="_blank" rel="sponsored noopener">
      ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" width="64" height="64" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      <span class="product-text">
        <span class="product-title">${esc(p.title)}</span>
        <span class="product-meta">${meta}</span>
      </span>
    </a>`;
}

const searchLink = kw => `
  <a class="shop-link search" href="https://www.coupang.com/np/search?q=${encodeURIComponent(kw)}" target="_blank" rel="sponsored noopener">
    <span>쿠팡에서 "${esc(kw)}" 찾아보기</span>
  </a>`;

function itemHTML(it) {
  return `
    <article class="item" data-id="${it.id}">
      <div class="item-head">
        <input type="checkbox" class="item-check" id="chk-${it.id}" aria-label="${esc(it.name)} 이미 있어요">
        <label class="item-name" for="chk-${it.id}">${esc(it.name)}</label>
        ${it.level === 'must' ? '<span class="tag tag-must">필수</span>' : ''}
        <span class="tag tag-owned owned-badge" hidden>있어요</span>
        ${it.qtyText ? `<span class="item-qty">${esc(it.qtyText)}</span>` : ''}
      </div>
      <div class="item-body">
        ${it.scene ? `<p class="item-scene">${esc(it.scene)}</p>` : ''}
        <p class="item-why"><b>이번 여행에서는</b> ${esc(it.whyText)}</p>
        ${it.buy ? `
          <details class="pick" ${it.level === 'must' ? 'open' : ''}>
            <summary>고르는 법과 추천 상품 보기</summary>
            ${it.tips && it.tips.length ? `
              <div class="item-tips">
                <b>이렇게 고르세요</b>
                <ul>${it.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
              </div>` : ''}
            ${shopHTML(it)}
          </details>` : (it.tips ? `<ul class="item-note">${it.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '')}
      </div>
    </article>`;
}

function renderList() {
  const byStage = {};
  state.list.forEach(it => (byStage[it.stage] ||= []).push(it));
  const used = STAGES.filter(s => byStage[s.id]);
  $('#list').innerHTML = used.map((s, i) => `
    <section class="stage" id="stage-${s.id}">
      <header class="stage-head">
        <span class="stage-no">${i + 1}</span>
        <div>
          <h3>${esc(s.name)}</h3>
          <p>${esc(s.lead)}</p>
        </div>
      </header>
      <div class="stage-items">
        ${byStage[s.id].sort((a, b) => (a.level === 'must' ? 0 : 1) - (b.level === 'must' ? 0 : 1)).map(itemHTML).join('')}
      </div>
    </section>`).join('') +
    `<p class="inline-disclosure">상품 링크는 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.</p>`;

  $('#stage-nav').innerHTML = used.map((s, i) => `<a href="#stage-${s.id}">${i + 1}. ${esc(s.name)} <span>${byStage[s.id].length}</span></a>`).join('');

  $$('#list .item').forEach(row => {
    const id = row.dataset.id;
    const chk = $('.item-check', row);
    chk.checked = state.owned.has(id);
    chk.addEventListener('change', () => {
      chk.checked ? state.owned.add(id) : state.owned.delete(id);
      store.set('jk:owned', [...state.owned]);
      syncOwned();
    });
  });
  syncOwned();
  loadApiProducts();
}

function renderSchedule(c) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const left = Math.round((c.start - today) / DAY);
  const has = id => state.list.some(i => i.id === id);
  const steps = [];
  steps.push({ d: 14, title: '오래 걸리는 것부터', items: [
    c.intl && '여권 유효기간 확인 (입국일 기준 6개월 이상 남았는지)',
    (has('stroller') || has('carrier')) && `${[has('stroller') && '유모차', has('carrier') && '캐리어'].filter(Boolean).join(', ')}처럼 큰 물건은 미리 주문`,
    has('walking_shoes') && '새 신발은 지금 사서 미리 신어 보기',
  ] });
  steps.push({ d: 7, title: '부족한 준비물 주문', items: [
    '아래 "아직 없는 것" 목록 주문하기. 로켓배송은 보통 다음 날 오지만, 판매자 배송은 며칠 걸릴 수 있어요.',
    c.intl && '유심이나 eSIM 구매',
    c.intl && '환전과 해외 결제 카드 확인',
  ] });
  steps.push({ d: 3, title: '날씨 다시 보기', items: [
    '출발 15일 전부터는 실제 일기예보가 나와요. 짐꾸림에서 다시 확인하면 우산, 겉옷을 더 정확히 고를 수 있어요.',
  ] });
  steps.push({ d: 1, title: '짐 싸는 날', items: [
    '보조배터리와 기기 모두 충전',
    c.flight && c.intl && '기내 액체류는 100ml 이하 용기에 담아 투명 지퍼백 하나로',
    c.flight && '보조배터리는 위탁 수하물이 아니라 몸에 지니고 탑승 (1인 2개까지, 기내 사용 금지)',
    c.intl && '여권, 탑승권, 숙소 주소를 한곳에',
  ] });

  $('#schedule-lead').textContent = left > 0 ? `출발까지 ${left}일 남았어요.` : '오늘 출발이에요. 빠진 것만 확인하세요.';
  $('#schedule').innerHTML = steps.map(s => {
    const date = new Date(c.start.getTime() - s.d * DAY);
    const past = date < today;
    const items = s.items.filter(Boolean);
    if (!items.length) return '';
    return `
      <li class="${past ? 'now' : ''}">
        <div class="sch-when"><b>${past ? '지금' : `D-${s.d}`}</b><span>${past ? '날짜가 지났어요' : fmtDate(date)}</span></div>
        <div class="sch-what"><h4>${esc(s.title)}</h4><ul>${items.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
      </li>`;
  }).join('');
}

function syncOwned() {
  const onlyMissing = $('#only-missing').checked;
  let ownedCount = 0;
  $$('#list .item').forEach(row => {
    const owned = state.owned.has(row.dataset.id);
    if (owned) ownedCount++;
    row.classList.toggle('owned', owned);
    row.classList.toggle('hidden-owned', owned && onlyMissing);
    $('.owned-badge', row).hidden = !owned;
  });
  const total = state.list.length;
  $('#progress-text').textContent = `${total}개 중 ${ownedCount}개 준비됨`;
  $('#progress-bar').style.width = total ? `${(ownedCount / total) * 100}%` : '0';
  renderBuyList();
}

function renderBuyList() {
  const need = state.list.filter(it => !state.owned.has(it.id));
  const buyable = need.filter(it => it.buy);
  const notBuy = need.filter(it => !it.buy);
  $('#buylist').innerHTML = need.length === 0
    ? `<h3>다 챙겼어요</h3><p class="done">이제 떠나기만 하면 돼요.</p>`
    : `<h3>아직 없는 것 ${need.length}개</h3>
       <p>${buyable.length ? `이름을 누르면 해당 준비물 설명으로 이동해요.` : ''}${notBuy.length ? ` 직접 챙길 것: ${notBuy.map(i => i.name).join(', ')}` : ''}</p>
       <ul>${need.map(it => `<li><a href="#chk-${it.id}">${esc(it.name)}</a></li>`).join('')}</ul>`;
}

// ── 지도 ──
// 지도 그림: OpenFreeMap (무료·키 불필요·상업적 사용 가능), 그리는 도구: MapLibre GL
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
let mapLibReady = null;
function loadMapLib() {
  if (window.maplibregl) return Promise.resolve();
  if (mapLibReady) return mapLibReady;
  mapLibReady = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
    js.onload = resolve;
    js.onerror = reject;
    document.head.appendChild(js);
    setTimeout(() => reject(new Error('timeout')), 10000);
  });
  mapLibReady.catch(() => { mapLibReady = null; });
  return mapLibReady;
}

function pin(label, kind) {
  const el = document.createElement('div');
  el.className = `map-pin ${kind}`;
  el.innerHTML = `<span>${esc(label)}</span>`;
  return el;
}

let mapObj = null;
async function renderMap(c) {
  const d = c.dest, r = state.route;
  const enc = encodeURIComponent;
  const links = [];
  if (d.domestic) {
    if (r) {
      links.push(['카카오맵 길찾기', `https://map.kakao.com/link/from/${enc(r.from.name)},${r.from.lat},${r.from.lon}/to/${enc(d.name)},${d.lat},${d.lon}`]);
      links.push(['네이버 지도에서 보기', `https://map.naver.com/p/search/${enc(d.name)}`]);
      links.push(['구글 지도 대중교통', `https://www.google.com/maps/dir/?api=1&origin=${enc(r.from.name)}&destination=${enc(d.name)}&travelmode=transit`]);
    } else {
      links.push(['카카오맵에서 보기', `https://map.kakao.com/?q=${enc(d.name)}`]);
      links.push(['네이버 지도에서 보기', `https://map.naver.com/p/search/${enc(d.name)}`]);
    }
  } else {
    links.push(['구글 지도에서 보기', `https://www.google.com/maps/search/?api=1&query=${enc(d.name + ' ' + d.country)}`]);
  }
  $('#map-links').innerHTML = links.map(([t, u]) => `<a class="btn-line" href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`).join('');

  let lead;
  if (d.domestic && r) {
    const road = r.km * 1.25;
    const hours = Math.max(0.5, Math.round((road / 75) * 2) / 2);
    lead = c.transport === 'car'
      ? `${r.from.name}에서 ${d.name}까지 직선거리로 약 ${r.km}km예요. 차로는 보통 ${hours}시간 안팎 걸리고, 휴게소와 교통 상황에 따라 더 걸릴 수 있어요. 정확한 경로는 카카오맵 길찾기로 확인하세요.`
      : `${r.from.name}에서 ${d.name}까지 직선거리로 약 ${r.km}km예요. 기차·버스·비행기 시간표는 아래 길찾기에서 확인하세요.`;
  } else if (d.domestic) {
    lead = d.located ? `${d.name} 주변 지도예요. 출발지를 함께 입력하면 거리와 길찾기를 보여 드려요.` : `"${d.name}" 위치를 정확히 찾지 못했어요. 시·군 이름을 함께 적으면 더 정확해져요.`;
  } else {
    lead = `${d.name} 지도예요. 숙소와 가고 싶은 곳의 거리를 미리 보면 동선 짜기가 쉬워요.`;
  }
  $('#map-lead').textContent = lead;

  const box = $('#map');
  const fail = () => { box.innerHTML = '<p class="map-fallback">지도를 불러오지 못했어요. 아래 버튼으로 지도 앱에서 확인하세요.</p>'; };
  try {
    await loadMapLib();
    if (mapObj) { mapObj.remove(); mapObj = null; }
    box.innerHTML = '';
    const to = [d.lon, d.lat];
    mapObj = new maplibregl.Map({
      container: box, style: MAP_STYLE, center: to, zoom: d.domestic ? 10 : 9,
      scrollZoom: false, attributionControl: { compact: true },
    });
    mapObj.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    // 지명을 한국어 이름 우선으로 표시
    mapObj.on('style.load', () => {
      mapObj.getStyle().layers.forEach(l => {
        if (l.type === 'symbol' && l.layout && l.layout['text-field']) {
          mapObj.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:ko'], ['get', 'name']]);
        }
      });
    });
    mapObj.on('error', e => { if (e && e.error && /style|Failed to fetch/i.test(String(e.error.message))) fail(); });
    new maplibregl.Marker({ element: pin(r ? `도착 · ${d.name}` : d.name, 'to'), anchor: 'bottom' }).setLngLat(to).addTo(mapObj);
    if (r) {
      const from = [r.from.lon, r.from.lat];
      new maplibregl.Marker({ element: pin(`출발 · ${r.from.name}`, 'from'), anchor: 'bottom' }).setLngLat(from).addTo(mapObj);
      mapObj.fitBounds([from, to], { padding: { top: 70, bottom: 40, left: 50, right: 50 }, duration: 0, maxZoom: 12 });
      mapObj.on('load', () => {
        mapObj.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [from, to] } } });
        mapObj.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#1D2B5C', 'line-width': 3, 'line-dasharray': [2, 2] } });
      });
    }
  } catch {
    fail();
  }
}

// ── 가볼 만한 곳 ──
const KAKAO_CATS = [['AT4', '가볼 만한 곳'], ['FD6', '맛집'], ['CE7', '카페']];

function placeList(items) {
  return `<ul class="place-list">${items.map(p => `
    <li><a href="${esc(p.url)}" target="_blank" rel="noopener">
      <b>${esc(p.name)}</b>
      <span>${esc([p.category, p.address].filter(Boolean).join(' · '))}</span>
    </a></li>`).join('')}</ul>`;
}

async function kakaoNear(lat, lon, cat, radius = 10000) {
  const j = await fetchJSON(`/api/places?type=near&cat=${cat}&x=${lon}&y=${lat}&radius=${radius}`, 8000);
  return j.places || [];
}

async function renderPlaces(c) {
  const d = c.dest;
  const enc = encodeURIComponent;
  const gid = d.domestic ? d.guideId : d.id;
  const g = gid && DEST_GUIDE[gid];
  const parts = [];

  if (g) {
    parts.push(`
      <div class="guide-card">
        <p class="guide-intro">${esc(g.intro)}</p>
        <p class="guide-meta"><b>언제 가면 좋을까</b> ${esc(g.best)} ${esc(g.weather)}</p>
      </div>
      <div class="spot-grid">
        <div><h3>꼭 가 볼 곳</h3><ul class="spot-list">${g.sights.map(([n, t]) => `<li><b>${esc(n)}</b><span>${esc(t)}</span></li>`).join('')}</ul></div>
        <div><h3>먹어 볼 것</h3><ul class="spot-list">${g.foods.map(([n, t]) => `<li><b>${esc(n)}</b><span>${esc(t)}</span></li>`).join('')}</ul></div>
      </div>
      <p class="guide-more"><a href="guides/${gid}.html">${esc(d.name)} 여행 가이드 전체 보기</a></p>`);
  }

  const live = d.domestic && state.kakaoEnabled && d.located;
  if (live) parts.push('<div id="live-places"><p class="shop-loading">주변 장소를 찾는 중…</p></div>');

  const q = d.domestic ? d.name : `${d.name}`;
  const searches = d.domestic
    ? [['카카오맵 맛집', `https://map.kakao.com/?q=${enc(q + ' 맛집')}`], ['카카오맵 가볼만한곳', `https://map.kakao.com/?q=${enc(q + ' 가볼만한곳')}`], ['네이버 지도 맛집', `https://map.naver.com/p/search/${enc(q + ' 맛집')}`]]
    : [['구글 지도 맛집', `https://www.google.com/maps/search/${enc(q + ' 맛집')}`], ['구글 지도 관광지', `https://www.google.com/maps/search/${enc(q + ' 관광지')}`]];
  parts.push(`<div class="map-links">${searches.map(([t, u]) => `<a class="btn-line" href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`).join('')}</div>`);

  $('#places-lead').textContent = g
    ? (live ? '짐꾸림이 정리한 추천에 더해, 지도에 등록된 주변 장소를 함께 보여 드려요.' : '짐꾸림이 정리한 추천이에요. 실시간 리뷰와 영업 정보는 지도 앱에서 확인하세요.')
    : (live ? '지도에 등록된 주변 장소예요. 리뷰와 영업시간은 장소를 눌러 확인하세요.' : `${d.name} 주변 장소는 지도 앱에서 바로 찾아볼 수 있어요.`);
  $('#places').innerHTML = parts.join('');

  if (!live) return;
  try {
    const groups = await Promise.all(KAKAO_CATS.map(([cat]) => kakaoNear(d.lat, d.lon, cat, cat === 'AT4' ? 15000 : 5000)));
    let html = KAKAO_CATS.map(([, label], i) => groups[i].length ? `<h3>${esc(d.name)} 주변 ${label}</h3>${placeList(groups[i].slice(0, 6))}` : '').join('');
    const r = state.route;
    if (r && r.km >= 60 && c.transport === 'car') {
      const mid = { lat: (r.from.lat + d.lat) / 2, lon: (r.from.lon + d.lon) / 2 };
      const way = await kakaoNear(mid.lat, mid.lon, 'AT4', 20000);
      if (way.length) html += `<h3>가는 길에 들르기 좋은 곳</h3><p class="block-lead">출발지와 도착지 사이 중간쯤에 있는 곳이에요. 휴게소 대신 쉬어 가기 좋아요.</p>${placeList(way.slice(0, 5))}`;
    }
    $('#live-places').innerHTML = html || '<p class="block-lead">주변 장소를 찾지 못했어요.</p>';
  } catch {
    $('#live-places').innerHTML = '';
  }
}

// 최종 승인 후 API가 켜졌을 때만 동작
async function loadApiProducts() {
  const slots = $$('#list [data-api]');
  for (const slot of slots) {
    const kw = slot.dataset.api;
    try {
      const j = await fetchJSON(`/api/products?keyword=${encodeURIComponent(kw)}`, 10000);
      const items = (j.products || []).slice(0, 3);
      if (!items.length) throw new Error('none');
      slot.innerHTML = items.map(p => `
        <a class="shop-link" href="${esc(p.url)}" target="_blank" rel="sponsored noopener">
          <span>${esc(p.name)}${p.rocket ? '<small>로켓배송</small>' : ''}</span>
          <span class="price">${Number(p.price).toLocaleString('ko-KR')}원</span>
        </a>`).join('');
    } catch {
      slot.innerHTML = searchLink(kw);
    }
  }
}

// ── 실행 ──
async function onSubmit(e) {
  e.preventDefault();
  const f = readForm();
  const err = validate(f);
  const errEl = $('#form-error');
  errEl.hidden = !err;
  errEl.textContent = err;
  if (err) return;

  store.set('jk:trip', f);
  const btn = $('#submit-btn');
  btn.disabled = true;
  btn.textContent = '현지 날씨를 확인하는 중…';

  let dest;
  if (f.mode === 'domestic') {
    btn.textContent = '장소를 찾는 중…';
    const res = await resolveDomestic(f);
    dest = res.dest;
    state.route = res.route;
    btn.textContent = '현지 날씨를 확인하는 중…';
  } else {
    dest = DESTINATIONS.find(d => d.id === f.dest);
    state.route = null;
  }
  const w = await getWeather(dest, parseISO(f.start), parseISO(f.end));
  state.ctx = buildContext(f, dest, w);
  if (window.jkTrack) {
    const kids = f.kids + f.infants;
    window.jkTrack({ type: 'plan', path: location.pathname, k1: f.mode, k2: dest.name,
      k3: [`${f.adults + f.seniors + kids}명`, kids ? '아이 동반' : '', f.seniors ? '어르신 동반' : ''].filter(Boolean).join(' · ') });
  }
  state.list = pickItems(state.ctx);

  renderSummary(state.ctx);
  renderBrief(state.ctx);
  renderList();
  renderSchedule(state.ctx);
  $('#result').hidden = false;
  renderMap(state.ctx);
  renderPlaces(state.ctx);
  btn.disabled = false;
  btn.textContent = '다시 확인하기';
  $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function checklistText() {
  const c = state.ctx;
  const lines = [`[짐꾸림] ${c.dest.name} ${c.nights}박 ${c.days}일 준비물`, ''];
  STAGES.forEach(cat => {
    const items = state.list.filter(i => i.stage === cat.id);
    if (!items.length) return;
    lines.push(`■ ${cat.name}`);
    items.forEach(i => lines.push(`${state.owned.has(i.id) ? '☑' : '☐'} ${i.name}${i.qtyText ? ` (${i.qtyText})` : ''}`));
    lines.push('');
  });
  lines.push(location.origin);
  return lines.join('\n');
}

function initActions() {
  $('#only-missing').addEventListener('change', syncOwned);
  $('#print-btn').addEventListener('click', () => window.print());
  $('#reset-btn').addEventListener('click', () => {
    $('#result').hidden = true;
    $('#submit-btn').textContent = '준비물 확인하기';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('#copy-btn').addEventListener('click', async () => {
    const btn = $('#copy-btn');
    try {
      await navigator.clipboard.writeText(checklistText());
      btn.textContent = '복사했어요';
    } catch {
      btn.textContent = '복사가 안 되는 브라우저예요';
    }
    setTimeout(() => { btn.textContent = '체크리스트 복사'; }, 1800);
  });
}

async function checkApi() {
  try {
    const j = await fetchJSON('/api/status', 3000);
    state.apiEnabled = !!j.coupang;
    state.kakaoEnabled = !!j.kakao;
  } catch { state.apiEnabled = false; }
}

initForm();
initActions();
checkApi();

})();
