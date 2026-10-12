"""사이트에 들어가는 그림(삽화)과 지도.

모두 직접 그린 벡터 그림이라 저작권 걱정 없이 쓸 수 있고, 파일을 따로 두지 않고 페이지 안에 바로 넣는다.
실제 사진으로 바꾸고 싶으면 _builder/static/img/ 폴더에 아래 이름으로 사진(jpg/webp/png)을 넣으면 그 사진이 대신 쓰인다.
  home, bongan, funeral, crematorium, price, recommend, ranking, guide, search, info
"""
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _flower(cx, cy, r, petals=16, color="#ffffff", core="#f1d27a", rot=0):
    """국화 한 송이: 겹꽃잎 두 겹 + 꽃술."""
    out = []
    for layer, (rr, n, op) in enumerate(((r, petals, 1), (r * .68, petals - 4, .95))):
        for i in range(n):
            a = rot + i * 360 / n + layer * 11
            out.append(f'<ellipse cx="{cx}" cy="{cy - rr * .52:.1f}" rx="{rr * .17:.1f}" ry="{rr * .52:.1f}" '
                       f'transform="rotate({a:.1f} {cx} {cy})" fill="{color}" opacity="{op}"/>')
    out.append(f'<circle cx="{cx}" cy="{cy}" r="{r * .22:.1f}" fill="{core}"/>')
    return "".join(out)


def _pine(x, y, s=1.0, c1="#2c5446", c2="#3d6b59"):
    """소나무 한 그루 (구름 모양 잎)."""
    return (f'<g transform="translate({x} {y}) scale({s})">'
            f'<path d="M-4 0 C-2 -40 -8 -70 2 -110 L8 -110 C2 -70 6 -40 6 0Z" fill="#5b4632"/>'
            f'<path d="M2 -70 L-30 -82M4 -92 L34 -104" stroke="#5b4632" stroke-width="5" stroke-linecap="round"/>'
            f'<ellipse cx="-34" cy="-88" rx="34" ry="13" fill="{c1}"/><ellipse cx="38" cy="-110" rx="38" ry="14" fill="{c2}"/>'
            f'<ellipse cx="4" cy="-128" rx="42" ry="16" fill="{c1}"/><ellipse cx="0" cy="-146" rx="26" ry="11" fill="{c2}"/></g>')


def _tree(x, y, s=1.0, c="#4f7f69"):
    return (f'<g transform="translate({x} {y}) scale({s})"><rect x="-3" y="-30" width="6" height="30" fill="#6b5640"/>'
            f'<ellipse cx="0" cy="-52" rx="24" ry="30" fill="{c}"/><ellipse cx="-8" cy="-60" rx="10" ry="14" fill="#ffffff" opacity=".12"/></g>')


def _birds(x, y):
    return "".join(f'<path d="M{x + dx} {y + dy} q6 -6 12 0 q6 -6 12 0" fill="none" stroke="#5b5148" stroke-width="2.2" stroke-linecap="round" opacity=".6"/>'
                   for dx, dy in ((0, 0), (40, -18), (70, 10)))


def _hall(x, y, s=1.0):
    """기와지붕을 얹은 추모관(봉안당) 건물."""
    return (f'<g transform="translate({x} {y}) scale({s})">'
            f'<rect x="-150" y="-14" width="300" height="18" rx="2" fill="#d9cfbd"/><rect x="-170" y="2" width="340" height="14" rx="2" fill="#c8bca6"/>'
            f'<rect x="-120" y="-96" width="240" height="84" fill="#f6f1e6"/>'
            + "".join(f'<rect x="{cx - 5}" y="-96" width="10" height="84" fill="#8a5a3c"/>' for cx in (-115, -62, -10, 42, 110))
            + f'<rect x="-36" y="-70" width="56" height="58" fill="#6b4a33"/><rect x="-32" y="-66" width="23" height="54" fill="#a8774f"/><rect x="-5" y="-66" width="21" height="54" fill="#a8774f"/>'
            + f'<rect x="-100" y="-74" width="30" height="34" fill="#cfe0da"/><rect x="62" y="-74" width="30" height="34" fill="#cfe0da"/>'
            f'<path d="M-118 -66 h40 M-118 -50 h40" stroke="#8a5a3c" stroke-width="2"/>'
            f'<rect x="-128" y="-108" width="256" height="14" fill="#7b5a40"/>'
            f'<path d="M-190 -104 Q-120 -118 -96 -150 L96 -150 Q120 -118 190 -104 Q200 -112 206 -122 Q150 -120 120 -160 L-120 -160 Q-150 -120 -206 -122 Q-200 -112 -190 -104Z" fill="#2f3b37"/>'
            f'<path d="M-120 -160 Q0 -176 120 -160 L104 -184 Q0 -196 -104 -184Z" fill="#3c4a45"/>'
            f'<path d="M-112 -186 Q0 -200 112 -186" stroke="#2f3b37" stroke-width="6" fill="none" stroke-linecap="round"/>'
            f'<path d="M-180 -110 Q-110 -124 -92 -150 M180 -110 Q110 -124 92 -150" stroke="#55635d" stroke-width="2" fill="none"/></g>')


def _landscape(p, sky=("#f5e2c8", "#fbf6ec"), sun=(860, 150)):
    return (f'<defs><linearGradient id="{p}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{sky[0]}"/><stop offset="1" stop-color="{sky[1]}"/></linearGradient>'
            f'<radialGradient id="{p}g"><stop offset="0" stop-color="#fff3d6"/><stop offset="1" stop-color="#fff3d6" stop-opacity="0"/></radialGradient>'
            f'<linearGradient id="{p}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4c7d68"/><stop offset="1" stop-color="#2f5e4e"/></linearGradient></defs>'
            f'<rect width="1200" height="500" fill="url(#{p}s)"/>'
            f'<circle cx="{sun[0]}" cy="{sun[1]}" r="190" fill="url(#{p}g)"/><circle cx="{sun[0]}" cy="{sun[1]}" r="58" fill="#f6cf94" opacity=".9"/>'
            f'<path d="M0 300 C120 230 220 250 330 210 C450 170 520 240 640 205 C760 170 860 230 980 190 C1080 160 1150 200 1200 190 V500 H0Z" fill="#cbd8cd"/>'
            f'<path d="M0 340 C150 290 260 310 380 280 C520 245 600 300 720 280 C860 255 980 300 1200 260 V500 H0Z" fill="#a3bdaf"/>'
            f'<ellipse cx="420" cy="300" rx="260" ry="16" fill="#ffffff" opacity=".45"/><ellipse cx="1000" cy="285" rx="200" ry="12" fill="#ffffff" opacity=".4"/>')


def scene_home(p="ah"):
    return (_landscape(p, sun=(1010, 140)) + _birds(560, 110) + _birds(1060, 70)
            + f'<path d="M0 400 C200 350 380 360 560 340 C700 325 820 330 1000 350 C1100 362 1160 360 1200 356 V500 H0Z" fill="url(#{p}h)"/>'
            + _hall(930, 352, .9) + _pine(720, 372, 1.0) + _pine(1150, 376, .85, "#2a4f42", "#376452")
            + _tree(640, 382, 1.0) + _tree(800, 380, .85, "#5b8a73") + _tree(80, 400, .9, "#5b8a73")
            + '<path d="M910 500 C920 450 940 420 930 372 L950 372 C960 420 970 450 1010 500Z" fill="#e8dcc4" opacity=".85"/>'
            + "".join(f'<circle cx="{x}" cy="{y}" r="5" fill="#ffffff"/><circle cx="{x}" cy="{y}" r="2" fill="#f1d27a"/>' for x, y in ((680, 430), (708, 445), (1050, 440), (1080, 455), (840, 450), (1130, 430))))


def scene_bongan(p="ab"):
    return (_landscape(p, ("#e7efe8", "#f8f7f1"), (300, 140)) + _birds(820, 110)
            + f'<path d="M0 410 C250 370 520 372 760 360 C960 352 1100 368 1200 372 V500 H0Z" fill="url(#{p}h)"/>'
            + _hall(700, 372, 1.15) + _pine(420, 400, 1.15) + _pine(980, 398, 1.05, "#2a4f42", "#376452")
            + _tree(1100, 400, 1.2) + _tree(330, 404, 1.0, "#5b8a73")
            + '<path d="M660 500 L680 372 L720 372 L740 500Z" fill="#e8dcc4" opacity=".9"/>')


def scene_funeral(p="af"):
    flowers = "".join(_flower(x, y, r, 16, "#ffffff", "#f3d98b", rot)
                      for x, y, r, rot in ((640, 250, 52, 0), (560, 290, 46, 8), (720, 295, 48, 4), (600, 205, 40, 12), (690, 200, 42, 2),
                                           (520, 230, 36, 6), (770, 240, 38, 9), (640, 320, 44, 3), (480, 300, 34, 5), (810, 310, 36, 7)))
    yel = "".join(_flower(x, y, r, 14, "#f6e3a1", "#d8a93c", 3) for x, y, r in ((545, 345, 28), (745, 350, 30)))
    return (f'<defs><linearGradient id="{p}s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a3350"/><stop offset="1" stop-color="#5c4d86"/></linearGradient>'
            f'<radialGradient id="{p}g"><stop offset="0" stop-color="#ffe2a8" stop-opacity=".9"/><stop offset="1" stop-color="#ffe2a8" stop-opacity="0"/></radialGradient></defs>'
            f'<rect width="1200" height="500" fill="url(#{p}s)"/>'
            f'<rect x="0" y="380" width="1200" height="120" fill="#2c2740"/><rect x="0" y="378" width="1200" height="6" fill="#7a6aa6" opacity=".5"/>'
            f'<circle cx="980" cy="250" r="150" fill="url(#{p}g)"/><rect x="964" y="270" width="32" height="112" rx="4" fill="#f5efe2"/>'
            f'<path d="M980 228 C968 246 970 262 980 266 C990 262 992 246 980 228Z" fill="#ffcf6b"/>'
            f'<circle cx="260" cy="250" r="110" fill="url(#{p}g)" opacity=".5"/><rect x="246" y="290" width="28" height="92" rx="4" fill="#f5efe2"/>'
            f'<path d="M260 254 C250 270 252 282 260 286 C268 282 270 270 260 254Z" fill="#ffcf6b"/>'
            '<path d="M560 380 L580 330 L700 330 L720 380Z" fill="#e9e3d6"/>'
            '<g fill="#3f6b4f">' + "".join(f'<ellipse cx="{x}" cy="{y}" rx="34" ry="11" transform="rotate({a} {x} {y})"/>'
                                          for x, y, a in ((470, 340, -25), (820, 340, 25), (500, 270, -40), (790, 270, 35), (640, 360, 0), (600, 350, -10), (690, 352, 12))) + '</g>'
            + flowers + yel)


def scene_crematorium(p="ac"):
    return (f'<defs><linearGradient id="{p}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe8ee"/><stop offset="1" stop-color="#f4f6f4"/></linearGradient>'
            f'<linearGradient id="{p}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bcd3dc"/><stop offset="1" stop-color="#e3edf0"/></linearGradient></defs>'
            f'<rect width="1200" height="500" fill="url(#{p}s)"/>'
            '<path d="M0 300 C200 250 400 270 600 240 C800 215 1000 260 1200 230 V500 H0Z" fill="#c6d4cc"/>'
            '<rect x="0" y="360" width="1200" height="140" fill="#7fa08e"/>'
            '<rect x="430" y="220" width="460" height="140" fill="#f3f1ec"/><rect x="410" y="206" width="500" height="18" fill="#59656a"/>'
            '<rect x="600" y="150" width="220" height="70" fill="#e9e6df"/><rect x="590" y="140" width="240" height="14" fill="#59656a"/>'
            + "".join(f'<rect x="{x}" y="240" width="46" height="96" fill="#8fb2c0"/><rect x="{x}" y="240" width="46" height="96" fill="#ffffff" opacity=".18"/>' for x in range(450, 880, 60))
            + "".join(f'<rect x="{x}" y="166" width="34" height="40" fill="#8fb2c0"/>' for x in range(615, 820, 50))
            + '<rect x="420" y="356" width="480" height="10" fill="#cfc8ba"/>'
            '<path d="M380 400 H940 L980 470 H340Z" fill="url(#acw)" opacity=".9"/>'
            '<path d="M440 420 H880 M420 440 H900" stroke="#ffffff" stroke-width="2" opacity=".6"/>'
            + _tree(330, 368, 1.6) + _tree(260, 372, 1.2, "#5b8a73") + _tree(990, 368, 1.5) + _tree(1080, 374, 1.15, "#5b8a73") + _pine(160, 380, .9) + _birds(700, 90))


def scene_price(p="ap"):
    coins = "".join(f'<ellipse cx="{cx}" cy="{cy - i * 14}" rx="54" ry="16" fill="{"#d9a441" if i % 2 else "#e8b950"}" stroke="#b5832a" stroke-width="2"/>'
                    for cx, cy, n in ((830, 380, 6), (950, 390, 4)) for i in range(n))
    return (f'<defs><linearGradient id="{p}s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbeedd"/><stop offset="1" stop-color="#f6dcc0"/></linearGradient></defs>'
            f'<rect width="1200" height="500" fill="url(#{p}s)"/>'
            '<rect x="0" y="400" width="1200" height="100" fill="#c98f5a"/><rect x="0" y="398" width="1200" height="8" fill="#a8703f"/>'
            '<g transform="rotate(-6 560 260)"><rect x="430" y="90" width="270" height="320" rx="8" fill="#ffffff" stroke="#e2d4c2" stroke-width="2"/>'
            '<rect x="460" y="120" width="140" height="16" rx="4" fill="#9a4f12"/>'
            + "".join(f'<rect x="460" y="{y}" width="120" height="9" rx="3" fill="#d8cbb9"/><rect x="600" y="{y}" width="70" height="9" rx="3" fill="#b9a68e"/>' for y in range(170, 360, 32))
            + '<path d="M460 365 H670" stroke="#9a4f12" stroke-width="3"/></g>'
            '<rect x="250" y="250" width="140" height="160" rx="12" fill="#3b4a54"/><rect x="266" y="266" width="108" height="34" rx="4" fill="#cfe3d8"/>'
            + "".join(f'<rect x="{266 + c * 38}" y="{314 + r * 30}" width="30" height="22" rx="4" fill="{"#e8b950" if c == 2 and r == 2 else "#6c7d88"}"/>' for r in range(3) for c in range(3))
            + coins
            + '<text x="830" y="314" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="30" fill="#8a5a14">₩</text>'
            '<rect x="720" y="150" width="12" height="190" rx="4" fill="#2f5e4e" transform="rotate(28 726 245)"/>')


def scene_recommend(p="ar"):
    return (f'<defs><linearGradient id="{p}s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e2edf7"/><stop offset="1" stop-color="#cfe0f0"/></linearGradient></defs>'
            f'<rect width="1200" height="500" fill="url(#{p}s)"/><circle cx="1020" cy="110" r="120" fill="#ffffff" opacity=".35"/>'
            '<rect x="0" y="410" width="1200" height="90" fill="#9fbad4"/>'
            '<rect x="420" y="70" width="250" height="330" rx="16" fill="#8b6b4a"/><rect x="440" y="96" width="210" height="290" rx="6" fill="#ffffff"/>'
            '<rect x="500" y="56" width="90" height="34" rx="8" fill="#5f6b74"/>'
            + "".join(f'<rect x="464" y="{y}" width="34" height="34" rx="6" fill="#e7f0f8" stroke="#1f5b8f" stroke-width="3"/>'
                      f'<path d="M471 {y + 17} l8 9 l14 -18" stroke="#1f5b8f" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
                      f'<rect x="512" y="{y + 8}" width="{w}" height="12" rx="4" fill="#c4d3e0"/>' for y, w in ((130, 110), (190, 90), (250, 116), (310, 80)))
            + '<rect x="720" y="230" width="260" height="170" rx="22" fill="#1f5b8f"/><rect x="720" y="230" width="260" height="56" rx="22" fill="#2a6ea8"/>'
            '<rect x="900" y="296" width="96" height="64" rx="14" fill="#174a75"/><circle cx="930" cy="328" r="10" fill="#e8b950"/>'
            '<ellipse cx="800" cy="226" rx="44" ry="12" fill="#e8b950"/><ellipse cx="800" cy="214" rx="44" ry="12" fill="#f1c862"/>'
            '<text x="800" y="221" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="16" fill="#8a5a14">₩</text>')


def scene_ranking(p="ak"):
    lau = "".join(f'<ellipse cx="{600 + sx * (70 + math.sin(t) * 8):.0f}" cy="{230 - t * 26:.0f}" rx="9" ry="20" fill="#5f8a3a" transform="rotate({sx * (30 + t * 12):.0f} {600 + sx * (70 + math.sin(t) * 8):.0f} {230 - t * 26:.0f})"/>'
                  for sx in (-1, 1) for t in range(5))
    conf = "".join(f'<rect x="{x}" y="{y}" width="10" height="16" rx="2" fill="{c}" transform="rotate({a} {x} {y})"/>'
                   for x, y, c, a in ((300, 90, "#e8b950", 20), (380, 150, "#1f5b8f", -30), (860, 80, "#9a4f12", 40), (930, 160, "#2f5e4e", -10),
                                      (250, 200, "#5a4a8a", 60), (980, 230, "#e8b950", 15), (460, 60, "#2f5e4e", -50), (760, 50, "#5a4a8a", 25)))
    return (f'<defs><linearGradient id="{p}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf3dc"/><stop offset="1" stop-color="#f3e3b5"/></linearGradient>'
            f'<linearGradient id="{p}t" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d9a441"/><stop offset=".5" stop-color="#f6d77e"/><stop offset="1" stop-color="#c48f2e"/></linearGradient></defs>'
            f'<rect width="1200" height="500" fill="url(#{p}s)"/>' + conf
            + '<rect x="0" y="440" width="1200" height="60" fill="#d8c08a"/>'
            '<rect x="520" y="300" width="160" height="140" fill="#80620a"/><rect x="360" y="350" width="160" height="90" fill="#9c8a6e"/><rect x="680" y="375" width="160" height="65" fill="#a6764a"/>'
            '<text x="600" y="395" text-anchor="middle" font-family="sans-serif" font-weight="800" font-size="64" fill="#fff6dc">1</text>'
            '<text x="440" y="420" text-anchor="middle" font-family="sans-serif" font-weight="800" font-size="50" fill="#f7f1e6">2</text>'
            '<text x="760" y="428" text-anchor="middle" font-family="sans-serif" font-weight="800" font-size="44" fill="#f7efe6">3</text>'
            + lau +
            f'<path d="M550 120 H650 V160 C650 205 625 228 600 230 C575 228 550 205 550 160Z" fill="url(#{p}t)"/>'
            '<path d="M550 135 C520 135 515 175 552 186 M650 135 C680 135 685 175 648 186" stroke="#c48f2e" stroke-width="8" fill="none"/>'
            '<rect x="590" y="230" width="20" height="36" fill="#c48f2e"/><rect x="565" y="264" width="70" height="20" rx="4" fill="#80620a"/>'
            '<path d="M600 150 l7 14 15 2 -11 10 3 15 -14 -7 -14 7 3 -15 -11 -10 15 -2z" fill="#fff6dc"/>')


def scene_guide(p="ag"):
    return (f'<defs><linearGradient id="{p}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9eeec"/><stop offset="1" stop-color="#f3f8f5"/></linearGradient></defs>'
            f'<rect width="1200" height="500" fill="url(#{p}s)"/><circle cx="600" cy="150" r="70" fill="#f6cf94" opacity=".85"/>'
            '<path d="M380 300 C460 220 540 250 600 200 C660 250 740 220 820 300Z" fill="#9cc5bd"/>'
            '<path d="M420 300 C500 260 560 270 600 240 C640 270 700 260 780 300Z" fill="#6ea79c"/>'
            '<path d="M600 300 C590 270 610 255 600 240" stroke="#f3ead7" stroke-width="10" fill="none" stroke-linecap="round"/>'
            '<path d="M600 320 C520 290 420 290 330 310 V440 C420 420 520 420 600 450Z" fill="#ffffff" stroke="#c9ddd8" stroke-width="3"/>'
            '<path d="M600 320 C680 290 780 290 870 310 V440 C780 420 680 420 600 450Z" fill="#fbfaf6" stroke="#c9ddd8" stroke-width="3"/>'
            '<path d="M330 440 C420 420 520 420 600 450 C680 420 780 420 870 440 V456 C780 438 680 438 600 466 C520 438 420 438 330 456Z" fill="#1d6b73"/>'
            + "".join(f'<path d="M{x0} {y} C{x0 + d * 60} {y - 10} {x0 + d * 150} {y - 10} {x0 + d * 220} {y - 2}" stroke="#c3d3cf" stroke-width="6" fill="none" stroke-linecap="round"/>'
                      for x0, d in ((370, 1), (830, -1)) for y in (350, 375, 400))
            + _pine(250, 450, .9) + _pine(960, 450, .8, "#2a4f42", "#376452") + _birds(760, 100))


def scene_search(p="as"):
    return (f'<defs><linearGradient id="{p}s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8efe8"/><stop offset="1" stop-color="#d7e4da"/></linearGradient></defs>'
            f'<rect width="1200" height="500" fill="url(#{p}s)"/>'
            '<path d="M360 110 L520 80 L680 110 L840 80 V400 L680 430 L520 400 L360 430Z" fill="#fbf8f0" stroke="#cdbfa6" stroke-width="2"/>'
            '<path d="M520 80 V400 M680 110 V430" stroke="#e3d8c4" stroke-width="2"/>'
            '<path d="M380 300 C460 260 520 320 600 280 C680 240 740 300 820 250" stroke="#e8c48b" stroke-width="12" fill="none" stroke-linecap="round"/>'
            '<path d="M450 130 C470 200 440 300 500 400" stroke="#e8c48b" stroke-width="8" fill="none"/>'
            '<path d="M640 130 C700 170 760 160 820 140" stroke="#bcd7e6" stroke-width="18" fill="none" stroke-linecap="round"/>'
            '<ellipse cx="740" cy="350" rx="60" ry="30" fill="#c7dfc9"/>'
            + "".join(f'<g transform="translate({x} {y})"><path d="M0 0 C-22 -26 -22 -50 0 -54 C22 -50 22 -26 0 0Z" fill="{c}"/><circle cx="0" cy="-36" r="8" fill="#ffffff"/></g>'
                      for x, y, c in ((470, 250, "#2f5e4e"), (610, 300, "#5a4a8a"), (760, 230, "#2f5e4e"), (560, 190, "#9a4f12")))
            + '<circle cx="700" cy="250" r="90" fill="#ffffff" opacity=".35" stroke="#374151" stroke-width="18"/>'
            '<path d="M764 314 L860 410" stroke="#374151" stroke-width="30" stroke-linecap="round"/>')


def scene_info(p="ai"):
    return (f'<defs><linearGradient id="{p}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9edf1"/><stop offset="1" stop-color="#f6f7f8"/></linearGradient></defs>'
            f'<rect width="1200" height="500" fill="url(#{p}s)"/>'
            '<rect x="0" y="410" width="1200" height="90" fill="#c9d0d8"/>'
            '<rect x="470" y="150" width="300" height="200" rx="14" fill="#ffffff" stroke="#c4ccd5" stroke-width="3"/>'
            '<path d="M470 164 L620 270 L770 164" stroke="#4b5563" stroke-width="6" fill="none" stroke-linejoin="round"/>'
            '<circle cx="770" cy="160" r="36" fill="#2f5e4e"/><path d="M754 160 l11 11 20 -24" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
            + _tree(330, 412, 1.4) + _tree(900, 412, 1.2, "#5b8a73") + _pine(1020, 418, .8))


SCENES = {"home": scene_home, "bongan": scene_bongan, "funeral": scene_funeral, "crematorium": scene_crematorium,
          "price": scene_price, "recommend": scene_recommend, "ranking": scene_ranking, "guide": scene_guide,
          "search": scene_search, "info": scene_info}
_PHOTO_EXT = (".webp", ".jpg", ".jpeg", ".png")


def photo_for(key):
    """static/img/<key>.jpg 같은 사진이 있으면 그 파일 이름을 돌려준다."""
    for ext in _PHOTO_EXT:
        if (HERE / "static" / "img" / f"{key}{ext}").exists():
            return f"static/img/{key}{ext}"
    return None


def art(key, r="", cls="art", label="", align="xMidYMid"):
    """그림 한 장. 사진이 있으면 사진, 없으면 직접 그린 그림."""
    photo = photo_for(key)
    if photo:
        return f'<img class="{cls}" src="{r}{photo}" alt="{label}" loading="lazy">'
    aria = f'role="img" aria-label="{label}"' if label else 'aria-hidden="true"'
    return (f'<svg class="{cls}" viewBox="0 0 1200 500" preserveAspectRatio="{align} slice" {aria} focusable="false">'
            + SCENES[key]() + "</svg>")


# --------------------------------------------------------------------------
# 대한민국 시도 지도 (@svg-maps/south-korea, Victor Cazanave, CC BY 4.0 — 단순화해서 사용)
# --------------------------------------------------------------------------
_MAP = None


def korea_map():
    global _MAP
    if _MAP is None:
        p = HERE / "korea_map.json"
        _MAP = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"regions": {}}
    return _MAP


MAP_CREDIT = '지도: <a href="https://github.com/VictorCazanave/svg-maps" target="_blank" rel="noopener">svg-maps</a> (CC BY 4.0, 단순화)'


MAP_LABEL_POS = {"서울특별시": (152, 130), "인천광역시": (106, 140), "경기도": (196, 162), "강원특별자치도": (272, 96), "충청북도": (246, 222),
                 "충청남도": (118, 252), "세종특별자치시": (176, 244), "대전광역시": (196, 284), "전북특별자치도": (165, 346), "광주광역시": (141, 412),
                 "전라남도": (120, 472), "경상북도": (362, 232), "대구광역시": (300, 340), "울산광역시": (366, 368), "부산광역시": (344, 404),
                 "경상남도": (268, 412), "제주특별자치도": (112, 614)}


def map_svg(links, counts=None, label="지역 선택 지도"):
    """links: {시도명: href}. 시도를 누르면 그 페이지로 이동."""
    m = korea_map()
    counts = counts or {}
    hi = max(counts.values()) if counts else 0
    parts = []
    labels = []
    for sido, reg in m.get("regions", {}).items():
        href = links.get(sido)
        n = counts.get(sido, 0)
        lvl = 0 if not hi else min(4, int(4 * n / hi + .999))
        name = sido.replace("특별자치도", "").replace("특별자치시", "").replace("특별시", "").replace("광역시", "")
        name = {"충청북도": "충북", "충청남도": "충남", "전라남도": "전남", "경상북도": "경북", "경상남도": "경남", "경기도": "경기", "전북": "전북"}.get(name, name)
        x, y, w, h = reg["bbox"]
        cx, cy = x + w / 2, y + h / 2
        cx, cy = MAP_LABEL_POS.get(sido, (cx, cy))
        small = sido in ("서울특별시", "대전광역시", "광주광역시", "대구광역시", "울산광역시", "부산광역시", "세종특별자치시", "인천광역시")
        title = f"{sido}" + (f" {n:,}곳" if counts else "")
        shape = f'<path class="rg l{lvl}" d="{reg["d"]}"><title>{title}</title></path>'
        parts.append(f'<a href="{href}" aria-label="{title}">{shape}</a>' if href else shape)
        labels.append(f'<text x="{cx:.0f}" y="{cy:.0f}" class="{"ml s" if small else "ml"}">{name}</text>')
    return (f'<svg class="kmap" viewBox="{m.get("viewBox", "0 0 524 631")}" role="img" aria-label="{label}">'
            + "".join(parts) + '<g class="mlabels" aria-hidden="true">' + "".join(labels) + "</g></svg>")


def region_thumb(sido):
    """시도 모양 작은 그림 (지역 카드용)."""
    reg = korea_map().get("regions", {}).get(sido)
    if not reg:
        return ""
    x, y, w, h = reg["bbox"]
    pad = max(w, h) * .08
    return (f'<svg class="rthumb" viewBox="{x - pad:.0f} {y - pad:.0f} {w + 2 * pad:.0f} {h + 2 * pad:.0f}" aria-hidden="true" focusable="false">'
            f'<path d="{reg["d"]}"/></svg>')
