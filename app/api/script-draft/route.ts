import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { callGeminiVision, callGeminiGrounded } from '../../../lib/aiProviders';

// 5번(소재 선정) 단계의 소재 추천 + 완성된 콘텐츠 단위(unit)에 대한 AI 자동 검토(action=review)·
// 피드백 반영 수정(action=revise) 전용 API.
// 4번(analyze-materials)과 같은 이유로 pro 모델을 쓰고, 대본이 있는 소재만 신뢰해서 근거로 쓴다.
//
// category('trivia'|'disaster') — 2026-08-31 추가. 대참사·사고 소재는 우리 채널 특유의 가벼운 톤
// ("정신 나간", "환장할 노릇이죠", 발상 뒤집기식 카타르시스)을 쓰면 안 되고, 오락이 아니라
// "무엇이 일어났나 → 왜 일어났나(원인) → 무엇이 바뀌었거나 바뀌어야 하나(교훈/개선)" 구조로 다뤄야
// 한다는 사용자 지시에 따라 완전히 별도의 프롬프트 세트를 쓴다.
//
// 2026-09-08 삭제 — 원래 이 파일은 "소재 추천→제목 추천→대본(한국어+영어+일본어) 3단계"와
// "제미나이와 비교→업그레이드"(action=compare/upgrade)까지 처리하는 훨씬 큰 API였다. 그런데
// 클라이언트 쪽(useScriptWizard.ts)에서 이 단계들을 쓰던 옛 위저드 자체가 죽은 코드로 확인돼
// 전부 제거되면서(사용자 지적: "죽은코드는 정리해"), 이 API를 부르는 쪽엔 이제 stage='materials'
// (소재 추천)와 action='review'/'revise'만 남았다. 그래서 titles/script/translate 단계와
// compare/upgrade 액션, 그리고 그 안에 있던 채널 하드코딩 버그("아래는 유튜브 공학 쇼츠용으로
// 작성한 제목과 한국어 대본이야" — 경제학 사이트에서 호출해도 항상 "공학 쇼츠"라고 잘못
// 알려주던 buildComparePrompt)까지 통째로 걷어냈다(사용자 지적: "하드코딩 버그는 삭제해야지").
// 실제 대본 작성은 11번(step11-ScriptWritingPanel.tsx)이 클라이언트에서 직접 만든 프롬프트를
// 사람이 제미나이/Claude 구독 채팅에 붙여넣는 방식으로 이미 넘어가 있다.
export const maxDuration = 60;

const CHANNEL_TAG_RE = /^\[파이프라인:([^\]]+)\]\s*/;
const MAX_ITEMS = 15;
const MODEL = 'gemini-3.1-pro-preview';
const CATEGORIES = ['trivia', 'disaster'] as const;
type Category = (typeof CATEGORIES)[number];

type Item = { title: string; transcript: string | null; duration_seconds: number | null; views: string | null };
type AnalysisResult = { channel?: string; title?: string; script?: string; duration?: string; pace?: string };
type UnitReview = { score?: number; feedback?: string; reviewedAt?: string };
type ContentUnit = {
  id: string;
  material: string;
  title: string;
  script: string;
  category?: Category;
  // 공학 파이프라인 내 세부 분야 분류(건축/무기/토목/항공/자연재해 등) — 사용자가 늘어나는 콘텐츠를
  // 분야별로 훑어보고 싶어해서 추가. 자유 텍스트라 프리셋 밖의 값도 허용한다.
  topic?: string;
  materialCandidates?: string[];
  titleCandidates?: string[];
  titleEn?: string;
  scriptEn?: string;
  titleJa?: string;
  scriptJa?: string;
  review?: UnitReview;
  sources?: string[];
  // 사실확인 결과 — 나중에 지적받을 때 근거로 남겨두려고 완성 콘텐츠까지 따라간다.
  factCheck?: string;
  status?: 'pending' | 'approved' | 'rejected';
  createdAt: string;
};
// 12번(채널 캐릭터 시스템 설계) 단계 전용 — 채널 전체에서 반복해서 쓰는 캐릭터를 등록해두는
// 등장인물 소개(만화책 캐릭터 시트 개념) 목록. 특정 콘텐츠(unit)에 속한 게 아니라 채널 전체에서
// 공유되는 자산이라 ContentUnit이 아니라 ScriptDraft 최상위에 둔다.
type Character = {
  id: string;
  name: string;
  role: string;
  description: string;
  imageUrl?: string;
};
type ScriptDraft = {
  category?: Category;
  materials?: string[];
  selectedMaterial?: string;
  titles?: string[];
  selectedTitle?: string;
  script?: string;
  titleEn?: string;
  scriptEn?: string;
  titleJa?: string;
  scriptJa?: string;
  sources?: string[];
  factCheck?: string;
  units?: ContentUnit[];
  characters?: Character[];
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
// — buildReviewPrompt가 분량 기준으로 삼는다.
function extractTargetChars(pace: string | undefined): number {
  const m = pace?.match(/(\d{3,4})\s*자/);
  return m ? parseInt(m[1], 10) : 380;
}

function parseCategory(value: unknown): Category {
  return typeof value === 'string' && CATEGORIES.includes(value as Category) ? (value as Category) : 'trivia';
}

// 소재 추천 프롬프트를 만든다 — 유료(POST)/구독복사(GET) 둘 다 이 프롬프트를 그대로 쓴다.
async function buildPrompt(siteId: string, category: Category): Promise<{ prompt: string; error?: string; status?: number }> {
  const supabase = getSupabaseServerClient();
  const { data: site } = await supabase.from('hub_sites').select('id, name, analysis_result').eq('id', siteId).maybeSingle();
  if (!site) return { prompt: '', error: '사이트를 찾을 수 없습니다.', status: 404 };
  const analysis: AnalysisResult = site.analysis_result || {};

  if (category === 'disaster') return buildDisasterMaterialsPrompt(site.name);

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

**전 세계에서 찾아줘**: 한국/특정 지역에 국한하지 말고 전 세계를 대상으로 소재를 찾아줘. 특히 그 나라·지역의
지리·기후·역사가 낳은 고유한 공학을 우선해줘 — 예를 들어 "네덜란드는 국토 상당수가 해수면보다 낮아서 그
풍차와 제방이 발달했다", "사막 지역은 극한의 더위와 모래바람 때문에 특유의 건축 공법이 생겼다", "해안가는
파도·침식·염분 때문에 독특한 시공법이 필요했다" 같은, "이 지역만의 환경 문제 → 그걸 해결하려 발전한 공학"
구도를 가진 소재. 지역색이 뚜렷할수록 좋다. 이건 우선순위가 아니라 하나의 좋은 방향일 뿐이야 — 아래처럼
사람들이 지금 실제로 궁금해할 만한 최신 시사/재난 이슈도 똑같이 좋은 소재야: 일본 대지진·쓰나미 이후의
방재 공학, 기후 온난화로 새롭게 부각되는 이상기후 대응 공학, 최근 뉴스에 나온 홍수·산사태 같은 재해와 그
배경 원리 등. 다만 이런 최신 이슈는 특히 조심해야 해 — 최근 며칠~몇 주 안에 일어난 사건은 네가 정확한
세부사항(날짜, 피해 규모, 원인)을 모를 수도 있으니, 구체적 수치를 확신 없이 쓰지 말고 "최근 [나라]에서
발생한 [현상]" 정도로만 소재를 제안하고, 실제 대본 작성 전에 사람이 직접 뉴스를 검색해서 사실관계를
확인해야 한다고 명시해줘. 다만 사상자가 크게 발생한 인명 피해 위주의 사건이면 여기(트리비아 톤) 대신
"대참사/사건" 카테고리로 다루라고 알려줘 — 그쪽은 톤이 완전히 다르다.

**중요 — 이건 어그로가 아니라 사실 검증의 문제야**: 여기 적는 수치·연도·기록은 그냥 그럴듯하게 지어내면 안 돼.
네가 실제로 알고 있는(확신할 수 있는) 과학적·역사적 사실만 써줘. 정확한 숫자가 기억나지 않으면 "약 100년",
"수차례" 처럼 두루뭉술하게 쓰거나 아예 숫자를 빼고 서술해줘 — 없는 통계를 만들어내느니 모호한 게 낫다. 확신이
없는 소재는 후보에서 아예 빼는 게 낫다.

각 항목은 "[리뉴얼/신규] 소재 한 줄 설명(구체적 대상 명시)" 형식으로, 번호 매겨서 8개만 출력해줘. 다른 설명 없이 목록만.`;
  return { prompt };
}

// "대참사/사건" 전용 소재 추천 프롬프트 — 4번 분석(오락용 트리비아 패턴)을 참고하지 않는다. 오락이
// 아니라 "무엇이 일어났나 → 왜 일어났나 → 무엇이 바뀌었거나 바뀌어야 하나"를 전달하는 게 목적이다.
function buildDisasterMaterialsPrompt(siteName: string): { prompt: string } {
  const prompt = `"${siteName}" 파이프라인의 "대참사/사건" 카테고리용 소재를 8개 추천해줘.

## 기준
실제로 일어났던(또는 지금 진행 중인) 대형 사고·재난·참사 사례를 찾아줘. 반드시 구체적으로 특정 가능한 실제
사건이어야 하고, 이 콘텐츠의 목적은 오락이 아니라 "무엇이 일어났는지 → 왜 일어났는지(공학적/구조적/시스템적
원인) → 그 이후 무엇이 바뀌었는지 또는 무엇이 바뀌어야 하는지(교훈과 개선)"를 전달하는 것임을 명심해줘.
과거에 종료된 사건(설계 결함으로 인한 붕괴 사고, 대형 화재, 산업재해 등)과 최근 진행 중인 재난(자연재해,
기후 관련 사고 등) 둘 다 가능해.

## 사실 검증 — 가장 중요한 기준
숫자·연도·사망자 수·원인을 절대 지어내지 마. 확신할 수 있는 사실만 쓰고, 불확실하면 "정확한 시점은 확인이
필요합니다" 처럼 애매하게 표현하거나 후보에서 빼줘. 특히 최근 며칠~몇 주 안에 일어난 사건은 네 지식이
최신이 아닐 수 있으니 세부 수치 확신 없이 제안하고, 실제 대본 작성 전 사람이 직접 뉴스를 검색해서 확인해야
한다고 명시해줘.

각 항목은 "[사건명/대상] 한 줄 설명(발생 시기·장소 포함)" 형식으로, 번호 매겨서 8개만 출력해줘. 다른 설명 없이 목록만.`;
  return { prompt };
}

function buildReviewPrompt(analysis: AnalysisResult, title: string, script: string, category: Category): string {
  if (category === 'disaster') {
    return `아래 "대참사/사건" 카테고리 유튜브 쇼츠 제목/대본을 냉정하게 평가해줘.

## 평가 대상
제목: ${title}
대본(${script.length}자): ${script}

## 요청
아래 기준으로 평가해줘:
1. "여기 [역설적 상황]이 있습니다" 식의 트리비아와 동일한 오프닝 훅으로 시작하는지 — 이게 없거나 건조한
   뉴스 보도문처럼("2026년 O월 O일...") 시작하면 감점이야. 몰입감 있는 이야기 흐름(사실→원인→교훈/개선→
   마무리)으로 자연스럽게 이어지는지, 아니면 딱딱 끊어지는 보고서처럼 읽히는지도 확인해줘.
2. "정신 나간", "환장할 노릇" 같은 트리비아용 장난스러운 유행어가 섞여있지 않은지 — 있으면 지적해줘. 다만
   이건 단어 선택의 문제일 뿐, 몰입감 있는 스토리텔링 자체를 없애라는 게 아니야 — 무미건조한 보도문이 됐다면
   그것도 똑같이 지적해줘(반대 방향의 실패).
3. 제목/대본이 자극적이거나 선정적이지 않고, 피해자·유가족을 존중하는 톤을 유지하는지.
4. 구체적인 사실(사망자 수·날짜·원인 등)에 근거가 불확실해 보이는 부분이 있는지 — 있다면 FEEDBACK에
   "(사실확인 필요)"라고 짚어줘.

마지막에 아래 형식으로 정확히 한 줄씩 출력해줘.

SCORE: (10점 만점 정수)
FEEDBACK: (2~4문장으로 구체적인 개선점 또는 통과 사유. 트리비아 톤 잔존이나 사실 오류가 있으면 반드시 포함)`;
  }

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

**가장 중요한 체크 — 원리 설명 깊이**: 발상 전환 지점에서 "그래서 [해결책]을 합니다"라고 결과만 말하고 끝났는지,
아니면 왜/어떻게 그 해결책이 실제로 작동하는지 물리적·기계적 인과관계까지 설명했는지 반드시 확인해줘. 결과만
있고 원리가 빠졌다면 이게 가장 심각한 결함이야 — 분량을 맞추려고 원리 설명을 희생시킨 흔적(한 문장으로
뭉뚱그림, 인과관계 생략)이 있는지도 짚어줘.

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

// 검토(review)는 점수/피드백만 주고 끝나서 "그래서 뭘 고쳐야 하는데" 상태로 남는 문제가 있었다.
// 이 프롬프트는 그 피드백을 실제로 반영해서 대본을 다시 쓰게 시킨다 — 검토가 끝이 아니라 수정으로 이어지게.
function buildRevisePrompt(title: string, script: string, feedback: string, category: Category): string {
  const toneNote =
    category === 'disaster'
      ? '"정신 나간/환장할 노릇" 같은 트리비아 유행어는 여전히 쓰면 안 되고, 오프닝 훅+몰입감 있는 전개는 유지해줘.'
      : '우리 채널 톤(정신 나간/환장할 노릇/발상을 뒤집어 버립니다 등)과 오프닝 훅 공식, 원리 설명은 그대로 유지해줘.';
  return `아래 대본이 AI 검토에서 받은 피드백을 실제로 반영해서 대본을 다시 써줘. 지적받은 부분만 고치고
나머지 잘 된 부분(오프닝 훅, 구조, 톤)은 그대로 유지해줘 — 처음부터 새로 쓰지 마.

## 제목
${title}

## 기존 대본
${script}

## 검토 피드백 — 이걸 실제로 반영해줘
${feedback}

## 요청
피드백에서 지적한 문제를 실제로 고친 완결된 대본을 다시 써줘. ${toneNote} 특정 사실이 불확실하다고
지적됐다면 더 안전한(과장 없는) 표현으로 바꿔줘. 대본 본문만 출력하고 다른 설명은 붙이지 마.`;
}

// "💬 구독으로 만들기" — 유료 API 없이 프롬프트만 만들어서 클립보드 복사용으로 돌려준다.
// action=review일 땐 소재 추천과 무관하게 완성된 콘텐츠 하나의 검토용 프롬프트를 돌려준다.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get('siteId');
  if (!siteId) return NextResponse.json({ error: 'siteId가 필요합니다.' }, { status: 400 });
  const category = parseCategory(searchParams.get('category'));

  if (searchParams.get('action') === 'review') {
    const title = searchParams.get('title');
    const script = searchParams.get('script');
    if (!title || !script) return NextResponse.json({ error: 'title/script가 필요합니다.' }, { status: 400 });
    const supabase = getSupabaseServerClient();
    const { data: site } = await supabase.from('hub_sites').select('analysis_result').eq('id', siteId).maybeSingle();
    if (!site) return NextResponse.json({ error: '사이트를 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ prompt: buildReviewPrompt(site.analysis_result || {}, title, script, category) });
  }

  if (searchParams.get('action') === 'revise') {
    const title = searchParams.get('title');
    const script = searchParams.get('script');
    const feedback = searchParams.get('feedback');
    if (!title || !script || !feedback) return NextResponse.json({ error: 'title/script/feedback이 필요합니다.' }, { status: 400 });
    return NextResponse.json({ prompt: buildRevisePrompt(title, script, feedback, category) });
  }

  const { prompt, error, status } = await buildPrompt(siteId, category);
  if (error) return NextResponse.json({ error }, { status: status || 400 });
  return NextResponse.json({ prompt });
}

// "✨ Gemini Pro로 만들기" — 실제로 호출해서 결과를 script_draft에 저장까지 한다.
// action=review일 땐 특정 unit 하나를 AI로 자동 검토해서 그 unit.review에 점수/피드백을 저장한다.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const siteId = body?.siteId?.trim();
  if (!siteId) return NextResponse.json({ error: 'siteId가 필요합니다.' }, { status: 400 });
  const category = parseCategory(body?.category);

  const supabase = getSupabaseServerClient();

  if (body?.action === 'review') {
    const unitId: string | undefined = body?.unitId;
    const title: string | undefined = body?.title;
    const script: string | undefined = body?.script;
    if (!unitId || !title || !script) return NextResponse.json({ error: 'unitId/title/script가 필요합니다.' }, { status: 400 });

    const { data: site } = await supabase.from('hub_sites').select('analysis_result, script_draft').eq('id', siteId).maybeSingle();
    if (!site) return NextResponse.json({ error: '사이트를 찾을 수 없습니다.' }, { status: 404 });
    const prevDraftForReview: ScriptDraft = site.script_draft || {};
    const unitCategory = prevDraftForReview.units?.find((u) => u.id === unitId)?.category || category;

    let reviewText: string;
    try {
      reviewText = await callGeminiVision({
        systemPrompt:
          unitCategory === 'disaster'
            ? '너는 재난·사고 콘텐츠의 팩트체커 겸 편집장이다. 자극적인 표현이나 부적절한 톤을 엄격하게 걸러낸다.'
            : '너는 유튜브 쇼츠 콘텐츠 QA 담당자다. 냉정하고 구체적으로 평가한다.',
        userPrompt: buildReviewPrompt(site.analysis_result || {}, title, script, unitCategory),
        model: MODEL,
      });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }

    const review = parseReview(reviewText);
    const units = (prevDraftForReview.units || []).map((u) => (u.id === unitId ? { ...u, review } : u));
    const nextDraft: ScriptDraft = { ...prevDraftForReview, units, updated_at: new Date().toISOString() };

    const { error: saveError } = await supabase
      .from('hub_sites')
      .update({ script_draft: nextDraft, updated_at: new Date().toISOString() })
      .eq('id', siteId);
    if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });
    return NextResponse.json({ script_draft: nextDraft });
  }

  if (body?.action === 'revise') {
    const unitId: string | undefined = body?.unitId;
    const title: string | undefined = body?.title;
    const script: string | undefined = body?.script;
    const feedback: string | undefined = body?.feedback;
    if (!unitId || !title || !script || !feedback) return NextResponse.json({ error: 'unitId/title/script/feedback이 필요합니다.' }, { status: 400 });

    const { data: site } = await supabase.from('hub_sites').select('script_draft').eq('id', siteId).maybeSingle();
    if (!site) return NextResponse.json({ error: '사이트를 찾을 수 없습니다.' }, { status: 404 });
    const prevDraftForRevise: ScriptDraft = site.script_draft || {};
    const unitCategory = prevDraftForRevise.units?.find((u) => u.id === unitId)?.category || category;

    let revisedText: string;
    try {
      revisedText = await callGeminiVision({
        systemPrompt: '너는 유튜브 쇼츠 콘텐츠 편집자다. 검토 피드백을 실제로 반영해서 대본을 고친다.',
        userPrompt: buildRevisePrompt(title, script, feedback, unitCategory),
        model: MODEL,
      });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }

    // 대본이 바뀌었으니 기존 검토 결과는 더 이상 유효하지 않다 — 지우고 다시 검토받게 한다.
    const units = (prevDraftForRevise.units || []).map((u) =>
      u.id === unitId ? { ...u, script: revisedText.trim(), review: undefined, status: 'pending' as const } : u
    );
    const nextDraft: ScriptDraft = { ...prevDraftForRevise, units, updated_at: new Date().toISOString() };

    const { error: saveError } = await supabase
      .from('hub_sites')
      .update({ script_draft: nextDraft, updated_at: new Date().toISOString() })
      .eq('id', siteId);
    if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });
    return NextResponse.json({ script_draft: nextDraft });
  }

  // action 없음 = 소재 추천(materials) 생성 — 실제 검색 그라운딩을 켜서 출처까지 같이 받아온다.
  const { prompt, error, status } = await buildPrompt(siteId, category);
  if (error) return NextResponse.json({ error }, { status: status || 400 });

  const systemPrompt =
    category === 'disaster'
      ? '너는 재난·사고 콘텐츠 전문 저널리스트다. 사실 위주로, 존중하는 톤으로 작성한다.'
      : '너는 유튜브 쇼츠 콘텐츠 기획자 겸 작가다.';

  let resultText: string;
  try {
    const grounded = await callGeminiGrounded({ systemPrompt, userPrompt: prompt, model: MODEL });
    resultText = grounded.text;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  const { data: site } = await supabase.from('hub_sites').select('script_draft').eq('id', siteId).maybeSingle();
  const prevDraft: ScriptDraft = site?.script_draft || {};

  const materials = resultText
    .split('\n')
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean);
  // 소재를 새로 뽑으면 그 아래(제목/대본 선택)는 더 이상 유효하지 않으므로 같이 초기화하되,
  // 이미 완성해서 기록해둔 units(콘텐츠 단위)는 그대로 보존한다.
  const nextDraft: ScriptDraft = { units: prevDraft.units, materials, category, updated_at: new Date().toISOString() };

  const { error: saveError } = await supabase
    .from('hub_sites')
    .update({ script_draft: nextDraft, updated_at: new Date().toISOString() })
    .eq('id', siteId);
  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });

  return NextResponse.json({ script_draft: nextDraft });
}

// 소재를 클릭으로 고르거나, 구독으로 받은 결과를 붙여넣어 저장할 때 쓰는 patch.
//
// ⚠️ 2026-09-08 버그 수정 — "유닛 하나의 필드 몇 개만 바꾸는" 대다수의 저장(전략/훅/기획서/사실확인/
// 대본수정/캐릭터 등)이 지금까지 "이 화면이 들고 있는 units 배열 전체"를 통째로 다시 보내는 방식이었다.
// 그런데 그 배열은 이 화면을 마지막으로 불러온 시점의 스냅샷이라서, 그 사이에 다른 탭이나 다른 경로
// (예: MCP로 직접 DB에 쓴 결과)로 다른 유닛/다른 필드가 갱신됐다면, 그 갱신은 이 오래된 스냅샷으로 그냥
// 덮어써져서 조용히 사라진다 — 실제로 전략(strategyOptions/selectedStrategy)을 MCP로 갱신해놨는데
// 몇 분 뒤 화면에서 사소한 클릭 한 번 했다고 그 갱신이 통째로 원복되는 사고가 있었다. 원인은 여기 있던
// `if ('units' in body) patch.units = body.units;` — 클라이언트가 보낸 배열을 검증 없이 그대로 믿고
// 통째로 교체했기 때문. 이제 클라이언트가 "유닛 하나 + 바뀐 필드만"(unitPatch)을 보내면, 방금 위에서
// 새로 읽어온 prevDraft.units(항상 최신)를 기준으로 그 필드만 병합한다 — 클라이언트가 들고 있는 나머지
// 유닛/필드가 아무리 오래됐어도 서버의 최신 상태를 건드리지 않는다. 유닛을 통째로 추가/삭제/재배열하는
// 것처럼 배열 구조 자체가 바뀌는 드문 작업(6번 콘텐츠 등록/삭제 등)만 기존처럼 `units` 전체 교체를 쓴다.
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const siteId = body?.siteId?.trim();
  if (!siteId) return NextResponse.json({ error: 'siteId가 필요합니다.' }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data: site } = await supabase.from('hub_sites').select('script_draft').eq('id', siteId).maybeSingle();
  if (!site) return NextResponse.json({ error: '사이트를 찾을 수 없습니다.' }, { status: 404 });
  const prevDraft: ScriptDraft = site.script_draft || {};

  const patch: Partial<ScriptDraft> = {};
  if ('category' in body) patch.category = parseCategory(body.category);
  if ('materials' in body) patch.materials = body.materials;
  if ('selectedMaterial' in body) patch.selectedMaterial = body.selectedMaterial;
  if ('titles' in body) patch.titles = body.titles;
  if ('selectedTitle' in body) patch.selectedTitle = body.selectedTitle;
  if ('script' in body) patch.script = body.script;
  if ('titleEn' in body) patch.titleEn = body.titleEn;
  if ('scriptEn' in body) patch.scriptEn = body.scriptEn;
  if ('titleJa' in body) patch.titleJa = body.titleJa;
  if ('scriptJa' in body) patch.scriptJa = body.scriptJa;
  if ('sources' in body) patch.sources = body.sources;
  if ('factCheck' in body) patch.factCheck = body.factCheck;
  if ('characters' in body) patch.characters = body.characters;

  // unitPatch: { id, fields } — 유닛 하나의 지정된 필드만, 방금 새로 읽어온 최신 units를 기준으로 병합.
  // units: 배열 자체를 통째로 교체(유닛 추가/삭제 등 구조적 변경 전용, 하위호환 유지).
  if (body?.unitPatch && typeof body.unitPatch === 'object' && body.unitPatch.id) {
    const unitId: string = body.unitPatch.id;
    const fields: Record<string, unknown> = body.unitPatch.fields || {};
    patch.units = (prevDraft.units || []).map((u) => (u.id === unitId ? { ...u, ...fields } : u));
  } else if ('units' in body) {
    patch.units = body.units;
  }

  const nextDraft: ScriptDraft = { ...prevDraft, ...patch, updated_at: new Date().toISOString() };
  const { error } = await supabase
    .from('hub_sites')
    .update({ script_draft: nextDraft, updated_at: new Date().toISOString() })
    .eq('id', siteId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ script_draft: nextDraft });
}
