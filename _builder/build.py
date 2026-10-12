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
        for k in ("first_period", "ext_years", "ext_count"):
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
            if ("address" in cols or "tel" in cols) and nm not in directory:
                directory[nm] = {"sido": normalize_sido(_cell(r, cols, "sido"), _cell(r, cols, "address")),
                                 "address": _cell(r, cols, "address"), "tel": _cell(r, cols, "tel")}
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
    idx = index_facilities(facs)
    for f in facs:
        f["prices"] = []
    unmatched = []
    for pname, items in prices.items():
        info = directory.get(pname, {})
        sido = info.get("sido") or next((it["sido"] for it in items if it.get("sido")), "")
        sido = "" if sido == "기타" else sido
        targets = match_facility(idx, pname, sido, info.get("address", ""), info.get("tel", ""), allow_multi=True)
        if not targets:
            unmatched.append(pname)
            continue
        for t in targets:
            t["prices"].extend(items)
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



# ---------------------------------------------------------------------------
# 4-2. 안치 규모 (_builder/capacity/*.csv)
#   열: 시도, 시설명, 주소, 전화번호, 총안치능력, 안치수, 잔여, 기준일, 출처
# ---------------------------------------------------------------------------
CAP_DIR = ROOT / "capacity"


def _num(v):
    v = re.sub(r"[^\d.]", "", str(v or ""))
    try:
        return int(float(v)) if v else None
    except ValueError:
        return None


def _digits(s):
    return re.findall(r"\d+", s or "")


def _sim(a, b):
    import difflib
    ka, kb = name_key(a), name_key(b)
    if _digits(ka) and _digits(kb) and _digits(ka) != _digits(kb):
        return 0.0                      # 제1관 ↔ 제2관 같은 경우는 다른 시설
    score = difflib.SequenceMatcher(None, ka, kb).ratio()
    if ka and kb and (ka in kb or kb in ka):
        score += 0.3
    if bool(_digits(ka)) != bool(_digits(kb)):
        score -= 0.15
    ta = {w for w in ("봉안당", "봉안탑", "봉안묘", "봉안담", "추모관", "가족") if w in (a or "")}
    tb = {w for w in ("봉안당", "봉안탑", "봉안묘", "봉안담", "추모관", "가족") if w in (b or "")}
    if ta and tb:
        score += 0.2 if ta & tb else -0.25
    return score


def match_facility(facs_index, name, sido="", address="", tel="", allow_multi=False):
    """이름 → 전화번호·주소 → 정규화 이름 순으로 시설을 찾는다.
    확실한 한 곳이면 [시설], allow_multi 이면 같은 전화·주소를 쓰는 여러 관(제1관·제2관 등)을 모두 돌려준다."""
    by_tel, by_addr, by_name, by_key = facs_index
    cands = by_name.get(re.sub(r"\s", "", name), [])
    if sido:
        cands = [c for c in cands if c["sido"] == sido] or ([] if len(cands) > 1 else cands)
    if len(cands) == 1:
        return cands
    pool = {}
    if tel_key(tel):
        for c in by_tel.get(tel_key(tel), []):
            pool[c["id"]] = c
    if addr_key(address) and sido:
        for c in by_addr.get((sido, addr_key(address)), []):
            pool[c["id"]] = c
    if sido and not pool:
        for c in by_key.get((sido, name_key(name)), []):
            pool[c["id"]] = c
    if sido:
        pool = {k: c for k, c in pool.items() if c["sido"] == sido} or pool
    if not pool:
        return []
    scored = sorted(((_sim(name, c["name"]), c) for c in pool.values()), key=lambda x: -x[0])
    if len(scored) == 1:
        return [scored[0][1]] if scored[0][0] >= 0.35 else []
    top, second = scored[0][0], scored[1][0]
    if top >= 0.5 and top - second >= 0.15:
        return [scored[0][1]]
    if allow_multi:
        group = [c for sc, c in scored if sc >= 0.35 and sc >= top - 0.15]
        return group
    return []


def index_facilities(facs):
    by_tel, by_addr, by_name, by_key = defaultdict(list), defaultdict(list), defaultdict(list), defaultdict(list)
    for f in facs:
        if tel_key(f["tel"]):
            by_tel[tel_key(f["tel"])].append(f)
        if addr_key(f["address"]):
            by_addr[(f["sido"], addr_key(f["address"]))].append(f)
        by_name[re.sub(r"\s", "", f["name"])].append(f)
        by_key[(f["sido"], name_key(f["name"]))].append(f)
    return by_tel, by_addr, by_name, by_key


def attach_capacity(facs):
    for f in facs:
        f["cap"] = None
    if not CAP_DIR.exists():
        return 0, []
    idx = index_facilities(facs)
    matched, unmatched = 0, []
    for path in sorted(CAP_DIR.glob("*.csv")):
        for r in read_csv_any(path):
            name = (r.get("시설명") or "").strip()
            if not name:
                continue
            sido = normalize_sido(r.get("시도", ""), r.get("주소", ""))
            sido = "" if sido == "기타" else sido
            found = match_facility(idx, name, sido, r.get("주소", ""), r.get("전화번호", ""))
            if len(found) != 1:
                unmatched.append(name)
                continue
            f = found[0]
            total, used, remain = _num(r.get("총안치능력")), _num(r.get("안치수")), _num(r.get("잔여"))
            if not total:
                continue
            cur = f["cap"]
            if cur and cur["date"] >= (r.get("기준일") or ""):
                continue
            f["cap"] = {"total": total, "used": used, "remain": remain, "date": (r.get("기준일") or "").strip(),
                        "source": (r.get("출처") or path.stem).strip(),
                        "rate": round(used * 100 / total, 1) if used is not None and total else None}
            matched += 1
    return matched, unmatched


def load_cremation_stats():
    path = ROOT / "stats" / "cremation_rate_2018_2024.csv"
    if not path.exists():
        return []
    rows = []
    for r in read_csv_any(path):
        name = re.sub(r"[A-Za-z\s]", "", r.get("시도", ""))
        if not name or "이상" in name or not _num(r.get("사망자수")):
            continue
        rows.append({"year": _num(r.get("연도")), "sido": name, "deaths": _num(r.get("사망자수")),
                     "cremations": _num(r.get("화장건수")), "rate": float(r.get("화장률") or 0)})
    return rows

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
URL_READY = "YOUR-ID" not in SITE_URL   # 실제 주소를 넣기 전에는 canonical·sitemap 을 만들지 않음
TODAY = dt.date.today().isoformat()
AMENITIES = [("parking_lot", "주차장"), ("restaurant", "식당"), ("store", "매점"),
             ("waiting_room", "유족대기실"), ("accessible", "장애인 편의시설")]

GUIDES = []   # content/guides 에서 읽어 채움
# compact: 시설 상세를 시도 페이지 안에 넣어 전체 파일 수를 100개 안쪽으로 유지 (GitHub 웹 업로드용)
# full   : 시설마다 페이지를 따로 만듦 (파일 수 1,000개 가까이)
COMPACT = (CONFIG.get("mode") or "compact").lower() == "compact"
PAGES_WRITTEN = []



# ---------------------------------------------------------------------------
# 광고 자리 (_builder/ads.json)
# ---------------------------------------------------------------------------
ADS_FILE = ROOT / "ads.json"
ADS = json.loads(ADS_FILE.read_text(encoding="utf-8")) if ADS_FILE.exists() else {"slots": []}
ADS_BY_ID = {sl["id"]: sl for sl in ADS.get("slots", [])}


def ad_slot(slot_id, depth, region=None):
    """광고 자리 HTML. region 이 있으면 시도별 광고(ad 안에 시도 이름 키)를 먼저 찾는다."""
    sl = ADS_BY_ID.get(slot_id)
    if not sl:
        return ""
    r = rel(depth)
    ad = sl.get("ad") or {}
    if region and isinstance(sl.get("by_region"), dict):
        ad = sl["by_region"].get(region) or ad
    if ad.get("title"):
        img = f'<img src="{E(ad["image"])}" alt="{E(ad["title"])}" loading="lazy">' if ad.get("image") else ""
        tel = f'<a class="btn" href="tel:{E(re.sub(r"[^0-9+]", "", ad["tel"]))}">전화 {E(ad["tel"])}</a>' if ad.get("tel") else ""
        link_open = f'<a class="ad-main" href="{E(ad["link"])}" target="_blank" rel="sponsored noopener">' if ad.get("link") else '<div class="ad-main">'
        link_close = "</a>" if ad.get("link") else "</div>"
        return (f'<aside class="ad-slot filled" data-slot="{E(slot_id)}"><span class="ad-label">광고</span>{link_open}{img}'
                f'<span class="ad-text"><strong>{E(ad["title"])}</strong><span>{E(ad.get("text", ""))}</span></span>{link_close}'
                f'{f"<div class=ad-actions>{tel}</div>" if tel else ""}</aside>')
    if not ADS.get("show_empty", True):
        return ""
    where = f"{region} " if region else ""
    return (f'<aside class="ad-slot empty" data-slot="{E(slot_id)}"><span class="ad-label">광고 자리</span>'
            f'<span class="ad-text"><strong>{E(where + sl["name"])}</strong><span>봉안당·추모공원·상조 업체 광고를 받습니다 · 월 {sl["price"]:,}만 원</span></span>'
            f'<a class="btn" href="{r}pages/contact.html#ads">광고 문의</a></aside>')


def ad_price_table():
    rows = "".join(f'<tr><td><strong>{E(sl["name"])}</strong></td><td>{E(sl["location"])}</td><td class="hide-sm">{E(sl["size"])}</td>'
                   f'<td class="num"><strong>{sl["price"]:,}만 원</strong></td></tr>' for sl in sorted(ADS.get("slots", []), key=lambda x: -x["price"]))
    return (f'<div class="table-wrap"><table class="list"><thead><tr><th>광고 자리</th><th>위치</th><th class="hide-sm">형태</th><th class="num">월 광고비</th></tr></thead>'
            f'<tbody>{rows}</tbody></table></div><p class="small muted">{E(ADS.get("note", ""))}</p>')


def rel(depth):
    return "../" * depth


def adsense_head():
    client = (CONFIG.get("adsense_client") or "").strip()
    if not client:
        return ""
    return (f'<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client={E(client)}" '
            'crossorigin="anonymous"></script>')


# ---------------------------------------------------------------------------
# 아이콘 (직접 그린 단순 선 그림. 페이지마다 한 번 넣고 <use>로 재사용)
# ---------------------------------------------------------------------------
_S = 'fill="currentColor" stroke="none" opacity=".16"'
ICONS = {
    "home": f'<path {_S} d="M5 11v9h14v-9l-7-6z"/><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    "bongan": f'<path {_S} d="M5 11h14v9H5z"/><path d="M2.5 10.5C6 9.5 9 7.5 12 4.5c3 3 6 5 9.5 6"/><path d="M4 11h16"/><path d="M5 11v9M19 11v9M3 20h18"/>'
              '<rect x="8" y="13" width="2.6" height="2.6" rx=".4"/><rect x="13.4" y="13" width="2.6" height="2.6" rx=".4"/><path d="M10.5 20v-2.5h3V20"/>',
    "funeral": f'<circle {_S} cx="12" cy="9" r="6"/><circle cx="12" cy="4.6" r="2.2"/><circle cx="16.2" cy="7.6" r="2.2"/><circle cx="14.6" cy="12.5" r="2.2"/><circle cx="9.4" cy="12.5" r="2.2"/><circle cx="7.8" cy="7.6" r="2.2"/><circle cx="12" cy="9" r="1.6" fill="currentColor"/><path d="M12 14.7V22M12 19.5c-1-2-3-3-5-3 .5 2 2.5 3.2 5 3M12 18c1-1.6 2.6-2.4 4.5-2.4-.5 1.7-2.2 2.6-4.5 2.4"/>',
    "crematorium": f'<path {_S} d="M3 21V11l6-3v3l6-3v13z"/><path d="M3 21V11l6-3v3l6-3v13M3 21h18"/><path d="M15 21V5h4v16"/><path d="M16 3c0-1 1-1.5 2-1.5"/><rect x="6" y="15" width="2.5" height="3"/><rect x="10.5" y="15" width="2.5" height="3"/>',
    "search": f'<circle {_S} cx="10.5" cy="10.5" r="6.5"/><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5.5 5.5"/>',
    "map": f'<path {_S} d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    "won": f'<circle {_S} cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path d="m7.5 8 2 8 2.5-7 2.5 7 2-8M6.5 11.5h11"/>',
    "recommend": f'<path {_S} d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3z"/><path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11v3"/><path d="M21 11h-4a2 2 0 0 0 0 4h4"/><circle cx="17" cy="13" r=".6" fill="currentColor"/>',
    "trophy": f'<path {_S} d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8M9.5 18h5"/>',
    "guide": f'<path {_S} d="M12 6.5C10 5 6.5 4.5 3 5v13c3.5-.5 7 0 9 1.5 2-1.5 5.5-2 9-1.5V5c-3.5-.5-7 0-9 1.5z"/><path d="M12 6.5C10 5 6.5 4.5 3 5v13c3.5-.5 7 0 9 1.5 2-1.5 5.5-2 9-1.5V5c-3.5-.5-7 0-9 1.5zM12 6.5v13"/>',
    "parking": f'<rect {_S} x="3" y="3" width="18" height="18" rx="4"/><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M9.5 17V7h3.5a3 3 0 0 1 0 6H9.5"/>',
    "accessible": '<circle cx="12" cy="4.5" r="1.8"/><path d="M12 7.5V13h5l2 5"/><path d="M8.5 10.5a5.5 5.5 0 1 0 7.2 7.3"/><path d="M9 9.5h5"/>',
    "clock": f'<circle {_S} cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    "phone": '<path d="M5 3.5h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.6 6.6l1.4-2.3 4.5 1.8V19a2 2 0 0 1-2 2A17 17 0 0 1 3 5.5a2 2 0 0 1 2-2z"/>',
    "compare": f'<rect {_S} x="3" y="3" width="18" height="18" rx="3"/><path d="M4 20h16M7 17v-5M12 17V7M17 17v-8"/>',
    "public": f'<path {_S} d="M4 9h16v10H4z"/><path d="M3 9h18L12 3.5zM5 9v10M9.5 9v10M14.5 9v10M19 9v10M3 20h18"/>',
    "private": f'<path {_S} d="M5 10h14v10H5z"/><path d="M3 11 12 4l9 7M5 10v10h14V10"/><circle cx="12" cy="14" r="2"/><path d="M12 16v2"/>',
    "meal": f'<path {_S} d="M3 12h18a9 6 0 0 1-18 0z"/><path d="M3 12h18a9 6 0 0 1-18 0zM8 21h8M14 3l-3 7M19 4l-5 6"/>',
    "sofa": f'<path {_S} d="M4 11h16v6H4z"/><path d="M6 11V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3M3 11a1.5 1.5 0 0 1 3 0v3h12v-3a1.5 1.5 0 0 1 3 0v6H3zM5 17v2M19 17v2"/>',
    "info": f'<circle {_S} cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
}


def icon(name, cls=""):
    return f'<svg class="ic {cls}" aria-hidden="true" focusable="false"><use href="#i-{name}"/></svg>'


SPRITE = ('<svg class="sprite" width="0" height="0" aria-hidden="true" focusable="false"><defs>'
          + "".join(f'<symbol id="i-{k}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">{v}</symbol>'
                    for k, v in ICONS.items()) + "</defs></svg>")
FAVICON = ("data:image/svg+xml," + urllib.parse.quote('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#2f5e4e"/>'
           '<path d="M5 14c4-1 7.5-3.5 11-7 3.5 3.5 7 6 11 7M7 15v11h18V15M5 26h22" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'))

# 페이지 묶음: (아이콘, 이름, 설명, 색)
SECTIONS = {
    "bongan": ("bongan", "봉안당 찾기", "지역·공설/사설·편의시설로 봉안당을 찾습니다", "#2f5e4e"),
    "funeral": ("funeral", "장례식장·화장장", "지역별 장례식장과 화장시설, 전화번호와 비용", "#5a4a8a"),
    "price": ("won", "가격 비교", "봉안당 가격을 업체·종류·지역별로 비교합니다", "#9a4f12"),
    "recommend": ("recommend", "예산 추천", "가진 예산에 맞는 봉안당을 골라 드립니다", "#1f5b8f"),
    "ranking": ("trophy", "봉안당 순위", "여러 기준으로 매긴 전국 봉안당 순위", "#80620a"),
    "guide": ("guide", "장례·봉안 가이드", "처음 겪는 일, 차근차근 알려 드립니다", "#1d6b73"),
    "search": ("search", "이름으로 검색", "시설 이름이나 동네 이름으로 찾습니다", "#2f5e4e"),
    "home": ("home", "처음 화면", "", "#2f5e4e"),
    "info": ("info", "사이트 안내", "사이트 소개와 문의", "#4b5563"),
}
NAV = [("home", "index.html", "처음 화면"), ("bongan", "region/index.html", "봉안당"), ("funeral", "funeral/index.html", "장례식장·화장장"),
       ("price", "feature/price.html", "가격 비교"), ("recommend", "pages/recommend.html", "예산 추천"),
       ("ranking", "pages/ranking.html", "순위"), ("guide", "guides/index.html", "가이드"), ("search", "pages/search.html", "검색")]


def section_of(path):
    if path.startswith("funeral/"):
        return "funeral"
    if path.startswith("compare/") or path == "feature/price.html":
        return "price"
    if path.startswith(("region/", "type/", "feature/", "facility/")):
        return "bongan"
    if path.startswith("guides/"):
        return "guide"
    return {"pages/recommend.html": "recommend", "pages/ranking.html": "ranking", "pages/search.html": "search"}.get(
        path, "info" if path.startswith("pages/") else "")


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
    sec = section_of(path)
    on = ' aria-current="page" class="on"'
    nav_html = "".join(f'<a href="{r}{u}"{on if k == sec else ""}>{icon(SECTIONS[k][0])}<span>{E(lbl)}</span></a>' for k, u, lbl in NAV)
    strip = ""
    if sec:
        ic, nm, ds, col = SECTIONS[sec]
        strip = f'<div class="sec-strip" style="--sc:{col}"><span class="sec-ic">{icon(ic, "xl")}</span><span class="sec-txt"><strong>{E(nm)}</strong><span>{E(ds)}</span></span></div>'
    return f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{E(full_title)}</title>
<meta name="description" content="{E(description)}">
{f'<link rel="canonical" href="{E(canonical)}">' if URL_READY else ''}
<meta property="og:type" content="website">
<meta property="og:title" content="{E(full_title)}">
<meta property="og:description" content="{E(description)}">
{f'<meta property="og:url" content="{E(canonical)}">' if URL_READY else ''}
<meta property="og:site_name" content="{E(SITE)}">
{robots}
<link rel="icon" href="{FAVICON}" type="image/svg+xml">
<script>try{{var s=localStorage.getItem("fs");if(s)document.documentElement.setAttribute("data-fs",s)}}catch(e){{}}</script>
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="{r}static/style.css">
{adsense_head()}
{ld_html}
</head>
<body>
<a class="skip" href="#main">본문으로 건너뛰기</a>
{SPRITE}
<header class="site-header">
  <div class="wrap header-top">
    <a class="brand" href="{r}index.html"><img src="{FAVICON}" alt="" width="36" height="36"><span>{E(SITE)}</span></a>
    <div class="fs-ctl" role="group" aria-label="글자 크기"><span class="fs-label">글자 크기</span><button type="button" data-fs="" aria-label="글자 보통">가</button><button type="button" data-fs="lg" aria-label="글자 크게">가</button><button type="button" data-fs="xl" aria-label="글자 아주 크게">가</button></div>
  </div>
  <nav class="main-nav wrap" aria-label="주 메뉴">{nav_html}</nav>
</header>
<main id="main" class="wrap">
{strip}
{crumb_html}
{body}
</main>
<footer class="site-footer">
  <div class="wrap footer-inner">
    <div>
      <p class="footer-brand">{E(SITE)}</p>
      <p class="muted">시설 정보 출처: 보건복지부 「전국 봉안시설 현황」(공공데이터포털), 한국장례문화진흥원 장사시설 현황·가격정보. 이용 요금·잔여 기수·운영 여부는 바뀔 수 있으니 방문이나 계약 전에 반드시 해당 시설에 확인하세요.</p>
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
<script src="{r}static/site.js" defer></script>
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
    if f.get("cap"):
        desc_parts.append(f"총 {f['cap']['total']:,}기를 모실 수 있는 규모입니다.")
    if f.get("price_min"):
        desc_parts.append(f"공개된 가격 정보 기준으로 {fmt_won(f['price_min'])}부터 이용할 수 있습니다.")
    summary = " ".join(desc_parts)

    # 안치기간 막대
    period_html = ""
    if f["first_period"]:
        segs = [f'<div class="seg first" style="flex:{f["first_period"]}"><span>최초 {f["first_period"]:g}년</span></div>']
        if f["ext_years"] and f["ext_count"]:
            n_ext = int(f["ext_count"])
            if n_ext > 4:
                segs.append(f'<div class="seg ext" style="flex:{f["ext_years"] * n_ext}"><span>+{f["ext_years"]:g}년 × {n_ext}회</span></div>')
            for i in range(n_ext if n_ext <= 4 else 0):
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
    cap = f.get("cap")
    if cap:
        rows.append(("안치 규모", f'총 {cap["total"]:,}기' + (f' · 안치 {cap["used"]:,}기' if cap["used"] is not None else "")
                     + (f' · 남은 자리 {cap["remain"]:,}기' if cap["remain"] is not None else "")))
    info = "".join(f"<tr><th scope=row>{a}</th><td>{b}</td></tr>" for a, b in rows)
    amen = "".join(f'<li><span>{lbl}</span>{yn_badge(f[key])}</li>' for key, lbl in AMENITIES)

    cap_html = ""
    if cap:
        bar = (f'<div class="cap-bar" role="img" aria-label="안치율 {cap["rate"]}%"><span style="width:{min(100, cap["rate"])}%"></span></div>'
               f'<p class="small">총 {cap["total"]:,}기 가운데 {cap["used"]:,}기가 안치되어 <strong>{cap["rate"]:g}%</strong>가 찼습니다.'
               + (f' 남은 자리는 약 {cap["remain"]:,}기입니다.' if cap["remain"] is not None else "") + "</p>") if cap["rate"] is not None else \
              f'<p class="small">총 {cap["total"]:,}기를 모실 수 있는 규모입니다.</p>'
        cap_html = f'<h4>안치 규모</h4>{bar}<p class="muted small">출처: {E(cap["source"])} ({E(cap["date"])} 기준)</p>'

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
  {cap_html}
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
  {f'<section class="card">{cap_html.replace("<h4>안치 규모</h4>", "<h2>안치 규모</h2>", 1)}</section>' if cap_html else ""}
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
{ad_slot("region_top", depth, sido)}
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


FEAT_IC = {"parking": "parking", "accessible": "accessible", "waiting-room": "sofa", "restaurant": "meal"}


def feature_url(slug):
    return "feature/parking.html" if slug == "parking" else f"feature/amenities.html#{slug}"


def page_features(out, facs, groups):
    """주차장은 따로, 장애인 편의·유족대기실·식당은 한 페이지(feature/amenities.html)에 모은다."""
    depth = 1
    blocks = []
    for slug, key, title, intro in FEATURES:
        sub = [f for f in facs if f[key] is True]
        sections = []
        for sido in groups:
            sl = [f for f in sub if f["sido"] == sido]
            if sl:
                sections.append(f'<details class="card fold"><summary><strong>{E(sido)}</strong> <span class="muted">{len(sl)}곳</span></summary>{facility_table(sl, depth, show_region=True)}</details>')
        blocks.append((slug, title, intro, sub, "".join(sections)))
    for slug, title, intro, sub, secs in blocks:
        if slug != "parking":
            continue
        body = f"""<header class="page-head"><p class="eyebrow">편의시설별 찾기</p><h1>{title} {len(sub):,}곳</h1><p class="lead">{E(intro)}</p><p class="small">시도를 누르면 목록이 펼쳐집니다.</p></header>
{secs}
{guide_links(depth, ["visiting-etiquette", "accessibility-visit", "how-to-choose"])}"""
        write(out, "feature/parking.html", layout("feature/parking.html", title, f"전국 {title} {len(sub):,}곳을 시도별로 정리했습니다.", body,
                                                  crumbs=[("편의시설별", None), (title, None)], depth=depth))
    parts, toc = [], []
    for slug, title, intro, sub, secs in blocks:
        if slug == "parking":
            continue
        toc.append(f'<a class="chip-link" href="#{slug}">{E(title)} {len(sub):,}곳</a>')
        parts.append(f'<section class="feature-sec" id="{slug}"><h2>{E(title)} {len(sub):,}곳</h2><p>{E(intro)}</p>{secs}</section>')
    body = f"""<header class="page-head"><p class="eyebrow">편의시설별 찾기</p><h1>편의시설로 봉안당 찾기</h1>
<p class="lead">어르신이나 몸이 불편한 가족과 함께 가신다면 편의시설을 먼저 확인하세요. 시도를 누르면 목록이 펼쳐집니다.</p><nav class="rank-nav">{"".join(toc)}</nav></header>
{"".join(parts)}
{guide_links(depth, ["accessibility-visit", "visiting-etiquette", "how-to-choose"])}"""
    write(out, "feature/amenities.html", layout("feature/amenities.html", "편의시설로 봉안당 찾기 (장애인 편의·유족대기실·식당)",
                                                "장애인 편의시설, 유족대기실, 식당이 있는 전국 봉안당을 시도별로 찾아보세요.", body,
                                                crumbs=[("편의시설별", None)], depth=depth))


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
{price_hub_links(depth)}"""
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
{ad_slot("recommend_top", depth)}
<div id="rec-summary" aria-live="polite"></div>
<div id="rec-results" class="results"></div>
<div id="rec-over"></div>
<section class="card note"><h2>추천 기준</h2><ul class="tips">
<li>모실 형태에 맞는 상품 가운데 가장 낮은 가격이 예산 이하인 시설만 보여 줍니다.</li>
<li>추천순은 편의시설이 많을수록, 최대 안치기간이 길수록, 예산에 여유가 있을수록 위에 옵니다.</li>
<li>관리비는 별도인 경우가 많습니다. 결과 카드의 관리비와 상세 가격표를 함께 확인하세요.</li>
<li>가격은 한국장례문화진흥원 공개 자료(2023-06-01 기준)이며 지금은 다를 수 있습니다. 계약 전 시설에 꼭 확인하세요.</li></ul></section>
{price_hub_links(depth)}"""
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
{ad_slot("price_top", depth)}
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
    page_ranking(out, facs, groups)



def score_of(f):
    """종합 점수 100점: 편의시설 40 + 주차 20 + 안치기간 20 + 가격 접근성 20"""
    amen = sum(1 for k, _ in AMENITIES if f[k] is True) / len(AMENITIES) * 40
    park = min(f["parking_count"] or 0, 300) / 300 * 20
    mp = min(f["max_period"] or f["first_period"] or 0, 60) / 60 * 20
    pr = f.get("p_single") or f.get("price_min")
    price = (1 - min(pr, 5_000_000) / 5_000_000) * 20 if pr else 0
    return round(amen + park + mp + price, 1)


RANKINGS = [
    ("total", "종합 순위", "편의시설·주차·안치기간·가격을 합친 100점 만점 점수",
     lambda f: score_of(f), lambda v: f"{v:g}점", True),
    ("parking", "주차장 넓은 봉안당", "명절에도 덜 붐비는, 주차 대수가 많은 곳",
     lambda f: f["parking_count"] if f["parking_lot"] is not False else None, lambda v: f"{v:,.0f}대", True),
    ("cheap", "개인단 가장 저렴한 봉안당", "한 분을 모시는 가장 싼 상품 기준",
     lambda f: f.get("p_single"), fmt_won, False),
    ("premium", "프리미엄 봉안당", "가장 비싼 상품 가격이 높은 곳 (특실·가족실 포함)",
     lambda f: f.get("price_max"), fmt_won, True),
    ("long", "가장 오래 모실 수 있는 봉안당", "최초 안치기간 + 연장 가능 기간 전체",
     lambda f: f["max_period"], lambda v: f"{v:g}년", True),
    ("choices", "상품 선택지가 많은 봉안당", "공개한 가격 상품(칸 종류) 수가 많은 곳",
     lambda f: len(f.get("prices") or []) or None, lambda v: f"{v:,}개 상품", True),
    ("capacity", "안치 규모가 큰 봉안당", "총 안치(봉안) 가능 기수 기준. 지자체가 공개한 지역만 포함",
     lambda f: f["cap"]["total"] if f.get("cap") else None, lambda v: f"{v:,}기", True),
    ("chosen", "많이 선택된 봉안당", "실제로 안치된 기수 기준. 지자체가 공개한 지역만 포함",
     lambda f: f["cap"]["used"] if f.get("cap") and f["cap"]["used"] else None, lambda v: f"{v:,}기 안치", True),
    ("remain", "남은 자리가 많은 봉안당", "총 기수에서 안치된 기수를 뺀 남은 자리 기준",
     lambda f: f["cap"]["remain"] if f.get("cap") and f["cap"]["remain"] else None, lambda v: f"{v:,}기 남음", True),
    ("amenity", "편의시설 만점 봉안당", "주차장·식당·매점·유족대기실·장애인 편의시설을 모두 갖춘 곳 (주차 대수 순)",
     lambda f: (f["parking_count"] or 0.1) if all(f[k] is True for k, _ in AMENITIES) else None, lambda v: "5개 모두" if v else "", True),
]


def page_ranking(out, facs, groups):
    depth = 1
    r = rel(depth)
    nav = " ".join(f'<a class="chip-link" href="#{key}">{E(title)}</a>' for key, title, *_ in RANKINGS)
    secs = []
    for key, title, desc, getv, fmt, desc_order in RANKINGS:
        items = [(getv(f), f) for f in facs]
        items = [(v, f) for v, f in items if v]
        items.sort(key=lambda x: -x[0] if desc_order else x[0])
        top = items[:20]
        if not top:
            continue
        rows = "".join(
            f'<li class="rank-row{" top3" if i < 3 else ""}"><span class="rank-no">{i + 1}</span>'
            f'<span class="rank-name"><a href="{r}{facility_url(f)}">{E(f["name"])}</a> {kind_badge(f["kind"])}'
            f'<span class="muted small">{E(SIDO_SHORT.get(f["sido"], f["sido"]))} {E(f["sigungu"])}</span></span>'
            f'<span class="rank-val">{E(fmt(v))}</span></li>' for i, (v, f) in enumerate(top))
        secs.append(f'<section class="card rank-sec" id="{key}"><h2>{E(title)} TOP {len(top)}</h2><p class="muted small">{E(desc)}</p><ol class="rank-list">{rows}</ol></section>')
    by_sido = sorted(groups.items(), key=lambda kv: -len(kv[1]))
    sido_rows = "".join(
        f'<li class="rank-row{" top3" if i < 3 else ""}"><span class="rank-no">{i + 1}</span><span class="rank-name"><a href="{r}{region_url(sd)}">{E(sd)}</a>'
        f'<span class="muted small">공설 {sum(1 for f in v if f["kind"] == "공설")} · 사설 {sum(1 for f in v if f["kind"] == "사설")}</span></span><span class="rank-val">{len(v)}곳</span></li>'
        for i, (sd, v) in enumerate(by_sido))
    secs.append(f'<section class="card rank-sec" id="sido"><h2>봉안시설이 많은 지역</h2><ol class="rank-list">{sido_rows}</ol></section>')
    nav += ' <a class="chip-link" href="#sido">지역별 시설 수</a>'
    cr = load_cremation_stats()
    if cr:
        last = max(x["year"] for x in cr)
        cur = sorted([x for x in cr if x["year"] == last], key=lambda x: -x["rate"])
        prev = {x["sido"]: x["rate"] for x in cr if x["year"] == last - 4}
        tot_d = sum(x["deaths"] for x in cur); tot_c = sum(x["cremations"] for x in cur)
        crow = "".join(
            f'<li class="rank-row{" top3" if i < 3 else ""}"><span class="rank-no">{i + 1}</span><span class="rank-name"><strong>{E(x["sido"])}</strong>'
            f'<span class="muted small">사망 {x["deaths"]:,}명 · 화장 {x["cremations"]:,}건'
            + (f' · {last - 4}년 {prev[x["sido"]]:g}%' if x["sido"] in prev else "") + f'</span></span><span class="rank-val">{x["rate"]:g}%</span></li>'
            for i, x in enumerate(cur))
        secs.append(f'<section class="card rank-sec" id="cremation"><h2>{last}년 시도별 화장률 순위</h2>'
                    f'<p class="small">{last}년 전국 화장률은 <strong>{tot_c * 100 / tot_d:.1f}%</strong>입니다. 돌아가신 분 열 명 중 아홉 명 이상이 화장으로 모셔지고, 그만큼 봉안당과 자연장 수요도 늘고 있습니다.</p>'
                    f'<ol class="rank-list">{crow}</ol><p class="muted small">출처: 보건복지부 화장 통계(시도별 사망자 수·화장 건수)</p></section>')
        nav += ' <a class="chip-link" href="#cremation">시도별 화장률</a>'
    body = f"""<header class="page-head"><p class="eyebrow">봉안당 랭킹</p><h1>전국 봉안당 순위</h1>
<p class="lead">공공데이터에 등록된 시설 정보와 공개 가격으로 여러 기준의 봉안당 순위를 매겼습니다. 기준마다 1위가 다르니 우리 가족에게 중요한 기준부터 보세요.</p>
<nav class="rank-nav" aria-label="순위 기준">{nav}</nav></header>
{"".join(secs)}
<section class="card note"><h2>순위 기준과 한계</h2><ul class="tips">
<li>종합 점수는 편의시설(40점), 주차 대수(20점, 300대 이상 만점), 최대 안치기간(20점, 60년 이상 만점), 개인단 가격 접근성(20점, 낮을수록 높음)을 더한 값입니다.</li>
<li>가격 순위는 한국장례문화진흥원 공개 가격정보(2023-06-01 기준)를 쓰며, 가격을 공개하지 않은 시설은 빠집니다.</li>
<li>안치 규모 순위는 지자체가 시설별 기수를 공개한 지역(경기 고양·파주, 인천 남동·연수, 대구 동구, 충남 공주·당진, 경남 김해, 경북, 제주)의 시설만 포함합니다. 다른 지역 자료가 공개되면 추가하겠습니다.</li>
<li>매출과 방문객 수는 공개된 데이터가 없어 순위에 넣지 않았습니다. 시설에서 자료를 보내 주시면 반영하겠습니다.</li>
<li>순위는 정보 제공용이며 특정 시설을 추천하거나 평가하는 것이 아닙니다.</li></ul></section>
{price_hub_links(depth)}"""
    write(out, "pages/ranking.html", layout("pages/ranking.html", "전국 봉안당 순위 (종합·주차·가격·안치기간)",
                                            "주차장 넓은 곳, 가장 저렴한 곳, 오래 모실 수 있는 곳 등 기준별 전국 봉안당 순위를 확인하세요.", body,
                                            crumbs=[("봉안당 순위", None)], depth=depth))


# ---------------------------------------------------------------------------
# 장례식장·화장시설 (_builder/funeral/*.csv, 한국장례문화진흥원 2023-06-01)
# ---------------------------------------------------------------------------
FUNERAL_DIR = ROOT / "funeral"
FUNERAL_PRICE_COLS = [("빈소1일최저", "빈소 1일"), ("안치료1일", "안치료 1일"), ("염습", "염습"), ("관최저", "관"), ("수의최저", "수의")]


def load_funeral():
    items = []
    if not FUNERAL_DIR.exists():
        return items
    prices = {}
    for path in FUNERAL_DIR.glob("*price*.csv"):
        for r in read_csv_any(path):
            prices[(r.get("시설명") or "").strip()] = r
    for path in FUNERAL_DIR.glob("*facilities*.csv"):
        for r in read_csv_any(path):
            name = (r.get("시설명") or "").strip()
            if not name:
                continue
            addr = re.sub(r"\s+", " ", r.get("주소", "")).strip()
            sido = normalize_sido(r.get("시도", ""), addr)
            pr = prices.get(name, {})
            items.append({
                "id": hashlib.sha1(f"{name}|{addr}".encode("utf-8")).hexdigest()[:10],
                "kind": (r.get("종류") or "장례식장").strip(), "name": name, "sido": sido,
                "sigungu": (r.get("시군구") or "").strip() or (addr.split()[1] if len(addr.split()) > 1 else "기타"),
                "address": addr, "tel": clean_phone(r.get("전화번호", "")),
                "parking": _num(r.get("주차가능대수")), "rooms": _num(r.get("빈소수")), "morgue": _num(r.get("안치가능구수")),
                "furnace": _num(r.get("화장로")), "pubpri": (r.get("공사설") or "").strip(), "optype": (r.get("운영종류") or "").strip(),
                "closed": "휴업" in name or "폐업" in name,
                "amen": [lbl for col, lbl in (("주차장", "주차장"), ("식당", "식당"), ("매점", "매점"), ("유족대기실", "유족대기실"), ("장애인편의시설", "장애인 편의")) if yes_no(r.get(col)) is True],
                "price": {k: _num(pr.get(k)) for k, _ in FUNERAL_PRICE_COLS},
                "cre_in": _num(pr.get("화장료관내")), "cre_out": _num(pr.get("화장료관외")),
            })
    items.sort(key=lambda x: (list(SIDO).index(x["sido"]) if x["sido"] in SIDO else 99, x["sigungu"], x["name"]))
    return items


FN_AMEN_KEY = {"주차장": "parking_lot", "식당": "restaurant", "매점": "store", "유족대기실": "waiting_room", "장애인 편의": "accessible"}


def funeral_url(x):
    return f"funeral/{sido_slug(x['sido'])}.html#x-{x['id']}"


def _fn_badges(x):
    b = []
    if x["pubpri"]:
        b.append(kind_badge(x["pubpri"]))
    if x["optype"]:
        b.append(f'<span class="badge etc">{E(x["optype"])}</span>')
    return " ".join(b)


def funeral_card(x, depth):
    r = rel(depth)
    q = urllib.parse.quote(x["address"] or x["name"])
    tel = (f'<a class="btn primary big" href="tel:{E(re.sub(r"[^0-9+]", "", x["tel"]))}">{icon("phone")}{E(x["tel"])}</a>'
           if x["tel"] else "")
    facts = []
    if x["kind"] == "화장시설":
        if x["furnace"]:
            facts.append(f"화장로 {x['furnace']}기")
    else:
        if x["rooms"]:
            facts.append(f"빈소 {x['rooms']}실")
        if x["morgue"]:
            facts.append(f"안치 {x['morgue']}구")
    if x["parking"]:
        facts.append(f"주차 {x['parking']:,}대")
    prices = []
    if x["kind"] == "화장시설":
        if x["cre_in"]:
            prices.append(("관내 화장료(대인)", x["cre_in"]))
        if x["cre_out"]:
            prices.append(("관외 화장료(대인)", x["cre_out"]))
    else:
        prices = [(lbl, x["price"][k]) for k, lbl in FUNERAL_PRICE_COLS if x["price"].get(k)]
    price_html = ("<ul class=\"price-chips\">" + "".join(f"<li><span>{E(l)}</span><strong>{fmt_won(v)}{'~' if '최저' in l or l in ('빈소 1일', '관', '수의') else ''}</strong></li>" for l, v in prices) + "</ul>") if prices else ""
    amen = "".join(f'<span class="chip">{E(a)}</span>' for a in x["amen"])
    return (f'<article class="fn-card" id="x-{x["id"]}"><div class="fn-head"><h3>{E(x["name"])}</h3>{_fn_badges(x)}</div>'
            f'<p class="fn-addr">{E(x["address"])}</p>'
            + (f'<p class="fn-facts">{" · ".join(facts)}</p>' if facts else "")
            + price_html + (f'<div class="fn-amen">{amen}</div>' if amen else "")
            + f'<div class="actions">{tel}<a class="btn big" href="https://map.naver.com/p/search/{q}" target="_blank" rel="noopener">지도 보기</a></div></article>')


def tel_link(t):
    if not t:
        return "–"
    return f'<a href="tel:{E(re.sub(r"[^0-9+]", "", t))}">{E(t)}</a>'


def _med(vals):
    v = sorted(x for x in vals if x)
    return v[len(v) // 2] if v else None


def page_funeral(out, items):
    if not items:
        return
    depth = 1
    r = rel(depth)
    fh = [x for x in items if x["kind"] == "장례식장"]
    cr = [x for x in items if x["kind"] == "화장시설"]
    groups = OrderedDict()
    for x in items:
        groups.setdefault(x["sido"], []).append(x)
    src = '<p class="muted small">출처: 한국장례문화진흥원 전국 장사시설 현황·가격정보 (2023-06-01 기준). 가격과 운영 여부는 바뀔 수 있으니 이용 전 꼭 전화로 확인하세요.</p>'
    for sido, v in groups.items():
        sfh = [x for x in v if x["kind"] == "장례식장"]
        scr = [x for x in v if x["kind"] == "화장시설"]
        by_sgg = OrderedDict()
        for x in sfh:
            by_sgg.setdefault(x["sigungu"], []).append(x)
        toc = "".join(f'<a class="chip-link" href="#g-{sgg_slug(sido, g)}">{E(g)} {len(xs)}</a>' for g, xs in by_sgg.items())
        cre_html = (f'<section class="card fn-sec" id="crematorium"><h2>{icon("crematorium", "lg")}{E(sido)} 화장시설 {len(scr)}곳</h2>'
                    f'<div class="fn-grid">{"".join(funeral_card(x, depth) for x in scr)}</div></section>') if scr else ""
        sgg_html = "".join(f'<section class="fn-sec" id="g-{sgg_slug(sido, g)}"><h2>{E(g)} 장례식장 {len(xs)}곳</h2><div class="fn-grid">{"".join(funeral_card(x, depth) for x in xs)}</div></section>'
                           for g, xs in by_sgg.items())
        room = _med([x["price"].get("빈소1일최저") for x in sfh])
        lead = f"{sido}에는 장례식장 {len(sfh)}곳" + (f", 화장시설 {len(scr)}곳" if scr else "") + "이 있습니다."
        if room:
            lead += f" 빈소 하루 사용료(가장 작은 방 기준)는 중간값이 {fmt_won(room)}입니다."
        body = f"""<header class="page-head"><h1>{E(sido)} 장례식장·화장장</h1><p class="lead">{E(lead)}</p>
<p class="small">시군구를 누르면 바로 이동합니다.</p><nav class="rank-nav">{'<a class="chip-link" href="#crematorium">화장시설</a>' if scr else ''}{toc}</nav></header>
{cre_html}{sgg_html}{src}
{guide_links(depth, ["procedure-after-cremation", "ehaneul-guide", "public-vs-private"], "장례를 치르실 때 함께 보세요")}"""
        path = f"funeral/{sido_slug(sido)}.html"
        write(out, path, layout(path, f"{sido} 장례식장·화장장 목록 (가격·전화번호)",
                                f"{sido} 장례식장 {len(sfh)}곳과 화장시설 {len(scr)}곳의 빈소 사용료, 안치료, 화장료, 전화번호를 모았습니다.",
                                body, crumbs=[("장례식장·화장장", "funeral/index.html"), (sido, None)], depth=depth))
    cards = "".join(f'<a class="region-card" href="{r}funeral/{sido_slug(sd)}.html"><strong>{E(SIDO_SHORT.get(sd, sd))}</strong>'
                    f'<span>장례식장 {sum(1 for x in v if x["kind"] == "장례식장")} · 화장장 {sum(1 for x in v if x["kind"] == "화장시설")}</span></a>'
                    for sd, v in groups.items())
    meds = [(lbl, _med([x["price"].get(k) for x in fh])) for k, lbl in FUNERAL_PRICE_COLS]
    stat = "".join(f'<div class="stat"><span class="stat-label">{E(l)} 중간값</span><span class="stat-value">{fmt_won(m)}</span></div>' for l, m in meds if m)
    crow = "".join(f'<tr><td><a href="{r}{funeral_url(x)}">{E(x["name"])}</a> {kind_badge(x["pubpri"]) if x["pubpri"] else ""}</td>'
                   f'<td class="hide-sm">{E(SIDO_SHORT.get(x["sido"], x["sido"]))} {E(x["sigungu"])}</td><td class="num">{x["furnace"] or "–"}</td>'
                   f'<td class="num">{fmt_won(x["cre_in"]) if x["cre_in"] else "–"}</td><td class="num">{fmt_won(x["cre_out"]) if x["cre_out"] else "–"}</td>'
                   f'<td class="hide-sm">{tel_link(x["tel"])}</td></tr>' for x in cr)
    body = f"""<header class="page-head"><h1>전국 장례식장·화장장 찾기</h1>
<p class="lead">전국 장례식장 {len(fh):,}곳과 화장시설 {len(cr)}곳의 위치, 전화번호, 빈소 사용료와 화장료를 지역별로 정리했습니다. 사시는 곳을 눌러 주세요.</p></header>
<section class="card"><h2>지역을 고르세요</h2><div class="region-grid big">{cards}</div></section>
<section class="card"><h2>장례식장 비용, 이 정도가 보통입니다</h2><div class="stats">{stat}</div>
<p class="small">각 장례식장의 가장 저렴한 상품을 모아 중간값을 구했습니다. 실제 비용은 빈소 크기, 조문객 수, 장례 기간에 따라 크게 달라집니다.</p></section>
<section class="card" id="crematorium"><h2>전국 화장시설 {len(cr)}곳</h2>
<p class="small">화장료는 고인의 주소지가 그 지역이면(관내) 저렴하고, 다른 지역이면(관외) 몇 배 비쌉니다. 화장 예약은 <a href="https://www.15774129.go.kr" target="_blank" rel="noopener">e하늘 장사정보시스템</a>에서 합니다.</p>
<div class="table-wrap"><table class="list"><thead><tr><th>화장시설</th><th class="hide-sm">지역</th><th class="num">화장로</th><th class="num">관내 요금</th><th class="num">관외 요금</th><th class="hide-sm">전화</th></tr></thead><tbody>{crow}</tbody></table></div></section>
{src}
{guide_links(depth, ["procedure-after-cremation", "ehaneul-guide", "how-to-choose"], "장례를 치르실 때 함께 보세요")}"""
    write(out, "funeral/index.html", layout("funeral/index.html", "전국 장례식장·화장장 찾기 (지역별 가격·전화번호)",
                                            f"전국 장례식장 {len(fh):,}곳, 화장시설 {len(cr)}곳의 빈소 사용료·안치료·화장료와 전화번호를 지역별로 찾아보세요.", body,
                                            crumbs=[("장례식장·화장장", None)], depth=depth))


def page_index(out, facs, groups):
    st = stats_of(facs)
    cards = "".join(f'<a class="region-card" href="{region_url(s)}"><strong>{E(SIDO_SHORT.get(s, s))}</strong><span>{len(v)}곳</span></a>' for s, v in groups.items())
    feats = "".join(f'<a class="feature-card" href="{feature_url(slug)}">{icon(FEAT_IC.get(slug, "info"), "lg")}<strong>{E(t)}</strong><span>{sum(1 for f in facs if f[k] is True):,}곳</span></a>' for slug, k, t, _ in FEATURES)
    nf = sum(1 for x in FUNERAL if x["kind"] == "장례식장")
    nc = sum(1 for x in FUNERAL if x["kind"] == "화장시설")
    tiles = [
        ("bongan", "#2f5e4e", "region/index.html", "봉안당 찾기", f"전국 {st['n']:,}곳을 지역별로"),
        ("funeral", "#5a4a8a", "funeral/index.html", "장례식장 찾기", f"전국 {nf:,}곳 · 빈소 비용" if nf else "지역별 장례식장"),
        ("crematorium", "#6b4a2f", "funeral/index.html#crematorium", "화장장 찾기", f"전국 {nc}곳 · 화장료" if nc else "지역별 화장시설"),
        ("won", "#9a4f12", "feature/price.html", "가격 비교", "봉안당 가격을 한눈에"),
        ("recommend", "#1f5b8f", "pages/recommend.html", "예산으로 추천", "가진 돈에 맞는 곳"),
        ("trophy", "#80620a", "pages/ranking.html", "봉안당 순위", "기준별 TOP 20"),
        ("guide", "#1d6b73", "guides/procedure-after-cremation.html", "장례 절차 안내", "임종부터 안치까지"),
        ("search", "#374151", "pages/search.html", "이름으로 검색", "시설·동네 이름으로"),
    ]
    tile_html = "".join(f'<a class="big-tile" href="{u}" style="--sc:{c}"><span class="bt-ic">{icon(ic, "xl")}</span><strong>{E(t)}</strong><span>{E(d)}</span></a>'
                        for ic, c, u, t, d in tiles)
    body = f"""
<section class="hero">
  <h1>무엇을 찾으시나요?</h1>
  <p class="lead">아래 그림 단추를 눌러 주세요. 봉안당, 장례식장, 화장장 정보를 지역별로 쉽게 찾으실 수 있습니다.</p>
  <div class="big-tiles">{tile_html}</div>
</section>
<section class="card search-card"><h2>{icon("search", "lg")}이름으로 바로 찾기</h2>
  <form class="search-box" action="pages/search.html" method="get" role="search">
    <label class="sr-only" for="q">시설명이나 지역 검색</label>
    <input id="q" name="q" type="search" placeholder="예: 김포, 추모공원, 장례식장" autocomplete="off">
    <button type="submit">찾기</button>
  </form>
  <h2 class="mt">{icon("recommend", "lg")}예산으로 봉안당 추천받기</h2>
  <form class="search-box budget-box" action="pages/recommend.html" method="get">
    <label class="sr-only" for="hb">예산(만 원)</label>
    <input id="hb" name="b" type="number" min="1" step="1" inputmode="numeric" placeholder="예산(만 원) · 예: 300">
    <select name="t" aria-label="모실 형태"><option value="single">개인단</option><option value="couple">부부단</option><option value="any">상관없음</option></select>
    <button type="submit">추천받기</button>
  </form>
</section>
{ad_slot("main_top", 0)}
<a class="rank-banner" href="pages/ranking.html"><span class="rank-banner-eyebrow">{icon("trophy")} 봉안당 랭킹</span><strong>전국 봉안당 순위 TOP 20</strong><span>종합 점수 · 주차장 넓은 곳 · 가장 저렴한 곳 · 오래 모실 수 있는 곳</span><span class="btn primary">순위 보러 가기</span></a>
{stat_cards(st)}
{ad_slot("main_middle", 0)}
<section class="card"><h2>{icon("map", "lg")}봉안당, 지역별로 찾기</h2><div class="region-grid">{cards}</div></section>
<section class="card"><h2>{icon("bongan", "lg")}봉안당, 조건으로 찾기</h2><div class="feature-grid">
  <a class="feature-card" href="type/public.html">{icon("public", "lg")}<strong>공설 봉안당</strong><span>{st['pub']:,}곳</span></a>
  <a class="feature-card" href="type/private.html">{icon("private", "lg")}<strong>사설 봉안당</strong><span>{st['pri']:,}곳</span></a>
  {feats}
  <a class="feature-card" href="pages/ranking.html">{icon("trophy", "lg")}<strong>봉안당 순위</strong><span>기준별 TOP 20</span></a>
  <a class="feature-card" href="pages/recommend.html">{icon("recommend", "lg")}<strong>예산으로 추천받기</strong><span>원하는 가격에 맞는 곳</span></a>
  <a class="feature-card" href="compare/regions.html">{icon("compare", "lg")}<strong>지역별 가격 비교</strong><span>시도별 중간 가격</span></a>
  <a class="feature-card" href="feature/price.html">{icon("won", "lg")}<strong>가격대별 비교</strong><span>{sum(1 for f in facs if f.get("price_min")):,}곳 가격 등록</span></a>
  <a class="feature-card" href="feature/long-period.html">{icon("clock", "lg")}<strong>최대 안치기간 비교</strong><span>기간별 보기</span></a>
</div></section>
{guide_links(0, None, "처음이라면 먼저 읽어 보세요")}
{ad_slot("main_bottom", 0)}
<section class="card note"><h2>이 사이트의 정보에 대해</h2><p>시설 정보는 보건복지부가 공공데이터포털에 공개한 「전국 봉안시설 현황」을 바탕으로 합니다. 이용 요금, 남은 안치 기수, 신청 자격은 수시로 바뀌므로 최종 결정 전에는 꼭 시설에 직접 확인하세요.</p></section>"""
    write(out, "index.html", layout("index.html", SITE, f"전국 봉안당·납골당 {st['n']:,}곳을 지역, 공설·사설, 안치기간, 주차장·편의시설로 검색하세요.", body,
                                    jsonld={"@context": "https://schema.org", "@type": "WebSite", "name": SITE, "url": SITE_URL + "/",
                                            "potentialAction": {"@type": "SearchAction", "target": SITE_URL + "/pages/search.html?q={q}", "query-input": "required name=q"}}))


def page_search(out, groups):
    options = "".join(f'<option value="{E(s)}">{E(s)}</option>' for s in groups)
    body = f"""<header class="page-head"><h1>이름으로 검색</h1><p class="lead">봉안당·장례식장·화장장을 이름이나 동네 이름으로 찾아보세요.</p></header>
<form id="search-form" class="filters" role="search" onsubmit="return false">
  <label>검색어<input id="sq" type="search" placeholder="예: 김포, 추모공원"></label>
  <label>찾는 곳<select id="scat"><option value="">전체</option><option value="b">봉안당</option><option value="f">장례식장</option><option value="c">화장장</option></select></label>
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
<noscript><p>검색 기능은 자바스크립트가 필요합니다. <a href="../region/index.html">지역별 목록</a>을 이용해 주세요.</p></noscript>"""
    write(out, "pages/search.html", layout("pages/search.html", "봉안당·장례식장·화장장 검색", "전국 봉안당, 장례식장, 화장시설을 이름, 주소, 지역, 공설·사설, 편의시설로 검색합니다.", body, crumbs=[("검색", None)], depth=1))


def search_index(out, facs):
    data = [{"i": f["id"], "n": f["name"], "s": f["sido"], "g": f["sigungu"], "a": f["address"], "k": f["kind"],
             "p": f["first_period"], "pr": f.get("price_min"), "ps": f.get("p_single"), "pc": f.get("p_couple"), "po": f.get("p_other"),
             "mg": f.get("p_mgmt"), "psn": f.get("pn_single", ""), "pcn": f.get("pn_couple", ""), "pon": f.get("pn_other", ""),
             "mp": f.get("max_period"), "t": f["tel"], "u": facility_url(f), "f": [k for k, _ in AMENITIES if f[k] is True]} for f in facs]
    for x in FUNERAL:
        data.append({"i": x["id"], "n": x["name"], "s": x["sido"], "g": x["sigungu"], "a": x["address"], "k": x["pubpri"] or x["kind"],
                     "c": "c" if x["kind"] == "화장시설" else "f", "u": funeral_url(x), "t": x["tel"],
                     "f": [FN_AMEN_KEY[a] for a in x["amen"] if a in FN_AMEN_KEY],
                     "pr": x["price"].get("빈소1일최저") or x["cre_in"]})
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


def content_items(kind):
    """content/content.html 에서 kind('guides' 또는 'pages') 글을 (이름, 머리말, 본문) 으로 돌려준다.
    content/guides/*.html, content/pages/*.html 개별 파일도 함께 읽는다."""
    items = {}
    combined = ROOT / "content" / "content.html"
    if combined.exists():
        text = combined.read_text(encoding="utf-8")
        for m in re.finditer(r"<!--=====\s*(\w+)/([\w-]+)\s*=====-->(.*?)(?=<!--=====|\Z)", text, re.S):
            if m.group(1) == kind:
                tmp = m.group(3)
                meta, body = {}, tmp
                mm = re.match(r"\s*<!--(.*?)-->", tmp, re.S)
                if mm:
                    for line in mm.group(1).strip().splitlines():
                        if ":" in line:
                            k, v = line.split(":", 1)
                            meta[k.strip()] = v.strip()
                    body = tmp[mm.end():]
                items[m.group(2)] = (meta, body)
    for path in sorted((ROOT / "content" / kind).glob("*.html")) if (ROOT / "content" / kind).exists() else []:
        items[path.stem] = read_content(path)
    return items


def load_guides():
    GUIDES.clear()
    for slug, (meta, body) in content_items("guides").items():
        GUIDES.append({"slug": slug, "title": meta.get("title", slug), "description": meta.get("description", ""),
                       "order": int(meta.get("order", "99")), "related": [x.strip() for x in meta.get("related", "").split(",") if x.strip()],
                       "body": body})
    GUIDES.sort(key=lambda g: g["order"])


def render_content_body(body, depth):
    r = rel(depth)
    body = body.replace("{{root}}", r).replace("{{site_name}}", E(SITE)).replace("{{contact_email}}", E(CONFIG.get("contact_email", "")))
    return body.replace("{{today}}", TODAY).replace("{{ad_price_table}}", ad_price_table())


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
{ad_slot("guide_bottom", depth)}
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
    for stem, (meta, body) in content_items("pages").items():
        title = meta.get("title", stem)
        html_body = f'<article><header class="page-head"><h1>{E(title)}</h1></header><div class="prose">{render_content_body(body, 1)}</div></article>'
        write(out, f"pages/{stem}.html", layout(f"pages/{stem}.html", title, meta.get("description", title), html_body, crumbs=[(title, None)], depth=1))


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
    if URL_READY:
        (out / "sitemap.xml").write_text("\n".join(xml), encoding="utf-8")
        (out / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {SITE_URL}/sitemap.xml\n", encoding="utf-8")
    else:
        print("※ config.json 의 site_url 을 실제 주소로 바꾸면 sitemap.xml 이 만들어집니다.")
        (out / "robots.txt").write_text("User-agent: *\nAllow: /\n", encoding="utf-8")
    client = (CONFIG.get("adsense_client") or "").strip()
    if client:
        pub = client.replace("ca-", "")
        (out / "ads.txt").write_text(f"google.com, {pub}, DIRECT, f08c47fec0942fa0\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# 8. 실행
# ---------------------------------------------------------------------------

GENERATED_DIRS = ["facility", "region", "type", "feature", "guides", "pages", "static", "data", "compare", "funeral"]
GENERATED_FILES = ["index.html", "404.html", "robots.txt", "sitemap.xml", "ads.txt", ".nojekyll", ".gitignore"]
FUNERAL = []


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
    FUNERAL[:] = load_funeral()
    page_funeral(out, FUNERAL)
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
    ap.add_argument("--from-csv", nargs="?", const=str(ROOT / "data" / "bongan_facilities_20260531.csv"),
                    help="공공데이터포털 '보건복지부_봉안시설 현황' CSV 파일로 생성 (API가 막혔을 때)")
    args = ap.parse_args()

    if args.from_xml:
        records, _ = parse_items(Path(args.from_xml).read_text(encoding="utf-8"))
    elif args.from_csv:
        records = [dict(r) for r in read_csv_any(Path(args.from_csv))]
        print(f"CSV 파일에서 {len(records):,}건을 읽었습니다: {Path(args.from_csv).name}")
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
            try:
                records = fetch_all(key)
            except Exception as e:  # noqa: BLE001
                print(f"API 호출에 실패했습니다: {e}")
                if DATA_FILE.exists():
                    print("→ 지난번에 저장한 데이터로 사이트를 만듭니다.")
                    records = json.loads(DATA_FILE.read_text(encoding="utf-8"))["raw"]
                else:
                    fallback = ROOT / "data" / "bongan_facilities_20260531.csv"
                    print(f"→ 들어 있는 공공데이터 파일({fallback.name})로 사이트를 만듭니다.")
                    records = [dict(r) for r in read_csv_any(fallback)]

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
    cap_matched, cap_unmatched = attach_capacity(facs)
    if cap_matched or cap_unmatched:
        print(f"안치 규모가 연결된 시설: {cap_matched:,}곳" + (f" (연결 못 한 {len(cap_unmatched)}곳: " + ", ".join(cap_unmatched[:20]) + (" ..." if len(cap_unmatched) > 20 else "") + ")" if cap_unmatched else ""))
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
