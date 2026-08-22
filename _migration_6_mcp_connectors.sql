-- Claude에 연결해둔 MCP 커넥터 목록을 기록해두는 테이블.
create table if not exists hub_mcp_connectors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tags text[], -- 예: ['웹'], ['데스크톱','포함됨'], ['웹','사용자정의']
  connected boolean not null default true,
  site_id uuid references hub_sites(id) on delete set null, -- 관련된 우리 프로젝트(선택)
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table hub_mcp_connectors enable row level security;

create index if not exists hub_mcp_connectors_site_id_idx on hub_mcp_connectors(site_id);
