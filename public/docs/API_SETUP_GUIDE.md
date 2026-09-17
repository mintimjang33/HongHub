# 외부 API 연동 실전 가이드 (네이버 / Threads·Meta)

> 이 문서는 실제로 겪은 문제와 해결 과정을 그대로 기록한 것입니다. **추측이나 일반론이 아니라 실증된 사실만 적혀있습니다.**
> 메모리 없는 새 Claude 세션이 이 문서만 보고도 같은 실수를 반복하지 않는 게 목적입니다.

## 이 문서를 쓰는 사람에게 (필독)

- **빌드 통과 ≠ 동작 확인.** TypeScript 컴파일이 되는 것과 실제로 API가 200을 반환하는 건 다른 문제다. curl이든 브라우저든 반드시 실제로 호출해서 확인할 것.
- **API 스펙을 추측으로 구현하지 말 것.** 반드시 공식 문서를 찾아서 정확한 엔드포인트/파라미터/헤더로 구현한다. 공식 문서가 막혀있으면(Cloudflare 등) 포기하지 말고 우회 경로(캐시, 관련 이관 가이드 블로그, 다른 개발자의 정리글)로 정확한 스펙을 먼저 확보한 뒤 curl로 실증하고 나서 코드에 반영한다.
- **"안 된다"고 바로 단정하지 말 것.** 에러가 나면 "설정을 안 해서"라고 성급히 결론 내리기 전에, 서비스 자체가 정책을 바꿨거나(예: API 폐지/이관) 권한 전파가 지연 중일 가능성부터 확인한다.
- **비밀값(API 키, 토큰)은 채팅에 평문으로 적지 말 것.** 파일로 전달하고, 코드/커밋 로그에도 안 남게 `.env` 계열로만 다룬다.

---

## 네이버 API

### 종류별로 발급처가 다르다 (헷갈리지 말 것)

| 용도 | 발급처 | 인증 방식 |
|---|---|---|
| 검색광고 키워드도구(연관검색량) | 네이버 검색광고 관리자센터(searchad.naver.com) → 도구 → API 사용 관리 | API Key / Secret Key / Customer ID |
| 뉴스·블로그 검색 (구버전, 2027-06-30까지 유예) | developers.naver.com 개발자센터 | `X-Naver-Client-Id` / `X-Naver-Client-Secret` |
| **쇼핑인사이트·검색어트렌드 (신규는 여기서만)** | **NAVER Cloud Platform → NAVER API HUB** (`console.ncloud.com`) | `X-NCP-APIGW-API-KEY-ID` / `X-NCP-APIGW-API-KEY` |

### ⚠️ 중요: 네이버가 구버전 API를 단계적으로 폐지 중

네이버가 공식 공지(`developers.naver.com/notice/article/32530`, 실제로 찾아서 확인한 공지)로 밝힌 일정:

- **2026-07-31**: 개발자센터에서 Search API / 검색어 트렌드 / 쇼핑 인사이트 **신규 신청 차단**
- **2027-06-30**: 위 3개 API, 개발자센터 내 완전 종료(Fade-out) — 이후엔 API HUB에서만 이용 가능

즉 **이 날짜 이후로 만드는 프로젝트는 쇼핑인사이트/검색어트렌드를 구버전 개발자센터에서 절대 켤 수 없다.** "체크박스만 누르면 될 것"이라고 생각하지 말 것 — 실제로 이 착각으로 한 번 잘못 안내한 적이 있다.

### NAVER API HUB 발급 절차 (실제로 해본 순서)

1. `console.ncloud.com` 접속(NCP 계정 필요, 기존 네이버 계정으로 가입 가능)
2. 좌측 메뉴 또는 검색으로 **NAVER API HUB** 진입
3. **"+ 서비스 이용 신청"** → Application 등록
4. **API 선택** 화면에서 필요한 것 체크(쇼핑인사이트, 검색어트렌드, 뉴스 등 — 나중에 필요할 걸 대비해 관련된 건 한 번에 다 체크해도 무방, 무료 쿼터 내)
5. Application 이름 입력 → 완료
6. 발급된 **Client ID / Client Secret** 확인(구버전과 다른 새 키)

### 실제 요청 스펙 (curl로 검증 완료)

```
POST https://naverapihub.apigw.ntruss.com/shopping/v1/categories
Headers:
  X-NCP-APIGW-API-KEY-ID: {신규 Client ID}
  X-NCP-APIGW-API-KEY: {신규 Client Secret}
  Content-Type: application/json
Body:
  {"startDate":"...","endDate":"...","timeUnit":"date","category":[{"name":"...","param":["카테고리코드"]}]}
```

**구버전(`openapi.naver.com/v1/datalab/shopping/categories`, `X-Naver-Client-Id` 헤더)으로 신규 키를 쓰면 401이 난다** — 도메인/헤더/경로가 완전히 다른 별개 시스템이기 때문. 헷갈려서 구버전 엔드포인트에 신규 키를 넣고 테스트하다가 실제로 이 에러를 겪었다.

### Google Trends 관련 (참고 — 네이버는 아니지만 같이 겪은 사례)

`trends.google.com/trends/trendingsearches/daily/rss` 엔드포인트가 구글 쪽에서 폐기되고 `trends.google.com/trending/rss`로 바뀌었다. 404가 나면 URL이 바뀌었는지부터 curl로 확인할 것 — 이것도 "설정 문제"가 아니라 서비스 쪽 변경이었다.

---

## Threads API (Meta for Developers)

### 앱 등록 전체 절차

1. `developers.facebook.com/apps` 에서 앱 생성 (전화번호 인증 등 계정 신원 확인은 **사용자 본인이 직접** — Claude가 대행 불가)
2. 앱 대시보드 → **이용 사례(Use cases)** → **"Threads API 액세스"** 추가
3. 좌측 "설정" 탭에서 **리디렉션 콜백 URL** 등록 (아래 "저장 실패 3연속" 참고)
4. **앱 역할 → Threads 테스터**에 테스트용 Threads 계정 추가 → 해당 계정은 **Threads 모바일 앱**에서 초대 수락해야 실제 테스터로 활성화됨
5. Vercel(또는 배포 환경)에 `THREADS_APP_ID` / `THREADS_APP_SECRET` 등록

### ⚠️ 리디렉션 URL "양식을 저장할 수 없음" — 실제 겪은 원인 3가지 (순서대로 다 겪음)

같은 에러 메시지가 **서로 다른 3가지 원인**으로 반복해서 났다. 하나 고쳤다고 끝난 게 아니라 순서대로 다 확인해야 했다:

1. **기본 설정의 URL 필드가 Facebook 기본 placeholder로 남아있음**: 앱 도메인 / 개인정보처리방침 URL / 서비스 약관 URL / 사용자 데이터 삭제 안내 URL이 비어있거나 `facebook.com`으로 남아있으면 저장이 막힌다 → 전부 자기 서비스의 실제 URL(정책 페이지 등)로 채워야 함
2. **제거 콜백 URL / 삭제 콜백 URL이 비어있음**: 리디렉션 콜백 URL 하나만 채워선 안 되고, 이 두 개도 같이 채워야 저장이 통과된다(공식 문서에 명확히 안 나와있어서 여러 개발자 커뮤니티 사례를 찾아서 확인한 내용)
3. **입력은 했는데 Enter로 커밋 안 함**: 리디렉션 콜백 URL 입력칸에 텍스트만 쳐놓고 Enter를 안 누르면, 화면엔 값이 보여도 실제로는 태그/칩으로 등록이 안 돼서 폼이 인식을 못 한다 → 칸 클릭 후 커서를 끝으로 옮기고 **Enter**를 눌러야 확정된다

### 제거/삭제 콜백은 URL만 채우지 말고 실제로 구현할 것

Meta가 나중에 실제로 이 URL에 ping을 보낸다(사용자가 앱 연결 해제, 또는 데이터 삭제 요청 시). `signed_request` 파라미터(HMAC-SHA256으로 서명된 payload, `앱시크릿`으로 검증)가 POST로 온다. 최소 구현:

- 제거 콜백: `signed_request` 검증 → 해당 계정 데이터 삭제/연동 해제 처리 → 200
- 삭제 콜백: 위와 동일 + 응답 규격 `{"url": "...", "confirmation_code": "..."}` 반환 필요(공식 문서 규격)

### 앱 이름 vs Threads 표시 이름은 별개 필드

OAuth 동의 화면(`"OO에서 다음에 대한 액세스 권한을 요청합니다"`)에 뜨는 이름은 **앱 기본 설정의 "앱 이름"** 필드다. "Threads API 액세스" 설정 안의 "Threads 표시 이름"과는 별개 필드라, 둘 다 원하는 서비스명으로 맞춰야 한다.

### OAuth 권한(scope) 표준 10개

```
threads_basic, threads_content_publish, threads_manage_replies,
threads_read_replies, threads_manage_insights, threads_keyword_search,
threads_delete, threads_manage_mentions, threads_share_to_instagram,
threads_profile_discovery
```

**주의**: `threads_profile_discovery`(공개 프로필 조회)는 앱이 정식 심사(App Review)를 통과하기 전에는 **표준 액세스로 `@meta`/`@threads`/`@instagram`/`@facebook` 등 일부 공식 계정만 조회 가능**하다(공식 문서 확인). 일반 사용자 계정을 조회하려는 기능이라면 이 API 대신 공개 프로필 페이지를 직접 스크래핑하는 방식이 실사용성 면에서 더 낫다 — scope 목록엔 넣어도(원본과 권한 개수를 맞추기 위해) 실제 기능 구현엔 이 API를 쓰지 않기로 한 사례가 있다.

### "Application does not have permission for this action" 에러

새 scope를 추가하고 계정을 재연동한 직후 이 에러가 날 수 있다. **바로 "역시 안 되는구나"라고 단정하지 말고, 몇 분 후 다시 시도해볼 것** — 실제로 권한 전파 지연이었고 재시도하니 정상 동작했다.

### 권한 진단법 (문제 생기면 이걸로 원인 확인)

공식 문서화는 안 돼있지만 실제로 동작하는 엔드포인트:

```
GET https://graph.threads.net/debug_token?input_token={토큰}&access_token={토큰}
```
응답의 `data.scopes` 배열에 이 토큰에 실제로 부여된 권한 목록이 그대로 나온다. "권한이 있는 줄 알았는데 안 됨" 상황이 생기면 추측하지 말고 이걸로 먼저 확인할 것.

### 게시물 발행/삭제/타래 API (실제 검증된 스펙)

- 발행: `POST /{user-id}/threads` (컨테이너 생성, `media_type`, `text`, 답글이면 `reply_to_id`) → `POST /{user-id}/threads_publish` (`creation_id`)
- 인스타그램 스토리 동시공유: `threads_publish` 호출 시 `crossreshare_to_ig: true` 추가
- 삭제: `DELETE https://graph.threads.net/v1.0/{media-id}?access_token=...` (하루 계정당 100개 제한)
- 멘션 조회: `GET https://graph.threads.net/{user-id}/mentions?fields=...` (`threads_manage_mentions` 필요)

---

## 유튜브 데이터 API (OAuth) — Client ID/Secret, Refresh Token, 채널 ID

> 이 섹션은 실제로 홍허브에서 유튜브 계정 하나를 처음부터 끝까지 연동해본 기록이다. 중간에 겪은 삽질(잘못된 클라이언트로 토큰 발급, 브라우저 자동번역이 API 호출을 깨뜨림)까지 그대로 남긴다 — 다음에 또 겪지 않기 위해서다.

### 전체 절차

1. **Google Cloud Console → API 및 서비스 → 라이브러리**에서 "YouTube Data API v3" 사용 설정
2. **Google 인증 플랫폼 → 대상**에서 게시 상태 "테스트 중" 확인 + **테스트 사용자**에 이 채널을 실제로 운영하는 구글 계정 이메일 등록 (안 하면 로그인 시도 시 차단됨)
3. **클라이언트 → + 클라이언트 만들기** → 유형 "웹 애플리케이션" → **승인된 리디렉션 URI**에 `https://developers.google.com/oauthplayground` 추가 → 만들기 → 그 자리에서 뜨는 Client ID/Secret 즉시 복사(다시 못 봄)
4. **OAuth Playground**(`developers.google.com/oauthplayground`)에서 Refresh Token 발급 → ⚙ 설정에서 "Use your own OAuth credentials" 체크 + 방금 만든 Client ID/Secret 입력 → 아래 "실전에서 겪은 문제" 참고
5. **채널 ID**는 `GET https://www.googleapis.com/youtube/v3/channels?part=id&mine=true`를 방금 발급받은 access token으로 호출해서 `items[0].id` 값으로 확인

### ⚠️ 기존 OAuth 클라이언트를 재사용하려 하면 막힐 수 있음

한 프로젝트 안에 다른 앱(예: Supabase 로그인용으로 만든 클라이언트)이 이미 있어도, **클라이언트 보안 비밀번호(secret)는 클라이언트당 최대 2개까지만** 만들 수 있다. 이미 2개가 다 활성 상태고 어느 쪽이 실제로 다른 앱(Supabase 등)에 물려있는지 모르면, 함부로 삭제/교체하지 말 것 — 대신 **완전히 새로운 OAuth 클라이언트를 하나 더 만들면** 기존 앱을 전혀 안 건드리고 깨끗하게 분리된다(프로젝트당 클라이언트 개수 제한은 없음).

### ⚠️ "Use your own OAuth credentials" 체크가 중간에 풀릴 수 있음 — 반드시 client_id로 확인

OAuth Playground에서 이 체크를 해뒀다고 안심하면 안 된다. 실제로 이 세션에서 두 번째 "Authorize APIs" 시도 때 이 설정이 리셋되면서, 발급된 토큰이 **구글 공용 Playground 클라이언트(`client_id=407408718192.apps.googleusercontent.com`)**로 나온 적이 있다 — 이 토큰은 자기 앱(자기 Client ID/Secret)으로는 쓸 수 없다.

**검증 방법**: Step 2 "Exchange authorization code for tokens"를 누르기 전, Request 패널에 찍히는 요청 본문의 `client_id=`가 **본인이 만든 클라이언트 ID로 시작하는지** 반드시 확인할 것. `407408718192...`가 보이면 잘못된 것이니 ⚙ 설정에서 자기 자격증명을 다시 입력하고 처음부터(Authorize APIs부터) 다시 진행해야 한다.

### 인증 코드(authorization code)는 1회용, 재사용하면 `invalid_grant`

Step 1에서 받은 code로 Step 2 "Exchange"를 한 번 성공시키면 그 code는 소진된다. 같은 code로 다시 누르거나, 딴짓하다 시간이 지난 code를 쓰면 `{"error": "invalid_grant"}` 400 에러가 난다 — 처음부터(Authorize APIs) 다시 받아야 한다.

### 추천 스코프 (업로드 + 댓글 관리용)

```
https://www.googleapis.com/auth/youtube
https://www.googleapis.com/auth/youtube.upload
https://www.googleapis.com/auth/youtube.force-ssl   ← 댓글 답글/삭제/모더레이션에 필요
```

`youtubepartner`/`youtubepartner-channel-audit`는 방송사·음반사·MCN이 여러 채널의 저작권 클레임을 관리하는 별개 API용이다 — 일반 채널 운영(업로드, 댓글 관리, 수익화 포함)과 무관하니 체크하지 말 것.

### 테스트 중(Testing) 상태면 Refresh Token이 7일마다 만료

실제 응답에서 `"refresh_token_expires_in": 604799` (정확히 7일, 초 단위)를 확인했다. 앱을 "게시(Production)"로 전환 + 심사를 통과하기 전까지는, 이 자동화를 계속 쓰려면 **7일마다 OAuth Playground의 Authorize→Exchange 두 단계만 다시 해서** Refresh Token을 재발급받아야 한다(클라이언트를 다시 만들 필요는 없음).

### 채널 ID — YouTube Studio "고급 설정"에 더 이상 안 보일 수 있음

과거엔 YouTube Studio → 설정 → 채널 → 고급 설정 탭에 채널 ID가 표시됐는데, UI 개편으로 이 세션에서는 그 항목 자체가 없어진 걸 확인했다. **가장 확실한 방법은 API로 직접 조회**하는 것:

```
GET https://www.googleapis.com/youtube/v3/channels?part=id&mine=true
Authorization: Bearer {access_token}
```

응답의 `items[0].id`가 채널 ID(`UC`로 시작).

### OAuth Playground Step 3(API 요청 테스트)가 브라우저 번역 때문에 깨질 수 있음

크롬 자동 번역이 켜져 있으면 "HTTP Method" 드롭다운의 "GET"이 "얻다"로 번역되어 실제 전송값이 깨지고 `{"error": "Disallowed Method '얻다'"}` 400 에러가 난다. Step 3의 드롭다운/버튼이 클릭해도 반응 없을 때는 번역 문제로 DOM이 꼬였을 가능성이 있다 — 이때는 Step 3를 쓰지 말고, 그냥 새 탭 주소창에 아래처럼 **access_token을 쿼리 파라미터로 붙여서 GET 요청을 직접 열면** 우회된다:

```
https://www.googleapis.com/youtube/v3/channels?part=id&mine=true&access_token={access_token}
```

---

## 예약/반복 실행(크론)

별도 문서 참고: **[크론/예약작업 가이드](/docs/CRON_GUIDE.md)** — cron-job.org를 쓰는 이유, 실제 겪은 실수 2건(푸시 누락으로 404, 헤더 누락으로 401) 기록돼있음.
