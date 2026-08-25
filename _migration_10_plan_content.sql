-- 계획서를 파일 업로드(plan_file_url) 대신 텍스트로 직접 적어서 Claude가 MCP로 바로 갱신할 수 있게 한다.
-- 기존 plan_file_url/plan_file_name은 과거 업로드 이력 보존용으로 남겨둔다(새로 안 씀).
alter table hub_sites add column if not exists plan_content text;
