-- 소스 채널 & 소재 & 생성 콘텐츠 관리
-- Supabase SQL Editor에서 실행

create table if not exists hub_source_channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  platform text not null default 'youtube', -- youtube / tiktok / instagram / community / etc
  url text,
  subscriber_count text,
  content_types text[] default '{}',        -- TRIVIA, LIFEHACK, EMOTIONAL, HUMOR, MOTIVATION, RANKING, PERSONAL_STORY, DEBATE
  platform_fit text[] default '{}',         -- threads, youtube_shorts, tiktok, instagram
  notes text,
  status text default '후보',                -- 후보 / 추적중 / 보류
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists hub_source_items (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references hub_source_channels(id) on delete set null,
  title text not null,
  source_url text,
  views text,
  content_type text,                        -- 단일 대표 태그
  platform_fit text[] default '{}',
  raw_notes text,                           -- 원본 소재 요약(사실관계만, 대본 원문 금지)
  status text default '미가공',              -- 미가공 / 가공완료 / 발행완료
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists hub_generated_content (
  id uuid primary key default gen_random_uuid(),
  source_item_id uuid references hub_source_items(id) on delete set null,
  persona_id uuid,                          -- ut_personas.id 참조 (같은 프로젝트, FK 제약은 걸지 않음)
  persona_name text,                        -- 생성 시점 페르소나 이름 스냅샷
  target_platform text not null,            -- threads / youtube_shorts / tiktok / instagram
  generated_text text not null,
  status text default 'draft',              -- draft / approved / published
  created_at timestamptz default now()
);

create index if not exists idx_hub_source_items_channel on hub_source_items(channel_id);
create index if not exists idx_hub_generated_content_source on hub_generated_content(source_item_id);
