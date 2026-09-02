import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { callGeminiVision } from '../../../lib/aiProviders';

// 썸네일 이미지 여러 개를 서버에서 받아와 base64로 변환해 Gemini에 보내다 보면 기본 10초 제한을
// 넘을 수 있어서 최대치로 늘려둔다(Vercel Hobby/Pro 둘 다 60초까지 지원).
export const maxDuration = 60;

const CHANNEL_TAG_RE = /^\[파이프라인:([^\]]+)\]\s*/;
const MAX_ITEMS = 15; // 프롬프트 크기/비용 제어 — 조회수 상위 N개만 분석 대상.
const MAX_THUMBNAILS = 8; // 비전 호출은 이미지 개수만큼 비싸므로 더 적게 제한.
const MAX_COMMENTS_PER_ITEM = 10;
const MODEL = 'gemini-3.1-pro-preview'; // 4번 분석은 항상 pro로 — flash는 이 용도엔 얕음.
const ALL_CATEGORIES = ['channel', 'title', 'thumbnail', 'script', 'comment', 'duration', 'pace'] as const;
type Category = (typeof ALL_CATEGORIES)[number];

type VideoComment = { author: string; text: string; likeCount: number };
type Item = {
  title: string;
  thumbnail_url: string | null;
  transcript: string | null;
  duration_seconds: number | null;
  views: string | null;
  comment_count: number | null;
  top_comments: VideoComment[] | null;
};
type ChannelRow = { name: string; url: string | null; subscriber_count: string | null; notes: string | null };

function parseViews(label: string | null): number {
  if (!label) return 0;
  const m = label.match(/([\d.]+)\s*(억|만|천)?/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (m[2] === '억') return n * 100_000_000;
  if (m[2] === '만') return n * 10_000;
  if (m[2] === '천') return n * 1_000;
  return n;
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const siteId = body?.siteId?.trim();
  if (!siteId) return NextResponse.json({ error: 'siteId가 필요합니다.' }, { status: 400 });
  const categories: Category[] = Array.isArray(body?.categories)
    ? body.categories.filter((c: string): c is Category => ALL_CATEGORIES.includes(c as Category))
    : [...ALL_CATEGORIES];
  if (categories.length === 0) return NextResponse.json({ error: '분석할 항목이 없습니다.' }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data: site } = await supabase.from('hub_sites').select('id, name, analysis_result').eq('id', siteId).maybeSingle();
  if (!site) return NextResponse.json({ error: '사이트를 찾을 수 없습니다.' }, { status: 404 });

  const { data: channelsData } = await supabase.from('hub_source_channels').select('id, name, url, subscriber_count, notes');
  const mineChannels = (channelsData || []).filter((c) => c.notes?.match(CHANNEL_TAG_RE)?.[1] === site.name);
  const mineChannelIds = mineChannels.map((c) => c.id);
  if (mineChannelIds.length === 0) return NextResponse.json({ error: '등록된 채널이 없습니다.' }, { status: 400 });

  const { data: itemsData, error } = await supabase
    .from('hub_source_items')
    .select('title, thumbnail_url, transcript, duration_seconds, views, comment_count, top_comments')
    .in('channel_id', mineChannelIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items: Item[] = (itemsData || []) as Item[];

  // 대본이 있는 소재만 분석 대상으로 쓴다 — 사용자가 직접 확인·저장한 것만 신뢰할 수 있어서다.
  const withTranscript = items.filter((i) => i.transcript && i.transcript.trim().length > 20);
  const needsItems = categories.some((c) => c !== 'channel');
  if (needsItems && withTranscript.length === 0) {
    return NextResponse.json({ error: '대본이 등록된 소재가 아직 없어요 — 3번 단계에서 먼저 대본을 채워주세요.' }, { status: 400 });
  }
  const topItems = [...withTranscript].sort((a, b) => parseViews(b.views) - parseViews(a.views)).slice(0, MAX_ITEMS);
  const thumbItems = topItems.filter((i) => i.thumbnail_url).slice(0, MAX_THUMBNAILS);
  const commentItems = topItems.filter((i) => i.top_comments && i.top_comments.length > 0);

  const jobs: Partial<Record<Category, Promise<string>>> = {};

  if (categories.includes('channel')) {
    const channelLines = mineChannels
      .map((c: ChannelRow) => `- ${c.name} | 구독자 ${c.subscriber_count || '?'} | ${c.url || ''} | ${(c.notes || '').replace(CHANNEL_TAG_RE, '') || ''}`)
      .join('\n');
    jobs.channel = callGeminiVision({
      systemPrompt: '너는 유튜브 쇼츠 채널 분석가다.',
      userPrompt: `아래는 벤치마크 채널 ${mineChannels.length}개다:\n\n${channelLines}\n\n채널명 작명 패턴, 구독자 규모대, 채널 소개/메모에서 보이는 공통 포지셔닝을 분석해서 정리해줘.`,
      model: MODEL,
    });
  }
  if (categories.includes('title')) {
    const titleList = topItems.map((i) => `- ${i.title}`).join('\n');
    jobs.title = callGeminiVision({
      systemPrompt: '너는 유튜브 쇼츠 콘텐츠 분석가다.',
      userPrompt: `아래는 벤치마크 영상 제목 목록이다(조회수 상위 ${topItems.length}개):\n\n${titleList}\n\n공통된 후킹 패턴, 구조, 어투, 길이 경향을 분석해서 정리해줘. 새 대본 작성에 참고할 수 있게 구체적으로.`,
      model: MODEL,
    });
  }
  if (categories.includes('script')) {
    jobs.script = callGeminiVision({
      systemPrompt: '너는 유튜브 쇼츠 콘텐츠 분석가다.',
      userPrompt: `아래는 벤치마크 영상 대본 ${topItems.length}개다:\n\n${topItems
        .map((i, idx) => `[${idx + 1}] ${i.title}\n${i.transcript!.slice(0, 1500)}`)
        .join('\n\n---\n\n')}\n\n공통된 서사 구조(오프닝 훅→전개→반전→마무리 등), 문장 스타일, 어미 패턴을 분석해서 정리해줘.`,
      model: MODEL,
    });
  }
  if (categories.includes('thumbnail')) {
    jobs.thumbnail =
      thumbItems.length > 0
        ? callGeminiVision({
            systemPrompt: '너는 유튜브 쇼츠 썸네일 디자인 분석가다.',
            userPrompt: `첨부된 ${thumbItems.length}개는 벤치마크 채널들의 실제 썸네일이다. 공통된 색감, 구도, 텍스트 사용 여부/스타일, 강조 기법을 분석해서 새 썸네일 제작에 참고할 수 있게 정리해줘.`,
            imageUrls: thumbItems.map((i) => i.thumbnail_url!),
            model: MODEL,
          })
        : Promise.resolve('썸네일이 있는 소재가 없어요.');
  }
  if (categories.includes('comment')) {
    jobs.comment =
      commentItems.length > 0
        ? callGeminiVision({
            systemPrompt: '너는 유튜브 쇼츠 시청자 반응 분석가다.',
            userPrompt: `아래는 벤치마크 영상 ${commentItems.length}개의 실제 상위 댓글이다:\n\n${commentItems
              .map(
                (i, idx) =>
                  `[${idx + 1}] ${i.title} (댓글 수 ${i.comment_count ?? '?'}개)\n` +
                  i
                    .top_comments!.slice(0, MAX_COMMENTS_PER_ITEM)
                    .map((c) => `- (👍${c.likeCount}) ${c.text.replace(/\s+/g, ' ').slice(0, 200)}`)
                    .join('\n')
              )
              .join('\n\n---\n\n')}\n\n시청자들이 어떤 포인트에 공감/반박/추가정보를 다는지, 자주 나오는 질문이나 불만, 반복되는 반응 패턴을 분석해줘. 다음 대본에서 미리 짚어주면 좋을 포인트를 구체적으로 정리해줘.`,
            model: MODEL,
          })
        : Promise.resolve('댓글이 있는 소재가 없어요 — 3번 단계에서 "💬 댓글 가져오기"로 채워주세요.');
  }

  const keys = Object.keys(jobs) as Category[];
  const settled = await Promise.allSettled(keys.map((k) => jobs[k]!));
  const aiResults: Partial<Record<Category, string>> = {};
  keys.forEach((k, idx) => {
    const r = settled[idx];
    aiResults[k] = r.status === 'fulfilled' ? r.value : `분석 실패: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`;
  });

  if (categories.includes('duration')) {
    const durationValues = items.map((i) => i.duration_seconds).filter((n): n is number => !!n);
    aiResults.duration =
      durationValues.length > 0
        ? `분석 대상 ${durationValues.length}개 기준\n평균 길이: ${fmtDuration(Math.round(durationValues.reduce((a, b) => a + b, 0) / durationValues.length))}\n범위: ${fmtDuration(Math.min(...durationValues))} ~ ${fmtDuration(Math.max(...durationValues))}`
        : '길이 데이터가 있는 소재가 없어요 — 2·3번에서 "⏱ 길이 가져오기"로 채워주세요.';
  }
  if (categories.includes('pace')) {
    const paceValues = items.filter((i) => i.transcript && i.duration_seconds).map((i) => i.transcript!.length / i.duration_seconds!);
    aiResults.pace =
      paceValues.length > 0
        ? `분석 대상 ${paceValues.length}개 기준 (대본+길이 둘 다 있는 것만)\n평균 나레이션 속도: 초당 ${(paceValues.reduce((a, b) => a + b, 0) / paceValues.length).toFixed(1)}자`
        : '대본과 길이가 둘 다 있는 소재가 아직 없어요.';
  }

  const analysisResult = {
    ...(site.analysis_result || {}),
    ...aiResults,
    updated_at: new Date().toISOString(),
  };

  const { error: saveError } = await supabase
    .from('hub_sites')
    .update({ analysis_result: analysisResult, updated_at: new Date().toISOString() })
    .eq('id', siteId);
  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });

  return NextResponse.json({ analysis_result: analysisResult, analyzedCount: topItems.length, totalCount: items.length });
}
