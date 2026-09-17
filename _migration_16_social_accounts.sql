-- 2026-09-17 신설 — 사용자 요청: "홍허브 메인화면 플랫폼 버튼(유튜브/인스타/쓰레드/페이스북/
-- 틱톡/네이버블로그)들이 그냥 외부 링크만 있는데, 계정 채널 셋팅(API/설정 문구 등)을 하게
-- 해두자". 기존 버튼(외부 사이트 새 탭 열기)은 그대로 두고, 그 아래에 플랫폼별 계정 목록을
-- 등록/관리하는 섹션을 추가하기 위한 테이블.
create table if not exists hub_social_accounts (
  id uuid primary key default gen_random_uuid(),
  platform text not null, -- 'youtube' | 'instagram' | 'threads' | 'facebook' | 'tiktok' | 'naver_blog'
  account_name text not null, -- 계정/채널명 (예: "경제학 똑똑", "@mintimjang33")
  setting_note text, -- API 키, 연동 상태, 그 외 자유 메모 — 평문 저장(실제 비밀키를 여기 쓰지 말 것, app_config 참고)
  admin_email text, -- 이 계정을 관리하는 구글 계정(선택) — 메인화면 이메일 그룹과 연결 지을 때 사용
  site_id uuid references hub_sites(id) on delete set null, -- 특정 파이프라인 전용 계정이면 연결(선택, 비워두면 전역 계정)
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table hub_social_accounts enable row level security;

create index if not exists hub_social_accounts_platform_idx on hub_social_accounts(platform);
create index if not exists hub_social_accounts_site_id_idx on hub_social_accounts(site_id);
