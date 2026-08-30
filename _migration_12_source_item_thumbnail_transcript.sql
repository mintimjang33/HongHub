-- 소재(hub_source_items)에 썸네일/대본 필드 추가.
-- thumbnail_url은 링크 가져오기(import_source_url/import-url API)가 og:image에서 자동으로 채운다.
-- transcript는 자동 수집이 안 돼서 "/sources" 페이지의 "📜 대본" 버튼으로 수동으로 붙여넣는다.
alter table hub_source_items add column if not exists thumbnail_url text;
alter table hub_source_items add column if not exists transcript text;
