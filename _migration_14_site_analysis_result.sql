-- 4번(분석) 단계 결과 저장용. 웹앱이 직접 유료 API로 분석하지 않고, Claude(구독)나 Gemini에게
-- 채팅으로 분석을 시켜서 그 결과를 MCP save_pipeline_analysis 툴로 여기 저장하면 워크플로우
-- 페이지의 4번 탭에 그대로 표시된다.
alter table hub_sites add column if not exists analysis_result jsonb;
