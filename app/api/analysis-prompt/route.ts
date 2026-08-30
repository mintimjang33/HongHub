import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';

const CHANNEL_TAG_RE = /^\[파이프라인:([^\]]+)\]\s*/;
const MAX_ITEMS = 15;

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

// "🎬 구독으로 분석하기" 버튼용 — 유료 API 호출 없이, 이 파이프라인의 2·3번 소재 데이터를
// Gemini/Claude 구독 채팅에 그대로 붙여넣을 수 있는 프롬프트 텍스트로 만들어서 돌려준다.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get('siteId');
  if (!siteId) return NextResponse.json({ error: 'siteId가 필요합니다.' }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data: site } = await supabase.from('hub_sites').select('id, name').eq('id', siteId).maybeSingle();
  if (!site) return NextResponse.json({ error: '사이트를 찾을 수 없습니다.' }, { status: 404 });

  const { data: channels } = await supabase.from('hub_source_channels').select('id, notes');
  const mineChannelIds = (channels || [])
    .filter((c) => c.notes?.match(CHANNEL_TAG_RE)?.[1] === site.name)
    .map((c) => c.id);
  if (mineChannelIds.length === 0) return NextResponse.json({ error: '등록된 채널이 없습니다.' }, { status: 400 });

  const { data: itemsData, error } = await supabase
    .from('hub_source_items')
    .select('title, thumbnail_url, transcript, duration_seconds, views')
    .in('channel_id', mineChannelIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items: Item[] = (itemsData || []) as Item[];
  if (items.length === 0) return NextResponse.json({ error: '등록된 소재가 없습니다.' }, { status: 400 });

  const top = [...items].sort((a, b) => parseViews(b.views) - parseViews(a.views)).slice(0, MAX_ITEMS);

  const lines = top.map((i, idx) => {
    const parts = [`[${idx + 1}] "${i.title}"`, `조회수 ${i.views || '?'}`];
    if (i.duration_seconds) parts.push(`길이 ${Math.floor(i.duration_seconds / 60)}:${String(i.duration_seconds % 60).padStart(2, '0')}`);
    if (i.thumbnail_url) parts.push(`썸네일: ${i.thumbnail_url}`);
    let line = parts.join(' | ');
    if (i.transcript && i.transcript.trim().length > 20) line += `\n  대본: ${i.transcript.slice(0, 800)}`;
    return line;
  });

  const prompt = `"${site.name}" 파이프라인 벤치마크 영상 ${top.length}/${items.length}개(조회수 상위)를 분석해줘.

각 영상의 제목/조회수/길이/썸네일 이미지 링크/대본(있는 것만)이야:

${lines.join('\n\n')}

아래 5가지를 각각 정리해줘:
1. 제목 — 공통된 후킹 패턴, 구조, 어투, 길이 경향
2. 썸네일 — (이미지 링크를 열어서 실제로 보고) 공통된 색감, 구도, 텍스트 사용 스타일
3. 대본 — 공통된 서사 구조(오프닝 훅→전개→반전→마무리 등), 문장 스타일
4. 시간 — 영상 길이 경향
5. 속도 — 나레이션 속도(대본 글자수 ÷ 영상 길이) 경향

새 대본/썸네일 제작에 바로 참고할 수 있게 구체적으로 답해줘.`;

  return NextResponse.json({ prompt, analyzedCount: top.length, totalCount: items.length });
}
