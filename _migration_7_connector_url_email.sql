-- MCP 커넥터 목록에 실제 접속 주소(URL)와 관리 이메일(그룹화용) 추가.
alter table hub_mcp_connectors
  add column if not exists url text,
  add column if not exists admin_email text;
