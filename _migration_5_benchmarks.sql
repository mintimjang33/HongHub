-- 벤치마킹할 아이템(깃허브/사이트/노션 등)을 특정 프로젝트와 별개로 모아두는 테이블.
create table if not exists hub_benchmarks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  type text not null default 'site', -- github | site | notion | other
  status text not null default '후보', -- 후보 | 검토중 | 클론예정 | 완료 | 보류
  notes text,
  site_id uuid references hub_sites(id) on delete set null, -- 관련된 우리 프로젝트(선택)
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hub_benchmarks_site_id_idx on hub_benchmarks(site_id);
