import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { callGeminiVision } from '../../../lib/aiProviders';

// 5번(대본 작성) 단계 전용 — 소재 추천 → 제목 추천 → 대본(한국어+영어+일본어), 3단계 파이프라인.
// + 완성된 콘텐츠 단위(unit)에 대한 AI 자동 검토(action=review).
// 4번(analyze-materials)과 같은 이유로 pro 모델을 쓰고, 대본이 있는 소재만 신뢰해서 근거로 쓴다.
export const maxDuration = 60;

const CHANNEL_TAG_RE = /^\[파이프라인:([^\]]+)\]\s*/;
const MAX_ITEMS = 15;
const MODEL = 'gemini-3.1-pro-preview';
const STAGES = ['materials', 'titles', 'script'] as const;
type Stage = (typeof STAGES)[number];

type Item = { title: string; transcript: string | null; duration_seconds: number | null; views: string | null };
type AnalysisResult = { channel?: string; title?: string; script?: string; duration?: string; pace?: string };
type UnitReview = { score?: number; feedback?: string; reviewedAt?: string };
type ContentUnit = {
  id: string;
  material: string;
  title: string;
  script: string;
  materialCandidates?: string[];
  titleCandidates?: string[];
  titleEn?: string;
  scriptEn?: string;
  titleJa?: string;
  scriptJa?: string;
  review?: UnitReview;
  status?: 'pending' | 'approved' | 'rejected';
  createdAt: string;
};
type ScriptDraft = {
  materials?: string[];
  selectedMaterial?: string;
  titles?: string[];
  selectedTitle?: string;
  script?: string;
  titleEn?: string;
  scriptEn?: string;
  titleJa?: string;
  scriptJa?: string;
  units?: ContentUnit[];
  updated_at?: string;
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

// pace 분석 텍스트에 "380자" 같은 목표 글자수가 있으면 뽑아 쓰고, 없으면 380자를 기본값으로 쓴다
// — 프롬프트에 "속도 패턴 참고해줘" 정도로 암시만 하면 실제로는 목표보다 짧게 나오는 경우가 많아서,
// 목표 글자수를 명시적으로 박아넣기 위함.
function extractTargetChars(pace: string | undefined): number {
  const m = pace?.match(/(\d{3,4})\s*자/);
  return m ? parseInt(m[1], 10) : 380;
}

// 단계별로 필요한 근거 자료 + 지시문을 한 군데서 만든다 — 유료(POST)/구독복사(GET) 둘 다 이 프롬프트를 그대로 쓴다.
async function buildPrompt(
  stage: Stage,
  siteId: string,
  material: string | undefined,
  title: string | undefined
): Promise<{ prompt: string; error?: string; status?: number }> {
  const supabase = getSupabaseServerClient();
  const { data: site } = await supabase.from('hub_sites').select('id, name, analysis_result').eq('id', siteId).maybeSingle();
  if (!site) return { prompt: '', error: '사이트를 찾을 수 없습니다.', status: 404 };
  const analysis: AnalysisResult = site.analysis_result || {};

  const { data: channelsData } = await supabase.from('hub_source_channels').select('id, name, notes');
  const mineChannelIds = (channelsData || []).filter((c) => c.notes?.match(CHANNEL_TAG_RE)?.[1] === site.name).map((c) => c.id);

  const { data: itemsData } = await supabase
    .from('hub_source_items')
    .select('title, transcript, duration_seconds, views')
    .in('channel_id', mineChannelIds.length > 0 ? mineChannelIds : ['__none__']);
  const items: Item[] = (itemsData || []) as Item[];
  // 대본까지 있는 것만 "확인된 소재"로 취급 — 4번과 동일한 기준.
  const withTranscript = items.filter((i) => i.transcript && i.transcript.trim().length > 20);
  const topItems = [...withTranscript].sort((a, b) => parseViews(b.views) - parseViews(a.views)).slice(0, MAX_ITEMS);

  if (stage === 'materials') {
    if (!analysis.channel && !analysis.title) {
      return { prompt: '', error: '먼저 4번 단계에서 채널/제목 분석을 실행해주세요.', status: 400 };
    }
    const itemLines = topItems.map((i) => `- "${i.title}" (조회수 ${i.views || '?'})`).join('\n');
    const prompt = `"${site.name}" 파이프라인의 다음 콘텐츠 소재를 추천해줘.

## 4번 분석 결과
${analysis.channel ? `[채널 패턴]\n${analysis.channel}\n` : ''}${analysis.title ? `[제목 패턴]\n${analysis.title}\n` : ''}

## 이미 확보한 벤치마크 소재(대본까지 확인된 것, 조회수 상위 ${topItems.length}개)
${itemLines || '(없음)'}

## 요청
위 채널/제목 패턴에 맞는 새 콘텐츠 소재를 8개 추천해줘. 두 종류를 섞어서:
1. "리뉴얼" — 위 벤치마크 소재 중 하나를 골라 우리 채널 스타일로 다르게 풀어낼 수 있는 것 (원본 제목을 괄호로 표시)
2. "신규" — 벤치마크에 없는 완전히 새로운 소재

**소재를 고르는 기준이 중요해**: "지진 내진 설계" 같은 추상적인 주제 말고, 실제로 존재하거나 존재했던 구체적인
건축물/구조물/사건을 골라줘 — 이름을 대거나 특정할 수 있는 대상이어야 해. 그리고 그 대상은 이미 검증된 실제
결과(역사적 사실·기록)를 갖고 있어야 해. 예를 들면 "100년 동안 수많은 지진을 버틴 [구체적 건물/탑]" 처럼,
오랜 시간·많은 사건을 실제로 견뎌낸 기록이 있는 대상. 사람들이 잘 모르는 숨은 원리가 있고, 그 원리 때문에
그런 검증된 결과가 나올 수 있었다는 "왜 이게 가능했지?" 호기심을 자극할 수 있는 소재를 우선해줘 — 단순 문제
해결담이 아니라 궁금증과 놀람으로 접근할 수 있는 것.

각 항목은 "[리뉴얼/신규] 소재 한 줄 설명(구체적 대상 명시)" 형식으로, 번호 매겨서 8개만 출력해줘. 다른 설명 없이 목록만.`;
    return { prompt };
  }

  if (stage === 'titles') {
    if (!material) return { prompt: '', error: 'material이 필요합니다.', status: 400 };
    const prompt = `"${site.name}" 파이프라인에서 아래 소재로 쓸 제목 후보를 추천해줘.

## 소재
${material}

## 4번 분석 결과 — 제목 패턴
${analysis.title || '(제목 패턴 분석 없음 — 일반적인 유튜브 쇼츠 후킹 원칙으로 작성)'}

## 요청
위 패턴을 그대로 적용한 제목 후보 6개를 추천해줘. 번호 매겨서 제목만 6개, 다른 설명 없이.`;
    return { prompt };
  }

  // stage === 'script' — 한국어 대본 + 영어/일본어 현지화 각색 버전까지 한 번에 요청한다.
  if (!title) return { prompt: '', error: 'title이 필요합니다.', status: 400 };
  const targetChars = extractTargetChars(analysis.pace);
  const prompt = `"${site.name}" 파이프라인의 아래 제목으로 쇼츠 대본을 작성해줘.

## 제목
${title}

## 4번 분석 결과 — 참고할 패턴
${analysis.script ? `[대본 구조 패턴]\n${analysis.script}\n` : ''}${analysis.pace ? `[속도 패턴]\n${analysis.pace}\n` : ''}${analysis.duration ? `[길이 패턴]\n${analysis.duration}\n` : ''}

## 한국어 대본 요청
위 패턴(서사 구조, 문장 스타일)을 그대로 따라서 실제 나레이션 대본 전문을 작성해줘. 오프닝 훅부터 마무리까지 완결된 형태로,
컷 구분 없이 이어지는 나레이션 텍스트 하나로. TTS가 빠른 속도로 읽는다는 걸 감안해서 숨 쉴 틈 없이 이어지는 문장으로 쓰고,
분량은 공백 포함 정확히 ${targetChars}자 내외(±20자)로 맞춰줘 — 이게 가장 중요한 조건이야, 짧게 쓰지 마.
4단 구조를 지키되 그걸 체크리스트처럼 딱딱 끊어 나열하지 말고, 접속사와 흐름을 살려서 하나의 이야기처럼 자연스럽게
이어지도록 써줘 — 구조는 맞는데 문장이 뚝뚝 끊기는 게 제일 나쁜 결과야.

추가로 아래 규칙들을 반드시 지켜줘:
- **오프닝 훅 공식**: 대본은 반드시 "여기 정신 나간 [구체적인 소품/작은 사물]을(를) [간단한 동작]" 같은 형태로 시작해줘.
  추상적인 설명("예전엔 ~하려면")으로 열지 말고, 손에 잡히는 구체적인 물건이나 인물의 행동을 먼저 하나 보여준 다음에
  본 주제로 넓혀가는 방식이야. 중요한 건 그 소품/행동 자체가 이미 "어? 저게 왜 되지?/왜 저러지?" 싶은 역설이나
  놀람을 담고 있어야 한다는 거야 — 단순히 물건을 보여주는 게 아니라 "신기하지?/어이없지?/이런 거 알아?/너 이거
  몰랐지?" 하는 뉘앙스가 첫 문장에 바로 느껴져야 해. 겉보기엔 평범한 사물/상황 뒤에 숨겨진 비밀이나 원리가 있다는
  걸 암시해서, 이 영상 전체의 반전을 축소판으로 첫 줄에 압축해서 미리 보여주는 거라고 생각해줘. (예: "여기 정신 나간 못을 망치로 때려 박으면 판자엔 쉽게 들어가지만, 이 못이 몇백 배로 커지면 무슨
  수로 박나 환장할 노릇이죠" — 작은 못은 쉬운데 커지면 불가능해 보인다는 역설이 첫 줄에 이미 들어있음. "이 남자는
  3천만 원짜리 금괴를 망치로 부었는데요" — 거액을 부순다는 것 자체가 이미 "왜?"를 유발함.) 그냥 소품 하나 등장
  시키는 걸로 끝내지 말고, 그 안에 위화감·모순이 반드시 있어야 해. 4번 분석의 대본 패턴에 이 공식이 이미 나와
  있으니 그대로 따라줘 — 절대 생략하지 마.
- **어미 리듬**: 한 문단 안에서 같은 종결어미를 반복하지 말고 "~습니다/~거든요/~죠/~겁니다/~셈입니다"를 의도적으로 교차
  배치해줘. 객관적 사실은 "~습니다"체로, 부연 설명이나 반전은 "~거든요/~죠"체로 구분해서 써줘 — 문장 끝이 계속 같은
  소리로 끝나면 기계적으로 들려서 감점 요인이야.
- **셀프 문답**: 중반 이후, 시청자가 당연히 떠올릴 법한 반박이나 의문이 있다면("그럼 ~하면 되지 않냐고요?" 같은 식으로)
  네가 먼저 질문을 던지고 바로 답하는 문장을 최소 한 번 넣어줘.
- **현실적 대가/한계**: 네이밍으로 끝내지 말고, 그 직전이나 직후에 이 해결책의 실제 비용·유지보수·부작용·한계를
  한 문장이라도 짧게 인정해줘("물론 ~라는 단점도 있습니다" 같은 식으로). 완벽한 해결로만 끝나면 오히려 신뢰도가 떨어져.

## 영어/일본어 버전 요청
같은 소재·같은 서사 구조·같은 정보를 담되, 한국어를 그대로 번역하지 말고 각 언어권 쇼츠 시청자에게 통하는 후킹 표현으로
현지화 각색해줘(영어는 영어식 임팩트 있는 구어체, 일본어는 일본어식 쇼츠 어투). 제목도 각 언어에 맞게 새로 뽑아줘.
분량은 한국어 버전과 비슷한 낭독 시간이 나오도록 맞춰줘.

## 출력 형식 — 아래 형식을 정확히 지켜줘(다른 설명 붙이지 말고 이 형식만)
[KO]
(한국어 대본 본문)

[EN]
Title: (영어 제목)
Script: (영어 대본 본문)

[JA]
Title: (일본어 제목)
Script: (일본어 대본 본문)`;
  return { prompt };
}

// buildPrompt의 "출력 형식" 그대로 온 응답을 파싱한다. 구독-복사 경로(사람이 붙여넣는 답변)도
// AI가 같은 형식으로 답하는 걸 전제로 동일하게 파싱한다 — 형식이 깨져 있으면 KO만이라도 최대한 살린다.
function parseScriptResponse(text: string): { ko: string; titleEn?: string; scriptEn?: string; titleJa?: string; scriptJa?: string } {
  const koMatch = text.match(/\[KO\]([\s\S]*?)(?=\[EN\]|\[JA\]|$)/);
  const enMatch = text.match(/\[EN\]([\s\S]*?)(?=\[JA\]|$)/);
  const jaMatch = text.match(/\[JA\]([\s\S]*?)$/);

  const ko = (koMatch ? koMatch[1] : text).trim();

  function pickField(block: string | undefined, field: 'Title' | 'Script'): string | undefined {
    if (!block) return undefined;
    const re = new RegExp(`${field}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:Title|Script)\\s*:|$)`, 'i');
    const m = block.match(re);
    return m ? m[1].trim() : undefined;
  }

  return {
    ko,
    titleEn: pickField(enMatch?.[1], 'Title'),
    scriptEn: pickField(enMatch?.[1], 'Script'),
    titleJa: pickField(jaMatch?.[1], 'Title'),
    scriptJa: pickField(jaMatch?.[1], 'Script'),
  };
}

function buildReviewPrompt(analysis: AnalysisResult, title: string, script: string): string {
  const targetChars = extractTargetChars(analysis.pace);
  return `아래 유튜브 쇼츠 제목/대본이 4번 분석에서 뽑은 패턴에 얼마나 잘 맞는지 냉정하게 평가해줘.

## 평가 대상
제목: ${title}
대본(${script.length}자): ${script}

## 기준으로 삼을 4번 분석 결과
${analysis.title ? `[제목 패턴]\n${analysis.title}\n` : ''}${analysis.script ? `[대본 구조 패턴]\n${analysis.script}\n` : ''}${analysis.pace ? `[속도 패턴, 목표 분량 약 ${targetChars}자]\n${analysis.pace}\n` : ''}

## 요청
제목 구조/길이, 대본의 4단 구조(문제제기→1차해결+위기→발상전환→네이밍) 준수 여부, 어투, 분량(목표 ${targetChars}자 대비)을
각각 짚어서 평가해줘. 특히 구조를 지키느라 문장이 뚝뚝 끊기거나 나열식으로 읽히지 않는지, 나레이션으로 쭉 읽었을 때
자연스럽게 이어지는 흐름인지도 반드시 확인해줘 — 구조 체크리스트는 맞아도 문장이 끊기면 감점.

어미 리듬도 확인해줘 — 한 문단 안에서 "~습니다/~거든요/~죠/~겁니다/~셈입니다" 같은 종결어미가 반복되지 않고
교차되는지, 팩트는 "~습니다"체·반전/부연은 "~거든요/~죠"체로 구분돼 있는지 짚어줘. 중반 이후 시청자가 떠올릴 법한
반박에 스스로 질문을 던지고 답하는 "셀프 문답"이 최소 한 번 들어있는지도 확인해줘. 완벽한 해결로만 끝나지 않고
그 해결책의 현실적 비용·한계·부작용을 짧게라도 인정하는 문장이 있는지도 확인해줘. 오프닝이 "여기 정신 나간
[구체적 소품]을 [간단한 동작]" 같은 구체적인 사물/행동으로 시작하는지, 추상적인 설명("예전엔 ~하려면")으로
시작해서 훅이 약해지지 않았는지도 확인해줘. 그 소품/행동 자체에 "왜 저러지?" 싶은 역설이나 위화감이 담겨서
영상 전체의 반전을 첫 줄에 축소판으로 미리 보여주고 있는지, 아니면 그냥 밋밋한 소품 소개에 그쳤는지도 짚어줘.

추가로 대본에 나오는 구체적인 사실(수치·연도·명칭·원리 설명 등)에 틀린 부분이 없는지도 팩트체크해줘 — 지식 콘텐츠는
숫자 하나만 틀려도 댓글에서 바로 지적당해서 신뢰가 무너지니, 확실하지 않은 부분은 FEEDBACK에 "(사실확인 필요)"라고
구체적으로 짚어줘. 사소한 문체 지적까지 전부 나열하지는 말고, 구조 이탈이나 사실 오류처럼 실제로 고쳐야 할 것 위주로만
말해줘. 마지막에 아래 형식으로 정확히 한 줄씩 출력해줘.

SCORE: (10점 만점 정수)
FEEDBACK: (2~4문장으로 구체적인 개선점 또는 통과 사유. 사실 오류가 있으면 반드시 포함)`;
}

function parseReview(text: string): UnitReview {
  const scoreMatch = text.match(/SCORE:\s*(\d+)/i);
  const feedbackMatch = text.match(/FEEDBACK:\s*([\s\S]*)/i);
  return {
    score: scoreMatch ? parseInt(scoreMatch[1], 10) : undefined,
    feedback: feedbackMatch ? feedbackMatch[1].trim() : text.trim(),
    reviewedAt: new Date().toISOString(),
  };
}

function parseStage(value: unknown): Stage | null {
  return typeof value === 'string' && STAGES.includes(value as Stage) ? (value as Stage) : null;
}

// "💬 구독으로 만들기" — 유료 API 없이 프롬프트만 만들어서 클립보드 복사용으로 돌려준다.
// action=review일 땐 소재 추천/제목/대본과 무관하게 완성된 콘텐츠 하나의 검토용 프롬프트를 돌려준다.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get('siteId');
  if (!siteId) return NextResponse.json({ error: 'siteId가 필요합니다.' }, { status: 400 });

  if (searchParams.get('action') === 'review') {
    const title = searchParams.get('title');
    const script = searchParams.get('script');
    if (!title || !script) return NextResponse.json({ error: 'title/script가 필요합니다.' }, { status: 400 });
    const supabase = getSupabaseServerClient();
    const { data: site } = await supabase.from('hub_sites').select('analysis_result').eq('id', siteId).maybeSingle();
    if (!site) return NextResponse.json({ error: '사이트를 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ prompt: buildReviewPrompt(site.analysis_result || {}, title, script) });
  }

  const stage = parseStage(searchParams.get('stage'));
  if (!stage) return NextResponse.json({ error: 'stage가 필요합니다.' }, { status: 400 });
  const material = searchParams.get('material') || undefined;
  const title = searchParams.get('title') || undefined;

  const { prompt, error, status } = await buildPrompt(stage, siteId, material, title);
  if (error) return NextResponse.json({ error }, { status: status || 400 });
  return NextResponse.json({ prompt });
}

// "✨ Gemini Pro로 만들기" — 실제로 호출해서 결과를 script_draft에 저장까지 한다.
// action=review일 땐 특정 unit 하나를 AI로 자동 검토해서 그 unit.review에 점수/피드백을 저장한다.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const siteId = body?.siteId?.trim();
  if (!siteId) return NextResponse.json({ error: 'siteId가 필요합니다.' }, { status: 400 });

  const supabase = getSupabaseServerClient();

  if (body?.action === 'review') {
    const unitId: string | undefined = body?.unitId;
    const title: string | undefined = body?.title;
    const script: string | undefined = body?.script;
    if (!unitId || !title || !script) return NextResponse.json({ error: 'unitId/title/script가 필요합니다.' }, { status: 400 });

    const { data: site } = await supabase.from('hub_sites').select('analysis_result, script_draft').eq('id', siteId).maybeSingle();
    if (!site) return NextResponse.json({ error: '사이트를 찾을 수 없습니다.' }, { status: 404 });

    let reviewText: string;
    try {
      reviewText = await callGeminiVision({
        systemPrompt: '너는 유튜브 쇼츠 콘텐츠 QA 담당자다. 냉정하고 구체적으로 평가한다.',
        userPrompt: buildReviewPrompt(site.analysis_result || {}, title, script),
        model: MODEL,
      });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }

    const review = parseReview(reviewText);
    const prevDraft: ScriptDraft = site.script_draft || {};
    const units = (prevDraft.units || []).map((u) => (u.id === unitId ? { ...u, review } : u));
    const nextDraft: ScriptDraft = { ...prevDraft, units, updated_at: new Date().toISOString() };

    const { error: saveError } = await supabase
      .from('hub_sites')
      .update({ script_draft: nextDraft, updated_at: new Date().toISOString() })
      .eq('id', siteId);
    if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });
    return NextResponse.json({ script_draft: nextDraft });
  }

  const stage = parseStage(body?.stage);
  if (!stage) return NextResponse.json({ error: 'stage가 필요합니다.' }, { status: 400 });
  const material: string | undefined = body?.material || undefined;
  const title: string | undefined = body?.title || undefined;

  const { prompt, error, status } = await buildPrompt(stage, siteId, material, title);
  if (error) return NextResponse.json({ error }, { status: status || 400 });

  let resultText: string;
  try {
    resultText = await callGeminiVision({
      systemPrompt: '너는 유튜브 쇼츠 콘텐츠 기획자 겸 작가다.',
      userPrompt: prompt,
      model: MODEL,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  const { data: site } = await supabase.from('hub_sites').select('script_draft').eq('id', siteId).maybeSingle();
  const prevDraft: ScriptDraft = site?.script_draft || {};

  let nextDraft: ScriptDraft;
  if (stage === 'materials') {
    const materials = resultText
      .split('\n')
      .map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim())
      .filter(Boolean);
    // 소재를 새로 뽑으면 그 아래(제목/대본 선택)는 더 이상 유효하지 않으므로 같이 초기화하되,
    // 이미 완성해서 기록해둔 units(콘텐츠 단위)는 그대로 보존한다.
    nextDraft = { units: prevDraft.units, materials };
  } else if (stage === 'titles') {
    const titles = resultText
      .split('\n')
      .map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim())
      .filter(Boolean);
    nextDraft = { ...prevDraft, selectedMaterial: material, titles, selectedTitle: undefined, script: undefined, titleEn: undefined, scriptEn: undefined, titleJa: undefined, scriptJa: undefined };
  } else {
    const { ko, titleEn, scriptEn, titleJa, scriptJa } = parseScriptResponse(resultText);
    nextDraft = { ...prevDraft, selectedTitle: title, script: ko, titleEn, scriptEn, titleJa, scriptJa };
  }
  nextDraft.updated_at = new Date().toISOString();

  const { error: saveError } = await supabase
    .from('hub_sites')
    .update({ script_draft: nextDraft, updated_at: new Date().toISOString() })
    .eq('id', siteId);
  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });

  return NextResponse.json({ script_draft: nextDraft });
}

// 소재/제목을 클릭으로 고르거나, 구독으로 받은 결과를 붙여넣어 저장할 때 쓰는 patch.
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const siteId = body?.siteId?.trim();
  if (!siteId) return NextResponse.json({ error: 'siteId가 필요합니다.' }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data: site } = await supabase.from('hub_sites').select('script_draft').eq('id', siteId).maybeSingle();
  if (!site) return NextResponse.json({ error: '사이트를 찾을 수 없습니다.' }, { status: 404 });
  const prevDraft: ScriptDraft = site.script_draft || {};

  const patch: Partial<ScriptDraft> = {};
  if ('materials' in body) patch.materials = body.materials;
  if ('selectedMaterial' in body) patch.selectedMaterial = body.selectedMaterial;
  if ('titles' in body) patch.titles = body.titles;
  if ('selectedTitle' in body) patch.selectedTitle = body.selectedTitle;
  if ('script' in body) patch.script = body.script;
  if ('titleEn' in body) patch.titleEn = body.titleEn;
  if ('scriptEn' in body) patch.scriptEn = body.scriptEn;
  if ('titleJa' in body) patch.titleJa = body.titleJa;
  if ('scriptJa' in body) patch.scriptJa = body.scriptJa;
  if ('units' in body) patch.units = body.units;

  const nextDraft: ScriptDraft = { ...prevDraft, ...patch, updated_at: new Date().toISOString() };
  const { error } = await supabase
    .from('hub_sites')
    .update({ script_draft: nextDraft, updated_at: new Date().toISOString() })
    .eq('id', siteId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ script_draft: nextDraft });
}
