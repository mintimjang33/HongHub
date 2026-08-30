-- "워크플로우" — 계획서(plan_content)와는 별개 섹션. 파이프라인 카드에 "🔧 워크플로우 보기" 버튼으로 노출된다.
alter table hub_sites add column if not exists workflow_content text;
