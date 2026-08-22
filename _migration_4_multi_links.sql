-- github/vercel/live/supabase/benchmark URL을 단일값 -> 배열로 변경(기존 값은 1개짜리 배열로 자동 보존).
alter table hub_sites
  alter column github_url type text[] using case when github_url is null then null else array[github_url] end,
  alter column vercel_url type text[] using case when vercel_url is null then null else array[vercel_url] end,
  alter column live_url type text[] using case when live_url is null then null else array[live_url] end,
  alter column supabase_url type text[] using case when supabase_url is null then null else array[supabase_url] end,
  alter column benchmark_url type text[] using case when benchmark_url is null then null else array[benchmark_url] end;
