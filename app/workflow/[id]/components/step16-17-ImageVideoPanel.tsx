'use client';

import { useEffect, useRef, useState } from 'react';
import type { Site } from '../types';
import type { SceneBlock } from '../types';
import { parseSceneBlocks, serializeSceneBlocks, normalizeLabeledItems, IMAGE_STYLE_PRESETS } from '../utils';
import { CopyButton, SceneEditorList } from './shared';

// 13번(구 16-17번, 씬별 이미지 프롬프트 작성·생성) 단계 패널 — 완성된 콘텐츠 목록에서 이름을
// 클릭하면 펼쳐지면서 그 콘텐츠의 장면별 CLEAN/INFO/영상 프롬프트가 타임라인 순서로 나온다.
// 데이터 자체는 11번(대본 작성)의 콘텐츠 유닛(ContentUnit.scenePrompts)에 저장되지만, 실제로
// 이미지/영상을 만들 때 찾는 곳은 여기라서 이 패널에서도 똑같이 보여주고 편집도 여기서 끝낼 수 있게 한다.
// (코드상 이름은 구버전 "Step6Panel" — 파이프라인이 5~20번 구조로 재편되며 16·17번, 이후 14번, 12번
// 캐릭터 시트 단계 삭제로 다시 13번으로 옮겨졌다.)
//
// 2026-09-11 화풍 선택 기능 추가 (7개 프리셋 + 참고 이미지):
// 사용자가 같은 씬(약사 스틱맨+무너지는 PHARMACY 네온사인)을 Flow에서 7개 화풍으로 직접 만들어
// 비교 확정했다(화풍 지정 안함/2D 일러스트/연필 그림/수채화/한국형 웹툰/손그림/수묵화). 처음엔
// ①·②가 거의 구분 안 됐는데(둘 다 디테일한 음영), ②를 "완전 플랫, 그림자/그라데이션 없음"으로
// 정반대 방향으로 밀어서 분리했다. 7개 프리셋(프롬프트 문구+참고 이미지 URL)은 `IMAGE_STYLE_PRESETS`
// (utils.ts)에 정의돼 있다.
//
// 2026-09-11 저장 범위 수정 — 사이트 전체 공유값 → 콘텐츠 유닛별로 변경:
// 처음엔 선택한 화풍을 `site.analysis_result.imageStyle`(파이프라인 전체 공유)에 저장했는데,
// 사용자가 "화풍을 1번으로 기본설정으로 해두고 컨텐츠마다 고를수 있게 하면 되겠다"고 정정 — 코카콜라
// 유닛과 카페인 유닛이 서로 다른 화풍을 쓸 수 있어야 한다. `ContentUnit.imageStyle`(types.ts)로
// 옮기고, 이 패널도 사이트 최상단이 아니라 각 유닛 카드 안에 화풍 선택 UI를 넣도록 재작성했다.
// 저장은 scenePrompts와 같은 방식(`/api/script-draft`의 unitPatch)을 그대로 재사용한다. 캐릭터
// (스틱맨 정체성)는 화풍과 무관하게 항상 고정 — 화풍이 바뀌어도 안 바뀐다.
//
// 2026-09-11 "화풍 지정 안 함" 프리셋 수정 — 스토리 무관 조명 강제 버그:
// 처음 버전은 이름과 달리 "dramatic lighting... glowing effects for dramatic emphasis"를 항상
// 강제하고 있었다(사용자 지적: "왜 배경이 어두운 배경이야, 그냥 스토리에 따라 그림을 그려야지").
// 테스트에 쓴 약사+네온사인 장면이 원래 극적이라 안 드러났을 뿐, 밝고 잔잔한 장면에도 똑같이
// 어두운 톤이 강제되는 구조였다. IMAGE_STYLE_PRESETS의 'default' 항목에서 조명/분위기가 장면
// 내용을 그대로 따라가도록(밝은 장면=밝게, 어두운 장면만 어둡게) 수정하고, "매 장면에 극적 조명을
// 강제하지 마라"는 문장을 명시 추가했다.
//
// 2026-09-11 화풍 2차 확장 (6종 추가, 13종 체제):
// 사용자 요청으로 일본만화/디즈니풍/지브리풍/아메리칸 코믹북/레트로 픽셀아트/클레이(스톱모션) 6종을
// 추가했다. 사용자가 Flow에서 직접 1:1 비율로 생성한 이미지를 레퍼런스로 썼다(IMAGE_STYLE_PRESETS
// 참고).
//
// 2026-09-11 화풍 전면 교체 (플랫 벡터 → 디테일한 웹툰/코믹 일러스트) + 이 파일 자체가 실제로는
// 안 고쳐져 있던 버그 수정:
// workflow_content(DB) 문서는 사용자가 실제 테스트 이미지(S01: 약사 스틱맨+무너지는 네온사인)를
// 보고 "난 처음부터 이런 걸 원했다"고 확정한 뒤 "디테일한 음영·조명이 들어간 웹툰/코믹 일러스트"
// 화풍으로 갱신됐는데, 정작 이 패널의 복사 버튼 프롬프트(사용자가 실제로 복사해 Gemini에 붙여넣는
// 텍스트)는 옛날 "2D flat vector illustration, no shading, no gradients, limited color palette
// (black, white, red, gold), bright plain solid-color background" 문구가 그대로 남아있었다 —
// 문서만 "동기화 완료"라고 기록하고 이 파일은 실제로 안 고친 것. 코카콜라 유닛 87개 씬이 전부 이
// 옛 프롬프트로 만들어진 걸 사용자가 직접 발견해서("니가 제미나이에게 전달하는 프롬프트가 수정이
// 안된거 아니야???") 드러났다.
// **이 패널 프롬프트 문구를 다시 고칠 일이 생기면, 반드시 이 코드 파일(IMAGE_STYLE_PRESETS 포함)과
// workflow_content(DB) 13번 행 마스터 지침 코드블록을 "실제로 둘 다" 갱신할 것 — 한쪽만 고치고
// "동기화 완료"라고 적어두는 실수를 반복하지 않는다. 가능하면 갱신 직후 이 패널에서 실제로
// 복사되는 텍스트를 직접 눈으로 확인해서 새 문구가 들어갔는지 검증할 것.**
//
// 2026-09-11 시간 커버리지 누락 방지 재확인 문구 추가:
// 등록된 씬이 SRT 전체를 다 커버하지 못하고 중간에 "완료"로 등록되는 사고가 있었다(코카콜라 유닛
// 87개 씬이 12:00에서 멈춤, 실제 SRT는 13:19까지). [분량 처리 방식] 섹션에 완료 표시 직전 SRT
// 끝 시각과 정확히 일치하는지 재확인하라는 문구를 추가했다 — 아래 참고.
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
  // 2026-09-11 추가 — 화풍 선택 저장 중 표시. 콘텐츠 유닛별로 저장하므로(아래 selectUnitStyle),
  // 지금 저장 중인 유닛 id만 기록해서 그 유닛의 칩 버튼만 비활성화한다(다른 유닛은 계속 조작 가능).
  const [savingStyleUnitId, setSavingStyleUnitId] = useState<string | null>(null);

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

  // 2026-09-11 수정 — 화풍 선택은 콘텐츠 유닛별 값(ContentUnit.imageStyle)이라, scenePrompts와
  // 똑같이 /api/script-draft의 unitPatch로 그 유닛 하나만 패치한다(사이트 analysis_result 전체
  // 교체 방식이었던 것에서 변경 — 다른 유닛의 화풍이나 site.analysis_result의 다른 필드를 건드릴
  // 위험이 없다).
  async function selectUnitStyle(unitId: string, styleId: string) {
    setSavingStyleUnitId(unitId);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, unitPatch: { id: unitId, fields: { imageStyle: styleId } } }),
      });
      onRefresh();
    } finally {
      setSavingStyleUnitId(null);
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
          // 2026-09-11 추가 — 이 유닛의 화풍(콘텐츠마다 다를 수 있음). 비어있으면 기본값(인덱스 0,
          // "화풍 지정 안 함")을 쓴다 — 사용자 지시: "화풍을 1번으로 기본설정으로 해두고 컨텐츠마다
          // 고를수 있게".
          const unitStyleId = u.imageStyle || IMAGE_STYLE_PRESETS[0].id;
          const unitPreset = IMAGE_STYLE_PRESETS.find((p) => p.id === unitStyleId) || IMAGE_STYLE_PRESETS[0];
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

                  {/* 2026-09-11 추가 — 이 콘텐츠 유닛 전용 화풍 선택 UI. 사이트 전체가 아니라
                      이 유닛(u.imageStyle)에만 저장된다. 참고 이미지(같은 씬을 13개 화풍으로 실측한
                      것) 썸네일 + 라벨을 칩 버튼으로 보여주고, 선택된 것만 테두리 강조. */}
                  <div className="mb-2">
                    <div className="text-[10px] font-black text-neutral-500 mb-1">🎨 이 콘텐츠의 화풍 (기본값: {IMAGE_STYLE_PRESETS[0].label}, 캐릭터는 화풍과 무관하게 항상 스틱맨으로 고정)</div>
                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                      {IMAGE_STYLE_PRESETS.map((preset) => {
                        const active = preset.id === unitStyleId;
                        return (
                          <button
                            key={preset.id}
                            onClick={() => selectUnitStyle(u.id, preset.id)}
                            disabled={savingStyleUnitId === u.id}
                            className={`shrink-0 flex flex-col items-center gap-1 rounded-lg p-1.5 border-2 transition disabled:opacity-50 ${
                              active ? 'border-black bg-neutral-50' : 'border-transparent hover:border-neutral-200'
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={preset.referenceImageUrl} alt={preset.label} className="w-14 h-14 object-cover rounded-md border border-neutral-200" />
                            <span className={`text-[9px] font-bold whitespace-nowrap ${active ? 'text-black' : 'text-neutral-400'}`}>{preset.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {subtitleItems.length === 0 && (
                    <p className="text-[10px] text-red-500 font-bold mb-2">아직 12번에 자막이 없습니다 — 먼저 12번에서 자막을 등록해주세요.</p>
                  )}
                  {subtitleItems.length > 0 && !srtReady && !srtError && (
                    <p className="text-[10px] text-neutral-400 mb-2">자막(SRT) 불러오는 중...</p>
                  )}
                  {srtError && (
                    <p className="text-[10px] text-red-500 font-bold mb-2">자막을 불러오지 못했습니다({srtError}) — 새로고침 후 다시 시도해주세요.</p>
                  )}

                  <p className="text-[10px] text-neutral-400 mb-2">
                    현재 화풍: <span className="font-bold text-neutral-600">{unitPreset.label}</span> (위에서 바꿀 수 있음). 대본이 길면(10분 이상) 제미나이가 한 응답에 다 끝내려다 스토리를 요약해버릴 수 있습니다 — 아래 프롬프트는 한 구간만 만들고 멈추도록 지시해뒀습니다. 응답 끝에 "계속"이라고 답하면 이어서 다음 구간을 만듭니다(11번 대본 작성과 동일한 방식). 대본·자막 원문이 프롬프트 안에 이미 통째로 들어있으니 링크를 열 필요 없이 바로 붙여넣으면 됩니다. 제미나이 채팅에서 "계속"으로 끝까지 다 받은 뒤, 대화 전체(JSON 배열 여러 개 포함)를 그대로 복사해서 아래 붙여넣기 칸에 한 번에 넣고 등록하면 자동으로 합쳐서 저장됩니다. ⚠️ 등록 후에는 마지막 장면의 끝 시간이 실제 자막(SRT) 마지막 줄과 일치하는지 꼭 눈으로 확인하세요 — 중간에 완료로 착각하고 멈추면 뒷부분(클로징 멘트 등)이 통째로 비게 됩니다.
                  </p>

                  <div className="inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-full border border-amber-200 bg-amber-50 mb-2">
                    <span className="text-amber-700">🔍 제미나이 프롬프트 (대본·자막 원문 포함됨)</span>
                    {srtReady || subtitleItems.length === 0 ? (
                      <CopyButton
                        text={`[역할] 너는 우리 유튜브 경제/지식 채널 영상의 편집 감독(edit director)이다. 아래에 대본 전문과 자막(SRT) 전문을 직접 첨부했다. 이 텍스트를 그대로 읽고, 이를 기반으로 초 단위 스토리보드와 각 장면의 완벽한 한 장의 일러스트(이미지/전환) 프롬프트를 설계한다. (링크를 열 필요 없음 — 아래 텍스트가 원문 그대로다.)

[타임코드 및 분할 원칙] 아래 SRT는 실제 나레이션 음성을 정밀 전사한 것으로, 각 줄의 시작~끝 초는 이미 확정된 실측값이다. 이 시간 값을 새로 추측하거나 반올림하지 말고, 반드시 SRT의 타임코드를 그대로 기준 삼아 장면 경계를 정한다 — 여러 줄을 하나의 장면으로 묶을 땐 그 줄들의 시작 초~마지막 줄의 끝 초를 그대로 장면의 startSec/endSec으로 쓴다. 스토리 전체를 몇 개의 요약 장면으로 압축하지 않는다 — 아래 SRT에 있는 모든 줄을, 처리 대상 구간 안에서는 하나도 빠짐없이 실제 길이 그대로 촘촘히(6~7초 단위로) 장면화한다.

[분량 처리 방식 — 한 번에 전체를 다 만들지 말고 반드시 아래처럼 나눠서 진행할 것]
SRT 전체 분량을 한 응답에 다 처리하려 하지 마라. 대신 SRT 맨 처음부터 시작해서, 장면 25~35개 안팎(대략 3~4분 분량)을 만들었으면 그 지점에서 멈추고, 그때까지 만든 장면들만 아래 [출력 형식]의 JSON 배열로 출력한 뒤, 그 JSON 배열 바로 다음 줄에 정확히 이렇게만 적어라: (다음 구간 준비됨 — "계속"이라고 답하면 이어서 만듭니다)
사용자가 "계속"이라고 답하면, 방금 만든 마지막 장면의 endSec 바로 다음 시점부터 이어서 — 앞서 만든 장면들을 요약하거나 다시 만들지 말고 — 다음 3~4분 분량만 새로 만들어 같은 형식(JSON 배열 + 안내문)으로 출력해라. 이 과정을 SRT의 마지막 줄(자막 끝)까지 반복한다.
SRT 마지막 줄까지 실제로 다 만든 진짜 마지막 응답에서는, 이어가기 안내문 대신 JSON 배열 바로 다음 줄에 정확히 이렇게 완료 표시를 적어라(N·X는 지금까지 만든 전체 누적 기준 실제 값으로): [최종: 총 장면 N개, 마지막 장면 endSec X초 — SRT 마지막 줄(자막 끝)까지 도달함]
⚠️ 완료 표시를 적기 전에 반드시 재확인해라: 지금 만든 마지막 장면의 endSec이 위에 첨부된 SRT의 진짜 마지막 줄(자막 끝) 타임코드와 정확히 일치하는가? 스토리 내용상 자연스럽게 마무리되는 것처럼 느껴져도, SRT에 아직 처리하지 않은 줄이 하나라도 남아있다면(클로징 멘트, 구독 유도, 아웃트로 등 포함) 그건 완료가 아니다 — 그 부분까지 전부 SRT 끝까지 빠짐없이 장면화한 뒤에만 완료 표시를 적는다. 중간에 스토리가 끝난 것처럼 보인다고 일찍 완료 표시를 적는 실수를 절대 하지 마라.

[작업 지시]
1. SRT의 타임코드 줄들을 순서대로 묶어서, 하나의 장면이 대략 6~7초가 되도록 나눈다. 문장이 끊기는 자연스러운 호흡 지점(SRT 줄 경계)에서만 나누고, 문장 중간을 억지로 자르지 않는다.
2. 씬 대부분은 정지 이미지 + 줌/패닝/컷 전환으로 처리한다(이미지는 0크레딧). 대본에 [영상화] 표시가 붙은 지점(콜드오픈, 챕터 전환부 등 후킹이 강한 순간)만 실제 짧은 영상 클립이 필요한 장면으로 표시한다(needsVideoClip: true) — 전체 장면의 15~20% 이내로 제한한다.
3. transitionPrompt에는 카메라 움직임(줌인/줌아웃/패닝/틸트), 정지 이미지 간 전환 방식, needsVideoClip이 true인 경우엔 그 장면에서 실제로 어떤 동작이 일어나는지(짧은 모션)까지 영어로 구체적으로 쓴다.

[수정된 이미지 프롬프트(imagePrompt) 4대 핵심 원칙 — 반드시 지킬 것, 전부 영어로]
1. 비주얼 톤앤매너 (2026-09-11 화풍 선택 기능 반영 — 이 콘텐츠에 현재 선택된 화풍: "${unitPreset.label}"): "${unitPreset.promptStyle}"로 통일한다. 모든 캐릭터는 예외 없이 스틱맨 몸(얇은 선 팔다리 + 단순한 동그란 머리) 비율로만 그린다 — 정상적인 인체 비율(어깨 넓은 몸통, 상세한 손가락·근육 등)로 그리지 않는다. 이 캐릭터 비율 규칙은 화풍과 무관하게 항상 고정이다.
2. 인물 필수 등장 및 '주어' 전진 배치 (핵심 수정!): 절대 사물이나 배경만 덩그러니 있는 정물화/풍경화 컷을 만들지 마라. 모든 컷에는 반드시 메인 화자(젠틀맨 루즈)나 해당 씬의 주인공(스틱맨 펨버턴, 스틱맨 캔들러, 군중 등)이 프레임 안에 크게 등장해야 한다. AI가 인물을 최우선으로 그리도록, 영어 프롬프트는 반드시 다음 순서로 작성한다: [비주얼 톤앤매너] -> [캐릭터 외형 묘사] -> [캐릭터의 구체적인 표정과 행동(동사)] -> [주변 사물 및 배경].
3. 사물 비유와 캐릭터 리액션의 결합 + 의미 전달용 텍스트 라벨: 사물 단독 샷은 안 된다 — 반드시 캐릭터의 물리적 상호작용과 리액션이 결합된 구도로 짠다. 예: '무너지는 동전 탑'을 그릴 거라면, "동전 탑이 무너진다"가 아니라 "스틱맨 캔들러가 무너지는 동전 탑을 보며 머리를 쥐어뜯고 오열한다"처럼 반드시 캐릭터의 물리적 상호작용과 리액션이 결합된 구도로 짠다. 단, 의미가 헷갈릴 수 있는 사물·수치·비교 항목에는 짧은 한글 단어 라벨을 적극 붙인다 — 그래프의 축·눈금·항목명, 항아리/상자 등에 붙는 카테고리명, 금액 등. 다만 문장형 캡션이나 나레이션 자막 문장은 이미지 안에 넣지 않는다 — 그건 12번(나레이션·자막) 단계가 SRT로 만들고 15번(렌더링)에서 별도로 입힌다.
4. 캐릭터 롤플레이 명확화 (화자와 배우의 분리, 화풍과 무관하게 항상 고정):
- 젠틀맨 루즈 (메인 화자/관찰자): "A minimalist vector stickman character with a round white face and simple dot eyes. Styled as 'Gentleman Rouge' wearing a black top hat, a gold-rimmed monocle, a neat curled black mustache, a black tailcoat, and a black cape with gold lining." 씬에 직접 개입하지 않을 때도, 화면 구석에서 상황을 비웃으며 지켜보거나, 시청자에게 사물을 손가락으로 가리키며 설명하는 앵글로 적극 배치한다.
- 스틱맨 배우들 (상황극 주인공): 하얀 동그라미 얼굴, 점눈 스틱맨 베이스에 역할 소품만 입힌다. 감정 상태(절망, 탐욕, 환희 등)를 극단적으로 과장해서 표현한다.

[전환 프롬프트(transitionPrompt) 작성 규칙]
정지 이미지 기반의 카메라 움직임(줌인/아웃, 패닝, 컷 전환)을 영어로 구체적으로 묘사한다. 대본에 [영상화] 표시가 있거나 훅이 강한 지점에만 needsVideoClip: true를 주고 짧은 모션을 적는다(전체의 15% 이내).

[출력 형식 — 이번 구간에서 새로 만든 장면들만 담은 JSON 배열 하나. 앞뒤 설명·마크다운 코드펜스 없이 순수 JSON 배열만, 이어가기 안내문/완료 표시는 배열 바깥 다음 줄에만.]
[
  {
    "id": "S01",
    "startSec": 0.0,
    "endSec": 9.0,
    "screenDescription": "한국어로 이 장면에서 무슨 일이 일어나는지 직관적 요약",
    "imagePrompt": "영어, Flow AI 이미지 생성용 완성된 프롬프트(캐릭터 묘사 + 직관적 사물 상황극 + 필요시 단어 수준 텍스트 라벨 + 상황에 맞는 배경 포함)",
    "transitionPrompt": "영어, 카메라 움직임/전환 또는(needsVideoClip이 true일 때) 실제 동작 묘사",
    "needsVideoClip": false
  }
]

SRT에 없는 구간을 임의로 지어내지 마. 절대 \`\`\`json 이나 \`\`\` 같은 마크다운 기호를 쓰지 말고, 오직 [ 로 시작해서 ] 로 끝나는 텍스트만 출력해라.

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
