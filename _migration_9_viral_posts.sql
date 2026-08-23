-- 플랫폼별로 실제 반응 좋았던 글(원문+반응수치+왜 터졌는지 분석)을 모아두는 테이블.
create table if not exists hub_viral_posts (
  id uuid primary key default gen_random_uuid(),
  platform text not null, -- threads | instagram | tiktok | youtube
  account_name text not null,
  post_url text,
  content text not null,
  engagement text, -- 예: "967 좋아요 · 127댓글 · 45리포스트"
  analysis text, -- 왜 터졌는지 분석
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table hub_viral_posts enable row level security;

create index if not exists hub_viral_posts_platform_idx on hub_viral_posts(platform);
