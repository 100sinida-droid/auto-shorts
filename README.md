# 봉안당 길잡이

전국 봉안시설 공공데이터로 봉안당 검색 사이트를 자동으로 만드는 저장소입니다.

## 폴더 구조

```
(저장소 맨 위)
├─ index.html      ← 사이트 첫 화면 (자동 생성)
├─ 404.html, robots.txt, sitemap.xml   (자동 생성)
├─ region/  type/  feature/  compare/  funeral/  guides/  pages/  static/  data/   (자동 생성)
├─ _builder/       ← 사이트를 만드는 프로그램과 설정. 사람이 고치는 곳은 여기뿐
└─ .github/        ← 자동 생성 설정
```

자동 생성 폴더는 실행할 때마다 지우고 새로 만듭니다. 직접 고치지 마세요.
사이트를 없애고 싶으면 저장소 자체를 삭제하면 됩니다.

## 올리는 방법 (웹에서 한 번에 끌어다 놓기)

전체 파일이 100개라 GitHub 웹 업로드 한도(100개) 안에 들어갑니다.
받은 압축 파일에는 **사이트가 이미 만들어져 있습니다**(보건복지부 봉안시설 현황 2026-05-31 기준). 그대로 올려도 되고, 최신 데이터로 다시 만들려면 `_builder/build.bat` 를 실행하세요.

1. (선택) `_builder/build.bat` 를 더블클릭해 실행합니다. API 호출이 실패하면 저장된 데이터나 들어 있는 공공데이터 파일로 자동으로 만듭니다.
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
- `pages/ranking.html` 봉안당 순위 (종합·주차·가격·안치기간 등 기준별 TOP 20, 첫 화면 배너로 연결)

## 장례 도우미 (tools/)

- `tools/index.html` 장례 도우미 첫 화면 (나이·띠 계산, 부의금 안내)
- `tools/jibang.html` 지방 작성기·명정 문구
- `tools/chukmun.html` 기제사 축문 작성기 (음력·간지 자동 계산)
- `tools/49jae.html` 삼우제·49재·100일·기일 계산, 음력↔양력 변환
- `tools/bugo.html` 부고 문자·답례 문자 만들기 (장례식장 목록 자동 완성)

음력 계산은 korean-lunar-calendar(MIT, 한국천문연구원 기준 음력표, 1000~2050년)를 `static/site.js` 에 넣어 씁니다.

## 방문 통계 (/stats)

맨 위의 `_worker.js` 가 방문 기록을 저장하고 통계 페이지를 보여 줍니다. Cloudflare Pages에서만 작동합니다.

처음 한 번만 Cloudflare 대시보드에서 설정합니다.
1. **Workers 및 Pages → D1 SQL 데이터베이스 → 만들기** (이름 예: `bongan-stats`)
2. Pages 프로젝트 → **설정 → 바인딩 → 추가 → D1 데이터베이스**: 변수 이름 `DB`, 방금 만든 데이터베이스 선택
3. Pages 프로젝트 → **설정 → 변수 및 비밀 → 추가**: 이름 `STATS_PASSWORD`, 값은 원하는 비밀번호 (유형: 비밀)
4. **배포** 탭에서 최근 배포를 다시 배포하거나 파일을 한 번 더 올리기
5. `https://사이트주소/stats` 접속 → 비밀번호 입력

볼 수 있는 것: 오늘·기간 방문자 수, 날짜별 그래프, 유입 경로(검색 포털·직접 방문·블로그/SNS·다른 사이트·배너), 포털별 방문, 검색어, 배너별 방문, 많이 본 페이지, 사이트 안 검색어, 기기, 최근 방문 목록.
배너나 블로그 글에 걸 주소는 통계 페이지의 **추적 링크 만들기** 로 만들면 어느 배너로 들어왔는지 따로 집계됩니다.
`_worker.js` 는 `_builder` 와 `.github` 폴더를 바깥에서 열어 볼 수 없게 막는 일도 합니다.

## 장례식장·화장장

- `_builder/funeral/funeral_facilities_prices_20230601.csv` : 전국 장례식장·화장시설 목록과 빈소 사용료·안치료·염습·관·수의 최저가, 화장료(관내·관외) (한국장례문화진흥원, 2023-06-01 기준)
- 만들어지는 페이지: `funeral/index.html`(전국 지역 선택·화장시설 표), `funeral/시도.html`(시군구별 장례식장 카드와 화장시설)
- 새 자료로 바꿀 때는 같은 열 이름으로 CSV를 바꿔 넣고 `build.bat` 를 실행하세요.

## 화면 구성

- 기업 사이트처럼 상단 안내 띠, 로고, 메뉴, 첫 화면 큰 그림, 서비스 카드, 숫자 띠, 지도, 바닥글로 구성했습니다.
- 기본 글자를 크게(19px), 버튼·입력칸을 큼직하게 만들었고, 오른쪽 위 **글자 크기** 단추로 두 단계 더 키울 수 있습니다.
- 그림은 `_builder/art.py` 에 직접 그린 벡터 그림이라 저작권 걱정이 없고 파일 수도 늘지 않습니다.
- **실제 사진으로 바꾸기**: `_builder/static/img/` 폴더를 만들고 아래 이름으로 사진을 넣은 뒤 `build.bat` 를 실행하면 그 자리의 그림이 사진으로 바뀝니다. (가로로 긴 사진, 폭 1600px 이상, 용량 300KB 이하 권장. 파일 수 100개 한도에 주의)
  `home`(첫 화면), `bongan`, `funeral`, `crematorium`, `price`, `recommend`, `ranking`, `guide`, `search`, `info` + `.jpg` / `.webp` / `.png`
- 시도 지도: [svg-maps](https://github.com/VictorCazanave/svg-maps) 의 대한민국 지도(CC BY 4.0)를 단순화해 `_builder/art.py` 안에 넣었습니다. 바닥글에 출처가 표시됩니다.

## 안치 규모·통계

- `_builder/capacity/capacity_merged.csv` : 지자체가 공개한 시설별 안치 규모(총 기수·안치 수·남은 자리)를 한 파일로 모은 것. 새 지역 자료가 생기면 같은 열(시도, 시설명, 주소, 전화번호, 총안치능력, 안치수, 잔여, 기준일, 출처)로 줄을 추가하세요.
- `_builder/stats/cremation_rate_2018_2024.csv` : 시도별 사망자 수·화장 건수·화장률. 순위 페이지의 화장률 순위에 씁니다.

## 글 고치기

가이드 13편과 소개·개인정보처리방침·약관·문의 페이지는 모두 `_builder/content/content.html` 한 파일에 들어 있습니다.

## 설정 바꾸기

광고 자리와 가격은 `_builder/config.json` 의 `ads` 항목에서 고칩니다. 지금은 문의 페이지 가격표에만 쓰이고 사이트에는 배너가 나오지 않습니다. (`show_empty` 를 `true` 로 바꾸면 각 자리에 "광고 문의" 칸이 보입니다)

`_builder/config.json` 에서 `site_url`(사이트 주소, 넣어야 sitemap.xml 이 만들어짐), `contact_email`(문의 이메일), `adsense_client`(애드센스 승인 후 코드)를 고친 뒤 GitHub에서 그 파일만 다시 올리면 자동으로 사이트가 다시 만들어집니다.
