# v4 — 유쇼츠의 app_config 방식 재사용 (환경변수 등록 불필요!)

이게 정답이었습니다. 유쇼츠(U-Short)가 이미 같은 Supabase 프로젝트의 `app_config` 테이블에
`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`를 평문으로 저장해두고 있었고, HongHub도 같은 프로젝트를
쓰고 있어서 **Vercel 환경변수를 따로 등록할 필요 없이 바로 조회해서 쓸 수 있습니다.**

## 반영 방법

1. **`_migration_11_ai_provider.sql`** → Supabase SQL Editor에서 실행 (컬럼 하나 추가)

2. **`lib/remoteConfig.ts`** → 신규 추가
   (app_config 테이블을 조회하는 유틸. 유쇼츠의 lib/remoteConfig.js와 같은 아이디어)

3. **`app/api/generate-content/route.ts`** → 기존 파일 덮어쓰기
   (Claude/Gemini 둘 다 지원, 키는 app_config에서 자동으로 가져옴)

4. **`app/sources/page.tsx`** → `GenerateTab_수정본.txt` 내용대로 GenerateTab 함수 교체
   (AI 선택 버튼 추가는 이전과 동일)

## Vercel 환경변수
**추가할 필요 없습니다.** app_config 테이블에 이미 키가 있고, 코드가 그걸 자동으로 읽어옵니다.
(다만 이전 시도들에서 혹시 `ANTHROPIC_API_KEY`, `VAULT_MASTER_KEY` 등을 넣으셨다면
지워도 되고 남겨둬도 상관없습니다 — `remoteConfig.ts`는 Vercel 환경변수가 있으면 그걸 우선 쓰고,
없으면 app_config를 조회하는 식으로 되어 있어서 둘 다 있어도 안전합니다.)

## 재배포 후 테스트
`/sources` → 3번 탭에서 Claude/Gemini 버튼 눌러가며 생성 테스트 해보시면 됩니다.

## 왜 이 방식이 제일 좋은가
- 새 키 발급 불필요 (이미 유쇼츠용으로 등록해두신 키 재사용)
- Vercel 환경변수 설정 불필요 (DB에서 자동으로 읽어옴)
- 유쓰레드의 암호화 볼트(VAULT_MASTER_KEY)처럼 복잡한 처리 불필요 (app_config는 평문 저장이라 그냥 select만 하면 됨)
