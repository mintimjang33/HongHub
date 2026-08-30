import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { callAi } from '../../../lib/aiProviders';
import { fetchOgMeta, detectChannelPlatform } from '../../../lib/ogMeta';

const CONTENT_TYPES = ['TRIVIA', 'LIFEHACK', 'EMOTIONAL', 'HUMOR', 'MOTIVATION', 'RANKING', 'PERSONAL_STORY', 'DEBATE'];
const PLATFORM_VALUES = ['threads', 'youtube_shorts', 'tiktok', 'instagram'];

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

  const { data: existing } = await supabase.from('hub_source_items').select('*').eq('source_url', url).maybeSingle();
  if (existing) return NextResponse.json({ duplicate: true, item: existing });

  let meta;
  try {
    meta = await fetchOgMeta(url);
  } catch (err) {
    return NextResponse.json({ error: `페이지를 가져오지 못했습니다: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
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
          notes: 'URL 가져오기로 자동 생성됨 — 정보 보강 필요',
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
    const raw = await callAi(aiProvider, '너는 콘텐츠 분류 전문가다. 반드시 JSON만 출력한다.', classifyPrompt);
    const cleaned = raw.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    classification = {
      content_type: CONTENT_TYPES.includes(parsed.content_type) ? parsed.content_type : 'TRIVIA',
      platform_fit: Array.isArray(parsed.platform_fit) ? parsed.platform_fit.filter((p: string) => PLATFORM_VALUES.includes(p)) : [],
      raw_notes: typeof parsed.raw_notes === 'string' ? parsed.raw_notes : meta.description,
    };
  } catch {
    // AI 분류 실패해도 기본값으로 저장은 진행한다
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ duplicate: false, item, channel_created: !!channelId });
}
