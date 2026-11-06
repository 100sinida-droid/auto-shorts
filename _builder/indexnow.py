"""IndexNow 알림: 사이트맵의 모든 주소를 빙·네이버 등 IndexNow 참여 검색엔진에 알린다.
GitHub Actions 에서 사이트를 올린 뒤 자동 실행된다. (직접 실행: python indexnow.py)
"""
import json, re, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
SITE = CONFIG["site_url"].rstrip("/")
KEY = CONFIG.get("indexnow_key", "")
ENDPOINTS = ["https://api.indexnow.org/indexnow", "https://searchadvisor.naver.com/indexnow"]


def main():
    if not KEY:
        sys.exit("config.json 에 indexnow_key 가 없습니다.")
    sm = (ROOT.parent / "sitemap.xml").read_text(encoding="utf-8")
    urls = re.findall(r"<loc>([^<]+)</loc>", sm)[:10000]
    host = SITE.split("//", 1)[1]
    body = json.dumps({"host": host, "key": KEY, "keyLocation": f"{SITE}/{KEY}.txt", "urlList": urls}).encode("utf-8")
    for ep in ENDPOINTS:
        try:
            req = urllib.request.Request(ep, data=body, headers={"Content-Type": "application/json; charset=utf-8"})
            with urllib.request.urlopen(req, timeout=30) as r:
                print(ep, r.status, f"{len(urls)}개 주소 알림")
        except Exception as e:  # noqa: BLE001
            print(ep, "실패:", e)


if __name__ == "__main__":
    main()
