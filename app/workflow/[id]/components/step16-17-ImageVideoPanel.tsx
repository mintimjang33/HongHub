'use client';

import { useEffect, useRef, useState } from 'react';
import type { Site } from '../types';
import type { SceneBlock } from '../types';
import { parseSceneBlocks, serializeSceneBlocks, normalizeLabeledItems } from '../utils';
import { CopyButton, SceneEditorList } from './shared';

// 14번(구 16-17번, 씬별 이미지 프롬프트 작성·생성) 단계 패널 — 완성된 콘텐츠 목록에서 이름을
// 클릭하면 펼쳐지면서 그 콘텐츠의 장면별 CLEAN/INFO/영상 프롬프트가 타임라인 순서로 나온다.
// 데이터 자체는 11번(대본 작성)의 콘텐츠 유닛(ContentUnit.scenePrompts)에 저장되지만, 실제로
// 이미지/영상을 만들 때 찾는 곳은 여기라서 이 패널에서도 똑같이 보여주고 편집도 여기서 끝낼 수 있게 한다.
// (코드상 이름은 구버전 "Step6Panel" — 파이프라인이 5~20번 구조로 재편되며 16·17번, 이후 14번으로 옮겨졌다.)
//
// 2026-09-09 제미나이 응답 붙여넣기 → 자동 파싱 등록 기능 추가:
// 8) 14번 프롬프트가 "구간(장면 25~35개)씩 만들고 '계속'으로 이어받는" 자기분할 방식이 되면서,
//    받는 응답이 JSON 배열 여러 개(+ "(다음 구간 준비됨...)"/"[최종: ...]" 안내문)로 나뉜다.
//    사용자가 제미나이 채팅에서 "계속"을 다 끝낸 뒤 전체 대화 내용을 한 번에 복사해서 등록하겠다고
//    했는데, 그때까지는 "+ 장면 추가" 폼으로 장면을 하나씩 손으로 입력하는 방법밖에 없어서
//    수십 개 장면을 수동으로 옮겨 적어야 하는 상황이었다 — 그래서 원문을 그대로 붙여넣으면 안에
//    섞여 있는 JSON 배열들을 전부 찾아 하나로 합쳐 등록하는 붙여넣기 칸+버튼을 추가했다.
//    `extractSceneArrays()`가 중괄호/따옴표를 추적하는 괄호 매칭으로 텍스트 안의 모든 최상위
//    `[...]` 블록을 찾아 JSON.parse를 시도하고, 배열이면 순서대로 이어붙인다 — 안내문 줄
//    ("(다음 구간 준비됨...)", "[최종: ...]")은 유효한 JSON이 아니라서 자동으로 걸러진다.
//    장면 id는 제미나이가 구간마다 S01부터 다시 매길 수 있어(충돌 위험) 파싱 후 등장 순서대로
//    S01, S02...로 새로 번호를 매긴다. "등록"은 기존 scenePrompts를 통째로 교체한다(사용자가
//    전체를 한 번에 붙여넣는다는 전제).
// 7) 실기 테스트 중 제미나이가 "보안 및 외부 접근 제한으로 접속 불가"라고 답해서 원인을 추적한
//    결과, 실제로는 /share 페이지도 SRT 파일도 전혀 막혀있지 않았다(curl로 구글봇 UA까지 써서
//    200 정상 응답 + 실제 대본 텍스트가 HTML에 그대로 포함된 것까지 확인). 사용자가 직접
//    제미나이에게 캐물은 결과, 제미나이 스스로 "이 채팅 환경엔애초에 URL을 열어서 읽는 웹
//    브라우징 기능 자체가 없다"고 인정 — 링크를 준 것 자체가 애초에 성립하지 않는 접근이었다.
//    "파일을 직접 주면 안 되냐"는 대안도 검토했으나, 이 패널의 SRT 링크는 이미 2026-09-09 수정
//    이력 2번에서 기록된 것처럼 Content-Disposition 헤더가 없어 <a download>가 브라우저에서
//    무시되고 새 탭에 텍스트만 열리는 문제가 있어 "파일 첨부"가 오히려 더 번거롭다. 그래서
//    11번(대본 작성)이 처음에 하던 방식 그대로 — 대본 전문(u.script, 이미 클라이언트에 있음)과
//    자막(SRT, subtitleUrl에서 fetch로 받아옴 — Supabase Storage가 Access-Control-Allow-Origin: *
//    라 브라우저에서 바로 fetch 가능함을 확인)을 프롬프트 안에 통째로 박아넣는 방식으로 되돌렸다.
//    이러면 사용자는 복사 버튼 하나만 누르면 되고, 66개 유닛 전부에 자동 적용된다(사용자가 매번
//    직접 대본·자막을 긁어모아 전달할 필요 없음 — 사용자 지적: "그걸 언제 맨날 대본 자막을 다
//    전달해"). SRT는 패널을 펼칠 때 한 번 fetch해서 상태에 캐싱해두고, 로딩 중엔 복사 버튼 대신
//    "자막 불러오는 중..."을 보여준다.
// 6) 11번과의 대칭성을 다시 점검하니(사용자 지적: "앞단계에서 한 방식을 그대로 따라 한거
//    맞아???"), 11번은 진짜 마지막 응답에서만 [글자수: 전체 TTS 합계 N자]를 적어 "정말 끝까지
//    다 됐는지" 검증 가능하게 하는데, 14번엔 그 완료 검증 표시가 빠져 있었다. 마지막 구간
//    응답에 [최종: 총 장면 N개, 마지막 endSec X초 — SRT 끝까지 도달함]을 적게 하는 문장을
//    추가해서 11번과 동일하게 "완료 여부를 스스로 보고"하도록 맞췄다. (아래 프롬프트에도 유지)
// 5) 1차로는 "구간(시작~끝) 직접 입력" UI를 만들어서, 사용자가 시분초를 직접 계산해 넣어야
//    새 프롬프트를 복사할 수 있게 했다. 그런데 이건 11번(대본 작성)이 이미 검증해둔 훨씬 간단한
//    방식 — 프롬프트 안에 "한 번에 다 쓰지 말고 일정 분량만 쓰고 멈춘 뒤, 사용자가 '계속'이라고
//    답하면 이어서 쓰라"는 자기 분할 지시를 넣고, 제미나이 채팅 안에서 그냥 "계속"만 치면 되는
//    방식 — 을 두고 굳이 사람이 시간을 계산해 입력하게 만든 불필요하게 번거로운 구현이었다
//    (사용자 지적: "앞에 어떻게 이어서 받았는지 안나와있었어?? 이렇게 병신같이 하래?"). 구간
//    입력 UI를 걷어내고, 11번과 동일한 "한 구간 쓰고 멈춤 → '계속' → 이어서" 자기분할 지시로
//    교체했다(이 자기분할 지시 자체는 이번 수정에서도 그대로 유지).
// 4) 코카콜라 유닛(13분19초 SRT)으로 실기 테스트했더니, 전체 구간을 한 번에 요청하자 제미나이가
//    스토리 전체를 6개 장면·42초로 요약해버렸다 — 그래서 애초에 구간 분할이 필요하다는 게
//    확인됐다(원인은 위 7번 항목대로 애초에 링크를 못 읽어서 지어낸 것이었지만, 구간 분할 자체는
//    한 응답 분량을 안전하게 유지하는 데 여전히 유효하다).
//
// 2026-09-09 수정 이력 (레거시 — 위 7번에서 링크 방식 자체를 되돌렸지만, 자막 링크 필드
// (subtitleUrls)와 UI 구조는 그대로 재사용하므로 배경 맥락으로 남겨둠):
// 1) 예전 프롬프트는 사람이 귀로 듣고 타임코드를 수기로 채우는 걸 전제했다가, 13번의 실측
//    SRT 파일이 생기면서 그 링크를 전달하는 방식으로 바뀌었었다.
// 2) <a download> 버튼으로 자막 파일을 따로 받게 했으나, Content-Disposition 헤더가 없어
//    cross-origin download 속성이 무시되고 새 탭에 텍스트만 열려서, 자막 URL을 프롬프트
//    텍스트 안에 직접 적어 넣는 것으로 전환했었다(이제는 URL이 아니라 fetch한 본문을 넣음).
// 3) 대본 전문을 프롬프트에 통째로 박아넣던 것을 12번 패턴을 따라 링크로 바꿨었으나, 위 7번
//    사유로 다시 텍스트 직접 포함으로 되돌아왔다.
function formatSec(sec: number): string {
  const total = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type RawScene = {
  id?: string;
  startSec?: number;
  endSec?: number;
  screenDescription?: string;
  imagePrompt?: string;
  transitionPrompt?: string;
  needsVideoClip?: boolean;
};

// 텍스트 안에서 최상위 `[...]` JSON 배열 블록을 전부 찾아(따옴표 안의 대괄호는 무시하도록 깊이를
// 추적) 파싱을 시도한다 — 유효한 JSON 배열이면 그 원소들을 결과에 이어붙이고, 아니면
// ("(다음 구간 준비됨...)" 같은 안내문 등) 조용히 건너뛴다.
function extractSceneArrays(raw: string): RawScene[] {
  const results: RawScene[] = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '[') {
      const start = i;
      let depth = 0;
      let inString = false;
      let escape = false;
      let j = i;
      for (; j < raw.length; j++) {
        const ch = raw[j];
        if (inString) {
          if (escape) escape = false;
          else if (ch === '\\') escape = true;
          else if (ch === '"') inString = false;
        } else {
          if (ch === '"') inString = true;
          else if (ch === '[') depth++;
          else if (ch === ']') {
            depth--;
            if (depth === 0) {
              j++;
              break;
            }
          }
        }
      }
      const candidate = raw.slice(start, j);
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed)) results.push(...parsed);
      } catch {
        // 유효한 JSON 배열이 아니면 건너뜀(이어가기 안내문/완료 표시 등)
      }
      i = Math.max(j, start + 1);
    } else {
      i++;
    }
  }
  return results;
}

export function ImageVideoPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const units = site.script_draft?.units || [];
  const [openUnitId, setOpenUnitId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [srtTexts, setSrtTexts] = useState<Record<string, string>>({});
  const [srtErrors, setSrtErrors] = useState<Record<string, string>>({});
  const fetchedSrtRef = useRef<Record<string, boolean>>({});
  const [pasteTexts, setPasteTexts] = useState<Record<string, string>>({});
  const [parseInfos, setParseInfos] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!openUnitId) return;
    const u = units.find((x) => x.id === openUnitId);
    const url = normalizeLabeledItems(u?.subtitleUrls)[0]?.url;
    if (!url || fetchedSrtRef.current[openUnitId]) return;
    fetchedSrtRef.current[openUnitId] = true;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => setSrtTexts((cur) => ({ ...cur, [openUnitId]: text })))
      .catch((err) => setSrtErrors((cur) => ({ ...cur, [openUnitId]: err instanceof Error ? err.message : String(err) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openUnitId, units]);

  async function save(id: string, scenePrompts: string) {
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, unitPatch: { id, fields: { scenePrompts } } }),
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  function registerParsed(unitId: string) {
    const raw = pasteTexts[unitId] || '';
    const rawScenes = extractSceneArrays(raw);
    if (rawScenes.length === 0) {
      setParseInfos((cur) => ({ ...cur, [unitId]: '❌ 유효한 JSON 배열을 찾지 못했습니다 — 제미나이 응답 전체를 그대로 붙여넣었는지 확인해주세요.' }));
      return;
    }
    const blocks: SceneBlock[] = rawScenes.map((s, idx) => ({
      id: `S${String(idx + 1).padStart(2, '0')}`,
      title: s.screenDescription || '',
      script: '',
      note: '',
      time: `${formatSec(s.startSec ?? 0)}-${formatSec(s.endSec ?? 0)}`,
      sceneImage: '',
      imagePrompt: s.imagePrompt || '',
      clean: '',
      info: '',
      video: [s.needsVideoClip ? '[영상클립 필요]' : '', s.transitionPrompt || ''].filter(Boolean).join(' '),
      media: [],
    }));
    setParseInfos((cur) => ({ ...cur, [unitId]: `✅ ${blocks.length}개 장면 파싱 완료 — 등록 중...` }));
    save(unitId, serializeSceneBlocks(blocks)).then(() => {
      setParseInfos((cur) => ({ ...cur, [unitId]: `✅ ${blocks.length}개 장면 등록 완료` }));
      setPasteTexts((cur) => ({ ...cur, [unitId]: '' }));
    });
  }

  if (units.length === 0) {
    return (
      <div className="border-t border-black/5 pt-3">
        <p className="text-xs text-neutral-300">아직 5번(대본 작성)에서 완성된 콘텐츠가 없어요 — 먼저 대본을 완성해주세요.</p>
      </div>
    );
  }

  return (
    <div className="border-t border-black/5 pt-3">
      <div className="text-xs font-black text-neutral-500 mb-2">🎬 콘텐츠별 이미지/영상 프롬프트</div>
      <div className="space-y-1.5">
        {units.map((u) => {
          const scenes = u.scenePrompts ? parseSceneBlocks(u.scenePrompts) : [];
          const subtitleItems = normalizeLabeledItems(u.subtitleUrls);
          const srtText = srtTexts[u.id];
          const srtError = srtErrors[u.id];
          const srtReady = !!srtText;
          return (
            <div key={u.id} className="bg-white border border-neutral-100 rounded-lg overflow-hidden">
              <button
                onClick={() => setOpenUnitId((cur) => (cur === u.id ? null : u.id))}
                className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer"
              >
                <span className={`shrink-0 transition-transform text-neutral-300 ${openUnitId === u.id ? 'rotate-90' : ''}`}>▶</span>
                {u.category === 'disaster' && <span className="shrink-0 text-[10px]">🚨</span>}
                <span className="flex-1 min-w-0 truncate text-[11px] font-bold">{u.title}</span>
                {u.scenePrompts ? (
                  <span className="shrink-0 text-[10px] font-black text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5">
                    {scenes.length > 0 ? `${scenes.length}개 장면` : '있음'}
                  </span>
                ) : (
                  <span className="shrink-0 text-[10px] font-black text-neutral-300 bg-neutral-50 rounded-full px-2 py-0.5">없음</span>
                )}
              </button>
              {openUnitId === u.id && (
                <div className="px-3 pb-3 pt-1 border-t border-neutral-50">
                  <p className="text-[10px] text-neutral-400 mb-1">소재: {u.material}</p>

                  {subtitleItems.length === 0 && (
                    <p className="text-[10px] text-red-500 font-bold mb-2">아직 13번에 자막이 없습니다 — 먼저 13번에서 자막을 등록해주세요.</p>
                  )}
                  {subtitleItems.length > 0 && !srtReady && !srtError && (
                    <p className="text-[10px] text-neutral-400 mb-2">자막(SRT) 불러오는 중...</p>
                  )}
                  {srtError && (
                    <p className="text-[10px] text-red-500 font-bold mb-2">자막을 불러오지 못했습니다({srtError}) — 새로고침 후 다시 시도해주세요.</p>
                  )}

                  <p className="text-[10px] text-neutral-400 mb-2">
                    대본이 길면(10분 이상) 제미나이가 한 응답에 다 끝내려다 스토리를 요약해버릴 수 있습니다 — 아래 프롬프트는 한 구간만 만들고 멈추도록 지시해뒀습니다. 응답 끝에 "계속"이라고 답하면 이어서 다음 구간을 만듭니다(11번 대본 작성과 동일한 방식). 대본·자막 원문이 프롬프트 안에 이미 통째로 들어있으니 링크를 열 필요 없이 바로 붙여넣으면 됩니다. 제미나이 채팅에서 "계속"으로 끝까지 다 받은 뒤, 대화 전체(JSON 배열 여러 개 포함)를 그대로 복사해서 아래 붙여넣기 칸에 한 번에 넣고 등록하면 자동으로 합쳐서 저장됩니다.
                  </p>

                  <div className="inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-full border border-amber-200 bg-amber-50 mb-2">
                    <span className="text-amber-700">🔍 제미나이 프롬프트 (대본·자막 원문 포함됨)</span>
                    {srtReady || subtitleItems.length === 0 ? (
                      <CopyButton
                        text={`[역할] 너는 우리 채널 영상의 편집 감독(edit director)이다. 아래에 대본 전문과 자막(SRT) 전문을 직접 첨부했다. 이 텍스트를 그대로 읽고, 이를 기반으로 초 단위 스토리보드와 각 장면의 이미지/전환 프롬프트를 설계한다. (링크를 열 필요 없음 — 아래 텍스트가 원문 그대로다.)

[중요 — 타임코드 처리 원칙] 아래 SRT는 실제 나레이션 음성을 정밀 전사한 것으로, 각 줄의 시작~끝 초는 이미 확정된 실측값이다. 이 시간 값을 새로 추측하거나 반올림하지 말고, 반드시 SRT의 타임코드를 그대로 기준 삼아 장면 경계를 정한다 — 여러 줄을 하나의 장면으로 묶을 땐 그 줄들의 시작 초~마지막 줄의 끝 초를 그대로 장면의 startSec/endSec으로 쓴다. 스토리 전체를 몇 개의 요약 장면으로 압축하지 않는다 — 아래 SRT에 있는 모든 줄을, 처리 대상 구간 안에서는 하나도 빠짐없이 실제 길이 그대로 촘촘히(6~7초 단위로) 장면화한다.

[분량 처리 방식 — 한 번에 전체를 다 만들지 말고 반드시 아래처럼 나눠서 진행할 것]
SRT 전체 분량을 한 응답에 다 처리하려 하지 마라. 대신 SRT 맨 처음부터 시작해서, 장면 25~35개 안팎(대략 3~4분 분량)을 만들었으면 그 지점에서 멈추고, 그때까지 만든 장면들만 아래 [출력 형식]의 JSON 배열로 출력한 뒤, 그 JSON 배열 바로 다음 줄에 정확히 이렇게만 적어라: (다음 구간 준비됨 — "계속"이라고 답하면 이어서 만듭니다)
사용자가 "계속"이라고 답하면, 방금 만든 마지막 장면의 endSec 바로 다음 시점부터 이어서 — 앞서 만든 장면들을 요약하거나 다시 만들지 말고 — 다음 3~4분 분량만 새로 만들어 같은 형식(JSON 배열 + 안내문)으로 출력해라. 이 과정을 SRT의 마지막 줄(자막 끝)까지 반복한다.
SRT 마지막 줄까지 실제로 다 만든 진짜 마지막 응답에서는, 이어가기 안내문 대신 JSON 배열 바로 다음 줄에 정확히 이렇게 완료 표시를 적어라(N·X는 지금까지 만든 전체 누적 기준 실제 값으로): [최종: 총 장면 N개, 마지막 장면 endSec X초 — SRT 마지막 줄(자막 끝)까지 도달함]

[작업 지시]
1. SRT의 타임코드 줄들을 순서대로 묶어서, 하나의 장면이 대략 6~7초가 되도록 나눈다. 문장이 끊기는 자연스러운 호흡 지점(SRT 줄 경계)에서만 나누고, 문장 중간을 억지로 자르지 않는다.
2. 씬 대부분은 정지 이미지 + 줌/패닝/컷 전환으로 처리한다(이미지는 0크레딧). 대본에 [영상화] 표시가 붙은 지점(콜드오픈, 챕터 전환부 등 후킹이 강한 순간)만 실제 짧은 영상 클립이 필요한 장면으로 표시한다(needsVideoClip: true) — 전체 장면의 15~20% 이내로 제한한다.
3. transitionPrompt에는 카메라 움직임(줌인/줌아웃/패닝/틸트), 정지 이미지 간 전환 방식, needsVideoClip이 true인 경우엔 그 장면에서 실제로 어떤 동작이 일어나는지(짧은 모션)까지 영어로 구체적으로 쓴다.

[이미지 프롬프트(imagePrompt) 작성 규칙 — 반드시 지킬 것, 전부 영어로]
- 진행자가 등장하는 장면은 항상 "젠틀맨 루즈"(검은 톱햇, 금테 외알렌즈, 검은 연미복+금색 안감 망토, 능글맞고 자신감 있는 쇼맨, 반전 순간 망토를 젖히는 제스처)로 묘사한다. 레퍼런스 이미지: https://iwxpjnwktxpscoktfpyl.supabase.co/storage/v1/object/public/honghub-files/character-refs/economics-gentleman-rouge.jpg
- 실존 인물의 동작이 필요한 장면은 얼굴을 그리지 않고 손 클로즈업으로만 표현한다.
- 이 소재의 상징 사물을 의인화한 배역이 등장할 수 있다 — 팔다리·눈·표정을 붙이되 사람 얼굴 캐릭터로 그리지 않는다.
- 이미지 안에 텍스트·캡션·라벨·제목을 절대 넣지 않는다 — 프롬프트 끝에 "IMPORTANT: absolutely NO text, no captions, no title, no labels anywhere in the image"를 반드시 포함한다.
- 재질/질감 지시는 반드시 "캐릭터 표면 자체의 재질"이라고 명시한다 — 배경은 별도로 "plain solid grey background" 등으로 명확히 지정한다.
- Korean webtoon vector illustration style, flat colors, clean line art로 통일한다.

[출력 형식 — 이번 구간에서 새로 만든 장면들만 담은 JSON 배열 하나. 앞뒤 설명·마크다운 코드펜스 없이 순수 JSON 배열만, 이어가기 안내문/완료 표시는 배열 바깥 다음 줄에만.]
[
  {
    "id": "S01",
    "startSec": 0.0,
    "endSec": 9.0,
    "screenDescription": "한국어로 이 장면에서 무슨 일이 일어나는지 요약",
    "imagePrompt": "영어, Flow AI 이미지 생성용 완성된 프롬프트",
    "transitionPrompt": "영어, 카메라 움직임/전환 또는(needsVideoClip이 true일 때) 실제 동작 묘사",
    "needsVideoClip": false
  }
]

SRT에 없는 구간을 임의로 지어내지 마.

======================================================================
[대본 전문 — "${u.title}"]
======================================================================

${u.script || '(아직 11번에 대본이 없습니다)'}

======================================================================
[자막(SRT) 전문 — 실측 타임코드]
======================================================================

${srtText || '(자막 없음)'}`}
                      />
                    ) : (
                      <span className="text-[10px] text-neutral-300">대기 중...</span>
                    )}
                  </div>

                  <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-2 mb-2">
                    <p className="text-[10px] font-black text-neutral-500 mb-1">📥 제미나이 응답 붙여넣기 (구간 여러 개 한 번에 가능 — JSON 배열만 자동으로 찾아 합쳐줍니다)</p>
                    <textarea
                      value={pasteTexts[u.id] || ''}
                      onChange={(e) => setPasteTexts((cur) => ({ ...cur, [u.id]: e.target.value }))}
                      rows={6}
                      placeholder='제미나이 채팅에서 "계속"으로 다 받은 뒤, 대화 내용 전체를 그대로 여기 붙여넣으세요.'
                      className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px] font-mono leading-relaxed mb-1.5"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => registerParsed(u.id)}
                        disabled={saving || !(pasteTexts[u.id] || '').trim()}
                        className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                      >
                        {saving ? '등록 중...' : '파싱해서 등록 (기존 장면 전체 교체)'}
                      </button>
                      {parseInfos[u.id] && <span className="text-[10px] font-bold text-neutral-500">{parseInfos[u.id]}</span>}
                    </div>
                  </div>

                  <SceneEditorList scenePrompts={u.scenePrompts || ''} saving={saving} onSave={(text) => save(u.id, text)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
