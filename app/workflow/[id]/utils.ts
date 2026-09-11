import type { Step, SceneBlock, LabeledItem, ImageStylePreset, CharacterStylePreset } from './types';

export const CHANNEL_TAG_RE = /^\[파이프라인:([^\]]+)\]\s*/;

export const TEMPLATE = `# {{프로젝트명}} 워크플로우

> 계획서(무엇을 벤치마킹하는지/어떤 소재인지)와는 별개 문서. 여기는 "어떤 순서로 어떤 도구를 쓰는지"만 담는다.

## 9단계

| # | 단계 | 내용 | 상태({{YYYY-MM-DD}}) |
|---|---|---|---|
| 1 | 채널 발굴 | 벤치마크 후보 채널을 찾아 소스채널로 등록 | |
| 2 | 채널별 소재(영상) 수집 | 채널별 잘 터진 영상의 제목/썸네일/조회수를 소재로 등록 | |
| 3 | 대본(자막) 수집 | 2번 영상들의 실제 대본 확보 | |
| 4 | 분석 | 제목/썸네일/대본에서 공통 패턴(훅/구조/톤) 추출 | |
| 5 | 대본 작성 | 4번 분석 기반 새 대본 작성 | |
| 6 | 이미지/영상 생성 | | |
| 7 | 나레이션(TTS) | | |
| 8 | 자막 | | |
| 9 | 렌더링+일괄배포 | | |

## 막히는 지점 / 다음에 정할 것

-
`;

// "| 1 | 채널 발굴 | 내용... | 상태... |" 형태의 마크다운 표 행을 파싱해서 단계 배열로 만든다.
// 헤더 행(#/단계/내용/상태)과 구분선 행(|---|...)은 건너뛴다. 표가 없거나 형식이 안 맞으면 빈 배열.
export function parseSteps(markdown: string): Step[] {
  const lines = markdown.split('\n');
  const steps: Step[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 3) continue;
    const [n, name, desc = '', status = ''] = cells;
    if (!/^\d+$/.test(n)) continue; // 헤더/구분선/숫자 아닌 행 제외
    steps.push({ n, name, desc, status });
  }
  return steps;
}

// scenePrompts 텍스트("### S01A 제목 (4초)\n대본: ...\n- CLEAN: ...\n- INFO: ...\n- 영상: ..." 형식,
// 6번 워크시트/워크플로우 문서에서 쓰는 것과 동일한 포맷)를 장면 카드 배열로 파싱한다.
// 형식이 안 맞으면(자유 텍스트로 붙여넣은 경우 등) 빈 배열을 반환하고, 그때는 원문 그대로 보여준다.
export function parseSceneBlocks(text: string): SceneBlock[] {
  if (!text) return [];
  const blocks = text
    .split(/\n(?=###\s)/)
    .map((b) => b.trim())
    .filter((b) => b.startsWith('###'));
  return blocks.map((block, idx) => {
    const lines = block.split('\n');
    const header = lines[0].replace(/^###\s*/, '');
    const headerMatch = header.match(/^(\S+)\s+(.*)$/);
    const id = headerMatch ? headerMatch[1] : `S${idx + 1}`;
    const title = headerMatch ? headerMatch[2] : header;
    let script = '';
    let note = '';
    let time = '';
    let sceneImage = '';
    let imagePrompt = '';
    let clean = '';
    let info = '';
    let video = '';
    const media: string[] = [];
    for (const line of lines.slice(1)) {
      if (line.startsWith('대본:')) script = line.replace(/^대본:\s*/, '');
      else if (line.startsWith('- 해석:')) note = line.replace(/^- 해석:\s*/, '');
      // 2026-09-07 추가 — 13번을 스토리보드(타임/장면이미지/이미지프롬프트/영상·전환프롬프트) 형태로
      // 재구성(사용자 지시). 기존 CLEAN/INFO/영상 라인은 구버전(A안 2장/D안 텍스트→영상) 데이터가
      // 깨지지 않도록 그대로 계속 읽는다 — 새 필드만 추가.
      else if (line.startsWith('- 시간:')) time = line.replace(/^- 시간:\s*/, '');
      else if (line.startsWith('- 장면이미지:')) sceneImage = line.replace(/^- 장면이미지:\s*/, '').trim();
      else if (line.startsWith('- 이미지프롬프트:')) imagePrompt = line.replace(/^- 이미지프롬프트:\s*/, '');
      else if (line.startsWith('- CLEAN:')) clean = line.replace(/^- CLEAN:\s*/, '');
      else if (line.startsWith('- INFO:')) info = line.replace(/^- INFO:\s*/, '');
      else if (line.startsWith('- 영상:')) video = line.replace(/^- 영상:\s*/, '');
      else if (line.startsWith('- 자료:')) media.push(line.replace(/^- 자료:\s*/, '').trim());
    }
    return { id, title, script, note, time, sceneImage, imagePrompt, clean, info, video, media };
  });
}

export const EMPTY_SCENE_DRAFT: SceneBlock = {
  id: '',
  title: '',
  script: '',
  note: '',
  time: '',
  sceneImage: '',
  imagePrompt: '',
  clean: '',
  info: '',
  video: '',
  media: [],
};

// Flow 등에서 만든 이미지/영상을 다운로드해서 여기로 업로드하면 /api/upload가 honghub-files
// Storage에 영구 저장하고 공개 URL을 돌려준다(Flow 자체 링크는 구글 로그인 세션에 묶이거나
// 임시 CDN이라 나중에 깨질 수 있어서, 항상 우리 쪽에 실물을 복사해두는 것).
export async function uploadSceneMedia(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '업로드 실패');
  return data.url as string;
}

// parseSceneBlocks의 역함수 — 장면 배열을 다시 "### id title\n대본: ...\n- CLEAN: ...\n- INFO: ...\n- 영상: ..." 텍스트로 합친다.
// 값이 비어있는 필드는 그 줄 자체를 안 씀(예: 텍스트→영상 직접 생성 방식은 CLEAN/INFO 없이 영상 한 줄만 있어도 됨).
export function serializeSceneBlocks(scenes: SceneBlock[]): string {
  return scenes
    .map((s) => {
      const lines = [`### ${s.id}${s.title ? ` ${s.title}` : ''}`];
      if (s.script) lines.push(`대본: ${s.script}`);
      if (s.note) lines.push(`- 해석: ${s.note}`);
      if (s.time) lines.push(`- 시간: ${s.time}`);
      if (s.sceneImage) lines.push(`- 장면이미지: ${s.sceneImage}`);
      if (s.imagePrompt) lines.push(`- 이미지프롬프트: ${s.imagePrompt}`);
      if (s.clean) lines.push(`- CLEAN: ${s.clean}`);
      if (s.info) lines.push(`- INFO: ${s.info}`);
      if (s.video) lines.push(`- 영상: ${s.video}`);
      for (const m of s.media || []) if (m) lines.push(`- 자료: ${m}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

// 기존 장면 id(S01A, S02A...)에서 숫자 부분 최댓값+1로 다음 장면 id를 제안한다.
export function nextSceneId(scenes: SceneBlock[]): string {
  let max = 0;
  for (const s of scenes) {
    const m = s.id.match(/(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `S${String(max + 1).padStart(2, '0')}A`;
}

// id에 든 숫자(S01A → 1) 기준 오름차순 정렬 — 순서를 만든 시점이 아니라 항상 번호 순서로 보이게.
export function sortScenesById(scenes: SceneBlock[]): SceneBlock[] {
  return [...scenes].sort((a, b) => {
    const na = parseInt((a.id.match(/(\d+)/) || ['', '0'])[1], 10);
    const nb = parseInt((b.id.match(/(\d+)/) || ['', '0'])[1], 10);
    if (na !== nb) return na - nb;
    return a.id.localeCompare(b.id);
  });
}

// 저장된 소재는 videoId 없이 유튜브 URL(source_url)만 갖고 있으므로, 미리보기 모달을 쓰려면
// URL 형태(watch?v=, youtu.be/, shorts/)에서 videoId를 다시 뽑아내야 한다.
export function extractVideoId(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (u.hostname.endsWith('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const shortsMatch = u.pathname.match(/^\/shorts\/([^/?]+)/);
      if (shortsMatch) return shortsMatch[1];
    }
  } catch {
    // URL 형식이 아니면 무시
  }
  return null;
}

export function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── 단계 이름/내용으로 어느 번호 단계인지 판별하는 함수들 — 파일명 번호와 매칭됨 ──

// 1번(채널 발굴)
export function isChannelStep(step: Step): boolean {
  return /채널\s*발굴/.test(`${step.name} ${step.desc}`);
}

// 2번(채널별 소재 수집) — "5.소재 선정" 단계에도 "소재"가 들어있어서 bare하게 매칭하면 이 단계에도
// 잘못 걸린다 — 2번만 매칭하도록 "수집"이 같이 나오는 경우로 좁힌다.
export function isMaterialStep(step: Step): boolean {
  return /소재.*수집|수집.*소재/.test(`${step.name} ${step.desc}`);
}

// 3번(대본(자막) 수집) — 단순히 "대본"만 매칭하면 4번·5번 설명에 "대본"이 스쳐지나가는 것까지
// 걸려버리므로, "대본...수집" 처럼 수집이 뒤에 나오는 경우만 매칭한다.
export function isTranscriptStep(step: Step): boolean {
  return /대본.*수집|자막.*수집/.test(`${step.name} ${step.desc}`);
}

// 4번(분석) — desc까지 같이 보면 5번("4번 분석 기반...")의 desc에 "분석"이 스쳐지나가는 것까지
// 걸리므로 name만 본다.
export function isAnalysisStep(step: Step): boolean {
  return /분석/.test(step.name);
}

// 5번(소재 선정) — 소재/제목/대본 위저드의 1단계(소재 목록)가 여기 속한다.
// exact match로 좁혀서 "소재 선정" 외의 다른 단계 이름에 실수로 걸리지 않게 한다.
export function isMaterialSelectionStep(step: Step): boolean {
  return step.name.trim() === '소재 선정';
}

// 6번(콘텐츠 등록) — exact match.
export function isContentRegisterStep(step: Step): boolean {
  return step.name.trim() === '콘텐츠 등록';
}

// 7번(자료조사) — exact match로 좁혀서 다른 단계 이름에 실수로 안 걸리게 한다.
export function isResearchStep(step: Step): boolean {
  return step.name.trim() === '자료조사';
}

// 8번(전략/컨셉 확정) — 이름 뒤에 "(신규)" 같은 부가 표기가 붙을 수 있어서 exact match 대신
// "전략"과 "컨셉"이 둘 다 들어있는지로 느슨하게 판별한다.
export function isStrategyStep(step: Step): boolean {
  return /전략/.test(step.name) && /컨셉/.test(step.name);
}

// 9번(훅/인트로 설계) — 위와 같은 이유로 "훅"과 "인트로"가 둘 다 들어있는지로 판별한다.
export function isHookStep(step: Step): boolean {
  return /훅/.test(step.name) && /인트로/.test(step.name);
}

// 10번(기획서 작성) — 2026-09-03 신설. 8·9번(전략/훅)이 확정된 뒤, 5·7·8·9번을 종합해 이
// 콘텐츠의 방향을 한 문서로 정리하는 단계. "기획서"라는 단어가 들어있으면 매칭한다.
export function isPlanningDocStep(step: Step): boolean {
  return /기획서/.test(step.name);
}

// 11번(대본 작성)
export function isScriptStep(step: Step): boolean {
  return /대본\s*작성/.test(step.name);
}

// 13번(나레이션)
export function isNarrationStep(step: Step): boolean {
  return /나레이션|TTS/i.test(step.name);
}

// 13번(자막) — 3번("대본(자막)·댓글·썸네일·시간 수집")에도 "자막"이 들어있어서 예전엔 이름 전체가
// 정확히 "자막"일 때만 매칭했는데, 2026-09-09 13·14번(나레이션·자막) 통합으로 단계 이름이
// "나레이션(TTS) & 자막생성"처럼 바뀌면서 exact match가 더 이상 안 걸리는 문제가 생겼다 — "자막"은
// 들어있지만 "수집"은 안 들어있는 경우로 조건을 완화해서, 3번(수집 단계)만 계속 제외하고 이후의
// 나레이션·자막 통합 단계는 새로 매칭되게 했다.
export function isSubtitleStep(step: Step): boolean {
  return /자막/.test(step.name) && !/수집/.test(step.name);
}

// 16·17번(씬별 이미지 프롬프트 작성·생성 / 영상 생성) — 2026-09-07 수정: 나레이션을 이미지/영상보다
// 앞으로 옮기면서 "이미지/영상 생성" 한 단계가 "씬별 이미지 프롬프트 작성·생성"과 "영상 생성" 두
// 단계로 쪼개졌다(경제학 등 파이프라인 재편). 원래는 이름에 "이미지"와 "영상"이 "둘 다" 있어야
// 매칭했는데, 쪼개진 두 이름은 각각 하나씩만 가지고 있어 이 스토리보드 패널이 안 열리는 버그가
// 생겼다 — "둘 중 하나"로 완화. scenePrompts 하나에 이미지 프롬프트와 영상/전환 프롬프트가 같이
// 들어있으니 두 단계 다 같은 스토리보드 표를 열어도 자연스럽다.
// 2026-09-11 수정 — 위 완화("영상"만 있어도 매칭)가 2번("채널별 소재(영상) 수집")까지 걸려버려서
// MaterialPanel과 ImageVideoPanel이 2번에 같이 뜨는 버그가 생겼다(사용자 스크린샷으로 발견).
// "수집"이 들어간 이름(2·3번)은 이 단계가 아니므로 명시적으로 제외한다.
export function isImageVideoStep(step: Step): boolean {
  if (/수집/.test(step.name)) return false;
  return /이미지/.test(step.name) || /영상/.test(step.name);
}

// 단계 이름/내용에 등장하는 키워드로 실제 작업 페이지 바로가기 링크를 만들어준다.
// "채널 발굴"(1번), "소재 수집"(2번), "대본 수집"(3번) 단계는 이 페이지에서 바로 처리할 수 있게
// 만들어서(ChannelPanel/MaterialPanel/TranscriptPanel) 별도 링크가 필요 없다.
// 2026-09-09 수정 — isNarrationStep/isSubtitleStep/isImageVideoStep이 나중에(2026-09-06~07)
// 신설됐을 때 이 제외 목록에 같이 추가하는 걸 빠뜨렸다. 그 결과 13(나레이션)·14(자막)·
// 15(씬 분할+이미지 프롬프트) 단계는 전용 패널(NarrationPanel/SubtitlePanel/ImageVideoPanel)이
// 이미 떠 있는데도, desc에 "생성"이라는 단어가 하나만 섞여 있으면(예: 14번 desc의 "음성에 맞춰
// 생성") 엉뚱한 "🎯 소스 발굴 → 콘텐츠 생성 탭" 링크가 그 밑에 같이 붙어 나왔다(사용자 지적,
// 14번 화면 스크린샷). 전용 패널이 있는 단계는 애초에 이 폴백 링크가 필요 없으므로 제외 목록에 추가.
export function stepLink(step: Step): { href: string; label: string } | null {
  const text = `${step.name} ${step.desc}`;
  if (
    isChannelStep(step) ||
    isMaterialStep(step) ||
    isTranscriptStep(step) ||
    isAnalysisStep(step) ||
    isScriptStep(step) ||
    isMaterialSelectionStep(step) ||
    isResearchStep(step) ||
    isContentRegisterStep(step) ||
    isStrategyStep(step) ||
    isHookStep(step) ||
    isPlanningDocStep(step) ||
    isNarrationStep(step) ||
    isSubtitleStep(step) ||
    isImageVideoStep(step)
  )
    return null;
  if (/생성|콘텐츠/.test(text)) return { href: '/sources?tab=generate', label: '🎯 소스 발굴 → 콘텐츠 생성 탭' };
  return null;
}

// 제미나이가 여러 후보를 "후보1: ... \n\n후보2: ..." (9번 훅 프롬프트) 또는 "A) ... \nB) ..."
// (8번 전략 프롬프트) 형식으로 한 번에 응답하는데, 사용자가 그 응답 전체를 통째로 붙여넣고
// "+ 후보 추가"를 한 번만 눌러도 각 후보가 개별 항목으로 들어가도록 자동으로 나눈다(2026-09-08
// — 사용자 지적: "이런 것을 그냥 넣으면 알아서 파싱을 해야지, 그래서 제미나이에게 어떤 식으로
// 아웃풋을 줘야 하는지까지 전달을 해야 해"). 이 라벨 패턴은 각 패널의 "🔍 제미나이 프롬프트"
// 안내문에 적힌 출력 형식과 반드시 일치해야 한다 — 프롬프트의 출력 형식을 바꾸면 이 패턴도 같이
// 고칠 것. 라벨을 하나도 못 찾으면(자유 텍스트 하나만 붙여넣은 경우) 원문 그대로 한 개짜리
// 배열로 돌려줘서 "붙여넣은 텍스트 전체를 후보 하나로 추가"하는 기존 동작을 그대로 유지한다.
const CANDIDATE_LABEL_PATTERNS = [/^\s*후보\s*\d+\s*[:：]\s*/gim, /^\s*[A-Z]\)\s*/gm];

export function splitCandidates(text: string): string[] {
  // "[최종 추천]"은 후보 목록이 아니라 그중 하나를 고르는 설명(8번 전략 프롬프트의 출력 형식에
  // 포함돼 있음) — 후보 분리 대상에서 제외한다. 안 그러면 그 설명이 마지막 후보 텍스트에 붙어버린다.
  const withoutRecommendation = text.split(/\[최종\s*추천\]/)[0];
  const trimmed = withoutRecommendation.trim();
  if (!trimmed) return [];
  for (const pattern of CANDIDATE_LABEL_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = [...trimmed.matchAll(pattern)];
    if (matches.length < 2) continue;
    const parts: string[] = [];
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index! + matches[i][0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index! : trimmed.length;
      const chunk = trimmed
        .slice(start, end)
        .trim()
        .replace(/^["“]|["”]$/g, '')
        .trim();
      if (chunk) parts.push(chunk);
    }
    if (parts.length >= 2) return parts;
  }
  return [trimmed];
}

// splitCandidates가 후보 분리 대상에서 빼버리는 "[최종 추천]" 뒤의 설명 — 후보 목록에는 안
// 섞여야 하지만, 그렇다고 그냥 버려지면 안 된다(2026-09-08, 사용자 지적: "8번에서 A를 추천한
// 이유가 아래에 있는데 왜 삭제되는거야?"). "+ 후보 추가"에서 이 함수로 따로 뽑아내서
// strategyReason/hookReason에 자동으로 채워 넣는다. 라벨이 없으면(자유 텍스트만 붙여넣은 경우)
// undefined를 돌려줘서 기존 선택 이유를 건드리지 않는다.
export function extractRecommendation(text: string): string | undefined {
  const match = text.match(/\[최종\s*추천\]([\s\S]*)$/);
  const reason = match?.[1]?.trim();
  return reason || undefined;
}

// extractRecommendation이 뽑아낸 "[최종 추천]" 설명 안에 실제로 어떤 후보(예: "A)", "후보2")를
// 추천했다는 언급이 있는지 찾아서, splitCandidates가 돌려주는 배열 기준 순번(0-based)을 돌려준다.
// 못 찾으면 null. 2026-09-08 추가 — 사용자 지적: "이 버전 선택 같은 짓을 하지 말라고" — 제미나이가
// 이미 후보 하나를 콕 집어 추천했는데, 그걸 사람이 후보 목록에서 또 찾아서 수동으로 "이 방향
// 선택"/"이 버전 선택"을 눌러야 하는 건 불필요한 손동작이라는 것. 추천 문장에 언급된 라벨을 찾아
// addOption/addHook이 selectedStrategy/selectedHook까지 한 번에 채워 넣게 한다.
export function extractRecommendedCandidateIndex(text: string): number | null {
  const match = text.match(/\[최종\s*추천\]([\s\S]*)$/);
  const reason = match?.[1];
  if (!reason) return null;
  const letterMatch = reason.match(/\b([A-Z])\)/);
  if (letterMatch) return letterMatch[1].charCodeAt(0) - 'A'.charCodeAt(0);
  const numMatch = reason.match(/후보\s*(\d+)/);
  if (numMatch) return parseInt(numMatch[1], 10) - 1;
  return null;
}

// 11번 대본은 [화면/음향 연출]과 [TTS] 줄이 번갈아 나오는 형식으로 쓰라고 프롬프트에 못박혀
// 있다(2026-09-08 추가 — 사용자 지적: "tts 만들때 우린 tts만 추출해야하지 않아?"). 13번(나레이션
// TTS 제작) 단계에서 ElevenLabs 등에 넣을 때는 화면 연출·SFX·BGM 지시문 없이 나레이션만
// 필요하므로, [TTS] 라벨이 붙은 줄만 뽑아 이어붙인다. 라벨을 하나도 못 찾으면(이 규칙 이전에
// 저장된 옛날 대본이거나 자유 형식으로 쓴 경우) 원문 그대로 돌려줘서 최소한 복사 자체는 항상
// 되게 한다 — 이 경우 화면 연출 지시문이 섞여 나올 수 있으니 사람이 눈으로 한 번 더 걸러야 한다.
export function extractTtsLines(script: string): string {
  const matches = [...script.matchAll(/\[TTS\]\s*([\s\S]*?)(?=\n\s*\[|$)/g)];
  if (matches.length === 0) return script;
  return matches
    .map((m) => m[1].trim())
    .filter(Boolean)
    .join('\n\n');
}

// 2026-09-01 이전엔 narrationUrls가 문자열 배열이었다 — 이미 저장된 예전 데이터를 위해
// 문자열이 그대로 오면 라벨 없는 항목으로 취급한다.
export function normalizeLabeledItems(raw: unknown): LabeledItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => (typeof item === 'string' ? { label: '', url: item } : (item as LabeledItem)));
}

// 상태 칸이 "미착수"/"진행 중"/"완료" 같은 정해진 키워드 대신 긴 서술문(예: "게이트 원칙 적용
// 중 — ... 각 유닛의 `factCheck` 필드가 기록이다")으로 채워지는 단계들이 있다(8~11번 등). 이런
// 경우 아래 keyword 매칭에 하나도 안 걸려 fallback으로 떨어지는데, 예전엔 fallback이 `label:
// status`로 원문 전체를 그대로 돌려줘서, 이 라벨을 그대로 뿌리는 작은 pill 배지(FlowChart.tsx의
// 단계 상세 헤더)에 문장 전체가 욱여넣어지며 레이아웃이 깨지는 버그가 있었다(2026-09-08 실측 —
// "기획서작성" 제목이 세로로 한 글자씩 밀려 쪼개짐). 배지에는 짧게 잘라서만 보여주고, 전체
// 원문은 어차피 "진행 로그 보기"에서 그대로 다 보여주므로 정보 손실은 없다.
const FALLBACK_LABEL_MAX = 20;

export function statusTone(status: string): { bg: string; border: string; text: string; label: string } {
  const s = status || '';
  if (/⚠️|막힘|막히는/.test(s)) return { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-600', label: '막힘' };
  if (/미착수/.test(s)) return { bg: 'bg-neutral-50', border: 'border-neutral-200', text: 'text-neutral-400', label: '미착수' };
  if (/진행\s*중|상시/.test(s)) return { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-600', label: '진행 중' };
  if (/검증|완료|확인|가능|결정됨/.test(s)) return { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-600', label: '완료' };
  if (!s.trim()) return { bg: 'bg-neutral-50', border: 'border-neutral-200', text: 'text-neutral-300', label: '-' };
  const trimmed = s.replace(/[*`#]/g, '').trim();
  const label = trimmed.length > FALLBACK_LABEL_MAX ? `${trimmed.slice(0, FALLBACK_LABEL_MAX)}…` : trimmed;
  return { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-600', label };
}

// 2026-09-11 추가 — 13번 화풍 선택 프리셋. 파이프라인 전체 공유값(AnalysisResult.imageStyle)으로
// 저장한다. 목록 첫 번째(인덱스 0)가 기본값 — imageStyle이 비어있을 때 이걸 쓴다. 대부분은 사용자가
// 같은 씬(약사 스틱맨+무너지는 PHARMACY 네온사인)을 Flow에서 직접 생성해 비교 확정한 것. '화풍 지정
// 안 함'은 스토리 내용과 무관하게 어두운 톤을 강제하던 버그를 수정한 버전 — 조명/분위기가 장면
// 내용을 따라가야 한다는 문장을 명시했다(사용자 지적: "왜 배경이 어두운 배경이야, 스토리에 따라
// 그림을 그려야지"). '2D 일러스트'는 그것과 구분이 잘 안 되던 것을 완전 플랫(그림자/그라데이션
// 없음)로 반대 방향으로 밀어서 분리했다. '수채화'는 사용자 요청으로 제거했다. '심슨 스타일'도
// 추가했다가 제거함 — Flow가 상표/저작권 캐릭터명("Simpsons")이 들어간 프롬프트를 거부해서
// 생성 자체가 안 됐다(사용자 실측: "심슨스타일은 거부하나봐").
export const IMAGE_STYLE_PRESETS: ImageStylePreset[] = [
  {
    id: 'default',
    label: '화풍 지정 안 함',
    promptStyle:
      "High-quality 2D digital illustration, bold webtoon/comic art style, clean thick black outlines, detailed cel shading, rich background details matching the scene's environment, full expressive color palette. The lighting and mood must follow what the scene actually depicts — bright and warm for calm or positive scenes, dark and dramatic only for scenes that are genuinely tense, scary, or negative. Do NOT force dramatic/dark lighting or glowing effects on every scene regardless of content — let the story decide the tone, scene by scene.",
    referenceImageUrl: 'https://iwxpjnwktxpscoktfpyl.supabase.co/storage/v1/object/public/honghub-files/style-refs/econ-pharmacy-1_default.jpg',
  },
  {
    id: '2d_illust',
    label: '2D 일러스트',
    promptStyle:
      'Clean flat 2D vector illustration, crisp bold outlines, completely flat cel colors with NO shading, NO gradients, NO dramatic lighting or glow effects — bright, evenly-lit graphic-design aesthetic, simple geometric shapes, poster-like flat color blocks, no 3D, no photorealism.',
    referenceImageUrl: 'https://iwxpjnwktxpscoktfpyl.supabase.co/storage/v1/object/public/honghub-files/style-refs/econ-pharmacy-2_2d_illust.jpg',
  },
  {
    id: 'pencil',
    label: '연필 그림',
    promptStyle:
      'Hand-drawn pencil sketch illustration, visible graphite pencil strokes and cross-hatching for shading, monochrome grayscale tones, textured sketchbook paper background, no color, no 3D, no photorealism.',
    referenceImageUrl: 'https://iwxpjnwktxpscoktfpyl.supabase.co/storage/v1/object/public/honghub-files/style-refs/econ-pharmacy-3_pencil.jpg',
  },
  {
    id: 'korean_webtoon',
    label: '한국형 웹툰',
    promptStyle:
      'Modern Korean webtoon illustration style, clean crisp digital linework, vivid flat-to-soft-gradient coloring, polished contemporary webtoon aesthetic typical of Korean comic platforms, no 3D, no photorealism.',
    referenceImageUrl: 'https://iwxpjnwktxpscoktfpyl.supabase.co/storage/v1/object/public/honghub-files/style-refs/econ-pharmacy-5_korean_webtoon.jpg',
  },
  {
    id: 'handdrawn',
    label: '손그림',
    promptStyle:
      'Casual hand-drawn doodle illustration, loose imperfect ink linework, marker-style flat coloring, playful sketchbook doodle aesthetic, no 3D, no photorealism.',
    referenceImageUrl: 'https://iwxpjnwktxpscoktfpyl.supabase.co/storage/v1/object/public/honghub-files/style-refs/econ-pharmacy-6_handdrawn.jpg',
  },
  {
    id: 'ink_wash',
    label: '수묵화',
    promptStyle:
      'Traditional East Asian ink wash painting (sumukhwa) style, monochrome black ink brush strokes with varying ink density, visible brush texture on traditional paper, minimal color, mostly black and white with subtle ink gray tones, no 3D, no photorealism.',
    referenceImageUrl: 'https://iwxpjnwktxpscoktfpyl.supabase.co/storage/v1/object/public/honghub-files/style-refs/econ-pharmacy-7_ink_wash.jpg',
  },
  {
    id: 'japanese_anime',
    label: '일본만화',
    promptStyle:
      'Japanese anime illustration style, large expressive sparkling eyes with detailed highlights, sharp clean cel-shaded coloring, dynamic speed lines and screentone (halftone dot) shading for dramatic effect, glossy hair with defined light reflections, no 3D, no photorealism.',
    referenceImageUrl: 'https://iwxpjnwktxpscoktfpyl.supabase.co/storage/v1/object/public/honghub-files/style-refs/econ-pharmacy-08_japanese_anime.jpg',
  },
  {
    id: 'disney_pixar',
    label: '디즈니풍',
    promptStyle:
      'Disney/Pixar-style 2D cartoon illustration, soft rounded shapes and exaggerated bouncy proportions, large round expressive eyes, smooth clean shading with warm rim lighting, vibrant saturated storybook color palette, polished family-animation look, no 3D render, no photorealism.',
    referenceImageUrl: 'https://iwxpjnwktxpscoktfpyl.supabase.co/storage/v1/object/public/honghub-files/style-refs/econ-pharmacy-09_disney_pixar.jpg',
  },
  {
    id: 'ghibli',
    label: '지브리풍',
    promptStyle:
      'Studio Ghibli-inspired illustration, soft painterly watercolor textures, gentle hand-painted brush strokes visible in the background, warm nostalgic natural lighting, muted earthy color palette with soft pastel accents, whimsical storybook atmosphere, no 3D, no photorealism.',
    referenceImageUrl: 'https://iwxpjnwktxpscoktfpyl.supabase.co/storage/v1/object/public/honghub-files/style-refs/econ-pharmacy-10_ghibli.jpg',
  },
  {
    id: 'american_comic',
    label: '아메리칸 코믹북',
    promptStyle:
      'American superhero comic book illustration style, bold thick black ink outlines, dramatic high-contrast cel shading, visible halftone dot printing texture, punchy primary color palette (red, blue, yellow), dynamic action-comic linework, no 3D, no photorealism.',
    referenceImageUrl: 'https://iwxpjnwktxpscoktfpyl.supabase.co/storage/v1/object/public/honghub-files/style-refs/econ-pharmacy-11_american_comic.jpg',
  },
  {
    id: 'retro_pixel',
    label: '레트로 픽셀아트',
    promptStyle:
      'Retro 16-bit pixel art illustration, visible square pixel blocks, limited retro color palette, blocky simplified character shapes with no smooth curves, flat dithered shading reminiscent of classic video games, no 3D, no photorealism, no smooth vector lines.',
    referenceImageUrl: 'https://iwxpjnwktxpscoktfpyl.supabase.co/storage/v1/object/public/honghub-files/style-refs/econ-pharmacy-12_retro_pixel.jpg',
  },
  {
    id: 'claymation',
    label: '클레이/스톱모션',
    promptStyle:
      'Claymation stop-motion illustration style, soft matte clay-like textures with visible fingerprint and tool-mark imperfections, chunky rounded character forms, warm diffused studio lighting, slightly imperfect handmade look, muted craft-material color palette, no photorealism, no glossy 3D render.',
    referenceImageUrl: 'https://iwxpjnwktxpscoktfpyl.supabase.co/storage/v1/object/public/honghub-files/style-refs/econ-pharmacy-13_claymation.jpg',
  },
];

// 2026-09-11 추가 — 13번 캐릭터 선택 프리셋. 화풍(IMAGE_STYLE_PRESETS)과 별개 축 — "어떻게 그릴지"가
// 아니라 "누구를 그릴지"(캐릭터 몸 비율·정체성)를 정한다. 원래 이 정체성(젠틀맨 루즈 등 스틱맨
// 캐릭터 롤플레이 텍스트)은 13번 프롬프트에 항상 고정 하드코딩돼 있었는데, 사용자가 "13단계에
// 캐릭터 선택이 화면에 안 보인다 — 스틱맨이 선택되어 있는 게 보여야 한다"고 지적해서, 화풍과
// 동일한 프리셋+선택 UI 패턴으로 뽑아냈다. 목록 첫 번째(인덱스 0)가 기본값 — AnalysisResult.
// characterStyle이 비어있을 때 이걸 쓴다. referenceImageUrl은 사용자가 Flow에서 프롬프트로 직접
// 생성해 전달한 실제 참고 이미지(Storage 영구 저장본). 모든 프리셋에 "여성 캐릭터는 머리에 리본만
// 추가" 규칙을 공통으로 적용한다(사용자 지시 — 성별 구분을 위해 복장을 새로 설계하지 않고 리본
// 하나로 최소한으로 처리).
const FEMALE_MARKER_RULE =
  '이 캐릭터의 여성 버전이 필요한 장면에서는 외형을 그대로 두고 머리 위에 리본 하나만 추가해서 성별을 구분한다(그 외 디자인은 동일).';

export const CHARACTER_STYLE_PRESETS: CharacterStylePreset[] = [
  {
    id: 'stickman',
    label: '스틱맨',
    description: `기본 스틱맨: 하얀 동그란 얼굴에 점 두 개 눈, 다른 얼굴 특징 없음. 팔다리는 얇은 선(정상적인 인체 비율이 아님, 손가락·관절·근육 묘사 없음). 옷·장신구 없이 몸 자체가 캐릭터다. 진행자(젠틀맨 루즈)로 쓸 때만 톱햇·금테 외알렌즈·검은 연미복+금빛 안감 망토를 이 스틱맨 베이스 위에 입힌다: "A minimalist vector stickman character with a round white face and simple dot eyes. Styled as 'Gentleman Rouge' wearing a black top hat, a gold-rimmed monocle, a neat curled black mustache, a black tailcoat, and a black cape with gold lining." 그 외 상황극 주인공(스틱맨 배우)은 복장 없이 역할 소품만 최소한으로 입히고, 감정 상태(절망, 탐욕, 환희 등)를 극단적으로 과장해서 표현한다. ${FEMALE_MARKER_RULE}`,
    referenceImageUrl: 'https://iwxpjnwktxpscoktfpyl.supabase.co/storage/v1/object/public/honghub-files/7dd4599c-8a36-43e2-814e-351867acd917.jpg',
  },
  {
    id: 'bean_mascot',
    label: '빈 마스코트',
    description: `둥근 몸통형(bean/blob) 마스코트: 머리와 몸통이 하나로 이어진 부드러운 타원형, 팔다리는 몸통에 붙은 짧고 뭉툭한 형태(손가락·관절 없음). 점 두 개 눈 외 다른 얼굴 특징 없음. 옷·장신구 없이 몸 표면 색으로만 구분한다. 감정 상태를 몸 전체의 기울기·통통 튀는 자세로 과장해서 표현한다. ${FEMALE_MARKER_RULE}`,
    referenceImageUrl: 'https://iwxpjnwktxpscoktfpyl.supabase.co/storage/v1/object/public/honghub-files/63386467-175c-4419-bd98-a86001a02638.jpg',
  },
  {
    id: 'bread_mascot',
    label: '식빵맨',
    description: `식빵 마스코트: 노릇노릇한 식빵 한 조각 모양(위쪽은 둥근 크러스트, 아래쪽은 평평한 단면)이 몸통이자 머리. 점 두 개 눈 외 다른 얼굴 특징 없음. 식빵 몸통에 얇은 선 팔다리가 바로 붙어있다(손가락·관절 없음, 정상적인 인체 비율 아님). 옷·장신구 없음. 감정 상태를 과장된 팔다리 동작으로 표현한다. ${FEMALE_MARKER_RULE}`,
    // ⚠️ 2026-09-11 — referenceImageUrl을 3번 시도했으나 매번 업로드 도중 데이터가 깨져서(위쪽
    // 일부만 정상, 나머지 회색/노이즈) 실패했다 — base64를 직접 옮겨적는 이 업로드 경로 자체의
    // 신뢰성 문제로 판단, 재시도 대신 빈 값으로 되돌림(UI가 🖼️ 플레이스홀더를 보여줌, 선택
    // 기능·프롬프트 반영은 이미지와 무관하게 정상 동작). 사용자가 Supabase 대시보드에서 직접
    // 올리는 게 안전하다.
    referenceImageUrl: '',
  },
];
