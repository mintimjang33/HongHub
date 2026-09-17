-- 2026-09-17 신설 — 사용자 지적: "계정 채널명 이런걸 니가 다 셋팅을 해줘야해" /
-- "그걸 셋팅하려면 뭐가 필요한지를 만들어야 정보를 입력해두지". 계정 등록 폼이 이름/메모
-- 뿐이라 실제 API 연동에 필요한 자격증명(플랫폼마다 다름 — 유튜브는 Client ID/Secret/
-- Refresh Token, 메타 계열(인스타/쓰레드/페북)은 App ID/Secret+Access Token, 틱톡은
-- Client Key/Secret+Access Token)을 구조화해서 저장할 곳이 없었다. 플랫폼마다 필요한 키가
-- 달라서 고정 컬럼 대신 jsonb로 유연하게 받는다(app/page.tsx의 CREDENTIAL_FIELDS가 플랫폼별
-- 실제 입력 필드를 정의).
alter table hub_social_accounts add column if not exists credentials jsonb;
