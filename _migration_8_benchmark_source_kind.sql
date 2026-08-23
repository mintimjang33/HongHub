-- 벤치마킹 아이템에 "어디서 찾았는지"(출처 이름+링크 여러 개)와 종류(개별 아이템 vs 계정모음) 구분 추가.
alter table hub_benchmarks
  add column if not exists source_name text,
  add column if not exists source_urls text[],
  add column if not exists kind text not null default 'item';

create index if not exists hub_benchmarks_kind_idx on hub_benchmarks(kind);
