# HongHub 계획서

> 이 프로젝트는 원본 브랜드를 클론하는 게 아니라 직접 만든 도구라, 다른 프로젝트들과 달리 이 파일도 git에 그대로 커밋해서 추적한다(민감한 원본 정찰 기록이 없음).

## 0. 한 줄 요약

내 사이트/프로젝트(유쓰레드, 유쇼츠, 카드뉴스컨버터 등)를 한곳에 모아서 이메일별로 관리하고, 계획서·가이드 문서까지 같이 보관하는 개인 관리 허브.

## 1. 배경 / 목적

여러 프로젝트를 GitHub/Vercel/Supabase에 흩어놓고 관리하다 보니 한눈에 안 들어와서, 프로젝트별 링크 묶음 + 관리 이메일별 그룹 + 계획서 파일까지 모아두는 대시보드가 필요했음.

## 2. 범위 정의

**포함**
- 사이트/프로젝트 CRUD(이름, 관리이메일, 깃허브, 배포, 접속, 슈퍼베이스, 벤치마킹, 시작일, 메모, 계획서 파일)
- 관리 이메일별 그룹 표시
- 비밀번호 로그인 게이트(개인 전용)
- MCP 서버(Claude가 직접 등록/조회/수정 가능)
- 가이드 문서 모음(클론 프로세스/MCP/크론/API연동/이메일서비스/계획서템플릿)
- 소셜 플랫폼(유튜브/인스타/쓰레드/페북/틱톡/네이버) 빠른 링크 바

**제외/후순위**
- 다중 사용자(현재는 비밀번호 하나로 단일 사용자 전용)
- 실시간 상태 모니터링(사이트가 실제로 살아있는지 핑 체크 등) — 필요하면 추후

## 3. 기술 스택

| 영역 | 선택 |
|---|---|
| 프레임워크 | Next.js 16(App Router) + TypeScript + Tailwind |
| DB | Supabase(유쓰레드·유쇼츠와 공유 프로젝트, `hub_` 접두사) |
| 파일 저장 | Supabase Storage(`honghub-files` 버킷) |
| 인증 | 비밀번호 1개 + httpOnly 쿠키(미들웨어 게이트), MCP는 별도 `?key=` 인증 |
| 배포 | Vercel |

- 깃허브: https://github.com/mintimjang33/HongHub
- 배포: https://vercel.com/mintimjang/honghub
- 접속: https://honghub.vercel.app/
- 슈퍼베이스: https://supabase.com/dashboard/project/iwxpjnwktxpscoktfpyl

## 4. 진행 기록

### 2026-08-23 — 초기 구축
- 사용자가 "내 사이트 모아서 관리할 HTML 페이지 하나" 요청 → 대화 중 요구사항이 정식 웹앱(Next.js+Supabase+MCP)으로 확장됨
- Next.js 스캐폴딩, `hub_sites` 테이블, CRUD API, 카드 UI 구현
- GitHub 저장소(`HongHub`) 생성, 초기 3개 사이트(유쓰레드/카드뉴스컨버터/유쇼츠) 시드 등록 요청받음 → 이후 HongHub 자기 자신도 4번째로 추가
- **문제**: 슈퍼베이스 링크를 API 엔드포인트(`*.supabase.co`)로 등록해서 브라우저로 안 열림 → 대시보드 URL(`supabase.com/dashboard/project/{ref}`) 형식으로 정정
- **문제**: 시드 SQL을 두 번 실행해서 이름 중복 등록됨 → 중복 제거 SQL + `name` 유니크 인덱스 추가로 재발 방지
- MCP 서버 구현 중 `server.tool()` API가 설치된 `mcp-handler` 버전(2.1.1)엔 없고 `server.registerTool()`로 바뀐 걸 타입 에러로 발견 → 실제 타입 정의 파일 뒤져서 정확한 시그니처로 수정(이 사실을 `docs/MCP_GUIDE.md`에 "흔한 실수"로 기록)
- 관리 이메일별 그룹 UI, 시작일/계획서 파일 업로드, 로그인 게이트(비밀번호+httpOnly 쿠키), 소셜 플랫폼 빠른 링크 바 순서대로 추가
- 가이드 문서 6종 작성(클론 프로세스/MCP/크론/API연동 실전/이메일서비스/계획서템플릿) — 처음엔 `docs/`에 둬서 웹에서 안 열렸다가 `public/docs/`로 옮겨서 홈 화면에 실제로 노출되게 수정
- **사고**: "GitHub에 다 올라간 건 삭제해도 된다"는 지시를 따라 폴더 전체를 지웠는데, `.env.local`(슈퍼베이스 서비스롤 키, MCP 비밀키, 로그인 비밀번호/세션시크릿)은 git에 없는 파일이라 같이 날아감. 사용자가 즉시 지적해서 슈퍼베이스 값은 유쇼츠 폴더에서 복구, 비밀번호류는 알고 있던 값으로 재작성, 세션 시크릿만 새로 발급해서 Vercel에 재동기화 필요 상태가 됨 — **교훈: "GitHub에 있는 것만 지운다"고 할 때 `.env.local`은 항상 예외로 다시 확인할 것, 삭제 명령을 실행하기 전에 사용자의 정정 메시지가 있는지 한 번 더 확인할 것.**

### 2026-08-23~24 — 사이트 등록 개선 + 벤치마킹/MCP 커넥터 기록 기능
- 사이트 등록 폼에 필드 라벨 추가, URL 필드 5종(깃허브/배포/접속/슈퍼베이스/벤치마킹) 다중값(배열) 지원
- MCP에 슈퍼베이스 범용 조회(`list_tables`/`run_sql`) + GitHub 파일 읽기 툴 추가
- 벤치마킹 아이템 수집함 기능 추가 → 이후 출처(어디서 찾았는지) 필드 보강 + 계정모음 페이지로 분리
- 연결된 MCP 커넥터 목록을 홍허브에 직접 기록하는 기능 추가(위 `list_mcp_connectors` 결과가 이걸로 관리됨) → 접속 URL·관리 이메일 필드 및 이메일별 그룹화 추가
- 플랫폼별(유튜브/틱톡/인스타 등) 터진 글 분석 페이지 추가

### 2026-08-24 — `/sources` 기능 대량 추가 (⚠️ Claude가 한 작업 아님, GitHub 웹 업로드로 직접 커밋됨)
- 커밋 메시지가 전부 "Add files via upload"로 남아있는 9개 커밋 — 사용자가 GitHub 웹 UI에서 직접 파일을 올린 것으로 추정, 이 세션에서 만든 게 아니라 사후에 발견함
- 내용: 소스채널(유튜브/틱톡/인스타) 디스커버리 + 트리비아성 콘텐츠 발굴 기능 — `app/sources/page.tsx`, `app/api/source-channels`, `app/api/source-items`, `app/api/generate-content`, `app/api/import-url`, `lib/aiProviders.ts`(AI 프로바이더 추상화), `lib/ogMeta.ts`, `_migration_10_source_channels.sql`, `_migration_11_ai_provider.sql`, `public/docs/SOURCE_DISCOVERY_GUIDE.md` 등
- `SOURCE_DISCOVERY_GUIDE.md`에 명시된 중요한 스코프 제약: 트리비아 콘텐츠는 유튜브 쇼츠/틱톡/인스타에서만 바이럴 검증됐고 **쓰레드(Threads)에서는 검증된 사례가 없음** — 쓰레드용 소재는 계속 `ut_benchmark_items`/커뮤니티 게시물에서 가져올 것

### 2026-08-25 — 소스 발굴 가이드 보강 + 유쓰레드 PLAN.md 유실 발견
- `SOURCE_DISCOVERY_GUIDE.md`에 유튜브 영상 자막(스크립트) 가져오는 방법 추가 — Python `youtube-transcript-api`가 안정적으로 동작하는 걸 실제 영상(496개 세그먼트, 사용자 붙여넣은 스크립트와 100% 일치)으로 검증 후 문서화. Node `fetch`로 유튜브 `timedtext` 엔드포인트 직접 호출은 빈 응답(서명URL/세션 바인딩 문제)이라 안 됨.
- 유쓰레드(U-Thread) 프로젝트의 자체 `PLAN.md`(로컬 전용, gitignore)가 폴더명이 `dreaths-clone`→`U-Thread`로 바뀌는 과정에서 유실된 걸 발견 → 이 홍허브의 `plan_file_url` 백업도 비어있어 복구 불가 확인, 메모리 기반으로 재작성함. **교훈: 로컬 전용(gitignore) 계획서 파일은 홍허브의 "계획서 파일 업로드"로 주기적으로 백업해야 이런 유실을 막을 수 있음 — 지금 이 파일(HongHub 자신의 PLAN.md)도 같은 위험이 있는지 점검 필요(이건 git 추적이라 안전).**

## 5. 남은 것
- Vercel 환경변수의 `HUB_SESSION_SECRET`을 새로 발급한 값으로 갱신 필요(로컬 `.env.local` 재생성 직후) — 실제 갱신 여부 미확인, 다음에 로그인 관련 문제 생기면 이것부터 의심할 것
- ~~MCP 커넥터를 Claude 쪽에 실제로 등록~~ → 완료(`list_mcp_connectors`로 확인, 13개 등록됨)
- 각 프로젝트(유쓰레드 등)의 로컬 전용 PLAN.md를 홍허브에 정기 백업(파일 업로드는 웹 UI에서만 가능, MCP엔 업로드 도구 없음)
