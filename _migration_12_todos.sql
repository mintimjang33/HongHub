-- 오늘의 할일: 급하게 처리해야 하는 업무/메모를 적어두고 완료하면 삭제하는 임시 노트 테이블.
create table if not exists hub_todos (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  attachments jsonb not null default '[]'::jsonb, -- [{ "url": "...", "name": "..." }]
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table hub_todos enable row level security;
