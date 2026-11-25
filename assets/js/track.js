// 방문 통계 기록 (관리자 페이지용)
// 실제 사이트(https)에서만 동작하고, 관리자로 로그인한 브라우저는 기록하지 않습니다.
(function () {
  'use strict';
  const on = /^https?:$/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname);
  let skip = false;
  try { skip = !!localStorage.getItem('jk:noTrack'); } catch { /* 저장소 사용 불가 */ }

  function send(data) {
    if (!on || skip) return;
    const body = JSON.stringify(data);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/track', body)) return;
    } catch { /* 아래 방법으로 */ }
    try { fetch('/api/track', { method: 'POST', body, keepalive: true }); } catch { /* 무시 */ }
  }
  window.jkTrack = send;

  send({ type: 'pv', path: location.pathname, ref: document.referrer });

  document.addEventListener('click', e => {
    const a = e.target.closest('a, button');
    if (!a) return;
    const itemEl = a.closest('[data-item], .item[data-id]');
    const item = itemEl ? (itemEl.dataset.item || itemEl.dataset.id) : '';
    if (a.matches('a.product')) {
      send({ type: 'click', path: location.pathname, k1: 'coupang', k2: item, k3: (a.querySelector('.product-title') || a).textContent.trim() });
    } else if (a.matches('a.shop-link.search')) {
      send({ type: 'click', path: location.pathname, k1: 'coupang-search', k2: item });
    } else if (a.closest('#map-links')) {
      send({ type: 'click', path: location.pathname, k1: 'map', k2: a.textContent.trim() });
    } else if (a.closest('.place-list')) {
      send({ type: 'click', path: location.pathname, k1: 'place', k2: (a.querySelector('b') || a).textContent.trim() });
    } else if (a.closest('#places .map-links')) {
      send({ type: 'click', path: location.pathname, k1: 'place-search', k2: a.textContent.trim() });
    } else if (a.matches('#copy-btn, #print-btn')) {
      send({ type: 'tool', path: location.pathname, k1: a.id === 'copy-btn' ? 'copy' : 'print' });
    }
  }, true);
})();
