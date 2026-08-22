-- 같은 이름으로 중복 등록된 행 정리(가장 먼저 생긴 것만 남김)
delete from hub_sites a using hub_sites b
where a.name = b.name and a.id > b.id;

-- 이후 같은 이름 재등록 시 에러 대신 무시되도록 유니크 인덱스 추가
create unique index if not exists hub_sites_name_key on hub_sites (name);
