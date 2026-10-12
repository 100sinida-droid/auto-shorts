#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
봉안당 길잡이 - 정적 사이트 생성기

공공데이터포털 '보건복지부_전국 봉안시설 현황' API에서 데이터를 받아
시설별·지역별·유형별 HTML 페이지를 docs/ 폴더에 만듭니다.

사용법
  1) 인증키는 config.json 의 api_key 에 들어 있습니다.
     (환경변수 DATA_GO_KR_KEY 가 있으면 그 값을 먼저 씁니다.)
  2) 응답 필드 확인      :  python build.py --inspect
  3) 사이트 생성         :  python build.py
  4) 저장된 데이터로 재생성(API 호출 없이) :  python build.py --offline

외부 라이브러리 없이 파이썬 3.8 이상 표준 라이브러리만 사용합니다.
"""

import argparse
import datetime as dt
import hashlib
import html
import json
import os
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter, OrderedDict, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
DATA_FILE = ROOT / "data" / "facilities.json"
FIELD_MAP_FILE = ROOT / "field_map.json"

# ---------------------------------------------------------------------------
# 1. 시도 정규화
# ---------------------------------------------------------------------------

SIDO = OrderedDict([
    ("서울특별시", ("seoul", ["서울"])),
    ("부산광역시", ("busan", ["부산"])),
    ("대구광역시", ("daegu", ["대구"])),
    ("인천광역시", ("incheon", ["인천"])),
    ("광주광역시", ("gwangju", ["광주광역", "광주시"])),
    ("대전광역시", ("daejeon", ["대전"])),
    ("울산광역시", ("ulsan", ["울산"])),
    ("세종특별자치시", ("sejong", ["세종"])),
    ("경기도", ("gyeonggi", ["경기"])),
    ("강원특별자치도", ("gangwon", ["강원"])),
    ("충청북도", ("chungbuk", ["충청북", "충북"])),
    ("충청남도", ("chungnam", ["충청남", "충남"])),
    ("전북특별자치도", ("jeonbuk", ["전라북", "전북"])),
    ("전라남도", ("jeonnam", ["전라남", "전남"])),
    ("경상북도", ("gyeongbuk", ["경상북", "경북"])),
    ("경상남도", ("gyeongnam", ["경상남", "경남"])),
    ("제주특별자치도", ("jeju", ["제주"])),
])

SIDO_SHORT = {
    "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천",
    "광주광역시": "광주", "대전광역시": "대전", "울산광역시": "울산", "세종특별자치시": "세종",
    "경기도": "경기", "강원특별자치도": "강원", "충청북도": "충북", "충청남도": "충남",
    "전북특별자치도": "전북", "전라남도": "전남", "경상북도": "경북", "경상남도": "경남",
    "제주특별자치도": "제주",
}


def normalize_sido(value, address=""):
    for source in (value or "", address or ""):
        s = re.sub(r"\s+", "", source)
        if not s:
            continue
        for full, (_slug, keys) in SIDO.items():
            if s.startswith(full) or any(s.startswith(k) for k in keys):
                return full
        # "광주"만 있는 경우: 경기 광주시와 구분이 어려우므로 value일 때만 광역시로 본다
        if source is value and s.startswith("광주"):
            return "광주광역시"
    return "기타"


def sido_slug(sido):
    return SIDO[sido][0] if sido in SIDO else "etc"


# ---------------------------------------------------------------------------
# 2. API 응답 필드 매핑
#    실제 태그명을 몰라도 한글/영문 후보로 자동 연결합니다.
#    틀리면 field_map.json 에 {"name": "실제태그명"} 처럼 적어 두면 우선 적용됩니다.
# ---------------------------------------------------------------------------

FIELD_LABELS = OrderedDict([
    ("sido", "시도"), ("sigungu", "시군구"), ("name", "시설명"), ("address", "주소"),
    ("tel", "전화번호"), ("fax", "팩스번호"), ("homepage", "홈페이지"),
    ("parking_count", "주차대수"), ("kind", "공/사설 구분"),
    ("first_period", "최초안치기간"), ("ext_years", "연장가능년"), ("ext_count", "연장가능횟수"),
    ("restaurant", "식당"), ("store", "매점"), ("parking_lot", "주차장"),
    ("waiting_room", "유족대기실"), ("accessible", "장애인편의시설"),
])

# (필드, 태그를 소문자·밑줄 제거한 문자열에 대한 판정 함수) — 위에서부터 먼저 맞는 규칙이 우선
def _has(*words):
    return lambda t: any(w in t for w in words)


def _all(*words):
    return lambda t: all(w in t for w in words)


RULES = [
    ("parking_count", lambda t: _has("주차대수", "주차면")(t) or (_has("prk", "park", "주차")(t) and (t.endswith("co") or _has("cnt", "num", "count", "대수", "면수")(t)))),
    ("ext_count", lambda t: _has("연장가능횟수", "연장횟수", "횟수")(t) or (_has("ext", "prlng", "renew")(t) and _has("cnt", "co", "num", "times", "nmtm")(t))),
    ("ext_years", lambda t: _has("연장가능년", "연장기간", "연장년", "연장")(t) or (_has("ext", "prlng", "renew")(t) and _has("yr", "year", "prd", "period", "term", "yy")(t))),
    ("first_period", _has("최초안치", "최초", "firstprd", "firstyr", "fstprd", "initprd", "enshrprd", "enshrineprd", "frstprd", "frst")),
    ("waiting_room", _has("유족대기", "대기실", "wait", "wtng", "rstrm", "loungeyn", "bereaved")),
    ("accessible", _has("장애인", "disab", "handicap", "dsbl", "dspsn", "hndcp", "barrierfree")),
    ("restaurant", _has("식당", "restaurant", "rstrnt", "rstr", "cafeteria", "diningyn")),
    ("store", _has("매점", "store", "shop", "snack", "stor", "canteen", "kiosk")),
    ("parking_lot", _has("주차장", "prkplce", "parkinglot", "prklot", "prkyn", "parkingyn", "parking", "prkg", "prk")),
    ("fax", _has("팩스", "fax")),
    ("tel", _has("전화", "tel", "phone", "telno")),
    ("homepage", _has("홈페이지", "hmpg", "homepage", "url", "website", "site", "hmpgaddr")),
    ("address", _has("주소", "addr", "adres", "adr", "location", "lctn")),
    ("sigungu", _has("시군구", "sigungu", "sgg", "signgu", "sggnm", "gugun")),
    ("sido", _has("시도", "sido", "ctprvn", "ctpv", "province", "brtc")),
    ("kind", lambda t: _has("공사설", "공설", "사설", "구분", "pblcprvt", "pubpri", "gubun", "fcltse", "fcltclsf",
                             "facilitytype", "fcltty", "type", "clsf")(t) or t.endswith("se") or t.endswith("secd")),
    ("name", lambda t: (_has("시설명", "fcltnm", "facilitynm", "facnm", "facilityname", "fcltname", "instnm", "bizplcnm", "name")(t)
                        or t.endswith("nm")) and not _has("sido", "sgg", "signgu", "ctprvn", "ctpv", "시도", "시군구", "gugun")(t)),
]

# 실제 API(ODMS_DATA_07_1) 응답 태그 — 2026-09 확인
KNOWN_MAP = {
    "sido": "ctpv", "sigungu": "sigungu", "name": "fcltNm", "address": "addr", "tel": "telno", "fax": "fxno",
    "homepage": "homepageUrl", "parking_count": "tpkct", "kind": "gubun", "first_period": "frstShrYr",
    "ext_years": "etsPsstYr", "ext_count": "etsPsstCnt", "restaurant": "diningFclt", "store": "store",
    "parking_lot": "pklt", "waiting_room": "bereavedWaitRm", "accessible": "sdblsPfFclt",
}

IGNORE_TAGS = {"rnum", "rownum", "no", "num", "번호", "순번", "seq", "id"}


def _norm_tag(tag):
    return re.sub(r"[_\-\s]", "", tag).lower()


def build_field_map(sample_tags):
    """태그 목록 -> {필드: 태그}"""
    override = {}
    if FIELD_MAP_FILE.exists():
        override = {k: v for k, v in json.loads(FIELD_MAP_FILE.read_text(encoding="utf-8")).items() if v}
    mapping = {f: t for f, t in KNOWN_MAP.items() if t in sample_tags}
    mapping.update({f: t for f, t in override.items() if f in FIELD_LABELS})
    used = set(mapping.values())
    for tag in sample_tags:
        if tag in used:
            continue
        t = _norm_tag(tag)
        if t in IGNORE_TAGS:
            continue
        for field, test in RULES:
            if field in mapping:
                continue
            if test(t):
                mapping[field] = tag
                used.add(tag)
                break
    return mapping


# ---------------------------------------------------------------------------
# 3. API 호출
# ---------------------------------------------------------------------------

def _leaf_children(el):
    return [c for c in list(el) if len(list(c)) == 0]


def parse_items(xml_text):
    """XML에서 레코드(dict) 목록과 totalCount를 뽑는다."""
    root = ET.fromstring(xml_text)
    # 공공데이터포털 게이트웨이 오류
    auth_msg = root.find(".//returnAuthMsg")
    reason = root.find(".//returnReasonCode")
    if auth_msg is not None:
        raise RuntimeError(
            f"API 인증 오류: {auth_msg.text} (코드 {reason.text if reason is not None else '?'})\n"
            "  - 발급 직후라면 키가 활성화되기까지 1~2시간 걸릴 수 있습니다.\n"
            "  - '일반 인증키(Decoding)' 값을 넣었는지 확인하세요.")
    result_code = root.find(".//resultCode")
    result_msg = root.find(".//resultMsg")
    if result_code is not None and (result_code.text or "").strip() not in ("00", "0", "000", "INFO-000", "NORMAL_SERVICE", ""):
        raise RuntimeError(f"API 오류: {result_code.text} {result_msg.text if result_msg is not None else ''}")
    total = None
    for tag in ("totalCount", "totalcount", "total_count", "totCnt"):
        el = root.find(f".//{tag}")
        if el is not None and (el.text or "").strip().isdigit():
            total = int(el.text.strip())
            break
    items = root.findall(".//item")
    if not items:
        # item 태그가 아닌 경우: 잎 자식이 3개 이상인 요소 중 가장 많이 반복되는 태그를 레코드로 본다
        counter = Counter(el.tag for el in root.iter() if len(_leaf_children(el)) >= 3)
        if counter:
            tag = counter.most_common(1)[0][0]
            items = [el for el in root.iter() if el.tag == tag]
    records = []
    for it in items:
        rec = OrderedDict()
        for c in it:
            rec[c.tag] = (c.text or "").strip()
        if rec:
            records.append(rec)
    return records, total


def fetch_page(key, page, rows):
    params = urllib.parse.urlencode({"serviceKey": key, "pageNo": page, "numOfRows": rows})
    url = f"{CONFIG['api_endpoint']}?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (bongan-site builder)"})
    last_err = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
            text = raw.decode("utf-8", errors="replace")
            if text.lstrip().startswith("{"):
                raise RuntimeError("JSON 응답이 왔습니다. 이 스크립트는 XML을 기준으로 작성되었습니다:\n" + text[:500])
            return text
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"API 호출 실패 ({page}페이지): {last_err}")


def fetch_all(key):
    rows = int(CONFIG.get("rows_per_page", 1000))
    all_records, page, total = [], 1, None
    while True:
        text = fetch_page(key, page, rows)
        records, t = parse_items(text)
        if total is None:
            total = t
        print(f"  {page}페이지: {len(records)}건 (지금까지 {len(all_records) + len(records)}건 / 전체 {total if total is not None else '?'}건)")
        all_records.extend(records)
        # 서버가 한 번에 주는 최대 건수가 요청보다 적을 수 있으므로(예: 500건) 전체 건수를 기준으로 반복한다
        if not records or page >= 200:
            break
        if total is not None:
            if len(all_records) >= total:
                break
        elif len(records) < rows:
            break
        page += 1
        time.sleep(0.3)
    return all_records


# ---------------------------------------------------------------------------
# 4. 정규화
# ---------------------------------------------------------------------------

YES = {"y", "yes", "있음", "유", "o", "○", "1", "true", "가능", "보유", "운영"}
NO = {"n", "no", "없음", "무", "x", "×", "0", "false", "불가", "미보유", "미운영", "-"}


def yes_no(v):
    s = (v or "").strip().lower()
    if not s:
        return None
    if s in NO or s.startswith(("없", "무", "미", "불", "비")):
        return False
    if s in YES or s.startswith(("있", "유", "설치", "보유", "운영")):
        return True
    # "3개소", "50면" 같은 값은 있음으로 본다
    m = re.search(r"\d+", s)
    if m:
        return int(m.group()) > 0
    return None


def to_number(v):
    m = re.search(r"\d+(\.\d+)?", (v or "").replace(",", ""))
    if not m:
        return None
    n = float(m.group())
    return int(n) if n.is_integer() else n


def normalize_kind(v):
    s = (v or "").strip()
    if not s:
        return "미상"
    if "공" in s and "사" not in s:
        return "공설"
    if s.startswith("공"):
        return "공설"
    if any(k in s for k in ("사설", "사립", "법인", "종교", "가족", "종중", "문중", "개인", "민간")):
        return "사설"
    return s


def clean_url(v):
    s = (v or "").strip()
    if not s or s in ("-", "없음"):
        return ""
    if not re.match(r"^https?://", s, re.I):
        s = "http://" + s
    return s


def clean_phone(v):
    s = (v or "").strip()
    return "" if s in ("-", "없음") else s


def normalize(records):
    tags = []
    for r in records[:50]:
        for k in r:
            if k not in tags:
                tags.append(k)
    fmap = build_field_map(tags)
    if "name" not in fmap:
        raise RuntimeError(
            "시설명 필드를 찾지 못했습니다. python build.py --inspect 로 태그명을 확인한 뒤\n"
            'field_map.json 에 {"name": "실제태그명"} 형식으로 적어 주세요.')
    out, seen = [], set()
    for r in records:
        def g(f):
            v = (r.get(fmap[f], "") if f in fmap else "") or ""
            return "" if v.strip().lower() in ("null", "none", "-") else v
        name = g("name").strip()
        if not name:
            continue
        addr = re.sub(r"\s+", " ", g("address")).strip()
        sido = normalize_sido(g("sido"), addr)
        sigungu = g("sigungu").strip()
        if not sigungu and addr:
            parts = addr.split()
            if len(parts) > 1:
                sigungu = parts[1]
        sigungu = sigungu or "기타"
        fid = hashlib.sha1(f"{name}|{addr}".encode("utf-8")).hexdigest()[:10]
        if fid in seen:
            fid = hashlib.sha1(f"{name}|{addr}|{len(seen)}".encode("utf-8")).hexdigest()[:10]
        seen.add(fid)
        out.append({
            "id": fid,
            "name": name,
            "sido": sido,
            "sigungu": sigungu,
            "address": addr,
            "tel": clean_phone(g("tel")),
            "fax": clean_phone(g("fax")),
            "homepage": clean_url(g("homepage")),
            "parking_count": to_number(g("parking_count")),
            "kind": normalize_kind(g("kind")),
            "kind_raw": g("kind").strip(),
            "first_period": to_number(g("first_period")),
            "ext_years": to_number(g("ext_years")),
            "ext_count": to_number(g("ext_count")),
            "restaurant": yes_no(g("restaurant")),
            "store": yes_no(g("store")),
            "parking_lot": yes_no(g("parking_lot")),
            "waiting_room": yes_no(g("waiting_room")),
            "accessible": yes_no(g("accessible")),
        })
    for f in out:
        for k in ("first_period", "parking_count"):
            if f[k] == 0:
                f[k] = None
        # 이 데이터는 99를 '미상·기타' 표시값으로 쓰는 것으로 보여 기간 계산에서 제외한다
        for k in ("first_period", "ext_years"):
            if isinstance(f[k], (int, float)) and f[k] >= 99:
                f[k] = None
        if not f["first_period"] or not f["ext_years"]:
            f["ext_years"] = f["ext_years"] or None
            f["ext_count"] = f["ext_count"] if f["ext_years"] else None
        if f["parking_lot"] is None and isinstance(f["parking_count"], (int, float)):
            f["parking_lot"] = f["parking_count"] > 0
        f["max_period"] = max_period(f)
    out.sort(key=lambda f: (list(SIDO).index(f["sido"]) if f["sido"] in SIDO else 99, f["sigungu"], f["name"]))
    return out, fmap


def max_period(f):
    a, y, c = f["first_period"], f["ext_years"], f["ext_count"]
    if isinstance(a, (int, float)) and isinstance(y, (int, float)) and isinstance(c, (int, float)):
        return a + y * c
    return None



# ---------------------------------------------------------------------------
# 4-1. 가격 정보 (CSV)
#   _builder/prices/ 폴더에 넣은 CSV 파일을 모두 읽어 시설명으로 연결합니다.
#   - 한국장례문화진흥원 「전국 장사시설 현황 시설_가격정보」(공공데이터포털 파일데이터) 를 그대로 넣어도 되고
#   - prices_manual.csv 양식에 직접 조사한 가격을 적어도 됩니다.
# ---------------------------------------------------------------------------

import csv
import io

PRICE_DIR = ROOT / "prices"

PRICE_COLS = OrderedDict([
    ("ftype", ["시설종류", "시설유형"]),
    ("name", ["시설명", "업체명", "기관명", "명칭", "fclt", "facility", "name"]),
    ("sido", ["시도", "광역", "ctpv", "sido"]),
    ("category", ["품목분류", "분류", "구분", "항목구분", "category"]),
    ("item", ["품목명", "품목", "항목", "상품명", "서비스", "내역", "item"]),
    ("price", ["금액", "가격", "요금", "단가", "price", "amount"]),
    ("unit", ["규격", "단위", "기간", "기준", "unit"]),
    ("note", ["비고", "설명", "note", "remark"]),
    ("date", ["기준일", "확인일", "등록일", "수정일", "date"]),
    ("address", ["주소", "addr"]),
    ("tel", ["전화", "tel"]),
])


def read_csv_any(path):
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "cp949", "euc-kr"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = raw.decode("utf-8", errors="replace")
    return list(csv.DictReader(io.StringIO(text)))


def map_price_columns(headers):
    mapping, used = {}, set()
    for field, words in PRICE_COLS.items():
        for h in headers:
            if h in used or h is None:
                continue
            hn = re.sub(r"\s", "", h).lower()
            if any(w in hn for w in words):
                mapping[field] = h
                used.add(h)
                break
    return mapping


def parse_won(v):
    """'1,500,000', '150만원', '150 만 원' -> 원 단위 정수"""
    s = re.sub(r"[\s,원]", "", str(v or ""))
    if not s:
        return None
    m = re.match(r"^(\d+(?:\.\d+)?)만(\d+)?$", s)
    if m:
        return int(float(m.group(1)) * 10000) + int(m.group(2) or 0)
    m = re.search(r"\d+(?:\.\d+)?", s)
    if not m:
        return None
    n = float(m.group())
    return int(n) if n > 0 else None


def name_key(name):
    s = re.sub(r"\(.*?\)|\[.*?\]", "", name or "")
    s = re.sub(r"\s|재단법인|㈜|주식회사|봉안당|봉안시설|봉안담|봉안묘|납골당|추모관|추모공원", "", s)
    return s.lower()


def tel_key(t):
    d = re.sub(r"\D", "", t or "")
    return d if len(d) >= 8 else ""


def addr_key(a):
    """'경기도 김포시 하성면 ○○로 12-3 (...)' -> '○○로12-3' (도로명+건물번호) 또는 지번"""
    a = re.sub(r"\(.*?\)", "", a or "")
    m = re.search(r"([가-힣0-9]+(?:로|길))\s*(\d+(?:-\d+)?)", a)
    if m:
        return m.group(1) + m.group(2)
    m = re.search(r"([가-힣0-9]+(?:리|동))\s*(산?\s*\d+(?:-\d+)?)", a)
    return (m.group(1) + re.sub(r"\s", "", m.group(2))) if m else ""


def _cell(r, cols, field):
    return (r.get(cols[field]) or "").strip() if field in cols else ""


def load_prices():
    """가격 행 목록과 시설 목록(주소·전화, 연결용)을 읽는다.
    반환: (prices: {원본 시설명: [항목...]}, directory: {원본 시설명: {sido, address, tel}}, files_info)"""
    prices, directory, files_info = defaultdict(list), {}, []
    if not PRICE_DIR.exists():
        return prices, directory, files_info
    for path in sorted(PRICE_DIR.glob("*.csv")):
        rows = read_csv_any(path)
        if not rows:
            continue
        cols = map_price_columns(list(rows[0].keys()))
        m = re.search(r"(20\d{2})(\d{2})(\d{2})", path.stem)
        file_date = f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else ""
        if "name" not in cols:
            print(f"  {path.name}: 시설명 열을 찾지 못해 건너뜀 → 열 이름 {list(rows[0].keys())}")
            continue
        if "price" not in cols:  # 시설 목록 파일 (주소·전화로 연결하는 데 사용)
            if "address" in cols or "tel" in cols:
                for r in rows:
                    nm = _cell(r, cols, "name")
                    if nm:
                        directory[nm] = {"sido": normalize_sido(_cell(r, cols, "sido"), _cell(r, cols, "address")),
                                         "address": _cell(r, cols, "address"), "tel": _cell(r, cols, "tel")}
                files_info.append((path.name, len(rows), "시설 목록(연결용)"))
            continue
        n = 0
        for r in rows:
            if "ftype" in cols and "봉안" not in _cell(r, cols, "ftype"):
                continue
            won = parse_won(r.get(cols["price"]))
            nm = _cell(r, cols, "name")
            if not nm or not won:
                continue
            text = " ".join(_cell(r, cols, k) for k in ("category", "item", "unit", "note"))
            if won < 10000 and "만원" in text.replace(" ", ""):
                won *= 10000          # '90' 처럼 만 원 단위로 적힌 값
            elif won < 1000 and not any(w in text for w in MGMT_WORDS):
                continue              # 단위를 알 수 없는 값은 비교에서 제외
            prices[nm].append({
                "category": _cell(r, cols, "category"), "item": _cell(r, cols, "item"), "price": won,
                "unit": _cell(r, cols, "unit"), "note": _cell(r, cols, "note"),
                "date": _cell(r, cols, "date") or file_date, "source": path.stem,
                "sido": normalize_sido(_cell(r, cols, "sido")) if "sido" in cols else "",
            })
            n += 1
        files_info.append((path.name, n, "가격"))
    return prices, directory, files_info


MGMT_WORDS = ("관리비", "관리료", "유지비")


def is_mgmt(it):
    return any(w in (it["category"] + it["item"] + it["unit"]) for w in MGMT_WORDS)


def attach_prices(facs, prices, directory):
    """가격표의 시설명을 API 시설과 연결한다. 전화번호 → 주소 → 이름 순으로 확인."""
    by_tel, by_addr, by_name, by_key = defaultdict(list), defaultdict(list), defaultdict(list), defaultdict(list)
    for f in facs:
        if tel_key(f["tel"]):
            by_tel[tel_key(f["tel"])].append(f)
        if addr_key(f["address"]):
            by_addr[(f["sido"], addr_key(f["address"]))].append(f)
        by_name[re.sub(r"\s", "", f["name"])].append(f)
        by_key[(f["sido"], name_key(f["name"]))].append(f)
    for f in facs:
        f["prices"] = []
    unmatched = []
    for pname, items in prices.items():
        info = directory.get(pname, {})
        sido = info.get("sido") or next((it["sido"] for it in items if it.get("sido")), "")
        target = None
        cands = by_name.get(re.sub(r"\s", "", pname), [])
        if sido:
            cands = [c for c in cands if c["sido"] == sido] or ([] if len(cands) > 1 else cands)
        if len(cands) == 1:
            target = cands[0]
        if target is None and tel_key(info.get("tel")):
            c = by_tel.get(tel_key(info["tel"]), [])
            # 같은 전화번호를 쓰는 시설이 여럿이면 이름이 가장 비슷한 곳
            c = [x for x in c if name_key(x["name"]) == name_key(pname)] or (c if len(c) == 1 else [])
            if len(c) == 1:
                target = c[0]
        if target is None and addr_key(info.get("address")) and sido:
            c = by_addr.get((sido, addr_key(info["address"])), [])
            c = [x for x in c if name_key(x["name"]) == name_key(pname)] or (c if len(c) == 1 else [])
            if len(c) == 1:
                target = c[0]
        if target is None and sido:
            c = by_key.get((sido, name_key(pname)), [])
            if len(c) == 1 and len(name_key(pname)) >= 2:
                target = c[0]
        if target is None:
            unmatched.append(pname)
            continue
        target["prices"].extend(items)
    matched = 0
    for f in facs:
        seen, uniq = set(), []
        for it in f["prices"]:
            sig = (it["category"], it["item"], it["unit"], it["price"])
            if sig not in seen:
                seen.add(sig)
                uniq.append(it)
        uniq.sort(key=lambda it: (is_mgmt(it), it["price"]))
        f["prices"] = uniq
        use = [it["price"] for it in uniq if not is_mgmt(it)]
        f["price_min"] = min(use) if use else None
        f["price_max"] = max(use) if use else None
        for t in PRICE_TYPES:
            its = [it for it in uniq if not is_mgmt(it) and price_type(it) == t]
            best = min(its, key=lambda it: it["price"]) if its else None
            f["p_" + t] = best["price"] if best else None
            f["pn_" + t] = item_label(best) if best else ""
        mg = [it for it in uniq if is_mgmt(it)]
        best = min(mg, key=lambda it: it["price"]) if mg else None
        f["p_mgmt"] = best["price"] if best else None
        f["pn_mgmt"] = item_label(best) if best else ""
        if uniq:
            matched += 1
    return matched, unmatched


PRICE_TYPES = ["single", "couple", "other"]
PRICE_TYPE_LABEL = {"single": "개인단(1위)", "couple": "부부단(2위)", "other": "기타(가족단·평장·봉안묘 등)", "mgmt": "관리비"}


def price_type(it):
    t = it["category"] + " " + it["item"] + " " + it["unit"]
    if any(w in t for w in ("부부", "2위", "2인", "쌍")):
        return "couple"
    if any(w in t for w in ("개인", "1위", "1인", "싱글", "단독")):
        return "single"
    return "other"


def item_label(it):
    parts = [x for x in (it["item"], it["unit"]) if x and x != it["category"]]
    lab = " · ".join(parts) or it["category"]
    return lab[:60]


def fmt_won(n):
    if n is None:
        return "–"
    if n >= 10000:
        man = n / 10000
        return f"{man:,.0f}만 원" if man >= 100 or float(man).is_integer() else f"{man:,.1f}만 원"
    return f"{n:,}원"


PRICE_BANDS = [(0, 1_000_000, "100만 원 미만"), (1_000_000, 3_000_000, "100만~300만 원"), (3_000_000, 5_000_000, "300만~500만 원"),
               (5_000_000, 10_000_000, "500만~1,000만 원"), (10_000_000, 10**12, "1,000만 원 이상")]

# ---------------------------------------------------------------------------
# 5. HTML 템플릿
# ---------------------------------------------------------------------------

E = html.escape
SITE = CONFIG["site_name"]
SITE_URL = CONFIG["site_url"].rstrip("/")
TODAY = dt.date.today().isoformat()
AMENITIES = [("parking_lot", "주차장"), ("restaurant", "식당"), ("store", "매점"),
             ("waiting_room", "유족대기실"), ("accessible", "장애인 편의시설")]

GUIDES = []   # content/guides 에서 읽어 채움
# compact: 시설 상세를 시도 페이지 안에 넣어 전체 파일 수를 100개 안쪽으로 유지 (GitHub 웹 업로드용)
# full   : 시설마다 페이지를 따로 만듦 (파일 수 1,000개 가까이)
COMPACT = (CONFIG.get("mode") or "compact").lower() == "compact"
PAGES_WRITTEN = []


def rel(depth):
    return "../" * depth


def adsense_head():
    client = (CONFIG.get("adsense_client") or "").strip()
    if not client:
        return ""
    return (f'<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client={E(client)}" '
            'crossorigin="anonymous"></script>')


def layout(path, title, description, body, crumbs=None, jsonld=None, depth=0, noindex=False):
    r = rel(depth)
    full_title = title if title == SITE else f"{title} | {SITE}"
    canonical = f"{SITE_URL}/{path}".replace("/index.html", "/")
    crumb_html = ""
    ld = []
    if crumbs:
        items = [f'<a href="{r}index.html">홈</a>']
        ld_items = [{"@type": "ListItem", "position": 1, "name": "홈", "item": SITE_URL + "/"}]
        for i, (label, href) in enumerate(crumbs, start=2):
            if href:
                items.append(f'<a href="{r}{href}">{E(label)}</a>')
                ld_items.append({"@type": "ListItem", "position": i, "name": label, "item": f"{SITE_URL}/{href}"})
            else:
                items.append(f'<span aria-current="page">{E(label)}</span>')
                ld_items.append({"@type": "ListItem", "position": i, "name": label})
        crumb_html = '<nav class="crumbs" aria-label="현재 위치">' + '<span class="sep">›</span>'.join(items) + "</nav>"
        ld.append({"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": ld_items})
    if jsonld:
        ld.extend(jsonld if isinstance(jsonld, list) else [jsonld])
    ld_html = "".join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in ld)
    robots = '<meta name="robots" content="noindex">' if noindex else ""
    return f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{E(full_title)}</title>
<meta name="description" content="{E(description)}">
<link rel="canonical" href="{E(canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="{E(full_title)}">
<meta property="og:description" content="{E(description)}">
<meta property="og:url" content="{E(canonical)}">
<meta property="og:site_name" content="{E(SITE)}">
{robots}
<link rel="icon" href="{r}static/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="{r}static/style.css">
{adsense_head()}
{ld_html}
</head>
<body>
<a class="skip" href="#main">본문으로 건너뛰기</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="{r}index.html"><img src="{r}static/favicon.svg" alt="" width="28" height="28"><span>{E(SITE)}</span></a>
    <nav class="main-nav" aria-label="주 메뉴">
      <a href="{r}pages/search.html">시설 검색</a>
      <a href="{r}region/index.html">지역별</a>
      <a href="{r}type/public.html">공설</a>
      <a href="{r}type/private.html">사설</a>
      <a href="{r}feature/price.html">가격 비교</a>
      <a href="{r}pages/recommend.html">예산 추천</a>
      <a href="{r}guides/index.html">가이드</a>
    </nav>
  </div>
</header>
<main id="main" class="wrap">
{crumb_html}
{body}
</main>
<footer class="site-footer">
  <div class="wrap footer-inner">
    <div>
      <p class="footer-brand">{E(SITE)}</p>
      <p class="muted">시설 정보 출처: 보건복지부 「전국 봉안시설 현황」(공공데이터포털). 이용 요금·잔여 기수·운영 여부는 바뀔 수 있으니 방문이나 계약 전에 반드시 해당 시설에 확인하세요.</p>
      <p class="muted">데이터 갱신일 {TODAY}</p>
    </div>
    <nav class="footer-nav" aria-label="사이트 정보">
      <a href="{r}pages/about.html">사이트 소개</a>
      <a href="{r}pages/privacy.html">개인정보처리방침</a>
      <a href="{r}pages/terms.html">이용약관·면책</a>
      <a href="{r}pages/contact.html">문의·정보 수정 요청</a>
      <a href="{r}pages/sitemap.html">사이트맵</a>
    </nav>
  </div>
</footer>
</body>
</html>
"""


def write(out_dir, path, content):
    p = out_dir / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    if path.endswith(".html") and path != "404.html":
        PAGES_WRITTEN.append(path)


def fmt_years(n):
    if n is None:
        return "정보 없음"
    return f"{n:g}년"


def fmt_count(n, unit):
    if n is None:
        return "정보 없음"
    return f"{n:g}{unit}"


def yn_badge(v):
    if v is True:
        return '<span class="yn yes">있음</span>'
    if v is False:
        return '<span class="yn no">없음</span>'
    return '<span class="yn na">정보 없음</span>'


def kind_badge(kind):
    cls = {"공설": "pub", "사설": "pri"}.get(kind, "etc")
    return f'<span class="badge {cls}">{E(kind)}</span>'


def josa(word, with_final, without_final):
    """받침 유무에 따라 조사를 고른다. josa('추모원', '은', '는') -> '은'"""
    w = re.sub(r"[\s\)\]\}'\"]+$", "", word or "")
    if not w:
        return with_final + "(" + without_final + ")"
    ch = w[-1]
    if "가" <= ch <= "힣":
        return with_final if (ord(ch) - 0xAC00) % 28 else without_final
    if ch.isdigit():
        return with_final if ch in "013678" else without_final
    return with_final + "(" + without_final + ")"


def facility_url(f):
    if COMPACT:
        return f"region/{sido_slug(f['sido'])}.html#f-{f['id']}"
    return f"facility/{f['id']}.html"


def sgg_slug(sido, sgg):
    return hashlib.sha1(f"{sido}|{sgg}".encode("utf-8")).hexdigest()[:6]


def region_url(sido, sgg=None):
    if sgg is None:
        return f"region/{sido_slug(sido)}.html"
    if COMPACT:
        return f"region/{sido_slug(sido)}.html#g-{sgg_slug(sido, sgg)}"
    return f"region/{sido_slug(sido)}/{sgg_slug(sido, sgg)}.html"


def facility_table(facs, depth, show_region=True):
    r = rel(depth)
    rows = []
    for f in facs:
        amen = "".join(f'<span class="chip" title="{lbl}">{lbl}</span>' for key, lbl in AMENITIES if f[key] is True)
        region = f'<td class="hide-sm">{E(SIDO_SHORT.get(f["sido"], f["sido"]))} {E(f["sigungu"])}</td>' if show_region else ""
        rows.append(
            f'<tr><td><a href="{r}{facility_url(f)}">{E(f["name"])}</a></td>'
            f'<td>{kind_badge(f["kind"])}</td>{region}'
            f'<td class="num">{fmt_years(f["first_period"]) if f["first_period"] is not None else "–"}</td>'
            f'<td class="num">{fmt_won(f.get("price_min")) + "~" if f.get("price_min") else "–"}</td>'
            f'<td class="hide-sm amen">{amen or "<span class=muted>–</span>"}</td></tr>')
    head_region = '<th class="hide-sm">지역</th>' if show_region else ""
    return (f'<div class="table-wrap"><table class="list"><thead><tr><th>시설명</th><th>구분</th>{head_region}'
            f'<th class="num">최초 안치</th><th class="num">가격</th><th class="hide-sm">편의시설</th></tr></thead><tbody>'
            + "".join(rows) + "</tbody></table></div>")


def stats_of(facs):
    n = len(facs)
    pub = sum(1 for f in facs if f["kind"] == "공설")
    pri = sum(1 for f in facs if f["kind"] == "사설")
    periods = [f["first_period"] for f in facs if isinstance(f["first_period"], (int, float))]
    period_mode = Counter(periods).most_common(1)[0][0] if periods else None
    amen = {k: sum(1 for f in facs if f[k] is True) for k, _ in AMENITIES}
    return {"n": n, "pub": pub, "pri": pri, "period_mode": period_mode, "amen": amen}


def pct(a, b):
    return f"{round(a * 100 / b)}%" if b else "–"


def stat_cards(st):
    cards = [("전체 시설", f'{st["n"]:,}곳'), ("공설", f'{st["pub"]:,}곳'), ("사설", f'{st["pri"]:,}곳'),
             ("주차장 보유", pct(st["amen"]["parking_lot"], st["n"]))]
    return '<div class="stats">' + "".join(
        f'<div class="stat"><span class="stat-label">{a}</span><span class="stat-value">{b}</span></div>' for a, b in cards) + "</div>"


def summary_sentence(place, st):
    if not st["n"]:
        return ""
    s = (f"{place}에는 이 데이터 기준으로 봉안시설이 모두 {st['n']:,}곳 있습니다. "
         f"이 가운데 지방자치단체 등이 운영하는 공설 시설이 {st['pub']:,}곳, 재단법인·종교단체 등이 운영하는 사설 시설이 {st['pri']:,}곳입니다. ")
    if st["period_mode"] is not None:
        s += f"가장 많은 시설이 최초 안치기간을 {st['period_mode']:g}년으로 정하고 있습니다. "
    a = st["amen"]
    s += (f"주차장을 갖춘 곳은 {a['parking_lot']:,}곳({pct(a['parking_lot'], st['n'])}), "
          f"유족대기실이 있는 곳은 {a['waiting_room']:,}곳, 장애인 편의시설이 있는 곳은 {a['accessible']:,}곳입니다.")
    return f"<p class=\"lead\">{E(s)}</p>"


def guide_links(depth, slugs=None, title="함께 읽으면 좋은 가이드"):
    r = rel(depth)
    items = [g for g in GUIDES if slugs is None or g["slug"] in slugs][:6]
    if not items:
        return ""
    lis = "".join(f'<li><a href="{r}guides/{g["slug"]}.html">{E(g["title"])}</a><span class="muted">{E(g["description"])}</span></li>' for g in items)
    return f'<section class="card"><h2>{E(title)}</h2><ul class="guide-list">{lis}</ul></section>'


# ---------------------------------------------------------------------------
# 6. 페이지 생성
# ---------------------------------------------------------------------------

def page_facility(out, f, same_sgg, same_sido):
    depth = 1
    r = rel(depth)
    region = f["sido"] if f["sigungu"] in (f["sido"], "기타") else f"{f['sido']} {f['sigungu']}"
    kind_text = {"공설": "공설", "사설": "사설"}.get(f["kind"], "")
    desc_parts = [f"{f['name']}{josa(f['name'], '은', '는')} {region}에 있는 {kind_text + ' ' if kind_text else ''}봉안시설입니다."]
    if f["first_period"] is not None:
        if f["ext_years"] and f["ext_count"]:
            desc_parts.append(
                f"최초 안치기간은 {f['first_period']:g}년이며, 기간이 끝나면 {f['ext_years']:g}년씩 {f['ext_count']:g}회까지 연장할 수 있어 "
                f"최대 {f['max_period']:g}년 동안 모실 수 있습니다.")
        elif f["ext_count"] == 0 and f["ext_years"]:
            desc_parts.append(f"최초 안치기간은 {f['first_period']:g}년이며, 공공데이터에는 연장 가능 횟수가 0회로 등록되어 있습니다.")
        else:
            desc_parts.append(f"최초 안치기간은 {f['first_period']:g}년입니다.")
    have = [lbl for key, lbl in AMENITIES if f[key] is True]
    lack = [lbl for key, lbl in AMENITIES if f[key] is False]
    if have:
        desc_parts.append(f"편의시설로는 {', '.join(have)}{josa(have[-1], '이', '가')} 있습니다.")
    if lack:
        desc_parts.append(f"{', '.join(lack)}{josa(lack[-1], '은', '는')} 없는 것으로 등록되어 있습니다.")
    if isinstance(f["parking_count"], (int, float)) and f["parking_count"] > 0 and f["parking_lot"] is not False:
        desc_parts.append(f"주차는 {f['parking_count']:g}대까지 가능합니다.")
    if f.get("price_min"):
        desc_parts.append(f"공개된 가격 정보 기준으로 {fmt_won(f['price_min'])}부터 이용할 수 있습니다.")
    summary = " ".join(desc_parts)

    # 안치기간 막대
    period_html = ""
    if f["first_period"]:
        segs = [f'<div class="seg first" style="flex:{f["first_period"]}"><span>최초 {f["first_period"]:g}년</span></div>']
        if f["ext_years"] and f["ext_count"]:
            for i in range(int(f["ext_count"])):
                segs.append(f'<div class="seg ext" style="flex:{f["ext_years"]}"><span>+{f["ext_years"]:g}년</span></div>')
        total = f["max_period"] or f["first_period"]
        period_html = (f'<section class="card"><h2>안치기간 한눈에 보기</h2><div class="period-bar" role="img" '
                       f'aria-label="최초 {f["first_period"]:g}년, 최대 {total:g}년">{"".join(segs)}</div>'
                       f'<p class="muted small">최대 {total:g}년 기준입니다. 연장할 때마다 사용료나 관리비를 다시 내는 경우가 많으니 시설에 조건을 확인하세요. '
                       f'<a href="{r}guides/enshrinement-period.html">안치기간과 연장 제도 알아보기</a></p></section>')

    rows = [("시설명", E(f["name"])), ("구분", kind_badge(f["kind"]) + (f' <span class="muted small">({E(f["kind_raw"])})</span>' if f["kind_raw"] and f["kind_raw"] != f["kind"] else "")),
            ("지역", f'<a href="{r}{region_url(f["sido"])}">{E(f["sido"])}</a> <a href="{r}{region_url(f["sido"], f["sigungu"])}">{E(f["sigungu"])}</a>'),
            ("주소", E(f["address"]) or "정보 없음"),
            ("전화번호", f'<a href="tel:{E(re.sub(r"[^0-9+]", "", f["tel"]))}">{E(f["tel"])}</a>' if f["tel"] else "정보 없음"),
            ("팩스", E(f["fax"]) or "정보 없음"),
            ("홈페이지", f'<a href="{E(f["homepage"])}" rel="nofollow noopener" target="_blank">{E(f["homepage"])}</a>' if f["homepage"] else "정보 없음"),
            ("주차대수", fmt_count(f["parking_count"], "대")),
            ("최초 안치기간", fmt_years(f["first_period"])),
            ("연장 가능 기간", fmt_years(f["ext_years"])),
            ("연장 가능 횟수", fmt_count(f["ext_count"], "회"))]
    info = "".join(f"<tr><th scope=row>{a}</th><td>{b}</td></tr>" for a, b in rows)
    amen = "".join(f'<li><span>{lbl}</span>{yn_badge(f[key])}</li>' for key, lbl in AMENITIES)

    # 가격 정보
    if f.get("prices"):
        prow = "".join(
            f'<tr><td>{E(it["category"] or "–")}</td><td>{E(it["item"] or "–")}</td><td class="num">{fmt_won(it["price"])}</td>'
            f'<td class="hide-sm">{E(" ".join(x for x in (it["unit"], it["note"]) if x)) or "–"}</td></tr>' for it in f["prices"][:40])
        dates = sorted({it["date"] for it in f["prices"] if it["date"]})
        date_txt = f"기준일 {dates[-1]} · " if dates else ""
        srcs = ", ".join(sorted({it["source"] for it in f["prices"]}))
        price_html = (f'<h4>서비스·가격</h4><div class="table-wrap"><table class="list price"><thead><tr><th>구분</th><th>항목</th>'
                      f'<th class="num">금액</th><th class="hide-sm">기간·비고</th></tr></thead><tbody>{prow}</tbody></table></div>'
                      f'<p class="muted small">{E(date_txt)}출처: {E(srcs)}. 가격은 바뀔 수 있으니 계약 전 시설과 '
                      f'<a href="https://www.15774129.go.kr" target="_blank" rel="noopener">e하늘 장사정보시스템</a>에서 확인하세요.</p>')
    else:
        price_html = ('<h4>서비스·가격</h4><p class="muted small">아직 등록된 가격 정보가 없습니다. 시설에 직접 문의하거나 '
                      '<a href="https://www.15774129.go.kr" target="_blank" rel="noopener">e하늘 장사정보시스템</a>에서 확인하세요.</p>')

    q = urllib.parse.quote(f["address"] or f["name"])
    map_links = (f'<a class="btn" href="https://map.naver.com/p/search/{q}" target="_blank" rel="noopener">네이버 지도</a>'
                 f'<a class="btn" href="https://map.kakao.com/?q={q}" target="_blank" rel="noopener">카카오맵</a>')

    if f["kind"] == "공설":
        tips = ["공설 봉안시설은 해당 지역 주민이나 그 지역에 연고가 있는 사람만 이용할 수 있는 경우가 많습니다. 사망자·신청자 주소 요건을 먼저 확인하세요.",
                "사용료는 조례로 정해져 있어 사설보다 저렴한 편이지만, 남은 기수가 부족해 대기하는 곳도 있습니다.",
                "신청 서류(사망진단서 또는 화장증명서, 가족관계 증명 등)를 미리 준비하면 당일 안치가 수월합니다."]
    else:
        tips = ["사설 봉안시설은 안치단 위치(층·높이)에 따라 가격이 크게 다릅니다. 같은 층의 여러 위치를 비교해 보세요.",
                "총액에 관리비가 포함됐는지, 관리비를 몇 년 치 선납하는지, 해약할 때 환불 기준은 무엇인지 계약서로 확인하세요.",
                "장사법에 따라 시설은 이용 요금을 게시해야 합니다. 게시된 가격표와 상담 가격이 같은지 확인하세요."]
    tips.append("명절에는 참배객이 몰려 주차가 어렵습니다. 평일이나 이른 시간 방문을 권합니다.")
    tip_html = "".join(f"<li>{E(t)}</li>" for t in tips)

    faq = [(f"{f['name']}{josa(f['name'], '은', '는')} 어디에 있나요?", f"{f['address'] or region}에 있습니다." + (f" 대표 전화는 {f['tel']}입니다." if f["tel"] else "")),
           (f"{f['name']}{josa(f['name'], '은', '는')} 공설인가요, 사설인가요?", f"공공데이터상 {f['kind']} 봉안시설로 등록되어 있습니다." if f["kind"] in ("공설", "사설") else "공공데이터에 구분 정보가 명확하지 않습니다. 시설에 직접 확인하세요.")]
    if f["first_period"] is not None:
        a = f"최초 안치기간은 {f['first_period']:g}년입니다."
        if f["max_period"] is not None and f["max_period"] != f["first_period"]:
            a += f" 연장하면 최대 {f['max_period']:g}년까지 가능합니다."
        faq.append((f"{f['name']}의 안치기간은 몇 년인가요?", a))
    if f["parking_lot"] is not None:
        faq.append((f"{f['name']}에 주차할 수 있나요?", ("주차장이 있습니다." + (f" 주차대수는 {f['parking_count']:g}대입니다." if isinstance(f["parking_count"], (int, float)) and f["parking_count"] else "")) if f["parking_lot"] else "주차장이 없는 것으로 등록되어 있습니다. 대중교통이나 인근 주차장을 확인하세요."))
    if f.get("price_min"):
        faq.append((f"{f['name']}의 가격은 얼마인가요?", f"공개된 가격 정보 기준으로 {fmt_won(f['price_min'])}부터입니다. 안치단 위치와 기간, 관리비에 따라 달라지니 시설에 확인하세요."))
    faq_html = "".join(f"<details><summary>{E(qq)}</summary><p>{E(aa)}</p></details>" for qq, aa in faq)
    faq_ld = {"@context": "https://schema.org", "@type": "FAQPage",
              "mainEntity": [{"@type": "Question", "name": qq, "acceptedAnswer": {"@type": "Answer", "text": aa}} for qq, aa in faq]}
    place_ld = {"@context": "https://schema.org", "@type": "Cemetery", "name": f["name"],
                "address": {"@type": "PostalAddress", "streetAddress": f["address"], "addressRegion": f["sido"], "addressLocality": f["sigungu"], "addressCountry": "KR"}}
    if f["tel"]:
        place_ld["telephone"] = f["tel"]
    if f["homepage"]:
        place_ld["url"] = f["homepage"]

    if COMPACT:
        tel_btn = f'<a class="btn primary" href="tel:{E(re.sub(r"[^0-9+]", "", f["tel"]))}">전화 걸기</a>' if f["tel"] else ""
        mini_period = period_html.replace('<section class="card"><h2>안치기간 한눈에 보기</h2>', '<div class="period-mini"><h4>안치기간</h4>').replace("</p></section>", "</p></div>")
        block = f"""<article class="card facility-block" id="f-{f['id']}">
  <p class="eyebrow">{E(f['sigungu'])}</p>
  <h3 class="fac-title">{E(f['name'])} {kind_badge(f['kind'])}</h3>
  <p>{E(summary)}</p>
  <div class="actions">{map_links}{tel_btn}</div>
  <div class="grid-2 inner">
    <div><h4>기본 정보</h4><table class="info">{info}</table></div>
    <div><h4>편의시설</h4><ul class="amen-list">{amen}</ul></div>
  </div>
  {mini_period}
  <div class="price-block">{price_html}</div>
  <details class="faq-fold"><summary>자주 묻는 질문</summary><div class="faq">{faq_html}</div></details>
</article>"""
        return block, place_ld

    near = [x for x in same_sgg if x["id"] != f["id"]][:12]
    near_html = ""
    if near:
        near_html = f'<section class="card"><h2>{E(f["sigungu"])}의 다른 봉안시설</h2>{facility_table(near, depth, show_region=False)}</section>'
    other = [x for x in same_sido if x["sigungu"] != f["sigungu"] and x["kind"] == f["kind"]][:8]
    other_html = ""
    if other:
        other_html = (f'<section class="card"><h2>{E(f["sido"])}의 다른 {E(f["kind"])} 시설</h2><ul class="link-list">'
                      + "".join(f'<li><a href="{r}{facility_url(x)}">{E(x["name"])}</a> <span class="muted">{E(x["sigungu"])}</span></li>' for x in other)
                      + "</ul></section>")

    body = f"""
<article class="facility">
  <header class="page-head">
    <p class="eyebrow">{E(f['sido'])} · {E(f['sigungu'])}</p>
    <h1>{E(f['name'])} {kind_badge(f['kind'])}</h1>
    <p class="lead">{E(summary)}</p>
    <div class="actions">{map_links}{f'<a class="btn primary" href="tel:{E(re.sub(r"[^0-9+]", "", f["tel"]))}">전화 걸기</a>' if f['tel'] else ''}</div>
  </header>
  <div class="grid-2">
    <section class="card"><h2>기본 정보</h2><table class="info">{info}</table></section>
    <section class="card"><h2>편의시설</h2><ul class="amen-list">{amen}</ul>
      <p class="muted small">공공데이터에 등록된 정보입니다. 실제 운영 여부는 방문 전에 확인하세요.</p></section>
  </div>
  {period_html}
  <section class="card">{price_html.replace("<h4>서비스·가격</h4>", "<h2>서비스·가격</h2>", 1)}</section>
  <section class="card"><h2>방문·계약 전 확인할 점</h2><ul class="tips">{tip_html}</ul>
    <p class="small"><a href="{r}guides/how-to-choose.html">봉안당 고르는 체크리스트</a> · <a href="{r}guides/contract-checklist.html">사설 봉안당 계약 전 주의사항</a></p></section>
  <section class="card"><h2>자주 묻는 질문</h2><div class="faq">{faq_html}</div></section>
  {near_html}
  {other_html}
  <p class="source muted small">출처: 보건복지부 「전국 봉안시설 현황」 · 정보가 실제와 다르다면 <a href="{r}pages/contact.html">정보 수정 요청</a>을 남겨 주세요.</p>
</article>"""
    desc = summary[:150]
    write(out, facility_url(f), layout(facility_url(f), f"{f['name']} ({SIDO_SHORT.get(f['sido'], f['sido'])} {f['sigungu']} 봉안당)", desc, body,
                                       crumbs=[(f["sido"], region_url(f["sido"])), (f["sigungu"], region_url(f["sido"], f["sigungu"])), (f["name"], None)],
                                       jsonld=[place_ld, faq_ld], depth=depth))


def page_sigungu(out, sido, sgg, facs):
    depth = 2
    st = stats_of(facs)
    place = f"{sido} {sgg}"
    body = f"""
<header class="page-head">
  <p class="eyebrow">{E(sido)}</p>
  <h1>{E(sgg)} 봉안당·납골당 {len(facs)}곳</h1>
  {summary_sentence(place, st)}
</header>
{stat_cards(st)}
<section class="card"><h2>{E(sgg)} 봉안시설 목록</h2>{facility_table(facs, depth, show_region=False)}</section>
{guide_links(depth, ["public-vs-private", "how-to-choose", "cost-structure"])}"""
    path = region_url(sido, sgg)
    write(out, path, layout(path, f"{sido} {sgg} 봉안당·납골당 목록", f"{place}의 봉안시설 {len(facs)}곳의 공설·사설 구분, 안치기간, 주차장·편의시설 정보를 모았습니다.",
                            body, crumbs=[(sido, region_url(sido)), (sgg, None)], depth=depth))


def page_sido(out, sido, facs):
    depth = 1
    r = rel(depth)
    st = stats_of(facs)
    by_sgg = OrderedDict()
    for f in facs:
        by_sgg.setdefault(f["sigungu"], []).append(f)
    sgg_cards = "".join(
        f'<a class="region-card" href="{r}{region_url(sido, s)}"><strong>{E(s)}</strong><span>{len(v)}곳 · 공설 {sum(1 for x in v if x["kind"] == "공설")} · 사설 {sum(1 for x in v if x["kind"] == "사설")}</span></a>'
        for s, v in sorted(by_sgg.items(), key=lambda kv: -len(kv[1])))
    slug = sido_slug(sido)
    body = f"""
<header class="page-head">
  <h1>{E(sido)} 봉안당·납골당 {len(facs)}곳</h1>
  {summary_sentence(sido, st)}
  <div class="actions">{'' if COMPACT else f'<a class="btn" href="{r}type/public-{slug}.html">{E(SIDO_SHORT.get(sido, sido))} 공설만 보기</a>' if st["pub"] else ''}{'' if COMPACT else f'<a class="btn" href="{r}type/private-{slug}.html">{E(SIDO_SHORT.get(sido, sido))} 사설만 보기</a>' if st["pri"] else ''}</div>
</header>
{stat_cards(st)}
<section class="card"><h2>시군구별로 보기</h2><div class="region-grid">{sgg_cards}</div></section>
<section class="card"><h2>{E(sido)} 전체 목록</h2>{facility_table(facs, depth)}</section>
{guide_links(depth)}"""
    jsonld = None
    if COMPACT:
        parts, jsonld = [], []
        for sgg, v in by_sgg.items():
            blocks = []
            for f in v:
                b, ld = page_facility(out, f, v, facs)
                blocks.append(b)
                jsonld.append(ld)
            place = sido if sgg in (sido, "기타") else f"{sido} {sgg}"
            parts.append(f'<section class="sgg-section" id="g-{sgg_slug(sido, sgg)}"><h2>{E(sgg)} 봉안시설 {len(v)}곳</h2>'
                         f'{summary_sentence(place, stats_of(v))}{"".join(blocks)}</section>')
        tips = ("<section class=\"card\"><h2>방문·계약 전 확인할 점</h2><ul class=\"tips\">"
                "<li>공설 봉안시설은 해당 지역 주민이나 연고자만 이용할 수 있는 경우가 많습니다. 주소 요건을 먼저 확인하세요.</li>"
                "<li>사설 봉안시설은 안치단 위치(층·높이)에 따라 가격이 크게 다릅니다. 관리비 포함 여부와 환불 기준을 계약서로 확인하세요.</li>"
                "<li>장사법에 따라 시설은 이용 요금을 게시해야 합니다. 게시된 가격표와 상담 가격이 같은지 확인하세요.</li>"
                "<li>명절에는 참배객이 몰려 주차가 어렵습니다. 평일이나 이른 시간 방문을 권합니다.</li></ul>"
                f"<p class=\"small\"><a href=\"{r}guides/how-to-choose.html\">봉안당 고르는 체크리스트</a> · <a href=\"{r}guides/contract-checklist.html\">사설 봉안당 계약 전 주의사항</a></p></section>")
        body = body.replace(f"{guide_links(depth)}", "") + tips + "".join(parts) + guide_links(depth)
    path = region_url(sido)
    write(out, path, layout(path, f"{sido} 봉안당·납골당 목록", f"{sido} 봉안시설 {len(facs)}곳을 시군구별로 정리했습니다. 공설·사설, 안치기간, 편의시설을 비교해 보세요.",
                            body, crumbs=[("지역별", "region/index.html"), (sido, None)], jsonld=jsonld, depth=depth))


def page_region_index(out, groups):
    depth = 1
    r = rel(depth)
    cards = "".join(f'<a class="region-card" href="{r}{region_url(s)}"><strong>{E(s)}</strong><span>{len(v)}곳</span></a>' for s, v in groups.items())
    body = f"""<header class="page-head"><h1>지역별 봉안시설</h1><p class="lead">시도를 고르면 시군구별 봉안당·납골당 목록을 볼 수 있습니다.</p></header>
<div class="region-grid big">{cards}</div>"""
    write(out, "region/index.html", layout("region/index.html", "지역별 봉안당·납골당 찾기", "전국 17개 시도의 봉안시설을 지역별로 찾아보세요.", body, crumbs=[("지역별", None)], depth=depth))


def page_type(out, kind, facs, groups):
    depth = 1
    r = rel(depth)
    key = "public" if kind == "공설" else "private"
    intro = ("공설 봉안시설은 시·군·구 같은 지방자치단체나 공공기관이 운영합니다. 사용료가 조례로 정해져 있어 비교적 저렴하지만, 지역 주민 우선 등 이용 자격이 있는 경우가 많습니다."
             if kind == "공설" else
             "사설 봉안시설은 재단법인, 종교단체, 종중·문중 등이 운영합니다. 자격 제한이 적고 시설·위치 선택 폭이 넓지만 가격 차이가 크고, 계약 조건을 꼼꼼히 봐야 합니다.")
    link = (lambda s: f"#{sido_slug(s)}") if COMPACT else (lambda s: f"{r}type/{key}-{sido_slug(s)}.html")
    cards = "".join(
        f'<a class="region-card" href="{link(s)}"><strong>{E(s)}</strong><span>{sum(1 for f in v if f["kind"] == kind)}곳</span></a>'
        for s, v in groups.items() if any(f["kind"] == kind for f in v))
    body = f"""<header class="page-head"><h1>전국 {kind} 봉안시설 {len(facs):,}곳</h1><p class="lead">{E(intro)}</p>
<p><a href="{r}guides/public-vs-private.html">공설과 사설 봉안당의 차이 자세히 보기</a></p></header>
<section class="card"><h2>시도별 {kind} 시설</h2><div class="region-grid">{cards}</div></section>
{guide_links(depth, ["public-vs-private", "cost-structure", "contract-checklist", "how-to-choose"])}"""
    if COMPACT:
        secs = "".join(f'<section class="card"><h2 id="{sido_slug(sd)}">{E(sd)} ({sum(1 for f in v if f["kind"] == kind)}곳)</h2>{facility_table([f for f in v if f["kind"] == kind], depth)}</section>'
                       for sd, v in groups.items() if any(f["kind"] == kind for f in v))
        body = body + secs
    write(out, f"type/{key}.html", layout(f"type/{key}.html", f"전국 {kind} 봉안당 목록", f"전국 {kind} 봉안시설 {len(facs):,}곳을 시도별로 모았습니다.", body,
                                          crumbs=[(f"{kind} 봉안시설", None)], depth=depth))
    for sido, v in groups.items():
        sub = [f for f in v if f["kind"] == kind]
        if not sub or COMPACT:
            continue
        st = stats_of(sub)
        body = f"""<header class="page-head"><p class="eyebrow">{kind} 봉안시설</p><h1>{E(sido)} {kind} 봉안당 {len(sub)}곳</h1><p class="lead">{E(intro)}</p></header>
{stat_cards(st)}
<section class="card"><h2>목록</h2>{facility_table(sub, depth)}</section>
<p class="small"><a href="{r}{region_url(sido)}">{E(sido)} 전체 시설 보기</a></p>"""
        path = f"type/{key}-{sido_slug(sido)}.html"
        write(out, path, layout(path, f"{sido} {kind} 봉안당 목록", f"{sido}의 {kind} 봉안시설 {len(sub)}곳의 안치기간·편의시설 정보.", body,
                                crumbs=[(f"{kind} 봉안시설", f"type/{key}.html"), (sido, None)], depth=depth))


FEATURES = [("parking", "parking_lot", "주차장이 있는 봉안당", "자가용으로 모시러 가거나 참배할 때 주차장이 있는지는 가장 먼저 확인할 조건입니다. 명절에는 주차장이 있어도 붐비니 여유 있게 출발하세요."),
            ("accessible", "accessible", "장애인 편의시설이 있는 봉안당", "휠체어 이용자나 거동이 불편한 어르신과 함께 참배한다면 경사로·엘리베이터·장애인 화장실 등 편의시설을 확인하세요."),
            ("waiting-room", "waiting_room", "유족대기실이 있는 봉안당", "안치 절차를 기다리는 동안 가족이 머물 공간이 있으면 한결 수월합니다. 특히 장거리에서 온 가족이 많을 때 유용합니다."),
            ("restaurant", "restaurant", "식당이 있는 봉안당", "외딴 곳에 있는 시설이 많아 안치 후 식사할 곳이 마땅치 않을 수 있습니다. 시설 안에 식당이 있으면 이동 부담이 줄어듭니다.")]


def page_features(out, facs, groups):
    depth = 1
    r = rel(depth)
    for slug, key, title, intro in FEATURES:
        sub = [f for f in facs if f[key] is True]
        sections = []
        for sido in groups:
            s = [f for f in sub if f["sido"] == sido]
            if s:
                sections.append(f'<section class="card"><h2 id="{sido_slug(sido)}">{E(sido)} ({len(s)}곳)</h2>{facility_table(s, depth, show_region=True)}</section>')
        toc = " · ".join(f'<a href="#{sido_slug(sd)}">{E(SIDO_SHORT.get(sd, sd))}</a>' for sd in groups if any(f["sido"] == sd for f in sub))
        body = f"""<header class="page-head"><p class="eyebrow">편의시설별 찾기</p><h1>{title} {len(sub):,}곳</h1><p class="lead">{E(intro)}</p><p class="small">{toc}</p></header>
{''.join(sections) or '<p>해당 시설이 없습니다.</p>'}
{guide_links(depth, ["accessibility-visit", "visiting-etiquette", "how-to-choose"])}"""
        write(out, f"feature/{slug}.html", layout(f"feature/{slug}.html", title, f"전국 {title} {len(sub):,}곳을 시도별로 정리했습니다.", body,
                                                  crumbs=[("편의시설별", None), (title, None)], depth=depth))


def page_period(out, facs):
    depth = 1
    r = rel(depth)
    buckets = defaultdict(list)
    for f in facs:
        if f["max_period"] is not None:
            buckets[f["max_period"]].append(f)
    if not buckets:
        return
    rows = "".join(f'<tr><td>{k:g}년</td><td class="num">{len(v):,}곳</td></tr>' for k, v in sorted(buckets.items()))
    long_ones = sorted([f for f in facs if f["max_period"] is not None], key=lambda f: -f["max_period"])[:50]
    body = f"""<header class="page-head"><h1>최대 안치기간으로 보는 봉안시설</h1>
<p class="lead">최초 안치기간에 연장 가능 기간과 횟수를 더하면 한 시설에 최대 몇 년 모실 수 있는지 계산할 수 있습니다. 공공데이터에 세 값이 모두 있는 시설만 계산했습니다.</p></header>
<section class="card"><h2>최대 안치기간별 시설 수</h2><table class="list"><thead><tr><th>최대 안치기간</th><th class="num">시설 수</th></tr></thead><tbody>{rows}</tbody></table></section>
<section class="card"><h2>오래 모실 수 있는 시설 50곳</h2>{facility_table(long_ones, depth)}</section>
{guide_links(depth, ["enshrinement-period", "natural-burial", "reburial"])}"""
    write(out, "feature/long-period.html", layout("feature/long-period.html", "최대 안치기간이 긴 봉안당", "최초 안치기간과 연장 조건으로 계산한 봉안시설별 최대 안치기간.", body,
                                                  crumbs=[("편의시설별", None), ("최대 안치기간", None)], depth=depth))



def _q(vals, q):
    v = sorted(vals)
    if not v:
        return None
    return v[min(len(v) - 1, int(round((len(v) - 1) * q)))]


def price_hub_links(depth):
    r = rel(depth)
    cards = [("compare/facilities.html", "업체별 가격 비교", "시설마다 개인단·부부단·관리비를 한 표에서 비교"),
             ("compare/types.html", "종류별 가격 비교", "개인단·부부단·가족단의 전국 가격 분포"),
             ("compare/regions.html", "지역별 가격 비교", "시도별 중간 가격과 가장 저렴한 곳"),
             ("pages/recommend.html", "예산으로 추천받기", "원하는 가격을 넣으면 맞는 봉안당을 골라 줌")]
    return '<div class="feature-grid hub">' + "".join(
        f'<a class="feature-card" href="{r}{u}"><strong>{E(t)}</strong><span>{E(d)}</span></a>' for u, t, d in cards) + "</div>"


def page_compare_facilities(out, facs):
    depth = 1
    r = rel(depth)
    priced = sorted([f for f in facs if f.get("price_min")], key=lambda f: (f.get("p_single") or f["price_min"]))
    def td(v, label=""):
        return f'<td class="num" data-v="{v if v else ""}" title="{E(label)}">{fmt_won(v) if v else "–"}</td>'
    rows = "".join(
        f'<tr data-sido="{E(f["sido"])}" data-kind="{E(f["kind"])}"><td><a href="{r}{facility_url(f)}">{E(f["name"])}</a></td>'
        f'<td class="hide-sm">{E(SIDO_SHORT.get(f["sido"], f["sido"]))} {E(f["sigungu"])}</td><td>{kind_badge(f["kind"])}</td>'
        + td(f.get("p_single"), f.get("pn_single")) + td(f.get("p_couple"), f.get("pn_couple")) + td(f.get("p_other"), f.get("pn_other"))
        + td(f.get("p_mgmt"), f.get("pn_mgmt"))
        + f'<td class="num hide-sm" data-v="{f["max_period"] or ""}">{fmt_years(f["max_period"]) if f["max_period"] else "–"}</td></tr>'
        for f in priced)
    sidos = "".join(f'<option>{E(sd)}</option>' for sd in SIDO if any(f["sido"] == sd for f in priced))
    body = f"""<header class="page-head"><p class="eyebrow">가격 비교</p><h1>업체별 봉안당 가격 비교</h1>
<p class="lead">가격 정보가 있는 봉안시설 {len(priced):,}곳의 종류별 최저 가격을 한 표에 모았습니다. 열 제목을 누르면 정렬되고, 금액에 마우스를 올리면 해당 상품명이 보입니다.</p></header>
<div class="filters compact-filters">
  <label>시도<select id="cf-sido"><option value="">전체</option>{sidos}</select></label>
  <label>구분<select id="cf-kind"><option value="">전체</option><option>공설</option><option>사설</option></select></label>
  <label>시설명<input id="cf-q" type="search" placeholder="시설명 검색"></label>
</div>
<p class="muted small" id="cf-count"></p>
<section class="card"><div class="table-wrap"><table class="list sortable" id="cf-table"><thead><tr>
<th data-sort="text">시설명</th><th class="hide-sm">지역</th><th>구분</th><th class="num" data-sort="num">개인단</th><th class="num" data-sort="num">부부단</th>
<th class="num" data-sort="num">기타</th><th class="num" data-sort="num">관리비</th><th class="num hide-sm" data-sort="num">최대 안치</th>
</tr></thead><tbody>{rows}</tbody></table></div>
<p class="muted small">금액은 해당 종류에서 가장 낮은 상품 가격입니다. 관리비는 1년치인지 전체 기간치인지 시설마다 다르니 상세 페이지의 가격표를 확인하세요. 출처: 한국장례문화진흥원 장사시설 가격정보(2023-06-01 기준).</p></section>
{price_hub_links(depth)}
<script src="{r}static/site.js" defer></script>"""
    write(out, "compare/facilities.html", layout("compare/facilities.html", "업체별 봉안당 가격 비교",
                                                 f"봉안시설 {len(priced):,}곳의 개인단·부부단·관리비 가격을 한 표에서 비교하세요.", body,
                                                 crumbs=[("가격 비교", "feature/price.html"), ("업체별", None)], depth=depth))


def page_compare_types(out, facs):
    depth = 1
    r = rel(depth)
    intro = {"single": "한 분을 모시는 칸입니다. 봉안당 가격 비교의 기본 기준이 됩니다.",
             "couple": "부부를 함께 모시는 칸입니다. 개인단 두 칸보다 저렴한 경우가 많지만, 나중에 함께 모실 계획이 있을 때 고릅니다.",
             "other": "가족단, 평장, 봉안묘, 봉안탑, 무연고 안치 등 개인·부부단이 아닌 상품입니다. 형태가 다양해 가격 폭이 넓습니다.",
             "mgmt": "시설 유지에 드는 비용입니다. 1년 단위로 내는 곳과 여러 해 치를 한 번에 내는 곳이 섞여 있어 단순 비교에 주의하세요."}
    secs, summary_rows = [], []
    for t in PRICE_TYPES + ["mgmt"]:
        key = "p_" + t
        have = [f for f in facs if f.get(key)]
        if not have:
            continue
        vals = [f[key] for f in have]
        pub = [f[key] for f in have if f["kind"] == "공설"]
        pri = [f[key] for f in have if f["kind"] == "사설"]
        summary_rows.append(f'<tr><td>{PRICE_TYPE_LABEL[t]}</td><td class="num">{len(have):,}곳</td><td class="num">{fmt_won(min(vals))}</td>'
                            f'<td class="num">{fmt_won(_q(vals, .5))}</td><td class="num">{fmt_won(max(vals))}</td>'
                            f'<td class="num hide-sm">{fmt_won(_q(pub, .5)) if pub else "–"}</td><td class="num hide-sm">{fmt_won(_q(pri, .5)) if pri else "–"}</td></tr>')
        cheap = sorted(have, key=lambda f: f[key])[:15]
        lis = "".join(f'<tr><td><a href="{r}{facility_url(f)}">{E(f["name"])}</a></td><td class="hide-sm">{E(SIDO_SHORT.get(f["sido"], f["sido"]))} {E(f["sigungu"])}</td>'
                      f'<td>{kind_badge(f["kind"])}</td><td class="hide-sm small">{E(f.get("pn_" + t, ""))}</td><td class="num">{fmt_won(f[key])}</td></tr>' for f in cheap)
        q1, q3 = _q(vals, .25), _q(vals, .75)
        secs.append(f'<section class="card" id="{t}"><h2>{PRICE_TYPE_LABEL[t]}</h2><p>{E(intro[t])}</p>'
                    f'<p class="small">가격이 등록된 {len(have):,}곳 가운데 절반은 <strong>{fmt_won(q1)}~{fmt_won(q3)}</strong> 사이입니다. 중간값은 {fmt_won(_q(vals, .5))}입니다.</p>'
                    f'<h3>가장 저렴한 15곳</h3><div class="table-wrap"><table class="list"><thead><tr><th>시설명</th><th class="hide-sm">지역</th><th>구분</th><th class="hide-sm">상품</th><th class="num">가격</th></tr></thead><tbody>{lis}</tbody></table></div></section>')
    body = f"""<header class="page-head"><p class="eyebrow">가격 비교</p><h1>종류별 봉안당 가격 비교</h1>
<p class="lead">개인단, 부부단, 가족단 같은 상품 종류에 따라 가격이 어떻게 다른지 전국 가격 정보로 정리했습니다.</p></header>
<section class="card"><h2>한눈에 보기</h2><div class="table-wrap"><table class="list"><thead><tr><th>종류</th><th class="num">시설 수</th><th class="num">최저</th><th class="num">중간값</th><th class="num">최고</th><th class="num hide-sm">공설 중간값</th><th class="num hide-sm">사설 중간값</th></tr></thead>
<tbody>{"".join(summary_rows)}</tbody></table></div>
<p class="muted small">각 시설에서 해당 종류의 가장 낮은 상품 가격을 모아 계산했습니다. 출처: 한국장례문화진흥원 장사시설 가격정보(2023-06-01 기준).</p></section>
{"".join(secs)}
{price_hub_links(depth)}"""
    write(out, "compare/types.html", layout("compare/types.html", "종류별 봉안당 가격 비교 (개인단·부부단·가족단)",
                                            "개인단·부부단·가족단·관리비의 전국 봉안당 가격 분포와 가장 저렴한 시설을 비교합니다.", body,
                                            crumbs=[("가격 비교", "feature/price.html"), ("종류별", None)], depth=depth))


def page_compare_regions(out, facs, groups):
    depth = 1
    r = rel(depth)
    rows, bars, secs = [], [], []
    meds = {}
    for sd, v in groups.items():
        s1 = [f["p_single"] for f in v if f.get("p_single")]
        s2 = [f["p_couple"] for f in v if f.get("p_couple")]
        if not s1 and not s2:
            continue
        pub = [f["p_single"] for f in v if f.get("p_single") and f["kind"] == "공설"]
        pri = [f["p_single"] for f in v if f.get("p_single") and f["kind"] == "사설"]
        n = sum(1 for f in v if f.get("price_min"))
        meds[sd] = _q(s1, .5) if s1 else None
        rows.append(f'<tr><td><a href="#{sido_slug(sd)}">{E(sd)}</a></td><td class="num">{n}곳</td><td class="num">{fmt_won(min(s1)) if s1 else "–"}</td>'
                    f'<td class="num">{fmt_won(_q(s1, .5)) if s1 else "–"}</td><td class="num">{fmt_won(_q(s2, .5)) if s2 else "–"}</td>'
                    f'<td class="num hide-sm">{fmt_won(_q(pub, .5)) if pub else "–"}</td><td class="num hide-sm">{fmt_won(_q(pri, .5)) if pri else "–"}</td></tr>')
        cheap = sorted([f for f in v if f.get("price_min")], key=lambda f: f.get("p_single") or f["price_min"])[:5]
        lis = "".join(f'<li><a href="{r}{facility_url(f)}">{E(f["name"])}</a> {kind_badge(f["kind"])} <span class="muted">{E(f["sigungu"])}</span> · '
                      f'<strong>{fmt_won(f.get("p_single") or f["price_min"])}</strong>{"" if f.get("p_single") else " (기타 상품)"}</li>' for f in cheap)
        secs.append(f'<section class="card"><h2 id="{sido_slug(sd)}">{E(sd)}</h2><p class="small">개인단 중간 가격 {fmt_won(meds[sd]) if meds[sd] else "정보 없음"} · 가격 등록 {n}곳</p>'
                    f'<h3>저렴한 곳 5곳</h3><ul class="link-list">{lis}</ul><p class="small"><a href="{r}{region_url(sd)}">{E(sd)} 전체 시설 보기</a></p></section>')
    top = max([m for m in meds.values() if m] or [1])
    bars = "".join(f'<div class="bar-row"><span class="bar-label">{E(SIDO_SHORT.get(sd, sd))}</span><span class="bar-track"><span class="bar" style="width:{max(2, round(m * 100 / top))}%"></span></span><span class="bar-val">{fmt_won(m)}</span></div>'
                   for sd, m in sorted(meds.items(), key=lambda kv: kv[1] or 0) if m)
    body = f"""<header class="page-head"><p class="eyebrow">가격 비교</p><h1>지역별 봉안당 가격 비교</h1>
<p class="lead">시도마다 봉안당 가격이 얼마나 다른지 개인단·부부단 중간 가격으로 비교했습니다. 공설이 많은 지역일수록 중간 가격이 낮게 나오는 경향이 있습니다.</p></header>
<section class="card"><h2>시도별 개인단 중간 가격</h2><div class="bars">{bars}</div></section>
<section class="card"><h2>시도별 가격 요약</h2><div class="table-wrap"><table class="list"><thead><tr><th>시도</th><th class="num">가격 등록</th><th class="num">개인단 최저</th><th class="num">개인단 중간값</th><th class="num">부부단 중간값</th><th class="num hide-sm">공설 개인단</th><th class="num hide-sm">사설 개인단</th></tr></thead>
<tbody>{"".join(rows)}</tbody></table></div><p class="muted small">출처: 한국장례문화진흥원 장사시설 가격정보(2023-06-01 기준). 공설 시설은 관내·관외 주민 요금이 다를 수 있습니다.</p></section>
{"".join(secs)}
{price_hub_links(depth)}"""
    write(out, "compare/regions.html", layout("compare/regions.html", "지역별 봉안당 가격 비교",
                                              "시도별 봉안당 개인단·부부단 중간 가격과 지역에서 가장 저렴한 시설을 비교합니다.", body,
                                              crumbs=[("가격 비교", "feature/price.html"), ("지역별", None)], depth=depth))


def page_recommend(out, groups):
    depth = 1
    r = rel(depth)
    options = "".join(f'<option value="{E(sd)}">{E(sd)}</option>' for sd in groups)
    body = f"""<header class="page-head"><p class="eyebrow">가격 비교</p><h1>예산으로 봉안당 추천받기</h1>
<p class="lead">생각하는 예산과 조건을 넣으면, 예산 안에 드는 봉안당을 편의시설과 안치기간까지 따져 추천해 드립니다.</p></header>
<form id="rec-form" class="card rec-form" onsubmit="return false">
  <div class="rec-grid">
    <label>예산 (만 원)<input id="rb" type="number" min="1" step="1" inputmode="numeric" placeholder="예: 300"></label>
    <label>모실 형태<select id="rt"><option value="single">한 분 (개인단)</option><option value="couple">부부 (부부단)</option><option value="any">상관없음</option></select></label>
    <label>지역<select id="rs"><option value="">전국</option>{options}</select></label>
    <label>운영<select id="rk"><option value="">상관없음</option><option>공설</option><option>사설</option></select></label>
  </div>
  <fieldset class="rec-amen"><legend>꼭 있어야 하는 편의시설</legend>
    <label class="check"><input type="checkbox" value="parking_lot">주차장</label>
    <label class="check"><input type="checkbox" value="accessible">장애인 편의</label>
    <label class="check"><input type="checkbox" value="waiting_room">유족대기실</label>
    <label class="check"><input type="checkbox" value="restaurant">식당</label>
  </fieldset>
  <div class="rec-actions"><button type="button" id="rgo">추천받기</button>
    <label class="inline">정렬<select id="ro"><option value="best">추천순</option><option value="near">예산에 가까운 순</option><option value="cheap">저렴한 순</option></select></label></div>
  <p id="rerr" class="err" role="alert"></p>
</form>
<div id="rec-summary" aria-live="polite"></div>
<div id="rec-results" class="results"></div>
<div id="rec-over"></div>
<section class="card note"><h2>추천 기준</h2><ul class="tips">
<li>모실 형태에 맞는 상품 가운데 가장 낮은 가격이 예산 이하인 시설만 보여 줍니다.</li>
<li>추천순은 편의시설이 많을수록, 최대 안치기간이 길수록, 예산에 여유가 있을수록 위에 옵니다.</li>
<li>관리비는 별도인 경우가 많습니다. 결과 카드의 관리비와 상세 가격표를 함께 확인하세요.</li>
<li>가격은 한국장례문화진흥원 공개 자료(2023-06-01 기준)이며 지금은 다를 수 있습니다. 계약 전 시설에 꼭 확인하세요.</li></ul></section>
{price_hub_links(depth)}
<script src="{r}static/site.js" defer></script>"""
    write(out, "pages/recommend.html", layout("pages/recommend.html", "예산으로 봉안당 추천받기",
                                              "예산과 지역, 개인단·부부단, 편의시설 조건을 넣으면 맞는 봉안당을 추천합니다.", body,
                                              crumbs=[("가격 비교", "feature/price.html"), ("예산 추천", None)], depth=depth))



def page_price(out, facs, groups):
    depth = 1
    r = rel(depth)
    priced = sorted([f for f in facs if f.get("price_min")], key=lambda f: f["price_min"])
    secs = []
    for lo, hi, label in PRICE_BANDS:
        band = [f for f in priced if lo <= f["price_min"] < hi]
        if band:
            secs.append(f'<section class="card"><h2 id="b{lo}">{label} ({len(band)}곳)</h2>{facility_table(band, depth)}</section>')
    toc = " · ".join(f'<a href="#b{lo}">{label}</a>' for lo, hi, label in PRICE_BANDS if any(lo <= f["price_min"] < hi for f in priced))
    by_sido = "".join(
        f'<tr><td><a href="{r}{region_url(sd)}">{E(sd)}</a></td><td class="num">{len(p)}곳</td><td class="num">{fmt_won(min(x["price_min"] for x in p))}</td>'
        f'<td class="num">{fmt_won(sorted(x["price_min"] for x in p)[len(p) // 2])}</td></tr>'
        for sd, v in groups.items() for p in [[x for x in v if x.get("price_min")]] if p)
    note = ("가격은 각 시설이 공개한 이용 요금 가운데 관리비를 뺀 가장 낮은 금액(최저가)입니다. 같은 시설이라도 안치단 높이·위치, 1위용·부부용, "
            "안치기간에 따라 가격이 크게 달라집니다. 반드시 시설에 현재 가격을 확인하세요.")
    body = f"""<header class="page-head"><h1>봉안당 가격 비교</h1>
<p class="lead">가격 정보가 등록된 봉안시설 {len(priced):,}곳을 최저가 기준으로 나눴습니다.</p><p class="small muted">{E(note)}</p></header>
{price_hub_links(depth)}
<p class="small">가격대 바로가기: {toc}</p>
{f'<section class="card"><h2>시도별 가격 요약</h2><div class="table-wrap"><table class="list"><thead><tr><th>시도</th><th class="num">가격 등록</th><th class="num">최저가</th><th class="num">중간값</th></tr></thead><tbody>{by_sido}</tbody></table></div></section>' if by_sido else ''}
{''.join(secs) or '<section class="card"><p>아직 등록된 가격 정보가 없습니다.</p></section>'}
{guide_links(depth, ["cost-structure", "contract-checklist", "public-vs-private"])}"""
    write(out, "feature/price.html", layout("feature/price.html", "봉안당 가격 비교", f"봉안시설 {len(priced):,}곳의 공개 가격을 가격대별·시도별로 비교합니다.", body,
                                            crumbs=[("가격 비교", None)], depth=depth))
    page_compare_facilities(out, facs)
    page_compare_types(out, facs)
    page_compare_regions(out, facs, groups)
    page_recommend(out, groups)


def page_index(out, facs, groups):
    st = stats_of(facs)
    cards = "".join(f'<a class="region-card" href="{region_url(s)}"><strong>{E(SIDO_SHORT.get(s, s))}</strong><span>{len(v)}곳</span></a>' for s, v in groups.items())
    feats = "".join(f'<a class="feature-card" href="feature/{slug}.html"><strong>{E(t)}</strong><span>{sum(1 for f in facs if f[k] is True):,}곳</span></a>' for slug, k, t, _ in FEATURES)
    body = f"""
<section class="hero">
  <h1>가까운 봉안당, 조건에 맞게 찾아보세요</h1>
  <p class="lead">{E(CONFIG['site_tagline'])}. 전국 봉안시설 {st['n']:,}곳의 공공데이터를 정리했습니다.</p>
  <form class="search-box" action="pages/search.html" method="get" role="search">
    <label class="sr-only" for="q">시설명이나 지역 검색</label>
    <input id="q" name="q" type="search" placeholder="시설명, 시군구, 주소로 검색 (예: 김포, 추모공원)" autocomplete="off">
    <button type="submit">검색</button>
  </form>
  <form class="search-box budget-box" action="pages/recommend.html" method="get">
    <label class="sr-only" for="hb">예산(만 원)</label>
    <input id="hb" name="b" type="number" min="1" step="1" inputmode="numeric" placeholder="예산(만 원)으로 추천받기 · 예: 300">
    <select name="t" aria-label="모실 형태"><option value="single">개인단</option><option value="couple">부부단</option><option value="any">상관없음</option></select>
    <button type="submit">추천받기</button>
  </form>
</section>
{stat_cards(st)}
<section class="card"><h2>지역별로 찾기</h2><div class="region-grid">{cards}</div></section>
<section class="card"><h2>조건으로 찾기</h2><div class="feature-grid">
  <a class="feature-card" href="type/public.html"><strong>공설 봉안당</strong><span>{st['pub']:,}곳</span></a>
  <a class="feature-card" href="type/private.html"><strong>사설 봉안당</strong><span>{st['pri']:,}곳</span></a>
  {feats}
  <a class="feature-card" href="pages/recommend.html"><strong>예산으로 추천받기</strong><span>원하는 가격에 맞는 곳</span></a>
  <a class="feature-card" href="compare/regions.html"><strong>지역별 가격 비교</strong><span>시도별 중간 가격</span></a>
  <a class="feature-card" href="feature/price.html"><strong>가격대별 비교</strong><span>{sum(1 for f in facs if f.get("price_min")):,}곳 가격 등록</span></a>
  <a class="feature-card" href="feature/long-period.html"><strong>최대 안치기간 비교</strong><span>기간별 보기</span></a>
</div></section>
{guide_links(0, None, "처음이라면 먼저 읽어 보세요")}
<section class="card note"><h2>이 사이트의 정보에 대해</h2><p>시설 정보는 보건복지부가 공공데이터포털에 공개한 「전국 봉안시설 현황」을 바탕으로 합니다. 이용 요금, 남은 안치 기수, 신청 자격은 수시로 바뀌므로 최종 결정 전에는 꼭 시설에 직접 확인하세요.</p></section>"""
    write(out, "index.html", layout("index.html", SITE, f"전국 봉안당·납골당 {st['n']:,}곳을 지역, 공설·사설, 안치기간, 주차장·편의시설로 검색하세요.", body,
                                    jsonld={"@context": "https://schema.org", "@type": "WebSite", "name": SITE, "url": SITE_URL + "/",
                                            "potentialAction": {"@type": "SearchAction", "target": SITE_URL + "/pages/search.html?q={q}", "query-input": "required name=q"}}))


def page_search(out, groups):
    options = "".join(f'<option value="{E(s)}">{E(s)}</option>' for s in groups)
    body = f"""<header class="page-head"><h1>봉안시설 검색</h1><p class="lead">시설명·주소로 찾고, 지역과 조건으로 좁혀 보세요.</p></header>
<form id="search-form" class="filters" role="search" onsubmit="return false">
  <label>검색어<input id="sq" type="search" placeholder="시설명, 시군구, 주소"></label>
  <label>시도<select id="ssido"><option value="">전체</option>{options}</select></label>
  <label>구분<select id="skind"><option value="">전체</option><option>공설</option><option>사설</option></select></label>
  <label>최대 가격<select id="spmax"><option value="">제한 없음</option><option value="100">100만 원 이하</option><option value="300">300만 원 이하</option><option value="500">500만 원 이하</option><option value="1000">1,000만 원 이하</option></select></label>
  <label>정렬<select id="ssort"><option value="">지역순</option><option value="price">가격 낮은 순</option></select></label>
  <fieldset><legend>편의시설</legend>
    <label class="check"><input type="checkbox" value="parking_lot">주차장</label>
    <label class="check"><input type="checkbox" value="accessible">장애인 편의</label>
    <label class="check"><input type="checkbox" value="waiting_room">유족대기실</label>
    <label class="check"><input type="checkbox" value="restaurant">식당</label>
  </fieldset>
</form>
<p id="result-count" class="muted" aria-live="polite">불러오는 중…</p>
<div id="results" class="results"></div>
<noscript><p>검색 기능은 자바스크립트가 필요합니다. <a href="../region/index.html">지역별 목록</a>을 이용해 주세요.</p></noscript>
<script src="../static/site.js" defer></script>"""
    write(out, "pages/search.html", layout("pages/search.html", "봉안시설 검색", "전국 봉안시설을 시설명, 주소, 지역, 공설·사설, 편의시설로 검색합니다.", body, crumbs=[("검색", None)], depth=1))


def search_index(out, facs):
    data = [{"i": f["id"], "n": f["name"], "s": f["sido"], "g": f["sigungu"], "a": f["address"], "k": f["kind"],
             "p": f["first_period"], "pr": f.get("price_min"), "ps": f.get("p_single"), "pc": f.get("p_couple"), "po": f.get("p_other"),
             "mg": f.get("p_mgmt"), "psn": f.get("pn_single", ""), "pcn": f.get("pn_couple", ""), "pon": f.get("pn_other", ""),
             "mp": f.get("max_period"), "t": f["tel"], "u": facility_url(f), "f": [k for k, _ in AMENITIES if f[k] is True]} for f in facs]
    (out / "data").mkdir(parents=True, exist_ok=True)
    (out / "data" / "search.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


# ---------------------------------------------------------------------------
# 7. 가이드·정적 페이지 (content/ 폴더)
# ---------------------------------------------------------------------------

def read_content(path):
    """<!-- title: ...\ndescription: ...\n--> 형식의 머리말을 읽는다."""
    text = path.read_text(encoding="utf-8")
    meta = {}
    m = re.match(r"\s*<!--(.*?)-->", text, re.S)
    if m:
        for line in m.group(1).strip().splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
        text = text[m.end():]
    return meta, text


def load_guides():
    GUIDES.clear()
    for p in sorted((ROOT / "content" / "guides").glob("*.html")):
        meta, body = read_content(p)
        GUIDES.append({"slug": p.stem, "title": meta.get("title", p.stem), "description": meta.get("description", ""),
                       "order": int(meta.get("order", "99")), "related": [s.strip() for s in meta.get("related", "").split(",") if s.strip()],
                       "body": body})
    GUIDES.sort(key=lambda g: g["order"])


def render_content_body(body, depth):
    r = rel(depth)
    body = body.replace("{{root}}", r).replace("{{site_name}}", E(SITE)).replace("{{contact_email}}", E(CONFIG.get("contact_email", "")))
    return body.replace("{{today}}", TODAY)


def page_guides(out):
    depth = 1
    r = rel(depth)
    for g in GUIDES:
        related = guide_links(depth, g["related"] or None, "관련 가이드")
        body = f"""<article class="guide"><header class="page-head"><p class="eyebrow">봉안 가이드</p><h1>{E(g['title'])}</h1><p class="lead">{E(g['description'])}</p></header>
<div class="prose">{render_content_body(g['body'], depth)}</div>
<p class="muted small">이 글은 일반적인 안내이며 법률 자문이 아닙니다. 법령과 시설 규정은 바뀔 수 있으니 최신 내용은 국가법령정보센터와 해당 시설에서 확인하세요. 최종 수정 {TODAY}</p>
</article>
<section class="card cta"><h2>조건에 맞는 봉안당 찾기</h2><p>지역, 공설·사설, 편의시설로 전국 봉안시설을 검색할 수 있습니다.</p><a class="btn primary" href="{r}pages/search.html">시설 검색하기</a></section>
{related}"""
        ld = {"@context": "https://schema.org", "@type": "Article", "headline": g["title"], "description": g["description"],
              "dateModified": TODAY, "author": {"@type": "Organization", "name": SITE}, "publisher": {"@type": "Organization", "name": SITE}}
        write(out, f"guides/{g['slug']}.html", layout(f"guides/{g['slug']}.html", g["title"], g["description"], body,
                                                      crumbs=[("가이드", "guides/index.html"), (g["title"], None)], jsonld=ld, depth=depth))
    lis = "".join(f'<li><a href="{g["slug"]}.html">{E(g["title"])}</a><span class="muted">{E(g["description"])}</span></li>' for g in GUIDES)
    body = f"""<header class="page-head"><h1>봉안 가이드</h1><p class="lead">봉안당을 처음 알아보는 분들을 위해 제도와 절차, 비용 구조, 계약 시 주의점을 정리했습니다.</p></header>
<section class="card"><ul class="guide-list">{lis}</ul></section>"""
    write(out, "guides/index.html", layout("guides/index.html", "봉안 가이드", "봉안당 선택, 안치기간, 비용, 계약, 개장·이장 절차 등 봉안에 관한 안내글 모음.", body,
                                           crumbs=[("가이드", None)], depth=depth))


def page_static(out):
    for p in sorted((ROOT / "content" / "pages").glob("*.html")):
        meta, body = read_content(p)
        title = meta.get("title", p.stem)
        html_body = f'<article><header class="page-head"><h1>{E(title)}</h1></header><div class="prose">{render_content_body(body, 1)}</div></article>'
        write(out, f"pages/{p.stem}.html", layout(f"pages/{p.stem}.html", title, meta.get("description", title), html_body, crumbs=[(title, None)], depth=1))


def page_404(out):
    body = """<header class="page-head"><h1>페이지를 찾을 수 없습니다</h1><p class="lead">주소가 바뀌었거나 삭제된 페이지입니다.</p>
<div class="actions"><a class="btn primary" href="/">홈으로</a><a class="btn" href="/pages/search.html">시설 검색</a></div></header>"""
    write(out, "404.html", layout("404.html", "페이지 없음", "페이지를 찾을 수 없습니다.", body, noindex=True))


def page_sitemap_html(out, groups):
    secs = []
    for s, v in groups.items():
        secs.append(f'<section class="card"><h2><a href="../{region_url(s)}">{E(s)}</a></h2><ul class="link-list cols">'
                    + "".join(f'<li><a href="../{facility_url(f)}">{E(f["name"])}</a></li>' for f in v) + "</ul></section>")
    guides = "".join(f'<li><a href="../guides/{g["slug"]}.html">{E(g["title"])}</a></li>' for g in GUIDES)
    body = f'<header class="page-head"><h1>사이트맵</h1></header><section class="card"><h2>가이드</h2><ul class="link-list cols">{guides}</ul></section>{"".join(secs)}'
    write(out, "pages/sitemap.html", layout("pages/sitemap.html", "사이트맵", "봉안당 길잡이의 전체 페이지 목록.", body, crumbs=[("사이트맵", None)], depth=1))


def seo_files(out):
    urls = sorted(set(PAGES_WRITTEN))
    xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u in urls:
        loc = f"{SITE_URL}/{u}".replace("/index.html", "/")
        xml.append(f"<url><loc>{E(loc)}</loc><lastmod>{TODAY}</lastmod></url>")
    xml.append("</urlset>")
    (out / "sitemap.xml").write_text("\n".join(xml), encoding="utf-8")
    (out / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {SITE_URL}/sitemap.xml\n", encoding="utf-8")
    client = (CONFIG.get("adsense_client") or "").strip()
    if client:
        pub = client.replace("ca-", "")
        (out / "ads.txt").write_text(f"google.com, {pub}, DIRECT, f08c47fec0942fa0\n", encoding="utf-8")
    (out / ".nojekyll").write_text("", encoding="utf-8")


# ---------------------------------------------------------------------------
# 8. 실행
# ---------------------------------------------------------------------------

GENERATED_DIRS = ["facility", "region", "type", "feature", "guides", "pages", "static", "data", "compare"]
GENERATED_FILES = ["index.html", "404.html", "robots.txt", "sitemap.xml", "ads.txt", ".nojekyll"]


def build_site(facs):
    out = (ROOT / CONFIG.get("output_dir", "..")).resolve()
    out.mkdir(parents=True, exist_ok=True)
    # 이전에 생성한 결과물만 지운다 (_builder, .github 등 다른 파일은 건드리지 않음)
    for name in GENERATED_DIRS:
        if (out / name).is_dir():
            shutil.rmtree(out / name)
    for name in GENERATED_FILES:
        if (out / name).is_file():
            (out / name).unlink()
    shutil.copytree(ROOT / "static", out / "static")
    load_guides()
    PAGES_WRITTEN.clear()

    groups = OrderedDict((s, []) for s in list(SIDO) + ["기타"])
    for f in facs:
        groups.setdefault(f["sido"], []).append(f)
    groups = OrderedDict((k, v) for k, v in groups.items() if v)
    by_sgg = defaultdict(list)
    for f in facs:
        by_sgg[(f["sido"], f["sigungu"])].append(f)

    if not COMPACT:
        for f in facs:
            page_facility(out, f, by_sgg[(f["sido"], f["sigungu"])], groups[f["sido"]])
        for (sido, sgg), v in by_sgg.items():
            page_sigungu(out, sido, sgg, v)
    for sido, v in groups.items():
        page_sido(out, sido, v)
    page_region_index(out, groups)
    page_type(out, "공설", [f for f in facs if f["kind"] == "공설"], groups)
    page_type(out, "사설", [f for f in facs if f["kind"] == "사설"], groups)
    page_features(out, facs, groups)
    page_period(out, facs)
    page_price(out, facs, groups)
    page_index(out, facs, groups)
    page_search(out, groups)
    search_index(out, facs)
    page_guides(out)
    page_static(out)
    page_404(out)
    page_sitemap_html(out, groups)
    seo_files(out)
    return out


def write_inspect(records, tags, fmap):
    """응답 태그·예시 값·자동 매핑 결과를 화면과 inspect_result.txt 에 남긴다."""
    lines = ["[응답 태그와 예시 값 (앞 3건)]"]
    for t in tags:
        samples = [r.get(t, "") for r in records[:3]]
        mark = "" if t in fmap.values() else "   <- 연결 안 됨"
        lines.append(f"  {t:<28} {' | '.join(x[:20] for x in samples)}{mark}")
    lines.append("")
    lines.append("[자동 매핑 결과]")
    for field, label in FIELD_LABELS.items():
        lines.append(f"  {label:<12} -> {fmap.get(field, '(못 찾음)')}")
    text = "\n".join(lines)
    print("\n" + text)
    (ROOT / "inspect_result.txt").write_text(text, encoding="utf-8")
    print("\n위 내용이 inspect_result.txt 파일로 저장되었습니다. 이 파일 내용을 보내 주시면 연결을 맞춰 드립니다.")


def main():
    ap = argparse.ArgumentParser(description="봉안당 길잡이 사이트 생성기")
    ap.add_argument("--inspect", action="store_true", help="API 응답 태그와 자동 매핑 결과만 출력")
    ap.add_argument("--offline", action="store_true", help="API를 부르지 않고 data/facilities.json 으로 생성")
    ap.add_argument("--from-xml", help="저장된 XML 파일로 생성(테스트용)")
    args = ap.parse_args()

    if args.from_xml:
        records, _ = parse_items(Path(args.from_xml).read_text(encoding="utf-8"))
    elif args.offline:
        if not DATA_FILE.exists():
            sys.exit("data/facilities.json 이 없습니다. 먼저 인증키로 한 번 실행하세요.")
        records = json.loads(DATA_FILE.read_text(encoding="utf-8"))["raw"]
    else:
        key = os.environ.get("DATA_GO_KR_KEY", "").strip() or (CONFIG.get("api_key") or "").strip()
        if not key:
            sys.exit("config.json 의 api_key 에 공공데이터포털 인증키를 넣어 주세요.")
        print("API에서 데이터를 받는 중...")
        if args.inspect:
            text = fetch_page(key, 1, 5)
            records, total = parse_items(text)
            print(f"\n전체 건수: {total}")
        else:
            records = fetch_all(key)

    if not records:
        sys.exit("받은 레코드가 없습니다. 인증키 활성화 여부나 API 상태를 확인하세요.")

    tags = []
    for r in records[:50]:
        for k in r:
            if k not in tags:
                tags.append(k)
    fmap = build_field_map(tags)

    if args.inspect:
        write_inspect(records, tags, fmap)
        return

    facs, fmap = normalize(records)
    prices, directory, price_files = load_prices()
    matched, unmatched = attach_prices(facs, prices, directory)
    if price_files:
        for name, n, kind in price_files:
            print(f"{kind} 파일 {name}: {n:,}행")
        print(f"가격 정보가 연결된 시설: {matched:,}곳 / {len(facs):,}곳 (가격표 시설 {len(prices):,}곳 중 {len(prices) - len(unmatched):,}곳 연결)")
        if unmatched:
            print(f"  연결 못 한 가격표 시설 {len(unmatched)}곳: " + ", ".join(sorted(unmatched)[:30]) + (" ..." if len(unmatched) > 30 else ""))
    else:
        print("가격 파일이 없습니다. _builder/prices 폴더에 CSV를 넣으면 가격이 표시됩니다.")
    missing = [FIELD_LABELS[f] for f in FIELD_LABELS if f not in fmap]
    if missing:
        print("주의: 다음 항목은 태그를 찾지 못해 '정보 없음'으로 표시됩니다 →", ", ".join(missing))
        write_inspect(records, tags, fmap)

    if not args.from_xml:
        DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        DATA_FILE.write_text(json.dumps({"fetched": TODAY, "field_map": fmap, "raw": records}, ensure_ascii=False, indent=1), encoding="utf-8")

    out = build_site(facs)
    print(f"\n완료: 시설 {len(facs):,}곳, HTML {len(PAGES_WRITTEN):,}개 페이지 → {out}")


if __name__ == "__main__":
    main()
