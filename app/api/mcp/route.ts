import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { getSupabaseServerClient } from '../../../lib/supabase';

const baseHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      'list_sites',
      { description: 'HongHub에 등록된 모든 사이트/프로젝트 목록을 조회한다.', inputSchema: z.object({}) },
      async () => {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase.from('hub_sites').select('*').order('sort_order').order('created_at');
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'add_site',
      {
        description: '새 사이트/프로젝트를 HongHub에 등록한다.',
        inputSchema: z.object({
          name: z.string().describe('사이트/프로젝트 이름'),
          admin_email: z.string().optional().describe('관리 이메일'),
          github_url: z.string().optional(),
          vercel_url: z.string().optional(),
          live_url: z.string().optional().describe('실제 접속 URL'),
          supabase_url: z.string().optional(),
          benchmark_url: z.string().optional().describe('벤치마킹 대상 원본 사이트 URL'),
          notes: z.string().optional(),
          start_date: z.string().optional().describe('시작일 (YYYY-MM-DD)'),
        }),
      },
      async (args) => {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase.from('hub_sites').insert(args).select().single();
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'update_site',
      {
        description: '등록된 사이트 정보를 수정한다(id 기준, 넘긴 필드만 갱신).',
        inputSchema: z.object({
          id: z.string().describe('수정할 사이트의 id (list_sites로 확인)'),
          name: z.string().optional(),
          admin_email: z.string().optional(),
          github_url: z.string().optional(),
          vercel_url: z.string().optional(),
          live_url: z.string().optional(),
          supabase_url: z.string().optional(),
          benchmark_url: z.string().optional(),
          notes: z.string().optional(),
          start_date: z.string().optional(),
        }),
      },
      async ({ id, ...fields }) => {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase
          .from('hub_sites')
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select()
          .single();
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'delete_site',
      { description: 'HongHub에서 사이트 등록을 삭제한다.', inputSchema: z.object({ id: z.string().describe('삭제할 사이트의 id') }) },
      async ({ id }) => {
        const supabase = getSupabaseServerClient();
        const { error } = await supabase.from('hub_sites').delete().eq('id', id);
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: '삭제됨' }] };
      }
    );

    server.registerTool(
      'list_tables',
      { description: '이 슈퍼베이스 프로젝트(유쓰레드/유쇼츠와 공유)의 public 스키마 테이블 목록을 조회한다.', inputSchema: z.object({}) },
      async () => {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase.rpc('hub_run_sql', {
          query: "select tablename from pg_tables where schemaname = 'public' order by tablename",
        });
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message} (hub_run_sql RPC가 DB에 없으면 _migration_3_run_sql.sql 실행 필요)` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'run_sql',
      {
        description: 'SELECT 문만 실행 가능한 안전 SQL 실행 도구. 이 슈퍼베이스 프로젝트 전체(hub_sites뿐 아니라 유쓰레드 ut_*, 유쇼츠 테이블도 같은 프로젝트라 조회 가능)를 SELECT로 조회한다.',
        inputSchema: z.object({ query: z.string().describe('SELECT로 시작하는 SQL 쿼리') }),
      },
      async ({ query }) => {
        const trimmed = query.trim();
        if (!/^select\s/i.test(trimmed) || /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create)\b/i.test(trimmed)) {
          return { content: [{ type: 'text', text: 'SELECT 문만 허용됩니다.' }] };
        }
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase.rpc('hub_run_sql', { query: trimmed });
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message} (hub_run_sql RPC가 DB에 없으면 _migration_3_run_sql.sql 실행 필요)` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'list_github_files',
      {
        description: 'HongHub GitHub 저장소(mintimjang33/HongHub)의 특정 경로에 어떤 파일·폴더가 있는지 조회한다.',
        inputSchema: z.object({ path: z.string().optional().describe('비우면 루트') }),
      },
      async ({ path }) => {
        const res = await fetch(`https://api.github.com/repos/mintimjang33/HongHub/contents/${path || ''}`);
        const json = await res.json();
        if (!res.ok) return { content: [{ type: 'text', text: `에러: ${JSON.stringify(json)}` }] };
        const list = (Array.isArray(json) ? json : [json]).map((f: { name: string; type: string; size: number }) => `${f.type === 'dir' ? '📁' : '📄'} ${f.name}${f.type === 'dir' ? '' : ` (${f.size} bytes)`}`);
        return { content: [{ type: 'text', text: list.join('\n') }] };
      }
    );

    server.registerTool(
      'get_github_file',
      {
        description: 'HongHub GitHub 저장소의 특정 파일 내용을 텍스트로 가져온다.',
        inputSchema: z.object({ path: z.string().describe('예: app/page.tsx') }),
      },
      async ({ path }) => {
        const res = await fetch(`https://raw.githubusercontent.com/mintimjang33/HongHub/main/${path}`);
        if (!res.ok) return { content: [{ type: 'text', text: `에러: 파일을 찾을 수 없습니다 (${res.status})` }] };
        const text = await res.text();
        return { content: [{ type: 'text', text }] };
      }
    );
  },
  { verboseLogs: true }
);

async function authedHandler(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!process.env.MCP_SHARED_SECRET || key !== process.env.MCP_SHARED_SECRET) {
    return new Response(JSON.stringify({ error: '인증 필요 (key 파라미터 확인)' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return baseHandler(request);
}

export { authedHandler as GET, authedHandler as POST };
