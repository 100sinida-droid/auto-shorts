"""시설 주소를 카카오 로컬 API로 좌표(위도·경도)로 바꿔 data/geocode.json 에 저장한다.
이미 받은 주소는 다시 부르지 않는다. 실행: python3 geocode.py  (config.json 의 kakao_rest_key 사용)"""
import json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.argv = [sys.argv[0]]
sys.path.insert(0, str(ROOT))
import build as B  # noqa: E402

KEY = (B.CONFIG.get("kakao_rest_key") or "").strip()
OUT = ROOT / "data" / "geocode.json"


def call(path, q):
    url = f"https://dapi.kakao.com{path}?" + urllib.parse.urlencode({"query": q, "size": 5})
    req = urllib.request.Request(url, headers={"Authorization": f"KakaoAK {KEY}"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8")).get("documents", [])


def clean(addr):
    a = re.sub(r"\(.*?\)", " ", addr or "")
    a = re.sub(r"\s+", " ", a).strip()
    return a


def short_addr(a):
    # 도로명 + 건물번호까지만 (뒤에 붙은 건물명·층·호 제거)
    m = re.match(r"(.+?(?:로|길)\s*\d+(?:-\d+)?)", a)
    if m:
        return m.group(1)
    m = re.match(r"(.+?(?:동|리|가)\s*(?:산\s*)?\d+(?:-\d+)?)", a)
    return m.group(1) if m else a


def geocode(name, addr, sido=""):
    a = clean(addr)
    for q in [a, short_addr(a)]:
        if not q:
            continue
        docs = call("/v2/local/search/address.json", q)
        if docs:
            return {"la": round(float(docs[0]["y"]), 6), "lo": round(float(docs[0]["x"]), 6), "by": "address"}
    # 주소로 못 찾으면 시설 이름으로 (같은 시도인 결과만)
    sd = B.SIDO_SHORT.get(sido, sido)[:2]
    docs = call("/v2/local/search/keyword.json", f"{sd} {name}".strip())
    for d in docs:
        if not sd or d.get("address_name", "").startswith(sd):
            return {"la": round(float(d["y"]), 6), "lo": round(float(d["x"]), 6), "by": "keyword"}
    return None


def main():
    if not KEY:
        sys.exit("config.json 에 kakao_rest_key 를 넣어 주세요.")
    cache = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    recs = json.loads(B.DATA_FILE.read_text(encoding="utf-8"))["raw"]
    facs, _ = B.normalize(recs)
    items = [(f["name"], f["address"], f["sido"]) for f in facs]
    items += [(x["name"], x["address"], x["sido"]) for x in B.load_funeral()]
    pc = ROOT / "partners" / "partners.csv"
    if pc.exists():
        for r in B.read_csv_any(pc):
            if (r.get("주소") or "").strip():
                items.append(((r.get("시설명") or "").strip(), r["주소"].strip(), (r.get("시도") or "").strip()))
    todo = [(n, a, s) for n, a, s in items if f"{n}|{a}" not in cache]
    print(f"전체 {len(items)}곳, 새로 찾을 곳 {len(todo)}곳")
    miss = 0
    from concurrent.futures import ThreadPoolExecutor

    def one(t):
        n, a, s_ = t
        for _ in range(3):
            try:
                return t, geocode(n, a, s_)
            except Exception as e:  # noqa: BLE001
                err = e
                time.sleep(1)
        print("오류:", n, err)
        return t, "err"

    with ThreadPoolExecutor(max_workers=8) as ex:
        for i, (t, g) in enumerate(ex.map(one, todo), 1):
            if g == "err":
                continue
            cache[f"{t[0]}|{t[1]}"] = g or {"miss": 1}
            if not g:
                miss += 1
            if i % 200 == 0:
                OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=0), encoding="utf-8")
                print(f"  {i}/{len(todo)}", flush=True)
    OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"완료. 못 찾은 곳 {miss}곳")


if __name__ == "__main__":
    main()
