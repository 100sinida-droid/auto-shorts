// 비행기 창밖 풍경 (여행지마다 다른 하늘과 땅)
// 사진 없이 SVG로 그려서 가볍고, 저작권 걱정이 없습니다.

const PALETTES = {
  above:    { sky: ['#4F7FD9', '#9DBDF0', '#FFD9B0'], sun: '#FFF4D6', glow: '#FFE2A8', ground: '#FFFFFF' },
  tropical: { sky: ['#1F7FE0', '#5DB3F0', '#BFE8FA'], sun: '#FFFDF0', glow: '#FFFFFF', sea: ['#16A3B5', '#0B6F8C'], land: '#2E7D6B' },
  golden:   { sky: ['#5874C9', '#F1A7A1', '#FFD79A'], sun: '#FFF1C4', glow: '#FFC98A', sea: ['#E7A88D', '#5B6FA8'], land: '#3D4C86' },
  dusk:     { sky: ['#283174', '#7E5AA6', '#FF9F7C'], sun: '#FFC58C', glow: '#FF9F7C', silhouette: '#1F2458', light: '#FFD98A' },
  europe:   { sky: ['#3B5BA5', '#9A9BC8', '#F6C9A0'], sun: '#FFEFD0', glow: '#F6C9A0', silhouette: '#2B3366', light: '#FFE2A6' },
  winter:   { sky: ['#7FA6DA', '#B9D2EE', '#EEF4FB'], sun: '#FFFFFF', glow: '#FFFFFF', ridges: ['#A9BFDF', '#7895C2', '#4E6A9C'], snow: '#FFFFFF' },
  coast:    { sky: ['#4A86D8', '#9CC6EE', '#F6E3C4'], sun: '#FFF6DE', glow: '#FFE9C0', sea: ['#3C8FC4', '#1D5F94'], ridges: ['#8FB0CF', '#5F87AE', '#3E6690'] },
};

const SCENE_OF = {
  jeju: ['coast', 'coast'], busan: ['coast', 'coast'], gangneung: ['coast', 'coast'], gyeongju: ['mountain', 'coast'],
  seoul: ['city', 'golden'], sokcho: ['coast', 'coast'], jeonju: ['mountain', 'coast'], yeosu: ['sea', 'golden'], tongyeong: ['coast', 'coast'],
  andong: ['mountain', 'coast'], pyeongchang: ['snow', 'winter'], chuncheon: ['mountain', 'coast'],
  tokyo: ['city', 'dusk'], osaka: ['city', 'dusk'], fukuoka: ['city', 'dusk'], sapporo: ['snow', 'winter'], okinawa: ['sea', 'tropical'],
  taipei: ['city', 'dusk'], hongkong: ['city', 'dusk'], shanghai: ['city', 'dusk'],
  danang: ['sea', 'tropical'], nhatrang: ['sea', 'tropical'], bangkok: ['city', 'dusk'], phuket: ['sea', 'tropical'],
  cebu: ['sea', 'tropical'], singapore: ['city', 'dusk'], bali: ['sea', 'tropical'],
  guam: ['sea', 'tropical'], saipan: ['sea', 'tropical'], hawaii: ['sea', 'tropical'],
  la: ['city', 'europe'], newyork: ['city', 'dusk'], sydney: ['sea', 'golden'],
  paris: ['city', 'europe'], rome: ['city', 'europe'], barcelona: ['sea', 'golden'], london: ['city', 'europe'], swiss: ['snow', 'winter'],
};

function sceneOf(dest) {
  if (!dest) return ['clouds', 'above'];
  return SCENE_OF[dest.id] || SCENE_OF[dest.guideId] || (dest.domestic ? ['coast', 'coast'] : ['clouds', 'above']);
}

function rng(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6D2B79F5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 400, H = 500;

function sceneSVG(dest) {
  const [type, pal] = sceneOf(dest);
  const P = PALETTES[pal];
  const seed = dest ? (dest.id === 'domestic' ? 'd-' + (dest.name || '') : dest.id) : 'above';
  const r = rng(seed);
  const uid = seed.replace(/[^a-z0-9]/gi, '') + Math.floor(r() * 1e6);

  const sunX = 120 + r() * 160;
  const horizon = type === 'clouds' ? 330 : type === 'city' ? 360 : 330;
  const sunY = horizon - 70 - r() * 90;

  let body = '';

  if (type === 'clouds') {
    for (let layer = 0; layer < 4; layer++) {
      const y = 330 + layer * 48;
      const op = 0.55 + layer * 0.15;
      let x = -40;
      while (x < W + 40) {
        const rad = 30 + r() * 40 + layer * 6;
        body += `<circle cx="${x.toFixed(0)}" cy="${(y + r() * 14).toFixed(0)}" r="${rad.toFixed(0)}" fill="#fff" opacity="${op.toFixed(2)}"/>`;
        x += rad * 1.1;
      }
      body += `<rect x="0" y="${y + 10}" width="${W}" height="${H}" fill="#fff" opacity="${op.toFixed(2)}"/>`;
    }
  }

  if (type === 'sea' || type === 'coast') {
    if (type === 'coast') {
      body += ridges(P.ridges.slice(0, 2), horizon, r, 2, 60);
    } else {
      // 먼 섬
      const ix = r() < 0.5 ? 30 + r() * 80 : 260 + r() * 80;
      body += `<path d="M${ix - 70} ${horizon} Q${ix} ${horizon - 34 - r() * 20} ${ix + 80} ${horizon} Z" fill="${P.land}" opacity=".75"/>`;
    }
    body += `<rect x="0" y="${horizon}" width="${W}" height="${H - horizon}" fill="url(#sea${uid})"/>`;
    // 햇빛 반사
    for (let i = 0; i < 9; i++) {
      const y = horizon + 10 + i * 16 + r() * 6;
      const w = 50 - i * 3 + r() * 30;
      body += `<rect x="${(sunX - w / 2 + (r() - .5) * 20).toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="3" rx="1.5" fill="${P.sun}" opacity="${(0.7 - i * 0.06).toFixed(2)}"/>`;
    }
  }

  if (type === 'city') {
    body += skyline(P.silhouette, horizon - 10, r, 0.45, 150, null);
    body += skyline(P.silhouette, horizon + 30, r, 1, 120, P.light);
    body += `<rect x="0" y="${horizon + 30}" width="${W}" height="${H}" fill="${P.silhouette}"/>`;
  }

  if (type === 'mountain' || type === 'snow') {
    body += ridges(P.ridges, horizon + 40, r, 3, 150, type === 'snow' ? P.snow : null);
  }

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="sky${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${P.sky[0]}"/><stop offset=".6" stop-color="${P.sky[1]}"/><stop offset="1" stop-color="${P.sky[2]}"/>
      </linearGradient>
      <radialGradient id="glow${uid}"><stop offset="0" stop-color="${P.glow}" stop-opacity=".9"/><stop offset="1" stop-color="${P.glow}" stop-opacity="0"/></radialGradient>
      ${P.sea ? `<linearGradient id="sea${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.sea[0]}"/><stop offset="1" stop-color="${P.sea[1]}"/></linearGradient>` : ''}
    </defs>
    <rect width="${W}" height="${H}" fill="url(#sky${uid})"/>
    <circle cx="${sunX.toFixed(0)}" cy="${sunY.toFixed(0)}" r="150" fill="url(#glow${uid})"/>
    <circle cx="${sunX.toFixed(0)}" cy="${sunY.toFixed(0)}" r="30" fill="${P.sun}"/>
    ${body}
  </svg>`;
}

function skyline(color, base, r, opacity, maxH, light) {
  let s = '', x = -10;
  while (x < W + 10) {
    const w = 18 + r() * 34;
    const h = 30 + r() * maxH;
    s += `<rect x="${x.toFixed(0)}" y="${(base - h).toFixed(0)}" width="${w.toFixed(0)}" height="${(h + 40).toFixed(0)}" fill="${color}" opacity="${opacity}"/>`;
    if (r() < 0.25) s += `<rect x="${(x + w / 2 - 1).toFixed(0)}" y="${(base - h - 18).toFixed(0)}" width="2" height="18" fill="${color}" opacity="${opacity}"/>`;
    if (light) {
      for (let wy = base - h + 8; wy < base - 6; wy += 11) {
        for (let wx = x + 4; wx < x + w - 5; wx += 8) {
          if (r() < 0.18) s += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="3" height="4" fill="${light}" opacity=".85"/>`;
        }
      }
    }
    x += w + 1;
  }
  return s;
}

function ridges(colors, base, r, count, amp, snow) {
  let s = '';
  for (let i = 0; i < count; i++) {
    const y0 = base - amp + i * (amp / 2.2);
    const pts = [];
    const peaks = [];
    let x = -20;
    while (x <= W + 20) {
      const up = r() < 0.5;
      const y = y0 + (up ? -1 : 1) * r() * amp * 0.45;
      pts.push(`${x.toFixed(0)},${y.toFixed(0)}`);
      if (up) peaks.push([x, y]);
      x += 40 + r() * 50;
    }
    s += `<polygon points="-20,${H} ${pts.join(' ')} ${W + 20},${H}" fill="${colors[i] || colors[colors.length - 1]}"/>`;
    if (snow && i === 0) {
      peaks.forEach(([px, py]) => {
        s += `<polygon points="${(px - 16).toFixed(0)},${(py + 16).toFixed(0)} ${px.toFixed(0)},${py.toFixed(0)} ${(px + 16).toFixed(0)},${(py + 16).toFixed(0)}" fill="${snow}" opacity=".9"/>`;
      });
    }
  }
  return s;
}
