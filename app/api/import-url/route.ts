import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { callAi } from '../../../lib/aiProviders';

const CONTENT_TYPES = ['TRIVIA', 'LIFEHACK', 'EMOTIONAL', 'HUMOR', 'MOTIVATION', 'RANKING', 'PERSONAL_STORY', 'DEBATE'];
const PLATFORM_VALUES = ['threads', 'youtube_shorts', 'tiktok', 'instagram'];

function detectChannelPlatform(hostname: string): string {
  if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube';
  if (hostname.includes('tiktok.com')) return 'tiktok';
  if (hostname.includes('instagram.com')) return 'instagram';
  if (hostname.includes('threads.net') || hostname.includes('threads.com')) return 'threads';
  return 'community';
}

function extractMeta(html: string, property: string): string | null {
  // property="og:title" content="..." 또는 content="..." property="og:title" 순서 둘 다 대응
  const re1 = new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, 'i');
  return html.match(re1)?.[1] || html.match(re2)?.[1] || null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const url = body?.url?.trim();
  const aiProvider = body?.ai_provider === 'gemini' ? 'gemini' : 'claude';
  if (!url) return NextResponse.json({ error: 'url이 필요합니다.' }, { status: 400 });

  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    return NextResponse.json({ error: '올바른 URL 형식이 아닙니다.' }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  // 1) 이미 등록된 소재인지 먼저 확인 (중복 방지)
  const { data: existing } = await supabase
    .from('hub_source_items')
    .select('*')
    .eq('source_url', url)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ duplicate: true, item: existing });
  }

  // 2) 페이지 메타데이터(og 태그) 가져오기
  let html = '';
  try {
    const pageRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HongHubBot/1.0; +https://honghub.vercel.app)',
      },
      redirect: 'follow',
    });
    html = await pageRes.text();
  } catch (err) {
    return NextResponse.json({ error: `페이지를 가져오지 못했습니다: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }

  const ogTitle = decodeHtmlEntities(extractMeta(html, 'og:title') || html.match(/<title>([^<]*)<\/title>/i)?.[1] || '제목 없음');
  const ogDescription = decodeHtmlEntities(extractMeta(html, 'og:description') || '');
  const ogSiteName = decodeHtmlEntities(extractMeta(html, 'og:site_name') || hostname);

  const channelPlatform = detectChannelPlatform(hostname);

  // 3) 채널 매칭 또는 신규 생성 (사이트명 기준 느슨한 매칭)
  let channelId: string | null = null;
  if (ogSiteName && ogSiteName !== hostname) {
    const { data: matchedChannel } = await supabase
      .from('hub_source_channels')
      .select('id')
      .ilike('name', `%${ogSiteName}%`)
      .limit(1)
      .maybeSingle();
    if (matchedChannel) {
      channelId = matchedChannel.id;
    } else {
      const { data: newChannel } = await supabase
        .from('hub_source_channels')
        .insert({
          name: ogSiteName,
          platform: channelPlatform,
          url: `${new URL(url).protocol}//${hostname}`,
          content_types: [],
          platform_fit: [],
          status: '후보',
          notes: 'URL 가져오기로 자동 생성됨 — 정보 보강 필요',
        })
        .select('id')
        .single();
      channelId = newChannel?.id || null;
    }
  }

  // 4) AI로 콘텐츠 유형 분류 + 사실관계 요약 (원문 그대로 옮기지 않도록 지시)
  const classifyPrompt = `
아래는 어떤 콘텐츠의 제목과 설명이다. 이 정보를 분석해서 JSON으로만 답해라.

제목: ${ogTitle}
설명: ${ogDescription || '(설명 없음)'}
출처 플랫폼: ${channelPlatform}

다음 형식으로만 출력해라:
{
  "content_type": "TRIVIA|LIFEHACK|EMOTIONAL|HUMOR|MOTIVATION|RANKING|PERSONAL_STORY|DEBATE 중 하나",
  "platform_fit": ["threads","youtube_shorts","tiktok","instagram" 중 이 소재에 잘 맞는 것들, 배열"],
  "raw_notes": "이 콘텐츠의 핵심 사실관계를 1~2문장으로 요약. 원문 표현을 그대로 옮기지 말고 완전히 새로운 문장으로 작성."
}
`.trim();

  let classification = { content_type: 'TRIVIA', platform_fit: ['youtube_shorts'] as string[], raw_notes: ogDescription || ogTitle };
  try {
    const raw = await callAi(aiProvider, '너는 콘텐츠 분류 전문가다. 반드시 JSON만 출력한다.', classifyPrompt);
    const cleaned = raw.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    classification = {
      content_type: CONTENT_TYPES.includes(parsed.content_type) ? parsed.content_type : 'TRIVIA',
      platform_fit: Array.isArray(parsed.platform_fit) ? parsed.platform_fit.filter((p: string) => PLATFORM_VALUES.includes(p)) : [],
      raw_notes: typeof parsed.raw_notes === 'string' ? parsed.raw_notes : ogDescription,
    };
  } catch {
    // AI 분류 실패해도 기본값으로 저장은 진행한다 (사람이 나중에 수정 가능)
  }

  // 5) 소재 등록
  const { data: item, error } = await supabase
    .from('hub_source_items')
    .insert({
      channel_id: channelId,
      title: ogTitle,
      source_url: url,
      content_type: classification.content_type,
      platform_fit: classification.platform_fit,
      raw_notes: classification.raw_notes,
      status: '미가공',
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ duplicate: false, item, channel_created: !!channelId });
}
