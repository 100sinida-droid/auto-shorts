# 짐꾸림 (JIMKKURIM)

여행지·날씨·동행자를 분석해서 필요한 준비물만 골라 주고, 부족한 물건을 쿠팡파트너스 링크로 연결하는 사이트.

`index.html`을 더블클릭하면 컴퓨터에서 바로 열어 볼 수 있습니다.

## 폴더 구조

```
(저장소 맨 위)
├─ index.html                 ← 첫 화면
├─ assets/
│  ├─ style.css               ← 디자인
│  └─ js/
│     ├─ destinations.js      ← 여행지 (전압·플러그·비행시간)
│     ├─ items.js             ← 준비물 규칙
│     ├─ products.js          ← ★ 쿠팡 제휴 링크를 넣는 곳
│     ├─ scene.js             ← 비행기 창밖 풍경
│     └─ app.js               ← 날씨 조회·준비물 계산·화면
├─ guides/ items/ tips/       ← 자동 생성되는 콘텐츠 페이지 (직접 고치지 말고 tools/로 다시 만드세요)
├─ about·privacy·terms·contact.html, sitemap.xml, robots.txt  ← 자동 생성
├─ tools/
│  ├─ build.js                ← 콘텐츠 페이지 생성기
│  ├─ site.config.js          ← ★ 주소·문의 이메일·애드센스 ID
│  └─ content/                ← 여행 팁 글, 준비물 설명
├─ functions/api/             ← Cloudflare 서버 함수 (쿠팡 API, 카카오 장소 검색)
├─ README.md
└─ .gitignore
```

## 1. GitHub에 올리기

1. GitHub에서 새 저장소 만들기 (예: `jimkkurim`)
2. 저장소 화면의 **uploading an existing file** 클릭
3. 압축을 푼 폴더를 열고, **그 안의 파일과 폴더 전부**(`index.html`, `assets`, `functions`, `README.md`)를 선택해서 끌어다 놓기 → Commit
4. 저장소 첫 화면에 `index.html`이 바로 보이면 성공입니다. 폴더 하나만 보이고 그 안에 `index.html`이 있으면 한 단계 안쪽을 올린 것이니 다시 올려 주세요.

## 2. Cloudflare Pages 연결

1. Cloudflare 대시보드 → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. 방금 만든 저장소 선택
3. 빌드 설정
   - Framework preset: **None**
   - Build command: **비워 둠**
   - Build output directory: **비워 둠** (또는 `/`)
4. **Save and Deploy** → 1~2분 뒤 `https://저장소이름.pages.dev` 주소가 생김

이후로는 GitHub에서 파일을 고칠 때마다 자동으로 다시 배포됩니다.

## 3. 쿠팡 제휴 링크 넣기 (지금 단계)

API 키가 없어도 대시보드에서 상품 링크는 만들 수 있습니다. 이 링크로 판매가 쌓여야 최종 승인(누적 15만 원)으로 갈 수 있어요.

1. 쿠팡파트너스 → **링크 생성**에서 상품 링크(`https://link.coupang.com/a/...`) 만들기
2. GitHub에서 `assets/js/products.js`를 열고 연필 아이콘으로 편집
3. 준비물 id에 맞춰 붙여 넣기

```js
const PRODUCTS = {
  adapter: [
    { title: '○○ 멀티 어댑터 USB-C', url: 'https://link.coupang.com/a/xxxx', note: '일본·미국·유럽 겸용' },
  ],
  powerbank: [
    { title: '○○ 보조배터리 10000mAh', url: 'https://link.coupang.com/a/yyyy' },
  ],
};
```

준비물 id는 `items.js`의 `id:` 값입니다. 자주 나오는 것부터 채우면 좋습니다:
`adapter`, `powerbank`, `multi_charger`, `packing_cube`, `umbrella`, `neck_pillow`, `kids_pillow`, `free_volt_dryer`, `carrier_cover`, `med_pouch`

링크가 없는 준비물은 쿠팡 검색 결과로 연결됩니다. 이 경우 수수료가 잡히지 않을 수 있습니다.

## 4. 최종 승인 후 API 켜기

1. 쿠팡파트너스에서 API 키 발급 (Access Key, Secret Key)
2. Cloudflare → **Workers & Pages** → **KV** → 네임스페이스 생성 (이름 예: `jimkkurim-cache`)
3. Pages 프로젝트 → **Settings**
   - **Variables and Secrets**: `COUPANG_ACCESS_KEY`, `COUPANG_SECRET_KEY`를 **Secret(암호화)**으로 추가
   - **Bindings** → KV namespace: 변수 이름 `PRODUCT_CACHE`, 위에서 만든 네임스페이스 연결
4. **Deployments**에서 최신 배포를 **Retry deployment**

이제 `products.js`에 링크가 없는 준비물은 API로 상품 3개씩 자동으로 보여 줍니다.
같은 검색어는 24시간 캐시되고, 실제 API 호출은 시간당 9회를 넘지 않게 막혀 있습니다.

> 키는 절대 코드나 GitHub에 직접 쓰지 마세요. Cloudflare Secret에만 넣습니다.

## 알아 두기

- 날씨: 여행이 15일 이내면 일기예보, 그 뒤면 작년 같은 기간 실제 날씨(Open-Meteo, 무료·키 불필요)
- "이미 있어요" 체크는 그 사람 브라우저에만 저장됩니다 (회원가입 없음)
- 쿠팡 파트너스 고지 문구는 하단과 준비물 목록 아래에 들어가 있습니다. 지우지 마세요.


## 5. 카카오 장소 검색 켜기 (국내 여행 추천 장소·맛집)

국내 여행에서 도착지 주변 관광지·맛집·카페와 "가는 길에 들르기 좋은 곳"을 실시간으로 보여 주려면 카카오 REST API 키가 필요해요. 키가 없어도 사이트는 돌아가고, 그동안은 짐꾸림이 정리한 추천과 지도 앱 검색 버튼이 대신 나와요.

1. https://developers.kakao.com 에 로그인 → **내 애플리케이션** → 애플리케이션 추가
2. 만든 앱의 **앱 키**에서 **REST API 키** 복사
3. 앱 설정에서 **카카오맵(로컬) API 사용 설정**이 켜져 있는지 확인
4. Cloudflare Pages 프로젝트 → Settings → Variables and Secrets → `KAKAO_REST_KEY`를 **Secret**으로 추가
5. 다시 배포 (Deployments → Retry deployment)

## 6. 콘텐츠 페이지 다시 만들기

여행지·준비물·팁 내용을 고쳤다면 컴퓨터에 Node.js가 있는 상태에서 저장소 맨 위에서 아래를 실행하고, 바뀐 파일을 GitHub에 올리세요.

```
node tools/build.js
```

## 7. 애드센스 신청 순서

1. `tools/site.config.js`에 **문의 이메일(CONTACT_EMAIL)**과 실제 주소(SITE_URL)를 넣고 `node tools/build.js` 실행 → GitHub에 올리기
2. 구글 서치 콘솔에 사이트를 등록하고 `sitemap.xml` 제출
3. 애드센스 가입 → 사이트 추가 → 심사 신청 (애드센스가 주는 확인 코드는 `ADSENSE_CLIENT`를 넣으면 모든 페이지에 들어가요)
4. 승인되면 `ADSENSE_CLIENT`에 `ca-pub-...` 값을 넣고 다시 빌드 → `ads.txt`가 자동으로 생기고 자동 광고가 붙어요

> 무료 주소(`pages.dev`)로도 신청할 수 있지만, 자기 도메인을 연결하면 승인과 관리가 더 수월한 편이에요.


## 8. 관리자 페이지(통계) 켜기

주소: `https://사이트주소/admin` — 배포 전에는 `admin.html?demo=1`로 예시 화면을 볼 수 있어요.

1. **D1 데이터베이스 만들기**: Cloudflare → Storage & Databases(또는 Workers & Pages) → **D1** → Create database → 이름 `jimkkurim-stats`
2. **연결**: Pages 프로젝트 → Settings → **Bindings** → Add → D1 database → 변수 이름 **`DB`**, 방금 만든 데이터베이스 선택
3. **관리자 비밀번호**: Settings → Variables and Secrets → **`ADMIN_PASSWORD`**를 **Secret**으로 추가 (길고 추측하기 어려운 값으로)
4. **다시 배포**: Deployments → Retry deployment
5. `/admin`에서 비밀번호로 로그인. 표(테이블)는 첫 기록이 들어올 때 자동으로 만들어져요.

- 로그인한 브라우저는 자동으로 통계에서 빠져요.
- IP 주소는 저장하지 않고 하루 단위 익명 값만 저장해요. 기록은 400일 뒤 자동 삭제돼요.
- 무료 한도: D1은 하루 쓰기 10만 건, 읽기 500만 건까지 무료라 방문 기록용으로 충분해요.
