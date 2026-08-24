import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase';

// 플랫폼별 포맷 가이드. 페르소나 톤은 유지하되, 플랫폼 문법(길이/구조)은 여기서 강제한다.
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

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { source_item_id, persona_id, persona_is_system, target_platform, manual_topic } = body || {};

  if (!target_platform || !PLATFORM_GUIDE[target_platform]) {
    return NextResponse.json({ error: 'target_platform이 올바르지 않습니다. (threads / youtube_shorts / tiktok / instagram)' }, { status: 400 });
  }
  if (!persona_id) return NextResponse.json({ error: 'persona_id가 필요합니다.' }, { status: 400 });
  if (!source_item_id && !manual_topic?.trim()) {
    return NextResponse.json({ error: 'source_item_id 또는 manual_topic 중 하나가 필요합니다.' }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  // 페르소나 조회. persona_is_system이면 ut_system_personas(prompt 단일 필드),
  // 아니면 ut_personas(tone_prompt/target_prompt 분리)에서 조회한다.
  let persona: { name: string; tone_prompt: string; target_prompt: string } | null = null;
  if (persona_is_system) {
    const { data, error } = await supabase.from('ut_system_personas').select('*').eq('id', persona_id).single();
    if (error || !data) return NextResponse.json({ error: '페르소나를 찾을 수 없습니다.' }, { status: 404 });
    persona = { name: data.name, tone_prompt: data.prompt, target_prompt: '' };
  } else {
    const { data, error } = await supabase.from('ut_personas').select('*').eq('id', persona_id).single();
    if (error || !data) return NextResponse.json({ error: '페르소나를 찾을 수 없습니다.' }, { status: 404 });
    persona = { name: data.name, tone_prompt: data.tone_prompt, target_prompt: data.target_prompt };
  }

  // 소재 조회 (있으면)
  let topicText = manual_topic?.trim() || '';
  let sourceItem = null;
  if (source_item_id) {
    const { data: item, error: itemError } = await supabase
      .from('hub_source_items')
      .select('*')
      .eq('id', source_item_id)
      .single();
    if (itemError || !item) return NextResponse.json({ error: '소재를 찾을 수 없습니다.' }, { status: 404 });
    sourceItem = item;
    topicText = `제목: ${item.title}\n요약/사실관계: ${item.raw_notes || '(추가 메모 없음, 제목 기반으로 작성)'}`;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY 환경변수가 설정되어 있지 않습니다.' }, { status: 500 });

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
`.trim();

  // 실제 배포 전, 최신 모델 id는 Anthropic 문서에서 확인해서 필요시 교체할 것
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

  const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: `다음 소재로 글을 작성해줘.\n\n${topicText}` }],
    }),
  });

  if (!aiResponse.ok) {
    const errText = await aiResponse.text().catch(() => '');
    return NextResponse.json({ error: `AI 호출 실패: ${errText}` }, { status: 502 });
  }

  const aiData = await aiResponse.json();
  const generatedText = (aiData.content || [])
    .filter((c: { type: string }) => c.type === 'text')
    .map((c: { text: string }) => c.text)
    .join('\n')
    .trim();

  const { data: saved, error: saveError } = await supabase
    .from('hub_generated_content')
    .insert({
      source_item_id: sourceItem?.id || null,
      persona_id,
      persona_name: persona.name,
      target_platform,
      generated_text: generatedText,
      status: 'draft',
    })
    .select()
    .single();
  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });

  return NextResponse.json({ content: saved });
}

export async function GET() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('hub_generated_content')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contents: data || [] });
}
