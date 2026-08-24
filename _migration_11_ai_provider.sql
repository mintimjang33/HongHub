-- hub_generated_content에 어떤 AI로 생성했는지 기록하는 컬럼 추가
alter table hub_generated_content
  add column if not exists ai_provider text default 'claude';
