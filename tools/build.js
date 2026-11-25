#!/usr/bin/env node
// 짐꾸림 콘텐츠 페이지 생성기
// 사용법: 저장소 맨 위에서 `node tools/build.js`
// 여행지 가이드, 준비물 가이드, 여행 팁, 안내 페이지, sitemap.xml, robots.txt, ads.txt를 만들고
// index.html에 광고 코드와 홈 링크 목록을 넣습니다.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CFG = require('./site.config.js');
const TIPS = require('./content/tips.js');
const ITEM_MORE = require('./content/item-more.js');
const TODAY = new Date().toISOString().slice(0, 10);

// ── 브라우저용 데이터 불러오기 ──
const files = ['destinations', 'items', 'guides', 'products', 'dest-content'].map(f => fs.readFileSync(path.join(ROOT, 'assets/js', f + '.js'), 'utf8'));
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(files.join('\n;\n') + `
;globalThis.__data = { DESTINATIONS, PLUG_TEXT, ITEMS, PRODUCTS, STAGES, ITEM_GUIDE, COUNTRY_TIPS, DEST_GUIDE, DOMESTIC_PICKS };`, sandbox);
const { DESTINATIONS, PLUG_TEXT, ITEMS, PRODUCTS, STAGES, ITEM_GUIDE, COUNTRY_TIPS, DEST_GUIDE, DOMESTIC_PICKS } = sandbox.__data;

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const won = n => `${Number(n).toLocaleString('ko-KR')}원`;
const pages = [];

function write(rel, html) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  pages.push(rel);
}

const prettyUrl = rel => '/' + rel.replace(/index\.html$/, '').replace(/\.html$/, '');

function adsenseHead() {
  return CFG.ADSENSE_CLIENT
    ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(CFG.ADSENSE_CLIENT)}" crossorigin="anonymous"></script>`
    : '';
}

function layout({ rel, title, desc, body, active, jsonld }) {
  const P = '../'.repeat(rel.split('/').length - 1);
  const nav = [['', '준비물 체크'], ['guides/', '여행지 가이드'], ['items/', '준비물 가이드'], ['tips/', '여행 팁']];
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} | ${esc(CFG.SITE_NAME)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${esc(CFG.SITE_URL + prettyUrl(rel))}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${esc(CFG.SITE_NAME)}">
  <meta name="theme-color" content="#EAF2FB">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect x='12' y='4' width='40' height='56' rx='20' fill='%23D9E2EE'/><rect x='17' y='9' width='30' height='46' rx='15' fill='%235DB3F0'/><circle cx='32' cy='26' r='6' fill='%23FFF4D6'/><rect x='17' y='38' width='30' height='17' fill='%2316A3B5'/></svg>">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hahmlet:wght@500;700&display=swap">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
  <link rel="stylesheet" href="${P}assets/style.css">
  ${adsenseHead()}
  ${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
</head>
<body class="content-page">
  <header class="topbar">
    <a class="brand" href="${P || './'}">짐꾸림</a>
    <nav class="site-nav" aria-label="사이트 메뉴">
      ${nav.map(([href, label]) => `<a href="${P}${href || ''}"${active === href ? ' aria-current="page"' : ''}>${label}</a>`).join('\n      ')}
    </nav>
  </header>
  <main class="article-wrap">
${body}
  </main>
  <footer class="footer">
    <p class="disclosure">이 사이트는 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.</p>
    <p>준비물 안내는 참고용이니 항공사와 현지 규정을 꼭 확인하세요.</p>
    <p class="footer-links"><a href="${P}about.html">짐꾸림 소개</a> <a href="${P}privacy.html">개인정보처리방침</a> <a href="${P}terms.html">이용약관</a> <a href="${P}contact.html">문의</a></p>
  </footer>
  <script src="${P}assets/js/track.js" defer></script>
</body>
</html>
`;
}

const crumbs = (P, list) => `<nav class="crumbs" aria-label="현재 위치"><a href="${P || './'}">홈</a>${list.map(([href, t]) => href ? ` <span>/</span> <a href="${P}${href}">${esc(t)}</a>` : ` <span>/</span> <span>${esc(t)}</span>`).join('')}</nav>`;

function productBlock(id, P, max = 5) {
  const list = (PRODUCTS[id] || []).slice(0, max);
  if (!list.length) return '';
  return `
    <section>
      <h2>짐꾸림이 고른 상품</h2>
      <p class="muted">평점과 후기 수를 기준으로 골랐어요. 가격과 배송 조건은 쿠팡에서 바뀔 수 있어요.</p>
      <div class="shop">${list.map(p => `
        <a class="product" href="${esc(p.url)}" target="_blank" rel="sponsored noopener">
          ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" width="64" height="64" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
          <span class="product-text"><span class="product-title">${esc(p.title)}</span>
          <span class="product-meta"><b>${won(p.price)}</b> ${p.rating && p.reviews ? `★ ${p.rating} (${Number(p.reviews).toLocaleString('ko-KR')})` : ''} ${p.rocket ? '<span class="rocket">로켓배송</span>' : ''}</span></span>
        </a>`).join('')}
      </div>
      <p class="inline-disclosure">이 상품 링크는 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.</p>
    </section>`;
}

// ── 대표 상황으로 준비물 고르기 (여행지 가이드용) ──
function baseCtx(dest, w, extra = {}) {
  const purposes = new Set(['tour', ...(extra.purposes || [])]);
  const transport = dest.domestic && !dest.flyIn ? 'car' : 'flight';
  const days = 5, nights = 4;
  return {
    dest, w, nights, days, adults: 2, kids: 0, infants: 0, seniors: 0, people: 2, kidsAll: 0, purposes, transport,
    flight: transport === 'flight', intl: !dest.domestic, longFlight: transport === 'flight' && dest.flight >= 6,
    cold: w.tmin <= 3 || w.lowest <= 0, cool: w.tmin <= 14, hot: w.tmax >= 28,
    rainy: w.rainDays >= 2, bags: 1,
  };
}
function itemsFor(ctx) {
  return ITEMS.filter(it => { try { return it.when(ctx); } catch { return false; } })
    .map(it => ({ ...it, level: typeof it.level === 'function' ? it.level(ctx) : it.level, whyText: it.why(ctx) }));
}
const SEASONS = {
  temperate: { warm: { tmin: 22, tmax: 30, lowest: 20, rainDays: 2 }, cold: { tmin: -2, tmax: 6, lowest: -5, rainDays: 1 } },
  mild: { warm: { tmin: 24, tmax: 31, lowest: 22, rainDays: 2 }, cold: { tmin: 3, tmax: 11, lowest: 0, rainDays: 1 } },
  cold: { warm: { tmin: 15, tmax: 25, lowest: 12, rainDays: 1 }, cold: { tmin: -8, tmax: 0, lowest: -12, rainDays: 2 } },
  southern: { warm: { tmin: 19, tmax: 27, lowest: 17, rainDays: 1 }, cold: { tmin: 9, tmax: 17, lowest: 6, rainDays: 1 } },
  tropical: { warm: { tmin: 25, tmax: 32, lowest: 24, rainDays: 2 } },
};

// ── 여행지 가이드 ──
const domesticDests = DOMESTIC_PICKS.map(p => ({
  id: p.id, name: p.name, country: '대한민국', group: '국내', lat: p.lat, lon: p.lon, plug: 'ok', voltage: 220, domestic: true,
  flight: p.id === 'jeju' ? 1 : 0, flyIn: p.id === 'jeju',
  climate: p.id === 'jeju' ? 'mild' : (p.id === 'pyeongchang' ? 'cold' : 'temperate'),
}));
const abroadDests = DESTINATIONS.filter(d => !d.domestic);
const allDests = [...domesticDests, ...abroadDests].filter(d => DEST_GUIDE[d.id]);

function destPage(d) {
  const g = DEST_GUIDE[d.id];
  const rel = `guides/${d.id}.html`;
  const P = '../';
  const seasons = SEASONS[d.climate] || SEASONS.temperate;
  const beach = d.climate === 'tropical' ? ['beach'] : [];
  const lists = Object.entries(seasons).map(([k, w]) => [k, itemsFor(baseCtx(d, w, { purposes: beach }))]);
  const common = lists.length > 1 ? lists[0][1].filter(a => lists[1][1].some(b => b.id === a.id)) : lists[0][1];
  const only = k => { const l = lists.find(x => x[0] === k); return l ? l[1].filter(a => !common.some(c => c.id === a.id)) : []; };
  const itemLi = it => `<li><a href="${P}items/${it.id}.html"><b>${esc(it.name)}</b></a>${it.level === 'must' ? ' <span class="tag tag-must">필수</span>' : ''}<span>${esc(it.whyText)}</span></li>`;
  const tips = [...(g.tips || []), ...(d.domestic ? [] : (COUNTRY_TIPS[d.country] || []))];
  const cta = d.domestic ? `${P}index.html?to=${encodeURIComponent(d.name.split('·')[0])}` : `${P}index.html?dest=${d.id}`;
  const siblings = allDests.filter(x => x.group === d.group && x.id !== d.id).slice(0, 6);
  const facts = d.domestic
    ? [['지역', '대한민국'], ['전기', '220V, 한국 콘센트 그대로'], ['추천 시기', g.best]]
    : [['나라', d.country], ['비행시간', `인천에서 약 ${d.flight}시간`], ['전기', `${PLUG_TEXT[d.plug]}, ${d.voltage}V`], ['추천 시기', g.best]];

  const body = `
    ${crumbs(P, [['guides/', '여행지 가이드'], [null, d.name]])}
    <article class="article">
      <p class="kicker">${esc(d.group)} 여행 가이드</p>
      <h1>${esc(d.name)} 여행 준비 가이드</h1>
      <p class="lead">${esc(g.intro)}</p>
      <dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>

      <h2>언제 가면 좋을까</h2>
      <p>${esc(g.best)} ${esc(g.weather)}</p>

      <h2>꼭 가 볼 곳</h2>
      <ul class="spot-list">${g.sights.map(([n, t]) => `<li><b>${esc(n)}</b><span>${esc(t)}</span></li>`).join('')}</ul>

      <h2>먹어 볼 것</h2>
      <ul class="spot-list">${g.foods.map(([n, t]) => `<li><b>${esc(n)}</b><span>${esc(t)}</span></li>`).join('')}</ul>
      <p class="muted">가게는 문을 닫거나 바뀌는 일이 잦아 특정 식당 대신 지역 대표 음식을 적었어요. 최신 영업 정보는 지도 앱에서 확인하세요.</p>

      <h2>${d.domestic ? '여행 전에 알아 두면 좋은 것' : `${esc(d.country)}에서 알아 두면 좋은 것`}</h2>
      <ul>${tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>

      <h2>${esc(d.name)} 여행에 챙길 준비물</h2>
      <p>어른 두 명이 4박 5일 ${d.domestic && !d.flyIn ? '차로' : '비행기로'} 다녀오는 일정을 기준으로 골랐어요. 아이나 어르신과 함께라면 짐꾸림 준비물 체크에서 인원을 넣어 다시 확인해 보세요.</p>
      <h3>계절과 상관없이</h3>
      <ul class="item-links">${common.map(itemLi).join('')}</ul>
      ${only('warm').length && lists.length > 1 ? `<h3>더운 계절에 더 챙길 것</h3><ul class="item-links">${only('warm').map(itemLi).join('')}</ul>` : ''}
      ${only('cold').length ? `<h3>추운 계절에 더 챙길 것</h3><ul class="item-links">${only('cold').map(itemLi).join('')}</ul>` : ''}

      <div class="cta-box">
        <p><b>우리 가족 일정으로 다시 확인해 보세요.</b> 여행 날짜의 실제 날씨와 동행자에 맞춰 준비물을 골라 드려요.</p>
        <a class="btn-go" href="${cta}">${esc(d.name)} 준비물 확인하기</a>
      </div>

      ${siblings.length ? `<h2>${esc(d.group)}의 다른 여행지</h2><ul class="chip-links">${siblings.map(s => `<li><a href="${s.id}.html">${esc(s.name)}</a></li>`).join('')}</ul>` : ''}
    </article>`;
  write(rel, layout({
    rel, active: 'guides/', title: `${d.name} 여행 준비물과 가볼 만한 곳`,
    desc: `${d.name} 여행 전에 알아 둘 날씨, ${d.domestic ? '' : '콘센트와 전압, '}꼭 가 볼 곳과 먹어 볼 것, 계절별로 챙길 준비물을 정리했어요.`,
    body,
    jsonld: { '@context': 'https://schema.org', '@type': 'Article', headline: `${d.name} 여행 준비 가이드`, dateModified: TODAY, inLanguage: 'ko' },
  }));
}

function guidesIndex() {
  const rel = 'guides/index.html';
  const groups = {};
  allDests.forEach(d => (groups[d.group] ||= []).push(d));
  const body = `
    ${crumbs('../', [[null, '여행지 가이드']])}
    <article class="article">
      <h1>여행지 가이드</h1>
      <p class="lead">여행지마다 날씨, 콘센트, 현지 사정이 달라서 챙길 짐도 달라져요. 떠나기 전에 여행지를 먼저 알아 두세요. 가볼 만한 곳과 먹어 볼 것, 계절별 준비물을 함께 정리했어요.</p>
      ${Object.entries(groups).map(([g, list]) => `
        <h2>${esc(g)}</h2>
        <div class="card-grid">${list.map(d => `
          <a class="link-card" href="${d.id}.html"><b>${esc(d.name)}</b><span>${esc(DEST_GUIDE[d.id].intro)}</span></a>`).join('')}
        </div>`).join('')}
    </article>`;
  write(rel, layout({ rel, active: 'guides/', title: '여행지 가이드', desc: '국내와 해외 인기 여행지의 날씨, 콘센트, 가볼 만한 곳, 먹어 볼 것, 챙길 준비물을 정리한 여행 준비 가이드예요.', body }));
}

// ── 준비물 가이드 ──
const tipsFor = id => TIPS.filter(t => (t.related || []).includes(id));

// 준비물이 필요한 여행지 계산 (계절별 대표 상황 기준)
const destNeeds = {};
allDests.forEach(d => {
  const seasons = SEASONS[d.climate] || SEASONS.temperate;
  const beach = d.climate === 'tropical' ? ['beach'] : [];
  Object.entries(seasons).forEach(([k, w]) => {
    itemsFor(baseCtx(d, w, { purposes: beach })).forEach(it => {
      ((destNeeds[it.id] ||= {})[d.id] ||= new Set()).add(k);
    });
  });
});

function destNeedBlock(it, P) {
  const map = destNeeds[it.id] || {};
  const ids = Object.keys(map);
  if (!ids.length) return `<h2>어떤 여행에 필요할까</h2><p>여행지보다 여행 방식에 따라 필요해요. ${esc((STAGES.find(s => s.id === (ITEM_GUIDE[it.id] || {}).stage) || {}).lead || '')} 짐꾸림 준비물 체크에서 여행 목적과 동행자를 넣으면 필요한지 알려 드려요.</p>`;
  if (ids.length >= allDests.length - 1) return `<h2>어떤 여행에 필요할까</h2><p>짐꾸림 여행지 가이드에 있는 ${allDests.length}곳 거의 모든 여행에서 챙기라고 권하는 기본 준비물이에요. 어디로 가든 짐 목록 맨 위에 두세요.</p>`;
  const seasonal = ids.filter(id => map[id].size === 1 && Object.keys(SEASONS[allDests.find(d => d.id === id).climate] || {}).length > 1);
  const always = ids.filter(id => !seasonal.includes(id));
  const link = id => { const d = allDests.find(x => x.id === id); return `<li><a href="${P}guides/${id}.html">${esc(d.name)}</a></li>`; };
  const seasonWord = id => [...map[id]][0] === 'cold' ? '추운 계절' : '더운 계절';
  return `<h2>어떤 여행에 필요할까</h2>
    <p>짐꾸림 여행지 가이드의 ${allDests.length}곳 가운데 ${ids.length}곳에서 이 준비물을 챙기라고 권해요. 어른 두 명이 4박 5일 다녀오는 일정을 기준으로 계산했어요.</p>
    ${always.length ? `<h3>계절과 상관없이 필요한 여행지</h3><ul class="chip-links">${always.map(link).join('')}</ul>` : ''}
    ${seasonal.length ? `<h3>계절에 따라 필요한 여행지</h3><ul class="chip-links">${seasonal.map(id => link(id).replace('</a>', ` <small>${seasonWord(id)}</small></a>`)).join('')}</ul>` : ''}`;
}

function itemPage(it) {
  const g = ITEM_GUIDE[it.id] || {};
  const stage = STAGES.find(s => s.id === g.stage);
  const rel = `items/${it.id}.html`;
  const P = '../';
  const sameStage = ITEMS.filter(x => x.id !== it.id && (ITEM_GUIDE[x.id] || {}).stage === g.stage).slice(0, 8);
  const tips = tipsFor(it.id);
  const body = `
    ${crumbs(P, [['items/', '준비물 가이드'], [null, it.name]])}
    <article class="article" data-item="${it.id}">
      <p class="kicker">${stage ? esc(stage.name) : '여행 준비물'}</p>
      <h1>${esc(it.name)}, 왜 챙겨야 할까</h1>
      ${g.scene ? `<blockquote class="scene">${esc(g.scene)}</blockquote>` : ''}
      <p class="lead">${esc(ITEM_MORE[it.id] || '')}</p>

      ${g.tips ? `<h2>${it.buy ? '이렇게 고르세요' : '이것만 확인하세요'}</h2><ul>${g.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}

      ${stage ? `<h2>언제 필요할까: ${esc(stage.name)}</h2><p>${esc(stage.lead)}</p>` : ''}

      ${destNeedBlock(it, P)}

      ${it.buy ? productBlock(it.id, P) : ''}

      ${tips.length ? `<h2>함께 읽으면 좋은 글</h2><ul class="chip-links">${tips.map(t => `<li><a href="${P}tips/${t.slug}.html">${esc(t.title)}</a></li>`).join('')}</ul>` : ''}

      ${sameStage.length ? `<h2>같은 때 함께 챙기면 좋은 것</h2><ul class="chip-links">${sameStage.map(x => `<li><a href="${x.id}.html">${esc(x.name)}</a></li>`).join('')}</ul>` : ''}

      <div class="cta-box">
        <p><b>내 여행에 정말 필요한지 확인해 보세요.</b> 여행지와 날짜, 동행자를 넣으면 필요한 준비물만 골라 드려요.</p>
        <a class="btn-go" href="${P}index.html">준비물 확인하기</a>
      </div>
    </article>`;
  write(rel, layout({
    rel, active: 'items/', title: `${it.name} 여행 준비물 가이드`,
    desc: `${it.name}이(가) 여행에서 필요한 순간과 고르는 법, 짐꾸림이 고른 상품을 정리했어요.`,
    body,
    jsonld: { '@context': 'https://schema.org', '@type': 'Article', headline: `${it.name}, 왜 챙겨야 할까`, dateModified: TODAY, inLanguage: 'ko' },
  }));
}

function itemsIndex() {
  const rel = 'items/index.html';
  const body = `
    ${crumbs('../', [[null, '준비물 가이드']])}
    <article class="article">
      <h1>준비물 가이드</h1>
      <p class="lead">여행 준비물을 떠나기 전부터 돌아오는 길까지 순서대로 정리했어요. 준비물마다 필요한 순간과 고르는 법을 담았어요.</p>
      ${STAGES.map((s, i) => {
        const list = ITEMS.filter(x => (ITEM_GUIDE[x.id] || {}).stage === s.id);
        return `<h2>${i + 1}. ${esc(s.name)}</h2><p>${esc(s.lead)}</p>
        <div class="card-grid">${list.map(x => `<a class="link-card" href="${x.id}.html"><b>${esc(x.name)}</b><span>${esc((ITEM_GUIDE[x.id] || {}).scene || '')}</span></a>`).join('')}</div>`;
      }).join('')}
    </article>`;
  write(rel, layout({ rel, active: 'items/', title: '여행 준비물 가이드', desc: '여권부터 보조배터리, 멀티 어댑터, 압축 파우치까지. 여행 준비물이 필요한 순간과 고르는 법을 정리했어요.', body }));
}

// ── 여행 팁 ──
function plugTable() {
  return `<table><thead><tr><th>여행지</th><th>콘센트</th><th>전압</th></tr></thead><tbody>${abroadDests.map(d => `<tr><td>${esc(d.name)} (${esc(d.country)})</td><td>${esc(PLUG_TEXT[d.plug])}</td><td>${d.voltage}V</td></tr>`).join('')}</tbody></table>`;
}

function tipPage(t) {
  const rel = `tips/${t.slug}.html`;
  const P = '../';
  const related = (t.related || []).map(id => ITEMS.find(x => x.id === id)).filter(Boolean);
  const others = TIPS.filter(x => x.slug !== t.slug).slice(0, 5);
  const body = `
    ${crumbs(P, [['tips/', '여행 팁'], [null, t.title]])}
    <article class="article">
      <p class="kicker">여행 팁</p>
      <h1>${esc(t.title)}</h1>
      <p class="meta">마지막 수정 ${esc(t.updated || TODAY)}</p>
      ${t.body.replace('{{plug_table}}', plugTable())}
      ${related.length ? `<h2>이 글과 관련된 준비물</h2><div class="card-grid">${related.map(x => `<a class="link-card" href="${P}items/${x.id}.html"><b>${esc(x.name)}</b><span>${esc((ITEM_GUIDE[x.id] || {}).scene || '')}</span></a>`).join('')}</div>` : ''}
      <div class="cta-box">
        <p><b>내 여행에 맞춰 준비물을 골라 드려요.</b> 여행지와 날짜, 동행자만 넣어 보세요.</p>
        <a class="btn-go" href="${P}index.html">준비물 확인하기</a>
      </div>
      <h2>다른 여행 팁</h2>
      <ul class="chip-links">${others.map(o => `<li><a href="${o.slug}.html">${esc(o.title)}</a></li>`).join('')}</ul>
    </article>`;
  write(rel, layout({ rel, active: 'tips/', title: t.title, desc: t.desc, body,
    jsonld: { '@context': 'https://schema.org', '@type': 'Article', headline: t.title, dateModified: t.updated || TODAY, inLanguage: 'ko' } }));
}

function tipsIndex() {
  const rel = 'tips/index.html';
  const body = `
    ${crumbs('../', [[null, '여행 팁']])}
    <article class="article">
      <h1>여행 팁</h1>
      <p class="lead">짐 싸기 전에 알아 두면 공항과 여행지에서 덜 헤매요. 기내 반입 규정부터 아이와 함께하는 여행까지 정리했어요.</p>
      <div class="card-grid">${TIPS.map(t => `<a class="link-card" href="${t.slug}.html"><b>${esc(t.title)}</b><span>${esc(t.desc)}</span></a>`).join('')}</div>
    </article>`;
  write(rel, layout({ rel, active: 'tips/', title: '여행 팁', desc: '보조배터리·액체류 기내 반입 규정, 나라별 콘센트, 아이와 첫 해외여행, 겨울·동남아 여행 준비까지 여행 준비 팁을 모았어요.', body }));
}

// ── 안내 페이지 ──
function staticPages() {
  const mail = CFG.CONTACT_EMAIL
    ? `<a href="mailto:${esc(CFG.CONTACT_EMAIL)}">${esc(CFG.CONTACT_EMAIL)}</a>`
    : '<span class="todo">tools/site.config.js의 CONTACT_EMAIL에 문의 이메일을 넣고 다시 만들어 주세요.</span>';

  const simple = (rel, title, desc, html) => write(rel, layout({ rel, title, desc, body: `${crumbs('', [[null, title]])}<article class="article"><h1>${esc(title)}</h1>${html}</article>` }));

  simple('about.html', '짐꾸림 소개', '짐꾸림은 여행지와 날씨, 함께 가는 사람에 맞춰 필요한 준비물만 골라 주는 여행 준비 서비스예요.', `
    <p class="lead">짐꾸림은 "이번 여행에 뭘 챙겨야 하지?"라는 질문에 답하려고 만든 여행 준비 서비스예요.</p>
    <h2>무엇을 하나요</h2>
    <p>여행지와 날짜, 함께 가는 사람을 입력하면 현지 날씨와 콘센트 모양, 전압, 비행시간, 아이 나이까지 따져서 필요한 준비물을 골라 드려요. 이미 가진 물건은 체크해서 빼고, 부족한 것만 정리할 수 있어요.</p>
    <h2>어떻게 고르나요</h2>
    <ul>
      <li>날씨는 Open-Meteo의 일기예보와 과거 관측 자료를 사용해요.</li>
      <li>준비물은 여행 단계(떠나기 전, 공항, 숙소, 현지, 돌아오는 길)에 따라 필요한 이유와 고르는 법을 함께 안내해요.</li>
      <li>여행지 가이드와 여행 팁은 짐꾸림이 직접 정리했어요. 규정은 바뀔 수 있으니 출발 전에 항공사와 공식 안내를 함께 확인해 주세요.</li>
    </ul>
    <h2>수익에 대해</h2>
    <p>짐꾸림은 쿠팡 파트너스 활동과 광고로 운영돼요. 상품 링크를 통해 구매가 이루어지면 일정액의 수수료를 받을 수 있어요. 수수료는 상품 가격에 영향을 주지 않으며, 추천 기준은 평점과 후기, 여행에서의 쓰임새예요.</p>
    <h2>문의</h2><p>${mail}</p>`);

  simple('privacy.html', '개인정보처리방침', '짐꾸림의 개인정보 처리 방침과 쿠키·광고에 대한 안내예요.', `
    <p class="meta">시행일 ${TODAY}</p>
    <p>짐꾸림(이하 "사이트")은 이용자의 개인정보를 소중히 다루며, 관련 법령을 지키기 위해 아래와 같이 개인정보처리방침을 공개합니다.</p>
    <h2>1. 수집하는 정보</h2>
    <p>사이트는 회원가입을 받지 않으며 이름, 연락처 같은 개인정보를 직접 수집하지 않습니다. 이용자가 입력한 여행지, 날짜, 인원, "이미 있어요" 체크 내용은 이용자의 브라우저 저장소(localStorage)에만 저장되며 사이트 운영자에게 전송되지 않습니다.</p>
    <h2>2. 외부 서비스로 전송되는 정보</h2>
    <ul>
      <li><b>날씨 조회</b>: 여행지의 좌표와 날짜가 Open-Meteo로 전송됩니다.</li>
      <li><b>장소 검색</b>: 국내 여행에서 입력한 출발지·도착지 이름이 카카오 로컬 API 또는 OpenStreetMap Nominatim으로 전송될 수 있습니다.</li>
      <li><b>지도 표시</b>: 지도를 불러올 때 OpenFreeMap 지도 서버와 지도 라이브러리(unpkg) 서버에 접속합니다.</li>
    </ul>
    <h2>2-1. 이용 통계</h2>
    <p>서비스 개선을 위해 방문한 페이지 주소, 유입 사이트 주소, 기기 종류(모바일·PC), 방문 시각, 준비물 확인에 입력한 여행지와 인원 수, 상품·지도 링크 클릭 여부를 사이트 운영 서버(Cloudflare)에 기록합니다. IP 주소는 저장하지 않으며, 같은 날 같은 방문자를 구분하기 위한 익명 값(IP와 브라우저 정보를 섞어 되돌릴 수 없게 만든 값)만 저장합니다. 기록은 최대 400일 동안 보관한 뒤 삭제합니다.</p>
    <h2>3. 쿠키와 광고</h2>
    <p>사이트는 Google 애드센스 광고를 게재할 수 있습니다. Google을 포함한 제3자 공급업체는 쿠키를 사용하여 이용자가 이 사이트나 다른 웹사이트를 방문한 기록을 바탕으로 광고를 게재합니다. Google은 광고 쿠키를 사용하여 이용자의 방문 기록을 바탕으로 맞춤 광고를 제공할 수 있습니다.</p>
    <p>이용자는 <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener">Google 광고 설정</a>에서 맞춤 광고를 해제할 수 있으며, <a href="https://www.aboutads.info" target="_blank" rel="noopener">www.aboutads.info</a>에서 제3자 공급업체의 맞춤 광고용 쿠키 사용을 해제할 수 있습니다. 브라우저 설정에서 쿠키 저장을 거부할 수도 있습니다.</p>
    <h2>4. 제휴 링크</h2>
    <p>사이트의 상품 링크는 쿠팡 파트너스 제휴 링크입니다. 링크를 누르면 쿠팡으로 이동하며, 쿠팡은 자체 방침에 따라 쿠키 등을 사용할 수 있습니다. 쿠팡에서의 정보 처리는 쿠팡의 개인정보처리방침을 따릅니다.</p>
    <h2>5. 문의</h2>
    <p>개인정보와 관련한 문의는 아래로 연락해 주세요.<br>${mail}</p>
    <h2>6. 방침의 변경</h2>
    <p>이 방침이 바뀌면 이 페이지를 통해 알려 드립니다.</p>`);

  simple('terms.html', '이용약관', '짐꾸림 이용약관이에요.', `
    <p class="meta">시행일 ${TODAY}</p>
    <h2>1. 서비스 내용</h2>
    <p>짐꾸림은 여행 준비물 추천, 여행지 가이드, 여행 팁 정보를 무료로 제공합니다.</p>
    <h2>2. 정보의 정확성</h2>
    <p>사이트의 날씨, 규정, 장소 정보는 참고용입니다. 항공 반입 규정, 입국 요건, 영업 정보 등은 바뀔 수 있으므로 이용자는 출발 전에 항공사, 대사관, 공식 기관의 최신 안내를 확인해야 합니다. 사이트 정보를 이용해 발생한 손해에 대해 사이트는 책임지지 않습니다.</p>
    <h2>3. 제휴 및 광고</h2>
    <p>사이트에는 쿠팡 파트너스 제휴 링크와 광고가 포함될 수 있습니다. 상품의 구매, 배송, 환불은 해당 판매처의 정책을 따릅니다.</p>
    <h2>4. 저작권</h2>
    <p>사이트의 글과 디자인의 저작권은 짐꾸림에 있습니다. 출처를 밝히고 링크하는 것은 자유롭게 할 수 있지만, 무단 복제와 배포는 할 수 없습니다.</p>
    <h2>5. 문의</h2><p>${mail}</p>`);

  simple('contact.html', '문의', '짐꾸림에 의견이나 제휴, 정보 수정 요청을 보내 주세요.', `
    <p class="lead">잘못된 정보를 발견하셨거나, 추가했으면 하는 여행지와 준비물이 있다면 알려 주세요.</p>
    <p>이메일: ${mail}</p>
    <p class="muted">보내 주신 의견은 확인 후 사이트에 반영할게요. 답장까지 며칠 걸릴 수 있어요.</p>`);
}

// ── 홈 화면 링크 목록·광고 코드 넣기 ──
function patchIndex() {
  const file = path.join(ROOT, 'index.html');
  let s = fs.readFileSync(file, 'utf8');
  const home = `<!-- home-links:start -->
    <section class="home-links" aria-labelledby="home-guides">
      <h2 id="home-guides">여행지 가이드</h2>
      <ul class="chip-links">${allDests.slice(0, 20).map(d => `<li><a href="guides/${d.id}.html">${esc(d.name)}</a></li>`).join('')}<li><a href="guides/">전체 보기</a></li></ul>
      <h2>떠나기 전에 읽어 보세요</h2>
      <div class="card-grid">${TIPS.slice(0, 6).map(t => `<a class="link-card" href="tips/${t.slug}.html"><b>${esc(t.title)}</b><span>${esc(t.desc)}</span></a>`).join('')}</div>
    </section>
    <!-- home-links:end -->`;
  s = s.replace(/<!-- home-links:start -->[\s\S]*?<!-- home-links:end -->/, home);
  s = s.replace(/<!-- adsense:start -->[\s\S]*?<!-- adsense:end -->/, `<!-- adsense:start -->${adsenseHead()}<!-- adsense:end -->`);
  fs.writeFileSync(file, s);
}

// ── 실행 ──
guidesIndex();
allDests.forEach(destPage);
itemsIndex();
ITEMS.forEach(itemPage);
tipsIndex();
TIPS.forEach(tipPage);
staticPages();
patchIndex();

const urls = ['index.html', ...pages].map(rel => `  <url><loc>${CFG.SITE_URL}${prettyUrl(rel)}</loc><lastmod>${TODAY}</lastmod></url>`);
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
fs.writeFileSync(path.join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /tools/\nDisallow: /functions/\n\nSitemap: ${CFG.SITE_URL}/sitemap.xml\n`);
if (CFG.ADSENSE_CLIENT) {
  fs.writeFileSync(path.join(ROOT, 'ads.txt'), `google.com, ${CFG.ADSENSE_CLIENT.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n`);
}
console.log(`페이지 ${pages.length}개를 만들었어요. (sitemap에는 홈 포함 ${urls.length}개)`);
