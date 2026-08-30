import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { callAi, callClaudeVision } from '../../../lib/aiProviders';

const CHANNEL_TAG_RE = /^\[파이프라인:([^\]]+)\]\s*/;
const MAX_ITEMS_FOR_AI = 15; // 프롬프트 크기/비용 제어 — 조회수 상위 N개만 분석 대상으로 쓴다.
const MAX_THUMBNAILS = 8; // 비전 호출은 이미지 개수만큼 비싸지므로 더 적게 제한.

type Item = {
  title: string;
  thumbnail_url: string | null;
  transcript: string | null;
  duration_seconds: number | null;
  views: string | null;
};

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

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const siteName = body?.siteName?.trim();
  const aiProvider = body?.ai_provider === 'gemini' ? 'gemini' : 'claude';
  if (!siteName) return NextResponse.json({ error: 'siteName이 필요합니다.' }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data: channels } = await supabase.from('hub_source_channels').select('id, notes');
  const mineChannelIds = (channels || [])
    .filter((c) => c.notes?.match(CHANNEL_TAG_RE)?.[1] === siteName)
    .map((c) => c.id);
  if (mineChannelIds.length === 0) return NextResponse.json({ error: '등록된 채널이 없습니다.' }, { status: 400 });

  const { data: itemsData, error } = await supabase
    .from('hub_source_items')
    .select('title, thumbnail_url, transcript, duration_seconds, views')
    .in('channel_id', mineChannelIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items: Item[] = (itemsData || []) as Item[];
  if (items.length === 0) return NextResponse.json({ error: '등록된 소재가 없습니다.' }, { status: 400 });

  const topItems = [...items].sort((a, b) => parseViews(b.views) - parseViews(a.views)).slice(0, MAX_ITEMS_FOR_AI);

  const titleList = topItems.map((i) => `- ${i.title}`).join('\n');
  const scriptItems = topItems.filter((i) => i.transcript && i.transcript.trim().length > 20);
  const thumbItems = topItems.filter((i) => i.thumbnail_url).slice(0, MAX_THUMBNAILS);

  const durationValues = items.map((i) => i.duration_seconds).filter((n): n is number => !!n);
  const paceValues = items
    .filter((i) => i.transcript && i.duration_seconds)
    .map((i) => i.transcript!.length / i.duration_seconds!);

  const durationStats =
    durationValues.length > 0
      ? {
          count: durationValues.length,
          avg: Math.round(durationValues.reduce((a, b) => a + b, 0) / durationValues.length),
          min: Math.min(...durationValues),
          max: Math.max(...durationValues),
        }
      : null;
  const paceStats =
    paceValues.length > 0
      ? {
          count: paceValues.length,
          avgCharsPerSec: Math.round((paceValues.reduce((a, b) => a + b, 0) / paceValues.length) * 10) / 10,
        }
      : null;

  const [titleResult, scriptResult, thumbResult] = await Promise.allSettled([
    callAi(
      aiProvider,
      '너는 유튜브 쇼츠 콘텐츠 분석가다.',
      `아래는 벤치마크 영상 제목 목록이다(조회수 상위 ${topItems.length}개):\n\n${titleList}\n\n공통된 후킹 패턴, 구조, 어투, 길이 경향을 분석해서 정리해줘. 새 대본 작성에 참고할 수 있게 구체적으로.`
    ),
    scriptItems.length > 0
      ? callAi(
          aiProvider,
          '너는 유튜브 쇼츠 콘텐츠 분석가다.',
          `아래는 벤치마크 영상 대본 ${scriptItems.length}개다:\n\n${scriptItems
            .map((i, idx) => `[${idx + 1}] ${i.title}\n${i.transcript!.slice(0, 1500)}`)
            .join('\n\n---\n\n')}\n\n공통된 서사 구조(오프닝 훅→전개→반전→마무리 등), 문장 스타일, 어미 패턴을 분석해서 정리해줘.`
        )
      : Promise.resolve('대본이 등록된 소재가 아직 없어요 — 3번 단계에서 먼저 대본을 모아주세요.'),
    thumbItems.length > 0
      ? callClaudeVision(
          '너는 유튜브 쇼츠 썸네일 디자인 분석가다.',
          `아래 ${thumbItems.length}개는 벤치마크 채널들의 실제 썸네일이다. 공통된 색감, 구도, 텍스트 사용 여부/스타일, 강조 기법을 분석해서 새 썸네일 제작에 참고할 수 있게 정리해줘.`,
          thumbItems.map((i) => i.thumbnail_url!)
        )
      : Promise.resolve('썸네일이 등록된 소재가 아직 없어요.'),
  ]);

  function settledText(r: PromiseSettledResult<string>): string {
    return r.status === 'fulfilled' ? r.value : `분석 실패: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`;
  }

  return NextResponse.json({
    title: settledText(titleResult),
    script: settledText(scriptResult),
    thumbnail: settledText(thumbResult),
    durationStats,
    paceStats,
    analyzedCount: topItems.length,
    totalCount: items.length,
  });
}
