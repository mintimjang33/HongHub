import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { callGeminiVision } from '../../../lib/aiProviders';

// 5번(대본 작성) 단계 전용 — 소재 추천 → 제목 추천 → 대본(한국어+영어+일본어), 3단계 파이프라인.
// + 완성된 콘텐츠 단위(unit)에 대한 AI 자동 검토(action=review).
// 4번(analyze-materials)과 같은 이유로 pro 모델을 쓰고, 대본이 있는 소재만 신뢰해서 근거로 쓴다.
//
// category('trivia'|'disaster') — 2026-08-31 추가. 대참사·사고 소재는 우리 채널 특유의 가벼운 톤
// ("정신 나간", "환장할 노릇이죠", 발상 뒤집기식 카타르시스)을 쓰면 안 되고, 오락이 아니라
// "무엇이 일어났나 → 왜 일어났나(원인) → 무엇이 바뀌었거나 바뀌어야 하나(교훈/개선)" 구조로 다뤄야
// 한다는 사용자 지시에 따라 완전히 별도의 프롬프트 세트를 쓴다.
export const maxDuration = 60;

const CHANNEL_TAG_RE = /^\[파이프라인:([^\]]+)\]\s*/;
const MAX_ITEMS = 15;
const MODEL = 'gemini-3.1-pro-preview';
const STAGES = ['materials', 'titles', 'script'] as const;
type Stage = (typeof STAGES)[number];
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
  status?: 'pending' | 'approved' | 'rejected';
  createdAt: string;
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

function parseCategory(value: unknown): Category {
  return typeof value === 'string' && CATEGORIES.includes(value as Category) ? (value as Category) : 'trivia';
}

// 단계별로 필요한 근거 자료 + 지시문을 한 군데서 만든다 — 유료(POST)/구독복사(GET) 둘 다 이 프롬프트를 그대로 쓴다.
async function buildPrompt(
  stage: Stage,
  siteId: string,
  material: string | undefined,
  title: string | undefined,
  category: Category
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

  if (category === 'disaster') return buildDisasterPrompt(stage, site.name, material, title);

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

**전 세계에서 찾아줘**: 한국/특정 지역에 국한하지 말고 전 세계를 대상으로 소재를 찾아줘. 특히 그 나라·지역의
지리·기후·역사가 낳은 고유한 공학을 우선해줘 — 예를 들어 "네덜란드는 국토 상당수가 해수면보다 낮아서 그
풍차와 제방이 발달했다", "사막 지역은 극한의 더위와 모래바람 때문에 특유의 건축 공법이 생겼다", "해안가는
파도·침식·염분 때문에 독특한 시공법이 필요했다" 같은, "이 지역만의 환경 문제 → 그걸 해결하려 발전한 공학"
구도를 가진 소재. 지역색이 뚜렷할수록 좋다. 이건 우선순위가 아니라 하나의 좋은 방향일 뿐이야 — 아래처럼
사람들이 지금 실제로 궁금해할 만한 최신 시사/재난 이슈도 똑같이 좋은 소재야: 일본 대지진·쓰나미 이후의
방재 공학, 기후 온난화로 새롭게 부각되는 이상기후 대응 공학, 최근 뉴스에 나온 홍수·산사태 같은 재해와 그
배경 원리 등. 다만 이런 최신 이슈는 특히 조심해야 해 — 최근 며칠~몇 주 안에 일어난 사건은 네가 정확한
세부사항(날짜, 피해 규모, 원인)을 모를 수도 있으니, 구체적 수치를 확신 없이 쓰지 말고 "최근 [나라]에서
발생한 [현상]" 정도로만 소재를 제안하고, 실제 대본 작성 전에 사람이 뉴스를 직접 검색해서 사실관계를
확인해야 한다고 명시해줘. 다만 사상자가 크게 발생한 인명 피해 위주의 사건이면 여기(트리비아 톤) 대신
"대참사/사건" 카테고리로 다루라고 알려줘 — 그쪽은 톤이 완전히 다르다.

**중요 — 이건 어그로가 아니라 사실 검증의 문제야**: 여기 적는 수치·연도·기록은 그냥 그럴듯하게 지어내면 안 돼.
네가 실제로 알고 있는(확신할 수 있는) 과학적·역사적 사실만 써줘. 정확한 숫자가 기억나지 않으면 "약 100년",
"수차례" 처럼 두루뭉술하게 쓰거나 아예 숫자를 빼고 서술해줘 — 없는 통계를 만들어내느니 모호한 게 낫다. 확신이
없는 소재는 후보에서 아예 빼는 게 낫다.

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

// "대참사/사건" 전용 프롬프트 — 4번 분석(오락용 트리비아 패턴)을 참고하지 않는다. 오락이 아니라
// "무엇이 일어났나 → 왜 일어났나 → 무엇이 바뀌었거나 바뀌어야 하나"를 전달하는 게 목적이고,
// "정신 나간/환장할 노릇/발상을 뒤집어버립니다" 같은 트리비아 톤은 절대 쓰지 않는다.
function buildDisasterPrompt(
  stage: Stage,
  siteName: string,
  material: string | undefined,
  title: string | undefined
): { prompt: string; error?: string; status?: number } {
  if (stage === 'materials') {
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

  if (stage === 'titles') {
    if (!material) return { prompt: '', error: 'material이 필요합니다.', status: 400 };
    const prompt = `"${siteName}" 파이프라인의 "대참사/사건" 카테고리에서 아래 소재로 쓸 제목 후보를 추천해줘.

## 소재
${material}

## 요청
자극적이거나 선정적인 표현("충격", "경악", 느낌표 남발 등) 없이, 사실을 있는 그대로 전달하는 담백한 제목으로
6개 추천해줘. 사건과 핵심 원인이 궁금해지도록 만들되, 피해자·유가족을 자극하거나 가볍게 다루는 인상을 주면
안 돼. 번호 매겨서 제목만 6개, 다른 설명 없이.`;
    return { prompt };
  }

  // stage === 'script'
  if (!title) return { prompt: '', error: 'title이 필요합니다.', status: 400 };
  const prompt = `"${siteName}" 파이프라인의 "대참사/사건" 카테고리 대본을 작성해줘.

## 제목
${title}

## 오프닝 훅 — 트리비아 카테고리와 똑같은 방식으로 시작해줘
"여기 [역설적인 상황/현상]이 있습니다" 형태로 시작해줘 — 이건 트리비아 카테고리랑 완전히 동일한 훅 공식이야.
(예: "여기 비 한 방울 내리지 않았는데 대홍수가 발생한 곳이 있습니다.") 이 도입부가 없으면 아무도 안 보니까
절대 빼지 마. 다만 사망·피해가 있는 사건이니 그 역설/사실 자체로 시청자를 몰입시키되, 아래 "절대 쓰지 말 것"에
나온 장난스러운 단어만 쓰지 않으면 돼 — 몰입감 있는 전개, 긴장감, 이야기로서의 흐름은 트리비아와 똑같이
살려줘. 이게 절대 건조한 뉴스 보도문이 되면 안 돼.

## 대본 구조 — 오프닝 훅 다음에 아래 순서로 자연스럽게 이어서
1. **사실 전달**: 무엇이, 언제, 어디서 일어났는지 검증된 사실. 오프닝 훅에서 던진 역설을 풀어가는 흐름으로.
2. **원인 분석**: 왜 일어났는지 — 공학적·구조적·시스템적 원인을 이야기하듯 설명.
3. **교훈과 개선**: 이 사건 이후 실제로 무엇이 바뀌었는지(제도, 설계 기준, 안전 규정 등), 또는 아직 진행
   중이거나 반복될 위험이 있다면 무엇이 바뀌어야 하는지.
4. **마무리**: 사건이 이미 종료됐다면 이 교훈이 지금 우리에게 주는 의미로 마무리하고, 아직 진행 중인 재난
   (수색·복구 중 등)이라면 계속된 관심과 지원을 부탁하는 문장으로 자연스럽게 이어서 마무리해줘 — 뜬금없이
   덧붙인 공지문처럼 느껴지면 안 되고, 이야기 흐름의 일부처럼 읽혀야 해.

## 절대 쓰지 말 것 (이것만 조심하면 돼 — 나머지는 트리비아 카테고리와 같은 스토리텔링 기법 그대로 써도 됨)
"정신 나간", "환장할 노릇", "~을 냅다", "발상을 뒤집어 버립니다" 같은 우리 채널 특유의 장난스러운 유행어와
가벼운 어투 "만" 빼줘. 대신 진지하면서도 몰입감 있는 표현으로 바꿔줘(예: "이때 전문가들이 나섭니다",
"그래서 접근 방식을 완전히 바꿉니다" 같은 식). 서술체("~습니다") 위주로 쓰되 어미 리듬은 여전히 살려서
기계적으로 들리지 않게 해줘. 피해 규모나 사망자 수를 과장하거나 자극적으로 표현하지 말고 사실을 존중하는
톤을 유지하되, 그렇다고 무미건조한 보도문이 되면 안 돼 — 사람들이 끝까지 보고 싶게 만드는 이야기여야 해.

## 분량
공백 포함 400~600자 정도로, 위 4단계를 각각 성실히 다룰 수 있는 만큼 충분히 써줘 — 여기선 글자수를 딱
맞추는 것보다 내용을 제대로 전달하는 게 우선이야.

## 사실 검증
확신할 수 없는 구체적 수치(사망자 수, 날짜, 규모)는 쓰지 말고 애매하게 표현하거나 생략해줘. 지어낸 통계는
절대 안 돼.

## 영어/일본어 버전 요청
같은 사실·구조·톤으로 영어, 일본어 버전도 만들어줘. 트리비아 카테고리와 달리 여기서는 "임팩트 있는 후킹
문구"로 각색하지 말고, 한국어 버전과 마찬가지로 담백하고 존중하는 어조를 그대로 유지해줘 — 오락적으로
과장하면 안 돼. 제목도 자극적이지 않게 각 언어로 자연스럽게 만들어줘.

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

  const stage = parseStage(searchParams.get('stage'));
  if (!stage) return NextResponse.json({ error: 'stage가 필요합니다.' }, { status: 400 });
  const material = searchParams.get('material') || undefined;
  const title = searchParams.get('title') || undefined;

  const { prompt, error, status } = await buildPrompt(stage, siteId, material, title, category);
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
            ? '너는 재난·사고 보도 콘텐츠의 팩트체커 겸 편집장이다. 자극적인 표현이나 부적절한 톤을 엄격하게 걸러낸다.'
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

  const stage = parseStage(body?.stage);
  if (!stage) return NextResponse.json({ error: 'stage가 필요합니다.' }, { status: 400 });
  const material: string | undefined = body?.material || undefined;
  const title: string | undefined = body?.title || undefined;

  const { prompt, error, status } = await buildPrompt(stage, siteId, material, title, category);
  if (error) return NextResponse.json({ error }, { status: status || 400 });

  let resultText: string;
  try {
    resultText = await callGeminiVision({
      systemPrompt:
        category === 'disaster'
          ? '너는 재난·사고 콘텐츠 전문 저널리스트다. 사실 위주로, 존중하는 톤으로 작성한다.'
          : '너는 유튜브 쇼츠 콘텐츠 기획자 겸 작가다.',
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
    nextDraft = { units: prevDraft.units, materials, category };
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
  if ('units' in body) patch.units = body.units;

  const nextDraft: ScriptDraft = { ...prevDraft, ...patch, updated_at: new Date().toISOString() };
  const { error } = await supabase
    .from('hub_sites')
    .update({ script_draft: nextDraft, updated_at: new Date().toISOString() })
    .eq('id', siteId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ script_draft: nextDraft });
}
