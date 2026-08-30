-- 소재(hub_source_items)에 영상 길이(초) 필드 추가. 2번(채널별 인기 영상 가져오기)에서
-- 새로 등록하는 건 자동으로 채워지고, 이미 등록된 건 3번 패널의 "⏱ 길이 가져오기" 버튼으로 채운다.
alter table hub_source_items add column if not exists duration_seconds integer;
