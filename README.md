# 봉안당 길잡이

전국 봉안시설 공공데이터로 봉안당 검색 사이트를 자동으로 만드는 저장소입니다.

## 폴더 구조

```
(저장소 맨 위)
├─ index.html      ← 사이트 첫 화면 (자동 생성)
├─ 404.html, robots.txt, sitemap.xml   (자동 생성)
├─ facility/  region/  type/  feature/  guides/  pages/  static/  data/   (자동 생성)
├─ _builder/       ← 사이트를 만드는 프로그램과 설정. 사람이 고치는 곳은 여기뿐
└─ .github/        ← 자동 생성 설정
```

자동 생성 폴더는 실행할 때마다 지우고 새로 만듭니다. 직접 고치지 마세요.
사이트를 없애고 싶으면 저장소 자체를 삭제하면 됩니다.

## 올리는 방법 (웹에서 한 번에 끌어다 놓기)

전체 파일이 약 90개라 GitHub 웹 업로드 한도(100개) 안에 들어갑니다.

1. `_builder/build.bat` 를 더블클릭해 실행합니다. 맨 위 폴더에 `index.html` 과 사이트 폴더들이 생깁니다.
2. github.com → **New repository** → 이름 `내아이디.github.io`, Public → Create
3. 저장소 화면의 **uploading an existing file** 을 누르고, 이 폴더 안의 것을 **전부 선택해서** 끌어다 놓은 뒤 **Commit changes**
   (`.github` 는 숨김 폴더라 탐색기 **보기 → 숨긴 항목** 을 켜야 보입니다)
4. **Settings → Pages** → Branch `main`, 폴더 `/ (root)` → Save
5. 몇 분 뒤 `https://내아이디.github.io` 접속

### 매주 자동 갱신 (선택)

**Settings → Actions → General → Workflow permissions** 에서 **Read and write permissions** 를 켜 두면 매주 월요일 새벽 GitHub가 데이터를 새로 받아 사이트를 다시 만듭니다. 공공데이터포털이 해외 접속을 막으면 저장된 데이터로 유지됩니다.

## 페이지 구성 방식

`_builder/config.json` 의 `mode` 로 고릅니다.
- `compact` (기본): 시설 상세 정보를 시도 페이지 안에 모아 둡니다. 파일 약 60개.
- `full`: 시설마다 페이지를 따로 만듭니다. 파일 약 1,000개라 웹 업로드 대신 GitHub Desktop이나 자동 생성(Actions)이 필요합니다.

## 가격 정보

`_builder/prices/` 폴더의 CSV를 읽어 시설별 가격표, 가격 비교 페이지, 예산 추천에 씁니다.

- `kfcpi_bongan_prices_20230601.csv` : 한국장례문화진흥원 장사시설 가격정보(2023-06-01) 중 봉안시설 부분
- `kfcpi_bongan_facilities_20230601.csv` : 같은 자료의 봉안시설 목록. 가격표 시설을 전화번호·주소로 찾아 연결하는 데 씁니다
- `prices_manual.csv` : 직접 조사했거나 제휴처에서 받은 가격을 적는 곳. 한 줄에 한 항목
  예) `하늘의문,인천광역시,개인단,1위 15년,3500000,15년,눈높이 칸,2026-10-12`

새 가격 파일(CSV)을 이 폴더에 넣고 `build.bat` 를 실행하면 자동으로 반영됩니다.

### 가격 관련 페이지
- `feature/price.html` 가격 비교 첫 화면 (가격대별)
- `compare/facilities.html` 업체별 비교 (정렬·필터 되는 표)
- `compare/types.html` 종류별 비교 (개인단·부부단·기타·관리비)
- `compare/regions.html` 지역별 비교 (시도별 중간 가격 그래프)
- `pages/recommend.html` 예산 추천 (예산·형태·지역·편의시설 조건)

## 설정 바꾸기

`_builder/config.json` 에서 `site_url`(사이트 주소), `contact_email`(문의 이메일), `adsense_client`(애드센스 승인 후 코드)를 고친 뒤 GitHub에서 그 파일만 다시 올리면 자동으로 사이트가 다시 만들어집니다.
