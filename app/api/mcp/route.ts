import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { callAi } from '../../../lib/aiProviders';
import { fetchOgMeta, detectChannelPlatform } from '../../../lib/ogMeta';
import { getConfigValue } from '../../../lib/remoteConfig';
import { searchShorts, resolveChannelId, getChannelTopVideos, fmtCount } from '../../../lib/youtubeSearch';

const urlArg = z.union([z.string(), z.array(z.string())]).optional().describe('URL 하나 또는 여러 개(배열)');

function toUrlArray(value: unknown): string[] | null {
  const arr = Array.isArray(value) ? value : value ? [value] : [];
  const cleaned = arr.map((v) => String(v).trim()).filter(Boolean);
  return cleaned.length ? cleaned : null;
}

const CONTENT_TYPE_ENUM = z.enum(['TRIVIA', 'LIFEHACK', 'EMOTIONAL', 'HUMOR', 'MOTIVATION', 'RANKING', 'PERSONAL_STORY', 'DEBATE']);
const PLATFORM_ENUM = z.enum(['threads', 'youtube_shorts', 'tiktok', 'instagram']);
const CONTENT_TYPES = ['TRIVIA', 'LIFEHACK', 'EMOTIONAL', 'HUMOR', 'MOTIVATION', 'RANKING', 'PERSONAL_STORY', 'DEBATE'];
const PLATFORM_VALUES = ['threads', 'youtube_shorts', 'tiktok', 'instagram'];

const PLATFORM_GUIDE: Record<string, string> = {
  threads: `
[쓰레드 포맷 규칙]
- 반드시 3~5줄 이내로 작성한다. 정보 나열형으로 흐르지 않는다.
- 순수 정보 전달("~다는 사실")보다 "나의 경험/반응"으로 포장하거나, 사람마다 답이 갈리는 질문형으로 마무리한다.
- 마지막 줄은 항상 댓글을 유도하는 질문으로 끝낸다 (예: "이거 나만 그럼?", "너넨 어떻게 생각함?").
- 해시태그는 사용하지 않거나 최대 1~2개만 사용한다.
`.trim(),
  youtube_shorts: `
[유튜브 쇼츠 나레이션 스크립트 규칙]
- 15~40초 분량의 나레이션 대본으로 작성한다.
- 구조: (1) 강한 훅 한 문장 (2) 반전/핵심 정보 전달 (3) 마무리 임팩트 문장.
- 각 구간을 줄바꿈으로 구분하고, 괄호로 (훅) (전개) (마무리) 라벨을 붙여준다.
`.trim(),
  tiktok: `
[틱톡 나레이션 스크립트 규칙]
- 유튜브 쇼츠와 유사한 훅-전개-마무리 구조를 쓰되, 더 캐주얼하고 밈틱한 어휘를 섞는다.
- 15~30초 분량, 자막에 강조할 문구는 **볼드**로 표시한다.
`.trim(),
  instagram: `
[인스타그램 카드뉴스 규칙]
- 5~8장의 카드로 나눠서 작성한다. 각 카드는 "카드 1: ..." 형식으로 번호를 매긴다.
- 카드 1은 표지(강한 훅 제목), 마지막 카드는 요약 또는 참여 유도 문구로 마무리한다.
- 각 카드 텍스트는 한 줄~두 줄 이내로 짧게 쓴다.
`.trim(),
};

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
          github_url: urlArg,
          vercel_url: urlArg,
          live_url: urlArg.describe('실제 접속 URL'),
          supabase_url: urlArg,
          benchmark_url: urlArg.describe('벤치마킹 대상 원본 사이트 URL(여러 개 가능)'),
          learning_url: urlArg.describe('제작법/학습 튜토리얼 URL(여러 개 가능) — 벤치마킹(무엇을 만들지)과 달리 어떻게 만드는지에 대한 자료'),
          notes: z.string().optional(),
          start_date: z.string().optional().describe('시작일 (YYYY-MM-DD)'),
          plan_content: z.string().optional().describe('계획서 본문(마크다운). PLAN_TEMPLATE.md 구조 권장.'),
          workflow_content: z
            .string()
            .optional()
            .describe(
              '워크플로우 본문(마크다운) — 계획서(plan_content)와는 별개 섹션. "무엇을 벤치마킹하는지"가 계획서라면, 이건 "어떤 순서로 어떤 도구를 쓰는지"만 담는다. 파이프라인(코드 아닌 콘텐츠 제작 워크플로) 항목마다 각자 따로 둔다 — 여러 파이프라인이 공유하는 문서로 만들지 말 것.'
            ),
        }),
      },
      async (args) => {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase
          .from('hub_sites')
          .insert({
            ...args,
            github_url: toUrlArray(args.github_url),
            vercel_url: toUrlArray(args.vercel_url),
            live_url: toUrlArray(args.live_url),
            supabase_url: toUrlArray(args.supabase_url),
            benchmark_url: toUrlArray(args.benchmark_url),
            learning_url: toUrlArray(args.learning_url),
          })
          .select()
          .single();
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
          github_url: urlArg.describe('통째로 교체됨(기존 값에 추가가 아님). 기존 값 유지하려면 list_sites로 먼저 확인 후 합쳐서 넘길 것'),
          vercel_url: urlArg,
          live_url: urlArg,
          supabase_url: urlArg,
          benchmark_url: urlArg.describe('통째로 교체됨. 여러 벤치마킹 URL을 유지하려면 배열로 전체를 넘길 것'),
          learning_url: urlArg.describe('통째로 교체됨. 제작법/학습 튜토리얼 URL — 여러 개 유지하려면 배열로 전체를 넘길 것'),
          notes: z.string().optional(),
          start_date: z.string().optional(),
          plan_content: z.string().optional().describe('계획서 본문(마크다운) 통째로 교체. 진행 기록에 이어붙이려면 먼저 list_sites로 기존 내용을 읽고 합쳐서 넘길 것.'),
          workflow_content: z
            .string()
            .optional()
            .describe(
              '워크플로우 본문(마크다운) 통째로 교체 — 계획서(plan_content)와는 별개 섹션. 이어붙이려면 먼저 list_sites로 기존 내용을 읽고 합쳐서 넘길 것. 파이프라인마다 각자 따로 두는 것이지 여러 파이프라인이 공유하는 문서가 아니다.'
            ),
        }),
      },
      async ({ id, ...fields }) => {
        const ARRAY_FIELDS = new Set(['github_url', 'vercel_url', 'live_url', 'supabase_url', 'benchmark_url', 'learning_url']);
        const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const [k, v] of Object.entries(fields)) {
          if (v === undefined) continue;
          update[k] = ARRAY_FIELDS.has(k) ? toUrlArray(v) : v;
        }
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase.from('hub_sites').update(update).eq('id', id).select().single();
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
      'list_benchmarks',
      {
        description: '벤치마킹할 아이템(깃허브/사이트/노션 등) 목록을 조회한다. 특정 사이트에 종속되지 않은 별도 수집함.',
        inputSchema: z.object({}),
      },
      async () => {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase.from('hub_benchmarks').select('*').order('sort_order').order('created_at');
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message} (hub_benchmarks 테이블이 없으면 _migration_5_benchmarks.sql 실행 필요)` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'add_benchmark',
      {
        description: '새 벤치마킹 아이템을 등록한다(깃허브 저장소, 사이트, 노션 페이지 등).',
        inputSchema: z.object({
          name: z.string().describe('아이템 이름'),
          url: z.string().describe('URL'),
          type: z.enum(['github', 'site', 'notion', 'other']).optional().describe('기본값 site'),
          status: z.string().optional().describe('후보/검토중/클론예정/완료/보류 중 하나, 기본값 후보'),
          notes: z.string().optional().describe('활용 방안, 눈여겨본 이유 등'),
          site_id: z.string().optional().describe('관련된 기존 프로젝트의 id(list_sites로 확인, 선택)'),
          source_name: z.string().optional().describe('이 아이템을 어디서 찾았는지(예: 유튜브 채널명)'),
          source_urls: urlArg.describe('출처 링크 하나 또는 여러 개(예: 유튜브 채널 + 블로그)'),
          kind: z.enum(['item', 'account_collection']).optional().describe('item=개별 아이템(기본), account_collection=실계정 여러 개를 모은 목록(별도 페이지에 표시됨)'),
        }),
      },
      async (args) => {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase
          .from('hub_benchmarks')
          .insert({ ...args, source_urls: toUrlArray(args.source_urls) })
          .select()
          .single();
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'update_benchmark',
      {
        description: '등록된 벤치마킹 아이템을 수정한다(id 기준, 넘긴 필드만 갱신).',
        inputSchema: z.object({
          id: z.string().describe('수정할 아이템의 id (list_benchmarks로 확인)'),
          name: z.string().optional(),
          url: z.string().optional(),
          type: z.enum(['github', 'site', 'notion', 'other']).optional(),
          status: z.string().optional(),
          notes: z.string().optional(),
          site_id: z.string().optional(),
          source_name: z.string().optional(),
          source_urls: urlArg,
          kind: z.enum(['item', 'account_collection']).optional(),
        }),
      },
      async ({ id, ...fields }) => {
        const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const [k, v] of Object.entries(fields)) {
          if (v === undefined) continue;
          update[k] = k === 'source_urls' ? toUrlArray(v) : v;
        }
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase.from('hub_benchmarks').update(update).eq('id', id).select().single();
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'delete_benchmark',
      { description: '벤치마킹 아이템을 삭제한다.', inputSchema: z.object({ id: z.string().describe('삭제할 아이템의 id') }) },
      async ({ id }) => {
        const supabase = getSupabaseServerClient();
        const { error } = await supabase.from('hub_benchmarks').delete().eq('id', id);
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: '삭제됨' }] };
      }
    );

    server.registerTool(
      'list_viral_posts',
      { description: '플랫폼별로 저장해둔 "터진 글"(실제 반응 좋았던 게시물 원문+반응수치+분석) 목록을 조회한다.', inputSchema: z.object({}) },
      async () => {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase.from('hub_viral_posts').select('*').order('sort_order').order('created_at');
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message} (hub_viral_posts 테이블이 없으면 _migration_9_viral_posts.sql 실행 필요)` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'add_viral_post',
      {
        description: '실제로 반응 좋았던 게시물을 원문+반응수치+왜 터졌는지 분석과 함께 저장한다.',
        inputSchema: z.object({
          platform: z.enum(['threads', 'instagram', 'tiktok', 'youtube']),
          account_name: z.string().describe('계정 이름/핸들'),
          post_url: z.string().optional(),
          content: z.string().describe('게시물 원문 그대로'),
          engagement: z.string().optional().describe('예: "967 좋아요 · 127댓글 · 45리포스트"'),
          analysis: z.string().optional().describe('첫 줄 훅 방식, 구조, 감정 트리거 등 왜 터졌는지'),
        }),
      },
      async (args) => {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase.from('hub_viral_posts').insert(args).select().single();
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'update_viral_post',
      {
        description: '저장된 터진 글 기록을 수정한다(id 기준, 넘긴 필드만 갱신).',
        inputSchema: z.object({
          id: z.string().describe('수정할 글의 id (list_viral_posts로 확인)'),
          platform: z.enum(['threads', 'instagram', 'tiktok', 'youtube']).optional(),
          account_name: z.string().optional(),
          post_url: z.string().optional(),
          content: z.string().optional(),
          engagement: z.string().optional(),
          analysis: z.string().optional(),
        }),
      },
      async ({ id, ...fields }) => {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase
          .from('hub_viral_posts')
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select()
          .single();
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'delete_viral_post',
      { description: '터진 글 기록을 삭제한다.', inputSchema: z.object({ id: z.string().describe('삭제할 글의 id') }) },
      async ({ id }) => {
        const supabase = getSupabaseServerClient();
        const { error } = await supabase.from('hub_viral_posts').delete().eq('id', id);
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: '삭제됨' }] };
      }
    );

    server.registerTool(
      'list_mcp_connectors',
      { description: 'Claude에 연결해둔 MCP 커넥터 목록을 조회한다.', inputSchema: z.object({}) },
      async () => {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase.from('hub_mcp_connectors').select('*').order('sort_order').order('created_at');
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message} (hub_mcp_connectors 테이블이 없으면 _migration_6_mcp_connectors.sql 실행 필요)` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'add_mcp_connector',
      {
        description: '새 MCP 커넥터 기록을 추가한다.',
        inputSchema: z.object({
          name: z.string().describe('커넥터 이름'),
          url: z.string().optional().describe('커넥터 접속 주소(?key= 포함)'),
          admin_email: z.string().optional().describe('관리 이메일(그룹핑용)'),
          tags: urlArg.describe('배지 태그(예: 웹, 데스크톱, 사용자정의)'),
          connected: z.boolean().optional().describe('기본값 true'),
          site_id: z.string().optional().describe('관련된 기존 프로젝트의 id(list_sites로 확인, 선택)'),
          notes: z.string().optional(),
        }),
      },
      async (args) => {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase
          .from('hub_mcp_connectors')
          .insert({ ...args, tags: toUrlArray(args.tags), connected: args.connected !== false })
          .select()
          .single();
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'update_mcp_connector',
      {
        description: '등록된 MCP 커넥터 기록을 수정한다(id 기준, 넘긴 필드만 갱신).',
        inputSchema: z.object({
          id: z.string().describe('수정할 커넥터의 id (list_mcp_connectors로 확인)'),
          name: z.string().optional(),
          url: z.string().optional(),
          admin_email: z.string().optional(),
          tags: urlArg,
          connected: z.boolean().optional(),
          site_id: z.string().optional(),
          notes: z.string().optional(),
        }),
      },
      async ({ id, ...fields }) => {
        const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const [k, v] of Object.entries(fields)) {
          if (v === undefined) continue;
          update[k] = k === 'tags' ? toUrlArray(v) : v;
        }
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase.from('hub_mcp_connectors').update(update).eq('id', id).select().single();
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'delete_mcp_connector',
      { description: 'MCP 커넥터 기록을 삭제한다.', inputSchema: z.object({ id: z.string().describe('삭제할 커넥터의 id') }) },
      async ({ id }) => {
        const supabase = getSupabaseServerClient();
        const { error } = await supabase.from('hub_mcp_connectors').delete().eq('id', id);
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: '삭제됨' }] };
      }
    );

    // ── 소스 발굴 & 콘텐츠 생성 (신규) ─────────────────────────────

    server.registerTool(
      'list_source_channels',
      {
        description: '소스 발굴용으로 등록된 채널 목록을 조회한다 (유튜브/틱톡/인스타/쓰레드/커뮤니티).',
        inputSchema: z.object({ platform: z.enum(['youtube', 'tiktok', 'instagram', 'threads', 'community']).optional() }),
      },
      async ({ platform }) => {
        const supabase = getSupabaseServerClient();
        let query = supabase.from('hub_source_channels').select('*').order('created_at', { ascending: false });
        if (platform) query = query.eq('platform', platform);
        const { data, error } = await query;
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'add_source_channel',
      {
        description: '새 소스 채널을 수동으로 등록한다. (링크만 있으면 import_source_url이 자동으로 채널까지 만들어주니, 이 툴은 채널 정보를 미리 세팅해두고 싶을 때 쓴다)',
        inputSchema: z.object({
          name: z.string().describe('채널명'),
          platform: z.enum(['youtube', 'tiktok', 'instagram', 'threads', 'community']).optional().describe('기본값 youtube'),
          url: z.string().optional(),
          subscriber_count: z.string().optional().describe('예: "5.2만"'),
          content_types: z.array(CONTENT_TYPE_ENUM).optional(),
          platform_fit: z.array(PLATFORM_ENUM).optional(),
          notes: z.string().optional(),
          status: z.string().optional().describe('후보/추적중/보류, 기본값 후보'),
        }),
      },
      async (args) => {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase
          .from('hub_source_channels')
          .insert({
            name: args.name,
            platform: args.platform || 'youtube',
            url: args.url || null,
            subscriber_count: args.subscriber_count || null,
            content_types: args.content_types || [],
            platform_fit: args.platform_fit || [],
            notes: args.notes || null,
            status: args.status || '후보',
          })
          .select()
          .single();
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'update_source_channel',
      {
        description: '등록된 소스 채널 정보를 수정한다(id 기준, 넘긴 필드만 갱신).',
        inputSchema: z.object({
          id: z.string().describe('list_source_channels로 확인'),
          name: z.string().optional(),
          platform: z.enum(['youtube', 'tiktok', 'instagram', 'threads', 'community']).optional(),
          url: z.string().optional(),
          subscriber_count: z.string().optional(),
          content_types: z.array(CONTENT_TYPE_ENUM).optional(),
          platform_fit: z.array(PLATFORM_ENUM).optional(),
          notes: z.string().optional(),
          status: z.string().optional(),
        }),
      },
      async ({ id, ...fields }) => {
        const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const [k, v] of Object.entries(fields)) if (v !== undefined) update[k] = v;
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase.from('hub_source_channels').update(update).eq('id', id).select().single();
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'delete_source_channel',
      { description: '소스 채널을 삭제한다 (연결된 소재는 유지됨).', inputSchema: z.object({ id: z.string() }) },
      async ({ id }) => {
        const supabase = getSupabaseServerClient();
        const { error } = await supabase.from('hub_source_channels').delete().eq('id', id);
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: '삭제됨' }] };
      }
    );

    server.registerTool(
      'list_source_items',
      {
        description: '등록된 소재 목록을 조회한다. status로 필터링 가능 (미가공/가공완료/발행완료).',
        inputSchema: z.object({
          status: z.string().optional(),
          channel_id: z.string().optional(),
        }),
      },
      async ({ status, channel_id }) => {
        const supabase = getSupabaseServerClient();
        let query = supabase.from('hub_source_items').select('*').order('created_at', { ascending: false });
        if (status) query = query.eq('status', status);
        if (channel_id) query = query.eq('channel_id', channel_id);
        const { data, error } = await query;
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'add_source_item',
      {
        description: '새 소재를 수동으로 등록한다. 링크만 있다면 import_source_url을 쓰는 게 더 빠르다(자동 분류까지 해줌).',
        inputSchema: z.object({
          channel_id: z.string().optional(),
          title: z.string(),
          source_url: z.string().optional(),
          thumbnail_url: z.string().optional().describe('썸네일 이미지 URL'),
          transcript: z.string().optional().describe('영상 대본/자막 전문 — 있으면 분석·대본작성 단계에서 그대로 활용'),
          views: z.string().optional(),
          content_type: CONTENT_TYPE_ENUM.optional(),
          platform_fit: z.array(PLATFORM_ENUM).optional(),
          raw_notes: z.string().optional().describe('원본 문장 그대로 X, 핵심 사실관계만 요약'),
          status: z.string().optional().describe('기본값 미가공'),
        }),
      },
      async (args) => {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase
          .from('hub_source_items')
          .insert({
            channel_id: args.channel_id || null,
            title: args.title,
            source_url: args.source_url || null,
            thumbnail_url: args.thumbnail_url || null,
            transcript: args.transcript || null,
            views: args.views || null,
            content_type: args.content_type || null,
            platform_fit: args.platform_fit || [],
            raw_notes: args.raw_notes || null,
            status: args.status || '미가공',
          })
          .select()
          .single();
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'update_source_item',
      {
        description: '등록된 소재를 수정한다(id 기준, 넘긴 필드만 갱신). 발행 완료 후 status를 "발행완료"로 갱신하는 용도로도 쓴다.',
        inputSchema: z.object({
          id: z.string().describe('list_source_items로 확인'),
          channel_id: z.string().optional(),
          title: z.string().optional(),
          source_url: z.string().optional(),
          thumbnail_url: z.string().optional(),
          transcript: z.string().optional().describe('영상 대본/자막 전문 통째로 교체'),
          views: z.string().optional(),
          content_type: CONTENT_TYPE_ENUM.optional(),
          platform_fit: z.array(PLATFORM_ENUM).optional(),
          raw_notes: z.string().optional(),
          status: z.string().optional(),
        }),
      },
      async ({ id, ...fields }) => {
        const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const [k, v] of Object.entries(fields)) if (v !== undefined) update[k] = v;
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase.from('hub_source_items').update(update).eq('id', id).select().single();
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'delete_source_item',
      { description: '소재를 삭제한다.', inputSchema: z.object({ id: z.string() }) },
      async ({ id }) => {
        const supabase = getSupabaseServerClient();
        const { error } = await supabase.from('hub_source_items').delete().eq('id', id);
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: '삭제됨' }] };
      }
    );

    server.registerTool(
      'import_source_url',
      {
        description:
          '링크(쓰레드/유튜브/틱톡/인스타 등) 하나를 던지면: 이미 등록된 소재인지 확인 → 없으면 og태그로 제목/설명 추출 → 채널 자동 매칭/생성 → AI가 content_type/platform_fit/사실관계 요약까지 자동 분류해서 등록한다. 소재를 발굴할 때 이 툴을 최우선으로 쓴다.',
        inputSchema: z.object({
          url: z.string().describe('가져올 게시물/영상 URL'),
          ai_provider: z.enum(['claude', 'gemini']).optional().describe('분류에 쓸 AI, 기본값 claude'),
        }),
      },
      async ({ url, ai_provider }) => {
        const provider = ai_provider === 'gemini' ? 'gemini' : 'claude';
        let hostname = '';
        try {
          hostname = new URL(url).hostname;
        } catch {
          return { content: [{ type: 'text', text: '올바른 URL 형식이 아닙니다.' }] };
        }

        const supabase = getSupabaseServerClient();
        const { data: existing } = await supabase.from('hub_source_items').select('*').eq('source_url', url).maybeSingle();
        if (existing) return { content: [{ type: 'text', text: `이미 등록됨: ${JSON.stringify(existing, null, 2)}` }] };

        let meta;
        try {
          meta = await fetchOgMeta(url);
        } catch (err) {
          return { content: [{ type: 'text', text: `페이지를 가져오지 못했습니다: ${err instanceof Error ? err.message : String(err)}` }] };
        }

        const channelPlatform = detectChannelPlatform(hostname);
        let channelId: string | null = null;
        if (meta.siteName && meta.siteName !== hostname) {
          const { data: matchedChannel } = await supabase
            .from('hub_source_channels')
            .select('id')
            .ilike('name', `%${meta.siteName}%`)
            .limit(1)
            .maybeSingle();
          if (matchedChannel) {
            channelId = matchedChannel.id;
          } else {
            const { data: newChannel } = await supabase
              .from('hub_source_channels')
              .insert({
                name: meta.siteName,
                platform: channelPlatform,
                url: `${new URL(url).protocol}//${hostname}`,
                content_types: [],
                platform_fit: [],
                status: '후보',
                notes: 'import_source_url로 자동 생성됨 — 정보 보강 필요',
              })
              .select('id')
              .single();
            channelId = newChannel?.id || null;
          }
        }

        const classifyPrompt = `
아래는 어떤 콘텐츠의 제목과 설명이다. 이 정보를 분석해서 JSON으로만 답해라.

제목: ${meta.title}
설명: ${meta.description || '(설명 없음)'}
출처 플랫폼: ${channelPlatform}

다음 형식으로만 출력해라:
{
  "content_type": "TRIVIA|LIFEHACK|EMOTIONAL|HUMOR|MOTIVATION|RANKING|PERSONAL_STORY|DEBATE 중 하나",
  "platform_fit": ["threads","youtube_shorts","tiktok","instagram" 중 이 소재에 잘 맞는 것들, 배열"],
  "raw_notes": "이 콘텐츠의 핵심 사실관계를 1~2문장으로 요약. 원문 표현을 그대로 옮기지 말고 완전히 새로운 문장으로 작성."
}
`.trim();

        let classification = { content_type: 'TRIVIA', platform_fit: ['youtube_shorts'] as string[], raw_notes: meta.description || meta.title };
        try {
          const raw = await callAi(provider, '너는 콘텐츠 분류 전문가다. 반드시 JSON만 출력한다.', classifyPrompt);
          const cleaned = raw.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
          const parsed = JSON.parse(cleaned);
          classification = {
            content_type: CONTENT_TYPES.includes(parsed.content_type) ? parsed.content_type : 'TRIVIA',
            platform_fit: Array.isArray(parsed.platform_fit) ? parsed.platform_fit.filter((p: string) => PLATFORM_VALUES.includes(p)) : [],
            raw_notes: typeof parsed.raw_notes === 'string' ? parsed.raw_notes : meta.description,
          };
        } catch {
          // AI 분류 실패해도 기본값으로 저장 진행
        }

        const { data: item, error } = await supabase
          .from('hub_source_items')
          .insert({
            channel_id: channelId,
            title: meta.title,
            source_url: url,
            thumbnail_url: meta.image,
            content_type: classification.content_type,
            platform_fit: classification.platform_fit,
            raw_notes: classification.raw_notes,
            status: '미가공',
          })
          .select()
          .single();
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify({ channel_created: !!channelId, item }, null, 2) }] };
      }
    );

    server.registerTool(
      'search_youtube_channels',
      {
        description:
          '키워드로 유튜브 쇼츠를 검색해서(최근 업로드, 조회수 기준) 채널당 1개씩만 추린다. ' +
          '워크플로우 페이지의 "🔍 채널 찾기" 버튼과 같은 기능 — 1번(채널 발굴) 단계에서 쓴다.',
        inputSchema: z.object({
          query: z.string().describe('검색어 (예: 건축 상식, 심리 실험)'),
          uploadWithinDays: z.number().optional().describe('최근 며칠 이내 업로드만 (기본 14일)'),
          maxSubscribers: z.number().optional().describe('이 구독자 수 이하 채널만'),
          minViews: z.number().optional().describe('이 조회수 이상만 (기본 10000)'),
        }),
      },
      async ({ query, uploadWithinDays, maxSubscribers, minViews }) => {
        try {
          const results = await searchShorts({ query, uploadWithinDays, maxSubscribers, minViews });
          const text = results
            .map((r) => `- "${r.title}" | 채널: ${r.channelTitle}(구독자 ${fmtCount(r.subscriberCount)}명) | 조회수 ${fmtCount(r.views)} | ${r.channelUrl} | ${r.url}`)
            .join('\n');
          return { content: [{ type: 'text', text: `${results.length}개 채널 발견:\n\n${text}` }] };
        } catch (err) {
          return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }] };
        }
      }
    );

    server.registerTool(
      'get_channel_top_videos',
      {
        description:
          '채널 URL/핸들/ID 하나를 지정해서 그 채널의 조회수 상위 영상을 가져온다. ' +
          '워크플로우 페이지의 "📥 채널별 인기 영상 가져오기"와 같은 기능 — 2번(채널별 소재 수집) 단계에서 쓴다.',
        inputSchema: z.object({
          channelUrl: z.string().describe('채널 URL(youtube.com/@handle, /channel/UC..., /c/..., /user/...) 또는 채널ID/핸들'),
          maxResults: z.number().optional().describe('가져올 영상 수 (기본 10)'),
        }),
      },
      async ({ channelUrl, maxResults }) => {
        try {
          const channelId = await resolveChannelId(channelUrl);
          const results = await getChannelTopVideos({ channelId, maxResults });
          const text = results.map((r) => `- "${r.title}" | 조회수 ${fmtCount(r.views)} | ${r.url}`).join('\n');
          return { content: [{ type: 'text', text: `${results.length}개 영상:\n\n${text}` }] };
        } catch (err) {
          return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }] };
        }
      }
    );

    server.registerTool(
      'get_pipeline_materials_for_analysis',
      {
        description:
          '워크플로우 4번(분석) 단계용 — 파이프라인 이름으로 그 파이프라인의 2번(제목/썸네일/조회수)·3번(대본)에서 ' +
          '모은 소재 원본 데이터를 가져온다. 이 웹앱은 유료 API로 직접 분석하지 않으므로, 이 툴로 데이터를 받아서 ' +
          'Claude(이 대화)가 직접 제목/썸네일(이미지 URL 보고)/대본의 공통 패턴을 분석한 뒤, ' +
          'save_pipeline_analysis 툴로 그 결과를 저장해준다.',
        inputSchema: z.object({
          site_name: z.string().describe('파이프라인 이름 (예: 공학, 경제학)'),
          limit: z.number().optional().describe('조회수 상위 몇 개까지 볼지 (기본 15)'),
        }),
      },
      async ({ site_name, limit }) => {
        const supabase = getSupabaseServerClient();
        const { data: channelsData } = await supabase.from('hub_source_channels').select('id, name, url, subscriber_count, notes');
        const tagRe = /^\[파이프라인:([^\]]+)\]\s*/;
        const mineChannels = (channelsData || []).filter((c) => c.notes?.match(tagRe)?.[1] === site_name);
        const mineChannelIds = mineChannels.map((c) => c.id);
        if (mineChannelIds.length === 0) {
          return { content: [{ type: 'text', text: `"${site_name}" 파이프라인에 등록된 채널이 없습니다.` }] };
        }
        const channelLines = mineChannels
          .map((c) => `- ${c.name} | 구독자 ${c.subscriber_count || '?'} | ${c.url || ''} | ${(c.notes || '').replace(tagRe, '') || ''}`)
          .join('\n');

        const { data: itemsData, error } = await supabase
          .from('hub_source_items')
          .select('title, thumbnail_url, transcript, duration_seconds, views')
          .in('channel_id', mineChannelIds);
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };

        const items = itemsData || [];
        if (items.length === 0) return { content: [{ type: 'text', text: `"${site_name}"에 등록된 소재가 없습니다.` }] };

        // 대본이 있는 소재만 분석 대상으로 쓴다 — 사용자가 직접 확인·저장한 것만 신뢰할 수 있어서다.
        const withTranscript = items.filter((i) => i.transcript && i.transcript.trim().length > 20);
        if (withTranscript.length === 0) {
          return { content: [{ type: 'text', text: `"${site_name}"에 대본이 등록된 소재가 아직 없습니다. 3번 단계에서 대본을 먼저 채워주세요.` }] };
        }

        function parseViews(label: string | null): number {
          const m = (label || '').match(/([\d.]+)\s*(억|만|천)?/);
          if (!m) return 0;
          const n = parseFloat(m[1]);
          return m[2] === '억' ? n * 1e8 : m[2] === '만' ? n * 1e4 : m[2] === '천' ? n * 1e3 : n;
        }
        const top = [...withTranscript].sort((a, b) => parseViews(b.views) - parseViews(a.views)).slice(0, limit || 15);

        const durations = items.map((i) => i.duration_seconds).filter((n): n is number => !!n);
        const paces = items.filter((i) => i.transcript && i.duration_seconds).map((i) => i.transcript!.length / i.duration_seconds!);

        const lines = top.map((i, idx) => {
          const parts = [`[${idx + 1}] "${i.title}"`, `조회수 ${i.views || '?'}`];
          if (i.duration_seconds) parts.push(`길이 ${Math.floor(i.duration_seconds / 60)}:${String(i.duration_seconds % 60).padStart(2, '0')}`);
          if (i.thumbnail_url) parts.push(`썸네일: ${i.thumbnail_url}`);
          let line = parts.join(' | ');
          if (i.transcript && i.transcript.trim().length > 20) line += `\n  대본: ${i.transcript.slice(0, 800)}`;
          return line;
        });

        const statsText = [
          durations.length > 0
            ? `길이 통계(${durations.length}개): 평균 ${Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)}초, 범위 ${Math.min(...durations)}~${Math.max(...durations)}초`
            : '길이 데이터 없음',
          paces.length > 0
            ? `나레이션 속도(${paces.length}개, 대본자수÷길이초): 평균 초당 ${(paces.reduce((a, b) => a + b, 0) / paces.length).toFixed(1)}자`
            : '속도 계산 가능한 소재(대본+길이 둘 다 있는 것) 없음',
        ].join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `벤치마크 채널 ${mineChannels.length}개:\n\n${channelLines}\n\n---\n\n"${site_name}" 대본까지 확보된 것 중 조회수 상위 ${top.length}개 (전체 ${items.length}개 중 대본 있는 건 ${withTranscript.length}개):\n\n${lines.join('\n\n')}\n\n--- 계산된 통계 (참고용, 그대로 저장해도 됨) ---\n${statsText}`,
            },
          ],
        };
      }
    );

    server.registerTool(
      'save_pipeline_analysis',
      {
        description:
          'get_pipeline_materials_for_analysis로 받은 데이터를 Claude(이 대화)가 직접 분석한 결과를 저장한다. ' +
          '워크플로우 페이지 4번 탭(채널/제목/썸네일/대본/시간/속도)에 그대로 표시된다. 넘긴 필드만 갱신되고 나머지는 유지된다.',
        inputSchema: z.object({
          site_id: z.string().describe('파이프라인의 hub_sites id (list_sites로 확인)'),
          channel: z.string().optional().describe('채널 패턴 분석 결과 (작명/구독자 규모대/포지셔닝)'),
          title: z.string().optional().describe('제목 패턴 분석 결과'),
          thumbnail: z.string().optional().describe('썸네일 패턴 분석 결과 (이미지 URL을 직접 보고 분석)'),
          script: z.string().optional().describe('대본 패턴 분석 결과'),
          duration: z.string().optional().describe('영상 길이 분석/통계 정리'),
          pace: z.string().optional().describe('나레이션 속도 분석/통계 정리'),
        }),
      },
      async ({ site_id, channel, title, thumbnail, script, duration, pace }) => {
        const supabase = getSupabaseServerClient();
        const { data: existing } = await supabase.from('hub_sites').select('analysis_result').eq('id', site_id).maybeSingle();
        const merged = {
          ...(existing?.analysis_result || {}),
          ...(channel !== undefined && { channel }),
          ...(title !== undefined && { title }),
          ...(thumbnail !== undefined && { thumbnail }),
          ...(script !== undefined && { script }),
          ...(duration !== undefined && { duration }),
          ...(pace !== undefined && { pace }),
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabase.from('hub_sites').update({ analysis_result: merged, updated_at: new Date().toISOString() }).eq('id', site_id);
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: 'OK — 저장됨' }] };
      }
    );

    server.registerTool(
      'list_personas',
      {
        description: '콘텐츠 생성에 쓸 수 있는 페르소나 목록을 조회한다 (유쓰레드의 ut_personas + 기본 제공 ut_system_personas를 합쳐서 반환).',
        inputSchema: z.object({}),
      },
      async () => {
        const supabase = getSupabaseServerClient();
        const [{ data: personas }, { data: systemPersonas }] = await Promise.all([
          supabase.from('ut_personas').select('id, name, tone_prompt, target_prompt').order('created_at', { ascending: false }),
          supabase.from('ut_system_personas').select('id, name, prompt').order('sort_order'),
        ]);
        const combined = [
          ...(personas || []).map((p) => ({ ...p, is_system: false })),
          ...(systemPersonas || []).map((p) => ({ id: p.id, name: `${p.name} (기본)`, tone_prompt: p.prompt, target_prompt: '', is_system: true })),
        ];
        return { content: [{ type: 'text', text: JSON.stringify(combined, null, 2) }] };
      }
    );

    server.registerTool(
      'generate_content',
      {
        description:
          '소재(source_item_id) 또는 직접 입력한 주제(manual_topic)를, 선택한 페르소나 톤과 타겟 플랫폼 포맷 규칙에 맞춰 AI로 콘텐츠를 생성하고 저장한다.',
        inputSchema: z.object({
          source_item_id: z.string().optional().describe('list_source_items로 확인한 소재 id'),
          manual_topic: z.string().optional().describe('source_item_id 없이 직접 주제를 줄 때'),
          persona_id: z.string().describe('list_personas로 확인한 페르소나 id'),
          persona_is_system: z.boolean().optional().describe('list_personas 결과의 is_system 값을 그대로 넣을 것'),
          target_platform: PLATFORM_ENUM,
          ai_provider: z.enum(['claude', 'gemini']).optional().describe('기본값 claude'),
        }),
      },
      async ({ source_item_id, manual_topic, persona_id, persona_is_system, target_platform, ai_provider }) => {
        if (!source_item_id && !manual_topic?.trim()) {
          return { content: [{ type: 'text', text: 'source_item_id 또는 manual_topic 중 하나가 필요합니다.' }] };
        }
        const provider = ai_provider === 'gemini' ? 'gemini' : 'claude';
        const supabase = getSupabaseServerClient();

        let persona: { name: string; tone_prompt: string; target_prompt: string } | null = null;
        if (persona_is_system) {
          const { data, error } = await supabase.from('ut_system_personas').select('*').eq('id', persona_id).single();
          if (error || !data) return { content: [{ type: 'text', text: '페르소나를 찾을 수 없습니다.' }] };
          persona = { name: data.name, tone_prompt: data.prompt, target_prompt: '' };
        } else {
          const { data, error } = await supabase.from('ut_personas').select('*').eq('id', persona_id).single();
          if (error || !data) return { content: [{ type: 'text', text: '페르소나를 찾을 수 없습니다.' }] };
          persona = { name: data.name, tone_prompt: data.tone_prompt, target_prompt: data.target_prompt };
        }

        let topicText = manual_topic?.trim() || '';
        let sourceItemId: string | null = null;
        if (source_item_id) {
          const { data: item, error: itemError } = await supabase.from('hub_source_items').select('*').eq('id', source_item_id).single();
          if (itemError || !item) return { content: [{ type: 'text', text: '소재를 찾을 수 없습니다.' }] };
          sourceItemId = item.id;
          topicText = `제목: ${item.title}\n요약/사실관계: ${item.raw_notes || '(추가 메모 없음, 제목 기반으로 작성)'}`;
        }

        const systemPrompt = `
너는 아래 페르소나로 글을 쓰는 콘텐츠 작가다.

[페르소나 톤]
${persona.tone_prompt || ''}

[타겟/추가 지침]
${persona.target_prompt || ''}

${PLATFORM_GUIDE[target_platform]}

[중요 - 저작권 주의]
- 아래 소재는 사실관계만 참고하고, 원본 영상/기사의 문장을 그대로 옮기지 마라.
- 완전히 새로운 표현과 구조로 재작성해라.

결과는 JSON으로만 출력해라: {"content": "..."}
`.trim();

        let generatedText = '';
        try {
          generatedText = await callAi(provider, systemPrompt, `다음 소재로 글을 작성해줘.\n\n${topicText}`);
        } catch (err) {
          return { content: [{ type: 'text', text: `AI 생성 실패: ${err instanceof Error ? err.message : String(err)}` }] };
        }
        try {
          const cleaned = generatedText.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
          const parsed = JSON.parse(cleaned);
          if (parsed?.content) generatedText = parsed.content;
        } catch {
          // JSON 아니면 그대로 사용
        }

        const { data: saved, error: saveError } = await supabase
          .from('hub_generated_content')
          .insert({
            source_item_id: sourceItemId,
            persona_id,
            persona_name: persona.name,
            target_platform,
            ai_provider: provider,
            generated_text: generatedText.trim(),
            status: 'draft',
          })
          .select()
          .single();
        if (saveError) return { content: [{ type: 'text', text: `에러: ${saveError.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(saved, null, 2) }] };
      }
    );

    server.registerTool(
      'list_generated_content',
      { description: '생성된 콘텐츠 목록을 조회한다.', inputSchema: z.object({ limit: z.number().optional().describe('기본 50') }) },
      async ({ limit }) => {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase
          .from('hub_generated_content')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit || 50);
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'save_unit_scene_prompts',
      {
        description:
          '5번(대본 작성) 완성 콘텐츠 목록(script_draft.units)의 특정 유닛 하나에 6번(이미지/영상 생성) 장면별 프롬프트 전문을 저장한다. ' +
          '워크플로우 문서(workflow_content)는 파이프라인 전체가 공유하는 문서라 특정 에피소드 전용 프롬프트를 적을 곳이 아니다 — ' +
          '반드시 이 툴로 해당 유닛에 붙여야 5번 탭에서 그 콘텐츠와 함께 보인다.',
        inputSchema: z.object({
          site_id: z.string().describe('파이프라인의 hub_sites id (list_sites로 확인)'),
          unit_id: z.string().describe('script_draft.units 안의 유닛 id (list_sites 결과의 script_draft.units 참고)'),
          scenePrompts: z.string().describe('장면별 CLEAN/INFO/영상 프롬프트 전문(마크다운/텍스트, 통째로 교체됨)'),
        }),
      },
      async ({ site_id, unit_id, scenePrompts }) => {
        const supabase = getSupabaseServerClient();
        const { data: siteRow, error: fetchErr } = await supabase.from('hub_sites').select('script_draft').eq('id', site_id).single();
        if (fetchErr) return { content: [{ type: 'text', text: `에러: ${fetchErr.message}` }] };
        const draft = siteRow?.script_draft || {};
        const units = Array.isArray(draft.units) ? draft.units : [];
        const idx = units.findIndex((u) => u.id === unit_id);
        if (idx === -1) return { content: [{ type: 'text', text: `해당 unit_id(${unit_id})를 찾을 수 없습니다.` }] };
        const nextUnits = units.slice();
        nextUnits[idx] = { ...nextUnits[idx], scenePrompts };
        const { error } = await supabase
          .from('hub_sites')
          .update({ script_draft: { ...draft, units: nextUnits }, updated_at: new Date().toISOString() })
          .eq('id', site_id);
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: 'OK — 저장됨' }] };
      }
    );

    // ── 범용 유틸 (기존) ─────────────────────────────

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

    server.registerTool(
      'push_github_file',
      {
        description:
          'HongHub GitHub 저장소(mintimjang33/HongHub)에 파일 하나를 생성/수정해서 바로 커밋+푸시한다. app_config 테이블(또는 GITHUB_TOKEN 환경변수)에 해당 저장소 쓰기 권한이 있는 GitHub PAT이 GITHUB_TOKEN 키로 저장되어 있어야 동작한다. content는 파일 일부가 아니라 전체 내용이어야 한다(부분 수정이면 먼저 get_github_file로 전체를 읽고 수정한 뒤 통째로 넘길 것). 텍스트 파일 전용이다 — content가 UTF-8 텍스트로 그대로 인코딩돼서 커밋되므로, 이미지 등 바이너리 파일에는 쓰면 안 된다(그러면 깨진 파일이 됨). 이미지는 upload_image를 쓸 것.',
        inputSchema: z.object({
          path: z.string().describe('예: app/page.tsx'),
          content: z.string().describe('파일의 전체 새 내용'),
          message: z.string().describe('커밋 메시지'),
          branch: z.string().optional().describe('기본값 main'),
        }),
      },
      async ({ path, content, message, branch }) => {
        const token = await getConfigValue('GITHUB_TOKEN');
        if (!token) {
          return {
            content: [
              {
                type: 'text',
                text: 'GITHUB_TOKEN이 설정되어 있지 않습니다. mintimjang33/HongHub 저장소에 쓰기 권한이 있는 GitHub Personal Access Token을 app_config 테이블에 key=GITHUB_TOKEN으로 추가하거나 배포 환경변수로 추가한 뒤 다시 시도해주세요.',
              },
            ],
          };
        }
        const ref = branch || 'main';
        const apiUrl = `https://api.github.com/repos/mintimjang33/HongHub/contents/${path}`;
        const headers = {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        };

        let sha: string | undefined;
        const existing = await fetch(`${apiUrl}?ref=${ref}`, { headers });
        if (existing.ok) {
          const existingJson = await existing.json();
          sha = existingJson.sha;
        }

        const res = await fetch(apiUrl, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            message,
            content: Buffer.from(content, 'utf-8').toString('base64'),
            branch: ref,
            ...(sha ? { sha } : {}),
          }),
        });
        const json = await res.json();
        if (!res.ok) return { content: [{ type: 'text', text: `에러: ${JSON.stringify(json)}` }] };
        const commitSha = json.commit?.sha ? String(json.commit.sha).slice(0, 7) : '?';
        return {
          content: [
            {
              type: 'text',
              text: `커밋 완료 (${commitSha}): https://github.com/mintimjang33/HongHub/blob/${ref}/${path}`,
            },
          ],
        };
      }
    );

    server.registerTool(
      'upload_image',
      {
        description:
          '이미지(base64)를 honghub-files Storage 버킷에 실제 바이너리로 업로드하고 공개 URL을 반환한다. push_github_file은 텍스트 파일 전용이라 이미지를 못 다루니(base64 문자열이 그대로 텍스트로 커밋되어 깨진 파일이 됨), 스크린샷처럼 어떤 기능의 유일한 근거가 되는 이미지는 이 도구로 실제 파일까지 저장하고 계획서(plan_content)에 마크다운 이미지 링크로 남길 것.',
        inputSchema: z.object({
          imageBase64: z.string().describe('base64로 인코딩된 이미지 데이터 (data:image/png;base64, 같은 접두사 없이 순수 base64 문자열만)'),
          filename: z.string().optional().describe('원본 파일명(확장자 추출용, 예: screenshot.png). 없으면 png로 저장'),
        }),
      },
      async ({ imageBase64, filename }) => {
        const supabase = getSupabaseServerClient();
        const ext = ((filename || '').split('.').pop() || 'png').toLowerCase();
        const path = `${crypto.randomUUID()}.${ext}`;
        const CONTENT_TYPE_MAP: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
        const contentType = CONTENT_TYPE_MAP[ext] || 'image/png';

        let buffer: Buffer;
        try {
          buffer = Buffer.from(imageBase64, 'base64');
        } catch {
          return { content: [{ type: 'text', text: 'imageBase64를 디코딩하지 못했습니다.' }] };
        }
        if (buffer.length === 0) return { content: [{ type: 'text', text: 'imageBase64가 비어있습니다.' }] };

        const { error } = await supabase.storage.from('honghub-files').upload(path, buffer, { contentType });
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };

        const { data } = supabase.storage.from('honghub-files').getPublicUrl(path);
        return { content: [{ type: 'text', text: JSON.stringify({ url: data.publicUrl }, null, 2) }] };
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
