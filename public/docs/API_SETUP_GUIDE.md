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

## 예약/반복 실행(크론)

별도 문서 참고: **[크론/예약작업 가이드](/docs/CRON_GUIDE.md)** — cron-job.org를 쓰는 이유, 실제 겪은 실수 2건(푸시 누락으로 404, 헤더 누락으로 401) 기록돼있음.
