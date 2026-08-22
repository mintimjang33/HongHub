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
