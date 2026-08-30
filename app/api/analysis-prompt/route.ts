import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';

const CHANNEL_TAG_RE = /^\[파이프라인:([^\]]+)\]\s*/;
const MAX_ITEMS = 15;
const ALL_CATEGORIES = ['channel', 'title', 'thumbnail', 'script', 'duration', 'pace'] as const;
type Category = (typeof ALL_CATEGORIES)[number];

const CATEGORY_INSTRUCTIONS: Record<Category, string> = {
  channel: '채널 — 채널명 작명 패턴, 구독자 규모대, 채널 소개/메모에서 보이는 공통 포지셔닝',
  title: '제목 — 공통된 후킹 패턴, 구조, 어투, 길이 경향',
  thumbnail: '썸네일 — (이미지 링크를 열어서 실제로 보고) 공통된 색감, 구도, 텍스트 사용 스타일',
  script: '대본 — 공통된 서사 구조(오프닝 훅→전개→반전→마무리 등), 문장 스타일',
  duration: '시간 — 영상 길이 경향',
  pace: '속도 — 나레이션 속도(대본 글자수 ÷ 영상 길이) 경향',
};

type Item = {
  title: string;
  thumbnail_url: string | null;
  transcript: string | null;
  duration_seconds: number | null;
  views: string | null;
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

// "💬 구독으로 분석하기" 버튼용 — 유료 API 호출 없이, 체크한 항목만 프롬프트로 만들어
// Gemini/Claude 구독 채팅에 그대로 붙여넣을 수 있게 돌려준다.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get('siteId');
  if (!siteId) return NextResponse.json({ error: 'siteId가 필요합니다.' }, { status: 400 });
  const categories: Category[] = (searchParams.get('categories') || '')
    .split(',')
    .filter((c): c is Category => ALL_CATEGORIES.includes(c as Category));
  if (categories.length === 0) return NextResponse.json({ error: '분석할 항목이 없습니다.' }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data: site } = await supabase.from('hub_sites').select('id, name').eq('id', siteId).maybeSingle();
  if (!site) return NextResponse.json({ error: '사이트를 찾을 수 없습니다.' }, { status: 404 });

  const { data: channelsData } = await supabase.from('hub_source_channels').select('id, name, url, subscriber_count, notes');
  const mineChannels = (channelsData || []).filter((c) => c.notes?.match(CHANNEL_TAG_RE)?.[1] === site.name);
  const mineChannelIds = mineChannels.map((c) => c.id);
  if (mineChannelIds.length === 0) return NextResponse.json({ error: '등록된 채널이 없습니다.' }, { status: 400 });

  const needsItems = categories.some((c) => c !== 'channel');
  let itemsSection = '';
  let withTranscriptCount = 0;
  let topCount = 0;

  if (needsItems) {
    const { data: itemsData, error } = await supabase
      .from('hub_source_items')
      .select('title, thumbnail_url, transcript, duration_seconds, views')
      .in('channel_id', mineChannelIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const items: Item[] = (itemsData || []) as Item[];
    // 대본이 있는 소재만 분석 대상으로 쓴다 — 사용자가 직접 확인·저장한 것만 신뢰할 수 있어서다.
    const withTranscript = items.filter((i) => i.transcript && i.transcript.trim().length > 20);
    if (withTranscript.length === 0) {
      return NextResponse.json({ error: '대본이 등록된 소재가 아직 없어요 — 3번 단계에서 먼저 대본을 채워주세요.' }, { status: 400 });
    }
    withTranscriptCount = withTranscript.length;
    const top = [...withTranscript].sort((a, b) => parseViews(b.views) - parseViews(a.views)).slice(0, MAX_ITEMS);
    topCount = top.length;

    // 체크한 항목에 필요한 필드만 넣는다 — 예를 들어 "제목"만 체크했는데 썸네일 링크·대본 전문까지
    // 딸려 나가면 프롬프트만 쓸데없이 커진다.
    const includeDuration = categories.includes('duration') || categories.includes('pace');
    const includeThumbnail = categories.includes('thumbnail');
    const includeScriptText = categories.includes('script');
    const includeCharCount = categories.includes('pace');
    const fieldNames = [
      '제목',
      '조회수',
      includeDuration && '길이',
      includeThumbnail && '썸네일 이미지 링크',
      includeScriptText && '대본',
      includeCharCount && '대본 글자수',
    ]
      .filter(Boolean)
      .join('/');

    const lines = top.map((i, idx) => {
      const parts = [`[${idx + 1}] "${i.title}"`, `조회수 ${i.views || '?'}`];
      if (includeDuration && i.duration_seconds) parts.push(`길이 ${Math.floor(i.duration_seconds / 60)}:${String(i.duration_seconds % 60).padStart(2, '0')}`);
      if (includeThumbnail && i.thumbnail_url) parts.push(`썸네일: ${i.thumbnail_url}`);
      if (includeCharCount) parts.push(`대본 글자수: ${i.transcript!.trim().length}자`);
      let line = parts.join(' | ');
      if (includeScriptText) line += `\n  대본: ${i.transcript!.slice(0, 800)}`;
      return line;
    });

    itemsSection = `영상 ${top.length}개(대본까지 확보된 것 중 조회수 상위, 전체 ${items.length}개 중 대본 있는 건 ${withTranscript.length}개)의 ${fieldNames}이야:\n\n${lines.join('\n\n')}`;
  }

  let channelSection = '';
  if (categories.includes('channel')) {
    const channelLines = mineChannels
      .map((c: ChannelRow) => `- ${c.name} | 구독자 ${c.subscriber_count || '?'} | ${c.url || ''} | ${(c.notes || '').replace(CHANNEL_TAG_RE, '') || ''}`)
      .join('\n');
    channelSection = `벤치마크 채널 ${mineChannels.length}개:\n\n${channelLines}`;
  }

  const dataSections = [channelSection, itemsSection].filter(Boolean).join('\n\n---\n\n');
  const instructionList = categories.map((c, idx) => `${idx + 1}. ${CATEGORY_INSTRUCTIONS[c]}`).join('\n');

  const prompt = `"${site.name}" 파이프라인을 분석해줘.

${dataSections}

아래를 각각 정리해줘:
${instructionList}

새 대본/썸네일 제작에 바로 참고할 수 있게 구체적으로 답해줘.`;

  return NextResponse.json({ prompt, analyzedCount: topCount, totalCount: mineChannels.length, withTranscriptCount });
}
