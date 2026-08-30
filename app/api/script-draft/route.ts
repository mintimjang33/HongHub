import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { callGeminiVision } from '../../../lib/aiProviders';

// 5번(대본 작성) 단계 전용 — 소재 추천 → 제목 추천 → 대본, 3단계 파이프라인.
// 4번(analyze-materials)과 같은 이유로 pro 모델을 쓰고, 대본이 있는 소재만 신뢰해서 근거로 쓴다.
export const maxDuration = 60;

const CHANNEL_TAG_RE = /^\[파이프라인:([^\]]+)\]\s*/;
const MAX_ITEMS = 15;
const MODEL = 'gemini-3.1-pro-preview';
const STAGES = ['materials', 'titles', 'script'] as const;
type Stage = (typeof STAGES)[number];

type Item = { title: string; transcript: string | null; duration_seconds: number | null; views: string | null };
type AnalysisResult = { channel?: string; title?: string; script?: string; duration?: string; pace?: string };
type ContentUnit = { id: string; material: string; title: string; script: string; createdAt: string };
type ScriptDraft = {
  materials?: string[];
  selectedMaterial?: string;
  titles?: string[];
  selectedTitle?: string;
  script?: string;
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

각 항목은 "[리뉴얼/신규] 소재 한 줄 설명" 형식으로, 번호 매겨서 8개만 출력해줘. 다른 설명 없이 목록만.`;
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

  // stage === 'script'
  if (!title) return { prompt: '', error: 'title이 필요합니다.', status: 400 };
  const prompt = `"${site.name}" 파이프라인의 아래 제목으로 쇼츠 대본을 작성해줘.

## 제목
${title}

## 4번 분석 결과 — 참고할 패턴
${analysis.script ? `[대본 구조 패턴]\n${analysis.script}\n` : ''}${analysis.pace ? `[속도 패턴]\n${analysis.pace}\n` : ''}${analysis.duration ? `[길이 패턴]\n${analysis.duration}\n` : ''}

## 요청
위 패턴(서사 구조, 문장 스타일, 속도/길이 기준)을 그대로 따라서 실제 나레이션 대본 전문을 작성해줘. 오프닝 훅부터 마무리까지 완결된 형태로, 컷 구분 없이 이어지는 나레이션 텍스트 하나로 줘. 대본 본문만 출력하고 다른 설명은 붙이지 마.`;
  return { prompt };
}

function parseStage(value: unknown): Stage | null {
  return typeof value === 'string' && STAGES.includes(value as Stage) ? (value as Stage) : null;
}

// "💬 구독으로 만들기" — 유료 API 없이 프롬프트만 만들어서 클립보드 복사용으로 돌려준다.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get('siteId');
  const stage = parseStage(searchParams.get('stage'));
  if (!siteId || !stage) return NextResponse.json({ error: 'siteId/stage가 필요합니다.' }, { status: 400 });
  const material = searchParams.get('material') || undefined;
  const title = searchParams.get('title') || undefined;

  const { prompt, error, status } = await buildPrompt(stage, siteId, material, title);
  if (error) return NextResponse.json({ error }, { status: status || 400 });
  return NextResponse.json({ prompt });
}

// "✨ Gemini Pro로 만들기" — 실제로 호출해서 결과를 script_draft에 저장까지 한다.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const siteId = body?.siteId?.trim();
  const stage = parseStage(body?.stage);
  if (!siteId || !stage) return NextResponse.json({ error: 'siteId/stage가 필요합니다.' }, { status: 400 });
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

  const supabase = getSupabaseServerClient();
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
    nextDraft = { ...prevDraft, selectedMaterial: material, titles, selectedTitle: undefined, script: undefined };
  } else {
    nextDraft = { ...prevDraft, selectedTitle: title, script: resultText.trim() };
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
  if ('units' in body) patch.units = body.units;

  const nextDraft: ScriptDraft = { ...prevDraft, ...patch, updated_at: new Date().toISOString() };
  const { error } = await supabase
    .from('hub_sites')
    .update({ script_draft: nextDraft, updated_at: new Date().toISOString() })
    .eq('id', siteId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ script_draft: nextDraft });
}
