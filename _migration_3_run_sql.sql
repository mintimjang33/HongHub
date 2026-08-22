-- MCP의 run_sql/list_tables 툴이 쓰는 안전한 SELECT 전용 SQL 실행 함수.
-- U-Thread(ut_mcp_run_sql)와 동일한 패턴: SECURITY DEFINER + SELECT만 허용.
create or replace function hub_run_sql(query text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if query !~* '^\s*select\s' or query ~* '\b(insert|update|delete|drop|alter|truncate|grant|revoke|create)\b' then
    raise exception 'SELECT 문만 허용됩니다.';
  end if;
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) t', query) into result;
  return result;
end;
$$;
