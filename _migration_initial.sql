create table if not exists hub_sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  admin_email text,
  github_url text,
  vercel_url text,
  live_url text,
  supabase_url text,
  benchmark_url text,
  notes text,
  start_date date,
  plan_file_url text,
  plan_file_name text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table hub_sites enable row level security;

insert into storage.buckets (id, name, public)
values ('honghub-files', 'honghub-files', true)
on conflict (id) do nothing;
