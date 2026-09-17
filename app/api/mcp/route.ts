import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { callAi } from '../../../lib/aiProviders';
import { fetchOgMeta, detectChannelPlatform } from '../../../lib/ogMeta';
import { getConfigValue } from '../../../lib/remoteConfig';
import { searchShorts, resolveChannelId, getChannelTopVideos, fmtCount } from '../../../lib/youtubeSearch';
import { parseClipPositions, setClipPosition, setClipTrack, setClipRange, fetchAndUpload } from '../../../lib/mltClipPosition';

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
          progress_log: z
            .string()
            .optional()
            .describe(
              '진행 로그(실측·시행착오 기반 의사결정 기록) 통째로 교체 — plan_content(사전 기획서)와는 별개 필드. 새 로그는 이어붙이려면 먼저 list_sites로 기존 내용을 읽고 합쳐서 넘길 것.'
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

    // 2026-09-17 신설 — 사용자 지적: "15단계 설명서등록이 안된다고? ... db로 직접 수정했나?".
    // 워크플로우 페이지 StepDocSection(app/workflow/[id]/components/shared.tsx)의 "+ 설명서
    // 등록" 기능이 analysis_result.stepDocs[단계번호]를 PATCH /api/sites/[id]로 저장하는데,
    // 이건 로그인 쿠키가 있어야 하는 일반 웹 API라 MCP(로그인 세션 없음)로는 못 건드렸다.
    // [[feedback_add_mcp_with_feature]] 원칙대로 새 기능엔 항상 MCP 짝을 만들어야 하는데
    // 이 기능만 빠져있었던 것 — 이제 채워넣는다. 클라이언트가 하듯 기존 stepDocs를 먼저 읽어와
    // 병합한 뒤 analysis_result 전체를 다시 쓴다(PATCH 라우트가 analysis_result를 부분 병합이
    // 아니라 통째로 교체하기 때문).
    server.registerTool(
      'save_step_doc',
      {
        description:
          '워크플로우 페이지의 특정 단계에 등록되는 "설명서"(analysis_result.stepDocs[단계번호])를 저장하거나 삭제한다. FlowChart의 각 단계 카드 안 StepDocSection에 그대로 표시됨 — 웹 UI의 "+ 설명서 등록" 버튼과 동일한 동작.',
        inputSchema: z.object({
          site_id: z.string().describe('사이트(파이프라인)의 hub_sites id (list_sites로 확인)'),
          step: z.union([z.string(), z.number()]).describe('설명서를 등록/삭제할 단계 번호(그 파이프라인 workflow_content의 번호, 예: 15)'),
          content: z.string().optional().describe('설명서 본문(마크다운 가능). delete:true가 아니면 필수.'),
          delete: z.boolean().optional().describe('true면 해당 단계의 설명서를 삭제한다(content는 무시)'),
        }),
      },
      async ({ site_id, step, content, delete: doDelete }) => {
        const supabase = getSupabaseServerClient();
        const { data: existing, error: fetchError } = await supabase
          .from('hub_sites')
          .select('analysis_result')
          .eq('id', site_id)
          .maybeSingle();
        if (fetchError) return { content: [{ type: 'text', text: `에러: ${fetchError.message}` }] };
        if (!existing) return { content: [{ type: 'text', text: '해당 site_id를 찾을 수 없습니다.' }] };

        const stepKey = String(step);
        const stepDocs: Record<string, string> = { ...(existing.analysis_result?.stepDocs || {}) };
        if (doDelete) {
          delete stepDocs[stepKey];
        } else {
          if (!content) return { content: [{ type: 'text', text: 'content가 필요합니다(삭제하려면 delete:true를 넘길 것).' }] };
          stepDocs[stepKey] = content;
        }
        const nextAnalysisResult = { ...(existing.analysis_result || {}), stepDocs };

        const { data, error } = await supabase
          .from('hub_sites')
          .update({ analysis_result: nextAnalysisResult, updated_at: new Date().toISOString() })
          .eq('id', site_id)
          .select('id, analysis_result')
          .single();
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify({ id: data.id, stepDocs: data.analysis_result?.stepDocs }, null, 2) }] };
      }
    );

    server.registerTool(
      'update_script_draft',
      {
        description:
          '사이트의 script_draft(대본+씬별 스토리보드 프롬프트가 담긴 JSON, units 배열 구조)를 통째로 교체한다. update_site로는 이 필드를 못 건드려서 별도로 만든 도구. ' +
          '⚠️ 대본은 units[].script, 씬별 프롬프트(시간/장면이미지/이미지프롬프트/영상·전환프롬프트)는 units[].scenePrompts에 저장한다(2026-09-07, 여러 파이프라인이 5~20번 구조로 통일된 이후 명칭) — 정확한 단계 번호는 파이프라인마다 다를 수 있으니 항상 그 파이프라인의 workflow_content를 먼저 확인할 것.',
        inputSchema: z.object({
          id: z.string().describe('사이트 id (list_sites로 확인)'),
          script_draft: z
            .string()
            .describe(
              'script_draft 전체를 JSON 문자열로 넘긴다. 기존 구조(units 배열 등)를 유지하려면 먼저 list_sites로 현재 값을 읽고, 필요한 부분만 고친 뒤 전체 객체를 다시 JSON.stringify해서 넘길 것.'
            ),
        }),
      },
      async ({ id, script_draft }) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(script_draft);
        } catch (e) {
          return { content: [{ type: 'text', text: `JSON 파싱 에러: ${(e as Error).message}` }] };
        }
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase
          .from('hub_sites')
          .update({ script_draft: parsed, updated_at: new Date().toISOString() })
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
          '워크플로우 4번(분석) 단계용 — 파이프라인 이름으로 그 파이프라인의 2번(제목/썸네일/조회수)·3번(대본/댓글)에서 ' +
          '모은 소재 원본 데이터를 가져온다. 이 웹앱은 유료 API로 직접 분석하지 않으므로, 이 툴로 데이터를 받아서 ' +
          'Claude(이 대화)가 직접 제목/썸네일(이미지 URL 보고)/대본/댓글(시청자 반응)의 공통 패턴을 분석한 뒤, ' +
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
          .select('title, thumbnail_url, transcript, duration_seconds, views, comment_count, top_comments')
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
          const topComments = i.top_comments as { author: string; text: string; likeCount: number }[] | null;
          if (topComments && topComments.length > 0) {
            const commentLines = topComments
              .slice(0, 10)
              .map((c) => `    - (👍${c.likeCount}) ${c.text.replace(/\s+/g, ' ').slice(0, 200)}`)
              .join('\n');
            line += `\n  댓글(${i.comment_count ?? '?'}개 중 상위):\n${commentLines}`;
          }
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
          '워크플로우 페이지 4번 탭(채널/제목/썸네일/대본/댓글/시간/속도)에 그대로 표시된다. 넘긴 필드만 갱신되고 나머지는 유지된다.',
        inputSchema: z.object({
          site_id: z.string().describe('파이프라인의 hub_sites id (list_sites로 확인)'),
          channel: z.string().optional().describe('채널 패턴 분석 결과 (작명/구독자 규모대/포지셔닝)'),
          title: z.string().optional().describe('제목 패턴 분석 결과'),
          thumbnail: z.string().optional().describe('썸네일 패턴 분석 결과 (이미지 URL을 직접 보고 분석)'),
          script: z.string().optional().describe('대본 패턴 분석 결과'),
          comment: z.string().optional().describe('댓글(시청자 반응) 패턴 분석 결과 — 공감/반박 포인트, 자주 나오는 질문·불만 등'),
          duration: z.string().optional().describe('영상 길이 분석/통계 정리'),
          pace: z.string().optional().describe('나레이션 속도 분석/통계 정리'),
        }),
      },
      async ({ site_id, channel, title, thumbnail, script, comment, duration, pace }) => {
        const supabase = getSupabaseServerClient();
        const { data: existing } = await supabase.from('hub_sites').select('analysis_result').eq('id', site_id).maybeSingle();
        const merged = {
          ...(existing?.analysis_result || {}),
          ...(channel !== undefined && { channel }),
          ...(title !== undefined && { title }),
          ...(thumbnail !== undefined && { thumbnail }),
          ...(script !== undefined && { script }),
          ...(comment !== undefined && { comment }),
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
          '대본 작성 완성 콘텐츠 목록(script_draft.units)의 특정 유닛 하나에 씬별(스토리보드) 프롬프트 전문을 저장한다. ' +
          '워크플로우 문서(workflow_content)는 파이프라인 전체가 공유하는 문서라 특정 에피소드 전용 프롬프트를 적을 곳이 아니다 — ' +
          '반드시 이 툴로 해당 유닛에 붙여야 앱의 스토리보드 탭(타임/장면이미지/이미지프롬프트/영상·전환프롬프트 표)에서 그 콘텐츠와 함께 보인다. ' +
          '⚠️ "대본 작성"과 "씬별 이미지·영상 생성"의 정확한 단계 번호는 파이프라인마다 다를 수 있으니(2026-09-07 여러 파이프라인이 5~20번 구조로 통일됐지만 진행 상태·예외가 파이프라인마다 있음) 항상 그 파이프라인의 workflow_content를 먼저 확인할 것 — 번호를 가정하지 말 것.',
        inputSchema: z.object({
          site_id: z.string().describe('파이프라인의 hub_sites id (list_sites로 확인)'),
          unit_id: z.string().describe('script_draft.units 안의 유닛 id (list_sites 결과의 script_draft.units 참고)'),
          scenePrompts: z
            .string()
            .describe(
              '장면별 스토리보드 프롬프트 전문(마크다운/텍스트, 통째로 교체됨). 각 장면은 "### 장면ID 제목" 헤더로 시작하고, 그 아래 다음 줄들을 필요한 것만 선택적으로 붙인다: ' +
                '"대본: ..."(그 장면의 대본 문장), "- 시간: 0:00-0:07"(타임코드), "- 장면이미지: https://..."(생성된 이미지 URL), ' +
                '"- 이미지프롬프트: ..."(현재 표준 — 이 장면 이미지를 생성할 때 쓴/쓸 프롬프트), "- 영상: ..."(영상프롬프트 or 전환프롬프트 — 이 장면을 영상 클립으로 만들거나 다음 장면으로 넘어가는 연출), ' +
                '"- 자료: https://..."(첨부 URL, 여러 줄 가능). "- CLEAN: ..."/"- INFO: ..."는 구버전(이미지 2장 방식) 필드로 지금은 "이미지프롬프트" 하나만 쓰면 된다.'
            ),
        }),
      },
      async ({ site_id, unit_id, scenePrompts }) => {
        const supabase = getSupabaseServerClient();
        const { data: siteRow, error: fetchErr } = await supabase.from('hub_sites').select('script_draft').eq('id', site_id).single();
        if (fetchErr) return { content: [{ type: 'text', text: `에러: ${fetchErr.message}` }] };
        const draft = siteRow?.script_draft || {};
        const units = Array.isArray(draft.units) ? draft.units : [];
        const idx = units.findIndex((u: { id: string }) => u.id === unit_id);
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

    // ── PD(오케스트레이터) 지침 (신규) ─────────────────────────────

    server.registerTool(
      'get_system_prompt',
      {
        description:
          'HongHub 유튜브 콘텐츠 파이프라인(공학/경제학/심리학 등) 작업을 시작할 때 가장 먼저 호출한다. ' +
          'PD(오케스트레이터) 역할을 어떻게 수행하는지가 여기 저장돼 있다 — 이 내용을 읽고 그대로 행동할 것. ' +
          '어느 PC/기기에서 접속하든 이 도구 하나로 항상 최신 지침을 불러올 수 있다(로컬 스킬 파일에 의존하지 않음). ' +
          '지침은 update_system_prompt로 갱신할 수 있다.',
        inputSchema: z.object({}),
      },
      async () => {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase.from('app_config').select('value').eq('key', 'HONGHUB_PD_SYSTEM_PROMPT').maybeSingle();
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return {
          content: [
            {
              type: 'text',
              text: data?.value || '(아직 PD 지침이 등록되지 않았습니다. update_system_prompt로 등록해주세요.)',
            },
          ],
        };
      }
    );

    server.registerTool(
      'update_system_prompt',
      {
        description:
          'HongHub PD(오케스트레이터) 행동 지침 전체를 교체 저장한다(통째로 교체). ' +
          'get_system_prompt가 반환하는 내용이 이걸로 갱신된다 — 이어붙이려면 먼저 get_system_prompt로 기존 내용을 읽고 합쳐서 넘길 것.',
        inputSchema: z.object({
          value: z.string().describe('저장할 지침 전문(마크다운/텍스트)'),
        }),
      },
      async ({ value }) => {
        const supabase = getSupabaseServerClient();
        const { error } = await supabase
          .from('app_config')
          .upsert({ key: 'HONGHUB_PD_SYSTEM_PROMPT', value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
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

    // 2026-09-17 신설 — 사용자 지적: "기능 추가하면 mcp를 같이 추가하게끔 하라고 했는데" —
    // 14번(렌더링) 모달의 트랙번호/타임라인 위치/사용 구간 설정 기능(app/api/render-position)이
    // 웹 API로만 있어서, 로그인 세션 쿠키가 없으면(=MCP에서는) 손댈 방법이 없었다. 같은 로직을
    // lib/mltClipPosition.ts로 공유해서 여기서도 그대로 쓴다.
    server.registerTool(
      'get_mlt_clip_positions',
      {
        description:
          'Shotcut 프로젝트(.mlt) 파일 안의 영상 클립들의 트랙 번호·타임라인 위치(position)·사용 구간(in/out)·원본 최대 길이(sourceMaxMs)를 조회한다. ' +
          'mltUrl은 해당 콘텐츠 유닛의 renderFiles에 등록된 .mlt 공개 URL(list_sites/run_sql로 script_draft.units[].renderFiles에서 확인).',
        inputSchema: z.object({ mltUrl: z.string().describe('공개 .mlt 파일 URL (honghub-files Storage, https://.../object/public/honghub-files/*.mlt)') }),
      },
      async ({ mltUrl }) => {
        const fileRes = await fetch(mltUrl);
        if (!fileRes.ok) return { content: [{ type: 'text', text: `mlt 파일을 불러오지 못했습니다 (HTTP ${fileRes.status})` }] };
        const xml = await fileRes.text();
        return { content: [{ type: 'text', text: JSON.stringify(parseClipPositions(xml), null, 2) }] };
      }
    );

    server.registerTool(
      'set_mlt_clip_position',
      {
        description:
          'Shotcut 프로젝트(.mlt) 파일 안의 영상 클립 하나의 타임라인 위치(action=position)/트랙 번호(action=track)/소스 영상 사용 구간(action=range, in~out)을 ' +
          '수정하고 Storage에 즉시 덮어쓴다. 웹 UI 14번 모달의 트랙/위치/구간 설정과 동일한 기능을 로그인 세션 없이 실행한다. ' +
          '⚠️ 자막(SRT) 기준으로 클립을 배치할 때는 반드시 position(타임라인 위치=클립이 시작하는 지점)만 그 자막 줄의 시작 시각에 맞추고, ' +
          'range(그 클립이 소스 영상에서 실제로 쓰는 구간·길이)는 건드리지 말 것 — 클립 자체의 길이/트리밍은 사용자가 직접 편집하는 영역이다 ' +
          '(사용자 지시, 2026-09-17: "자체 영상 길이는 내가 수정하는 영역이고, 넌 처음 셋팅을 할 때 자막 기준의 타임라인 위치에 시작점을 맞춰서 배치를 셋팅하라고"). ' +
          'range는 사용자가 명시적으로 구간 조정을 요청했을 때만 쓸 것.',
        inputSchema: z.object({
          mltUrl: z.string().describe('공개 .mlt 파일 URL (honghub-files Storage)'),
          file: z.string().describe('대상 클립 파일명(예: S01B.mp4) — 확장자 무관, 대소문자 무관 매칭'),
          action: z.enum(['position', 'track', 'range']),
          positionMs: z.number().optional().describe("action='position'일 때 필수 — 타임라인 위치(밀리초). 자막 기준 배치는 이 필드만 쓸 것"),
          trackNumber: z.number().optional().describe("action='track'일 때 필수 — 이동할 트랙 번호(1부터, get_mlt_clip_positions의 totalTracks 이내)"),
          inMs: z.number().optional().describe("action='range'일 때 필수 — 소스 영상 사용 시작(밀리초). 사용자가 명시적으로 요청했을 때만 쓸 것"),
          outMs: z.number().optional().describe("action='range'일 때 필수 — 소스 영상 사용 끝(밀리초, sourceMaxMs 이하). 사용자가 명시적으로 요청했을 때만 쓸 것"),
        }),
      },
      async ({ mltUrl, file, action, positionMs, trackNumber, inMs, outMs }) => {
        let result;
        if (action === 'track') {
          if (typeof trackNumber !== 'number' || !Number.isFinite(trackNumber) || trackNumber < 1) {
            return { content: [{ type: 'text', text: 'trackNumber(1 이상)가 필요합니다.' }] };
          }
          result = await fetchAndUpload(mltUrl, (xml) => setClipTrack(xml, file, trackNumber));
        } else if (action === 'range') {
          if (typeof inMs !== 'number' || !Number.isFinite(inMs) || inMs < 0 || typeof outMs !== 'number' || !Number.isFinite(outMs) || outMs <= inMs) {
            return { content: [{ type: 'text', text: 'inMs(0 이상), outMs(inMs보다 커야 함)가 필요합니다.' }] };
          }
          result = await fetchAndUpload(mltUrl, (xml) => setClipRange(xml, file, inMs, outMs));
        } else {
          if (typeof positionMs !== 'number' || !Number.isFinite(positionMs) || positionMs < 0) {
            return { content: [{ type: 'text', text: 'positionMs(0 이상)가 필요합니다.' }] };
          }
          result = await fetchAndUpload(mltUrl, (xml) => setClipPosition(xml, file, positionMs));
        }
        if ('error' in result) return { content: [{ type: 'text', text: `에러: ${result.error}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(parseClipPositions(result.xml), null, 2) }] };
      }
    );

    // 2026-09-17 신설 — 사용자 요청: "홍허브 메인화면 플랫폼 버튼들이 그냥 외부 링크만 있는데,
    // 계정 채널 셋팅(API/설정 문구 등)을 하게 해두자". hub_social_accounts 테이블(웹 UI의
    // app/api/social-accounts와 동일 테이블)을 MCP에서도 직접 조회/등록/수정/삭제할 수 있게
    // 한다 — [[feedback_add_mcp_with_feature]] 원칙에 따라 새 기능은 항상 MCP 짝을 같이 만든다.
    server.registerTool(
      'list_social_accounts',
      {
        description: '홍허브 메인화면에 등록된 플랫폼별 계정(유튜브/인스타/쓰레드/페이스북/틱톡/네이버블로그 등) 목록을 조회한다.',
        inputSchema: z.object({ platform: z.string().optional().describe('예: youtube, instagram, threads, facebook, tiktok, naver_blog — 비우면 전체 조회') }),
      },
      async ({ platform }) => {
        const supabase = getSupabaseServerClient();
        let query = supabase.from('hub_social_accounts').select('*').order('platform').order('sort_order').order('created_at');
        if (platform) query = query.eq('platform', platform);
        const { data, error } = await query;
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message} (hub_social_accounts 테이블이 없으면 _migration_16_social_accounts.sql 실행 필요)` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'add_social_account',
      {
        description: '새 플랫폼 계정을 등록한다(홍허브 메인화면 계정 관리 섹션에 표시됨).',
        inputSchema: z.object({
          platform: z.string().describe('예: youtube, instagram, threads, facebook, tiktok, naver_blog'),
          account_name: z.string().describe('계정/채널명(예: "경제학 똑똑", "@mintimjang33")'),
          setting_note: z.string().optional().describe('그 외 자유 메모(선택) — 실제 API 자격증명은 credentials 필드에 넣을 것'),
          admin_email: z.string().optional().describe('이 계정을 관리하는 구글 계정(선택) — 같은 이메일로 채널 여러 개 등록 가능(예: 유튜브 브랜드 계정)'),
          admin_phone: z.string().optional().describe('이 채널 담당자 연락처(선택)'),
          site_id: z.string().optional().describe('특정 파이프라인 전용 계정이면 그 사이트 id(선택, list_sites로 확인)'),
          // 2026-09-17 신설 — 사용자 지적: "그걸 셋팅하려면 뭐가 필요한지를 만들어야 정보를
          // 입력해두지". 플랫폼마다 실제 API 연동 자격증명 종류가 다르다(/docs/API_SETUP_GUIDE.md
          // 참고): youtube={client_id,client_secret,refresh_token,channel_id}, instagram/
          // threads/facebook(메타 앱 공유)={app_id,app_secret,+계정별 access_token과 고유id
          // (ig_business_id/threads_user_id/page_id)}, tiktok={client_key,client_secret,
          // access_token}. naver_blog는 공식 포스팅 API가 없어 비워둔다.
          credentials: z
            .record(z.string(), z.string())
            .optional()
            .describe('플랫폼별 API 자격증명 키-값(예: {"client_id":"...","client_secret":"...","refresh_token":"..."})'),
        }),
      },
      async (args) => {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase
          .from('hub_social_accounts')
          .insert({
            platform: args.platform,
            account_name: args.account_name,
            setting_note: args.setting_note || null,
            admin_email: args.admin_email || null,
            admin_phone: args.admin_phone || null,
            site_id: args.site_id || null,
            credentials: args.credentials || null,
          })
          .select()
          .single();
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'update_social_account',
      {
        description: '등록된 플랫폼 계정을 수정한다(id 기준, 넘긴 필드만 갱신). credentials를 넘기면 기존 credentials 전체를 교체한다(부분 병합 아님) — 일부만 바꾸려면 먼저 list_social_accounts로 현재 값을 읽고 합쳐서 넘길 것.',
        inputSchema: z.object({
          id: z.string().describe('수정할 계정의 id (list_social_accounts로 확인)'),
          platform: z.string().optional(),
          account_name: z.string().optional(),
          setting_note: z.string().optional(),
          admin_email: z.string().optional(),
          admin_phone: z.string().optional(),
          site_id: z.string().optional(),
          credentials: z.record(z.string(), z.string()).optional().describe('통째로 교체됨 — 부분 수정이면 기존 값을 읽어 합쳐서 넘길 것'),
        }),
      },
      async ({ id, ...fields }) => {
        const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const [k, v] of Object.entries(fields)) if (v !== undefined) update[k] = v;
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase.from('hub_social_accounts').update(update).eq('id', id).select().single();
        if (error) return { content: [{ type: 'text', text: `에러: ${error.message}` }] };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.registerTool(
      'delete_social_account',
      { description: '등록된 플랫폼 계정을 삭제한다.', inputSchema: z.object({ id: z.string().describe('삭제할 계정의 id') }) },
      async ({ id }) => {
        const supabase = getSupabaseServerClient();
        const { error } = await supabase.from('hub_social_accounts').delete().eq('id', id);
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
