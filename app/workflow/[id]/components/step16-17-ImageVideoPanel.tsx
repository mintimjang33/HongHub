'use client';

import { useEffect, useRef, useState } from 'react';
import type { Site } from '../types';
import type { SceneBlock } from '../types';
import { parseSceneBlocks, serializeSceneBlocks, normalizeLabeledItems, IMAGE_STYLE_PRESETS, CHARACTER_STYLE_PRESETS } from '../utils';
import { CopyButton, SceneEditorList, PresetPickerModal } from './shared';

// 13번(구 16-17번, 씬별 이미지 프롬프트 작성·생성) 단계 패널 — 완성된 콘텐츠 목록에서 이름을
// 클릭하면 펼쳐지면서 그 콘텐츠의 장면별 CLEAN/INFO/영상 프롬프트가 타임라인 순서로 나온다.
// 데이터 자체는 11번(대본 작성)의 콘텐츠 유닛(ContentUnit.scenePrompts)에 저장되지만, 실제로
// 이미지/영상을 만들 때 찾는 곳은 여기라서 이 패널에서도 똑같이 보여주고 편집도 여기서 끝낼 수 있게 한다.
// (코드상 이름은 구버전 "Step6Panel" — 파이프라인이 5~20번 구조로 재편되며 16·17번, 이후 14번, 12번
// 캐릭터 시트 단계 삭제로 다시 13번으로 옮겨졌다.)
//
// 2026-09-11 화풍 선택 기능 추가 (13개 프리셋 + 참고 이미지, 파이프라인 전체 공유):
// 사용자가 같은 씬(약사 스틱맨+무너지는 PHARMACY 네온사인)을 Flow에서 여러 화풍으로 직접 만들어
// 비교 확정했다(화풍 지정 안함/2D 일러스트/연필 그림/수채화/한국형 웹툰/손그림/수묵화/일본만화/
// 디즈니풍/지브리풍/아메리칸 코믹북/레트로 픽셀아트/클레이). 13개 프리셋(프롬프트 문구+참고 이미지
// URL)은 `IMAGE_STYLE_PRESETS`(utils.ts)에 정의돼 있다.
//
// ⚠️ 저장 범위 — 콘텐츠 유닛별로 만들었다가 파이프라인 전체 공유값으로 되돌림(2026-09-11):
// 처음엔 콘텐츠 유닛마다 따로 고를 수 있게(ContentUnit.imageStyle) 만들었는데, 사용자가 "컨텐츠가
// 100개면 그때마다 고르는 화면을 넣는다는거야? 왜 그런 쓸데없는 짓을 하지??", "카테고리를 한번
// 선택하고 그 안의 상품을 고르면 되는것을"이라고 지적 — 콘텐츠마다 따로 고르는 게 아니라 채널
// (파이프라인) 전체에서 한 번만 고르면 되는 구조가 맞다는 것. `AnalysisResult.imageStyle`(types.ts)
// 로 다시 옮기고, 이 패널 최상단(콘텐츠 목록 위)에 선택 UI를 한 번만 둔다 — `/api/sites/[id]`
// PATCH는 analysis_result를 통째로 교체하므로(부분 병합 아님) 기존 값을 스프레드해서 imageStyle만
// 덮어쓴다.
//
// 2026-09-11 "화풍 지정 안 함" 프리셋 수정 — 스토리 무관 조명 강제 버그:
// 처음 버전은 이름과 달리 "dramatic lighting... glowing effects for dramatic emphasis"를 항상
// 강제하고 있었다(사용자 지적: "왜 배경이 어두운 배경이야, 그냥 스토리에 따라 그림을 그려야지").
// 테스트에 쓴 약사+네온사인 장면이 원래 극적이라 안 드러났을 뿐, 밝고 잔잔한 장면에도 똑같이
// 어두운 톤이 강제되는 구조였다. IMAGE_STYLE_PRESETS의 'default' 항목에서 조명/분위기가 장면
// 내용을 그대로 따라가도록(밝은 장면=밝게, 어두운 장면만 어둡게) 수정하고, "매 장면에 극적 조명을
// 강제하지 마라"는 문장을 명시 추가했다.
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
//
// 2026-09-11 (2차) "커버리지는 맞는데 뒷부분을 통째로 뭉갬" 사고 + 프롬프트 자율 체크 신뢰 폐기:
// 재작업한 코카콜라 유닛이 SRT 끝(13:19=799.6초)까지는 도달했다고 자기보고했으나, 실제 저장된
// scenePrompts를 파싱해보니 장면이 73개가 아니라 72개였고(제미나이가 자기 개수도 잘못 셈), 그중
// 마지막 장면 하나가 "9:54-13:20"(206초)를 통째로 먹어치운 상태였다 — 앞부분(S01~S71)은 7~10초
// 간격을 잘 지켰는데 마지막 구간만 대충 뭉쳐서 "완료"로 넘긴 것. 제미나이가 이걸 "6~7초 기계적
// 분할이 아니라 문맥과 호흡을 분석해 10~15초 단위로 묶은 것"이라고 정교하게 변명했지만, 206초는
// 그 변명(10~15초)과도 안 맞는 명백한 거짓 설명이었다.
// 근본 원인: "장면 25~35개(3~4분)마다 멈추고 계속을 기다려라" 같은 프롬프트상의 자율 체크포인트를
// 제미나이가 지키지 않고 뒷부분을 한 번에 밀어붙이면서 압축해버려도, 이걸 걸러낼 장치가 프롬프트
// 안의 "말로 하는 재확인 지시"밖에 없었다 — 텍스트 지시는 우회되면 그만이라 신뢰할 수 없다.
// 재발 방지책 (2026-09-11, 사용자 지시: "중간중간 체크를 한다던가" — 말이 아니라 실제 검증으로):
// 1. 프롬프트의 자율 청크 크기를 25~35개/3~4분 → 12~18개/1.5~2분으로 줄여 체크포인트(사람이
//    "계속"을 눌러야 진행되는 지점)를 더 자주 강제한다.
// 2. 프롬프트에 "장면 하나의 길이는 어떤 경우에도 15초를 넘길 수 없다"는 하드 캡을 명시했다 —
//    문맥상 자연스럽다는 이유로 여러 줄을 긴 장면 하나로 뭉치는 걸 원천 금지.
// 3. **코드 레벨 검증(findSceneIssues) 추가** — registerParsed가 파싱된 장면들의 실제 길이
//    (endSec-startSec)와 장면 간 시간 공백/겹침을 계산해서, 15초를 넘는 장면이나 공백이 하나라도
//    있으면 저장 자체를 막고 어느 장면(id/시간대)이 문제인지 화면에 그대로 보여준다. "사용자가
//    등록 후 눈으로 확인"이 아니라 "등록 시점에 코드가 강제로 걸러낸다"로 바꾼 것 — 말로 된
//    지시(재확인해라)는 이번처럼 우회될 수 있지만 코드 체크는 우회되지 않는다.
//
// 2026-09-11 (3차) 원칙 2번("모든 컷에 인물 필수 등장") 수정 — 사용자 지적: "장면만 있는지
// 스틱맨이 나오는지에 따라 프로프트를 수정해야겠네". 실제 코카콜라 대본에는 트로피/도장 뒤집힘/
// 무너지는 성처럼 특정 인물의 행동이 아니라 "개념 자체"를 상징적으로 보여주는 씬이 여럿 있는데
// (S36/S48/S68/S69/S73/S74/S75 등), 옛 원칙 2번은 "무조건 인물 등장"을 강제해서 이런 씬에도
// 억지로 캐릭터를 끼워넣게 만들었다. 대본에 실제로 누군가 행동·반응하는 서술이 있는 씬만 인물을
// 등장시키고, 순수 상징/개념 컷은 인물 없이 사물·배경만으로 구성하도록 조건부로 바꿨다. 인물이
// 등장하는 경우의 프롬프트 작성 순서도, 4번(캐릭터 롤플레이 — 레퍼런스 기반, 외형 재설명 없음)
// 원칙과 어긋나지 않도록 "캐릭터 외형 묘사" 대신 "이름/역할 태그"로 수정했다(A/B 실측 테스트로
// 외형 재설명이 불필요함을 확인 완료 — 아래 4번 항목 참고).
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

// 2026-09-11 (2차) 추가 — 코카콜라 유닛 사고(마지막 장면이 206초를 통째로 먹어치움) 재발 방지용
// 코드 레벨 검증. 장면 하나가 비정상적으로 길거나(뭉쳐진 장면 의심) 장면 사이에 시간 공백/겹침이
// 있으면 문자열로 문제 목록을 반환한다 — 빈 배열이면 이상 없음.
const MAX_SCENE_SEC = 15;
const GAP_TOLERANCE_SEC = 1;

function findSceneIssues(rawScenes: RawScene[]): string[] {
  const issues: string[] = [];
  let prevEnd: number | null = null;
  rawScenes.forEach((s, idx) => {
    const start = s.startSec ?? 0;
    const end = s.endSec ?? 0;
    const dur = end - start;
    const label = s.id || `#${idx + 1}`;
    if (dur > MAX_SCENE_SEC) {
      issues.push(`${label} (${formatSec(start)}~${formatSec(end)}): ${dur.toFixed(1)}초 — 최대 ${MAX_SCENE_SEC}초 초과, 여러 장면이 뭉쳐졌을 가능성이 높습니다.`);
    }
    if (prevEnd !== null) {
      const gap = start - prevEnd;
      if (Math.abs(gap) > GAP_TOLERANCE_SEC) {
        issues.push(`${label} 앞 구간: ${formatSec(prevEnd)} → ${formatSec(start)} 사이에 ${gap > 0 ? '공백' : '겹침'} ${Math.abs(gap).toFixed(1)}초 발생.`);
      }
    }
    prevEnd = end;
  });
  return issues;
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
  // 2026-09-11 추가 — 화풍 선택 상태(파이프라인 전체 공유). site.analysis_result가 원본이지만,
  // "이걸로 선택" 직후 서버 저장(PATCH)과 onRefresh(전체 사이트 목록 재조회)가 끝날 때까지
  // 칩 강조 표시가 안 바뀌어서 "반응이 느리다"는 지적을 받았다(2026-09-11) — optimisticStyleId에
  // 클릭 즉시 값을 반영해서 화면은 바로 바뀌고, 실제 저장은 뒤에서 진행되게 한다. site prop이
  // 갱신되면(onRefresh 완료) 그 값이 곧 optimistic 값과 같아지므로 별도 리셋 로직은 필요 없다.
  const [savingStyle, setSavingStyle] = useState(false);
  const [optimisticStyleId, setOptimisticStyleId] = useState<string | null>(null);
  const selectedStyleId = optimisticStyleId || site.analysis_result?.imageStyle || IMAGE_STYLE_PRESETS[0].id;
  const selectedPreset = IMAGE_STYLE_PRESETS.find((p) => p.id === selectedStyleId) || IMAGE_STYLE_PRESETS[0];
  // 2026-09-11 추가 — 캐릭터 선택 상태. 화풍과 같은 저장 방식(analysis_result, 파이프라인 전체 공유)
  // 이지만 별도 필드(characterStyle)에 저장한다 — "어떻게 그릴지"(화풍)와 "누구를 그릴지"(캐릭터)는
  // 서로 다른 축이라 사용자가 각각 독립적으로 고를 수 있어야 한다. 화풍과 동일한 이유로 낙관적
  // 업데이트(optimisticCharacterId)를 둔다.
  const [savingCharacter, setSavingCharacter] = useState(false);
  const [optimisticCharacterId, setOptimisticCharacterId] = useState<string | null>(null);
  const selectedCharacterId = optimisticCharacterId || site.analysis_result?.characterStyle || CHARACTER_STYLE_PRESETS[0].id;
  const selectedCharacterPreset = CHARACTER_STYLE_PRESETS.find((p) => p.id === selectedCharacterId) || CHARACTER_STYLE_PRESETS[0];
  // 2026-09-11 추가 — 화풍/캐릭터 칩을 눌러도 바로 선택되지 않고, 이 모달로 원본 크기를 먼저
  // 보여준 뒤 "이걸로 선택"을 눌러야 확정된다(사용자 지시 — 한 줄 썸네일이 작아서 잘 안 보였음).
  const [previewPreset, setPreviewPreset] = useState<{ kind: 'style' | 'character'; id: string } | null>(null);

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

  // 2026-09-11 추가 — 화풍 선택 저장(파이프라인 전체 공유). analysis_result는 PATCH 시 전체
  // 교체라(부분 병합 아님), 기존 필드를 스프레드해서 imageStyle만 덮어써야 다른 분석 결과
  // (channel/title 등)가 안 날아간다.
  async function selectStyle(styleId: string) {
    setOptimisticStyleId(styleId);
    setSavingStyle(true);
    try {
      await fetch(`/api/sites/${site.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis_result: { ...site.analysis_result, imageStyle: styleId } }),
      });
      onRefresh();
    } finally {
      setSavingStyle(false);
    }
  }

  // 2026-09-11 추가 — 캐릭터 선택 저장. selectStyle과 완전히 같은 패턴(analysis_result는 PATCH 시
  // 전체 교체라 기존 값을 스프레드해서 characterStyle만 덮어써야 함).
  async function selectCharacter(characterId: string) {
    setOptimisticCharacterId(characterId);
    setSavingCharacter(true);
    try {
      await fetch(`/api/sites/${site.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis_result: { ...site.analysis_result, characterStyle: characterId } }),
      });
      onRefresh();
    } finally {
      setSavingCharacter(false);
    }
  }

  function registerParsed(unitId: string) {
    const raw = pasteTexts[unitId] || '';
    const rawScenes = extractSceneArrays(raw);
    if (rawScenes.length === 0) {
      setParseInfos((cur) => ({ ...cur, [unitId]: '❌ 유효한 JSON 배열을 찾지 못했습니다 — 제미나이 응답 전체를 그대로 붙여넣었는지 확인해주세요.' }));
      return;
    }
    // 2026-09-11 (2차) 추가 — 코카콜라 유닛 사고 재발 방지: 저장 전에 반드시 장면 길이·공백을
    // 코드로 검증한다. 제미나이가 "문맥상 자연스럽다"고 자체 판단해 여러 줄을 긴 장면 하나로
    // 뭉쳐버려도(예: 206초짜리 장면 1개), 여기서 걸리면 저장 자체가 막힌다 — 말로 된 재확인
    // 지시는 우회될 수 있지만 이 체크는 우회되지 않는다.
    const issues = findSceneIssues(rawScenes);
    if (issues.length > 0) {
      setParseInfos((cur) => ({
        ...cur,
        [unitId]: `⚠️ 등록 중단 — ${issues.length}건 문제 발견, 저장하지 않았습니다:\n${issues.join('\n')}\n제미나이한테 해당 구간을 ${MAX_SCENE_SEC}초 이하로 다시 쪼개달라고 요청한 뒤 그 결과만 다시 붙여넣어 주세요.`,
      }));
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
      {/* 2026-09-11 추가 — 캐릭터 선택 UI(파이프라인 전체 공유, 화풍 선택 위). "누구를 그릴지"를
          먼저 고르고 "어떻게 그릴지"(화풍)를 그다음 고르는 순서로 배치했다. 화풍과 마찬가지로
          한 줄 작은 칩으로 두고, 클릭하면 PresetPickerModal로 크게 보여준 뒤 확정한다(아래 화풍
          선택과 동일한 이유 — 썸네일이 작아서 클릭 즉시 반영하면 뭘 골랐는지 잘 안 보였다). */}
      <div className="mb-3">
        <div className="text-xs font-black text-neutral-500 mb-2">
          🧑 캐릭터 선택 (파이프라인 전체 공유, 기본값: {CHARACTER_STYLE_PRESETS[0].label})
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {CHARACTER_STYLE_PRESETS.map((preset) => {
            const active = preset.id === selectedCharacterId;
            return (
              <button
                key={preset.id}
                onClick={() => setPreviewPreset({ kind: 'character', id: preset.id })}
                disabled={savingCharacter}
                className={`shrink-0 flex flex-col items-center gap-1 rounded-lg p-1.5 border-2 transition disabled:opacity-50 ${
                  active ? 'border-black bg-neutral-50' : 'border-transparent hover:border-neutral-200'
                }`}
              >
                {preset.referenceImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preset.referenceImageUrl} alt={preset.label} className="w-16 h-16 object-cover rounded-md border border-neutral-200" />
                ) : (
                  <div className="w-16 h-16 rounded-md border border-neutral-200 bg-neutral-50 flex items-center justify-center text-xl">🖼️</div>
                )}
                <span className={`text-[10px] font-bold whitespace-nowrap ${active ? 'text-black' : 'text-neutral-400'}`}>{preset.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2026-09-11 추가 — 화풍 선택 UI(파이프라인 전체 공유, 콘텐츠 목록 위에 한 번만). 참고
          이미지(같은 씬을 여러 화풍으로 실측한 것) 썸네일 + 라벨을 칩 버튼으로 보여주고, 선택된
          것만 테두리 강조. 클릭하면 바로 선택되지 않고 PresetPickerModal로 원본 크기를 먼저 보여준
          뒤 "이걸로 선택"을 눌러야 확정된다(2026-09-11 수정 — 한 줄에 작은 썸네일만 있으니 뭘
          고르는지 잘 안 보인다는 지적, 두 줄로 늘리는 대신 이 모달 방식으로 확정). */}
      <div className="mb-3">
        <div className="text-xs font-black text-neutral-500 mb-2">🎨 화풍 선택 (파이프라인 전체 공유, 기본값: {IMAGE_STYLE_PRESETS[0].label})</div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {IMAGE_STYLE_PRESETS.map((preset) => {
            const active = preset.id === selectedStyleId;
            return (
              <button
                key={preset.id}
                onClick={() => setPreviewPreset({ kind: 'style', id: preset.id })}
                disabled={savingStyle}
                className={`shrink-0 flex flex-col items-center gap-1 rounded-lg p-1.5 border-2 transition disabled:opacity-50 ${
                  active ? 'border-black bg-neutral-50' : 'border-transparent hover:border-neutral-200'
                }`}
              >
                {preset.referenceImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preset.referenceImageUrl} alt={preset.label} className="w-16 h-16 object-cover rounded-md border border-neutral-200" />
                ) : (
                  <div className="w-16 h-16 rounded-md border border-neutral-200 bg-neutral-50 flex items-center justify-center text-xl">🖼️</div>
                )}
                <span className={`text-[10px] font-bold whitespace-nowrap ${active ? 'text-black' : 'text-neutral-400'}`}>{preset.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {previewPreset &&
        (() => {
          const preset =
            previewPreset.kind === 'style'
              ? IMAGE_STYLE_PRESETS.find((p) => p.id === previewPreset.id)
              : CHARACTER_STYLE_PRESETS.find((p) => p.id === previewPreset.id);
          if (!preset) return null;
          return (
            <PresetPickerModal
              label={preset.label}
              imageUrl={preset.referenceImageUrl}
              description={previewPreset.kind === 'style' ? undefined : (preset as (typeof CHARACTER_STYLE_PRESETS)[number]).description}
              onCancel={() => setPreviewPreset(null)}
              onConfirm={() => {
                if (previewPreset.kind === 'style') selectStyle(preset.id);
                else selectCharacter(preset.id);
                setPreviewPreset(null);
              }}
            />
          );
        })()}

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
                    <p className="text-[10px] text-red-500 font-bold mb-2">아직 12번에 자막이 없습니다 — 먼저 12번에서 자막을 등록해주세요.</p>
                  )}
                  {subtitleItems.length > 0 && !srtReady && !srtError && (
                    <p className="text-[10px] text-neutral-400 mb-2">자막(SRT) 불러오는 중...</p>
                  )}
                  {srtError && (
                    <p className="text-[10px] text-red-500 font-bold mb-2">자막을 불러오지 못했습니다({srtError}) — 새로고침 후 다시 시도해주세요.</p>
                  )}

                  <p className="text-[10px] text-neutral-400 mb-2">
                    현재 캐릭터: <span className="font-bold text-neutral-600">{selectedCharacterPreset.label}</span> · 현재 화풍: <span className="font-bold text-neutral-600">{selectedPreset.label}</span> (위에서 바꿀 수 있음). 대본이 길면(10분 이상) 제미나이가 한 응답에 다 끝내려다 스토리를 요약해버릴 수 있습니다 — 아래 프롬프트는 짧은 구간(1.5~2분)만 만들고 자주 멈추도록 지시해뒀습니다. 응답 끝에 "계속"이라고 답하면 이어서 다음 구간을 만듭니다(11번 대본 작성과 동일한 방식). 대본·자막 원문이 프롬프트 안에 이미 통째로 들어있으니 링크를 열 필요 없이 바로 붙여넣으면 됩니다. 제미나이 채팅에서 "계속"으로 끝까지 다 받은 뒤, 대화 전체(JSON 배열 여러 개 포함)를 그대로 복사해서 아래 붙여넣기 칸에 한 번에 넣고 등록하면 자동으로 합쳐서 저장됩니다. ⚠️ 장면 하나가 15초를 넘거나 장면 사이에 시간 공백이 있으면 등록 버튼을 눌러도 저장되지 않고 어느 장면이 문제인지 그대로 보여줍니다 — 그 경우 제미나이한테 해당 구간만 다시 쪼개달라고 요청한 뒤 재등록하세요.
                  </p>

                  <div className="inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-full border border-amber-200 bg-amber-50 mb-2">
                    <span className="text-amber-700">🔍 제미나이 프롬프트 (대본·자막 원문 포함됨)</span>
                    {srtReady || subtitleItems.length === 0 ? (
                      <CopyButton
                        text={`[역할] 너는 우리 유튜브 경제/지식 채널 영상의 편집 감독(edit director)이다. 아래에 대본 전문과 자막(SRT) 전문을 직접 첨부했다. 이 텍스트를 그대로 읽고, 이를 기반으로 초 단위 스토리보드와 각 장면의 완벽한 한 장의 일러스트(이미지/전환) 프롬프트를 설계한다. (링크를 열 필요 없음 — 아래 텍스트가 원문 그대로다.)

[타임코드 및 분할 원칙] 아래 SRT는 실제 나레이션 음성을 정밀 전사한 것으로, 각 줄의 시작~끝 초는 이미 확정된 실측값이다. 이 시간 값을 새로 추측하거나 반올림하지 말고, 반드시 SRT의 타임코드를 그대로 기준 삼아 장면 경계를 정한다 — 여러 줄을 하나의 장면으로 묶을 땐 그 줄들의 시작 초~마지막 줄의 끝 초를 그대로 장면의 startSec/endSec으로 쓴다. 스토리 전체를 몇 개의 요약 장면으로 압축하지 않는다 — 아래 SRT에 있는 모든 줄을, 처리 대상 구간 안에서는 하나도 빠짐없이 실제 길이 그대로 촘촘히(6~7초 단위로) 장면화한다. ⚠️ 어떤 경우에도 장면 하나의 길이(endSec-startSec)는 15초를 넘을 수 없다 — "문맥상 자연스럽다", "호흡이 이어진다" 같은 이유로 여러 SRT 줄을 15초 넘는 긴 장면 하나로 뭉치는 것은 절대 금지다. 그렇게 뭉치고 싶은 구간이 있어도 반드시 15초 이하 여러 장면으로 다시 쪼갠다.

[분량 처리 방식 — 한 번에 전체를 다 처리하려 하지 말고 반드시 아래처럼 나눠서 진행할 것]
SRT 전체 분량을 한 응답에 다 처리하려 하지 마라. 대신 SRT 맨 처음부터 시작해서, 장면 12~18개 안팎(대략 1.5~2분 분량)을 만들었으면 그 지점에서 멈추고, 그때까지 만든 장면들만 아래 [출력 형식]의 JSON 배열로 출력한 뒤, 그 JSON 배열 바로 다음 줄에 정확히 이렇게만 적어라: (다음 구간 준비됨 — "계속"이라고 답하면 이어서 만듭니다)
이렇게 짧게 자주 멈추는 이유: 예전에 한 번에 3~4분씩 만들게 했더니 뒷부분으로 갈수록 여러 줄을 대충 하나의 긴 장면(200초 이상)으로 뭉쳐버리고 "완료"라고 보고한 사고가 있었다. 구간을 짧게 끊으면 매 구간마다 실제로 몇 초 분량을 만들었는지 사람이 바로바로 확인할 수 있다.
사용자가 "계속"이라고 답하면, 방금 만든 마지막 장면의 endSec 바로 다음 시점부터 이어서 — 앞서 만든 장면들을 요약하거나 다시 만들지 말고 — 다음 1.5~2분 분량만 새로 만들어 같은 형식(JSON 배열 + 안내문)으로 출력해라. 이 과정을 SRT의 마지막 줄(자막 끝)까지 반복한다.
SRT 마지막 줄까지 실제로 다 만든 진짜 마지막 응답에서는, 이어가기 안내문 대신 JSON 배열 바로 다음 줄에 정확히 이렇게 완료 표시를 적어라(N·X는 지금까지 만든 전체 누적 기준 실제 값으로): [최종: 총 장면 N개, 마지막 장면 endSec X초 — SRT 마지막 줄(자막 끝)까지 도달함]
⚠️ 완료 표시를 적기 전에 반드시 두 가지를 재확인해라: (1) 지금 만든 마지막 장면의 endSec이 위에 첨부된 SRT의 진짜 마지막 줄(자막 끝) 타임코드와 정확히 일치하는가? 스토리 내용상 자연스럽게 마무리되는 것처럼 느껴져도, SRT에 아직 처리하지 않은 줄이 하나라도 남아있다면(클로징 멘트, 구독 유도, 아웃트로 등 포함) 그건 완료가 아니다. (2) 지금까지 만든 모든 장면 각각에 대해 endSec-startSec을 실제로 계산해봐서 15초를 넘는 장면이 하나라도 있는가? 하나라도 있다면 그 장면을 여러 개로 다시 쪼개고 번호를 다시 매긴 뒤에만 완료 표시를 적어라. 두 조건을 다 만족했을 때만 완료로 표시한다 — 중간에 스토리가 끝난 것처럼 보이거나 개수를 맞추기 급급해 장면을 뭉치는 실수를 절대 하지 마라.

[작업 지시]
1. SRT의 타임코드 줄들을 순서대로 묶어서, 하나의 장면이 대략 6~7초가 되도록 나눈다(아무리 길어도 15초 초과 금지). 문장이 끊기는 자연스러운 호흡 지점(SRT 줄 경계)에서만 나누고, 문장 중간을 억지로 자르지 않는다.
2. 씬 대부분은 정지 이미지 + 줌/패닝/컷 전환으로 처리한다(이미지는 0크레딧). 대본에 [영상화] 표시가 붙은 지점(콜드오픈, 챕터 전환부 등 후킹이 강한 순간)만 실제 짧은 영상 클립이 필요한 장면으로 표시한다(needsVideoClip: true) — 전체 장면의 15~20% 이내로 제한한다.
3. transitionPrompt에는 카메라 움직임(줌인/줌아웃/패닝/틸트), 정지 이미지 간 전환 방식, needsVideoClip이 true인 경우엔 그 장면에서 실제로 어떤 동작이 일어나는지(짧은 모션)까지 영어로 구체적으로 쓴다.

[수정된 이미지 프롬프트(imagePrompt) 4대 핵심 원칙 — 반드시 지킬 것, 전부 영어로]
1. 비주얼 톤앤매너 (2026-09-11 화풍 선택 기능 반영 — 현재 선택된 화풍: "${selectedPreset.label}"): "${selectedPreset.promptStyle}"로 통일한다. 인물이 등장하는 컷에서는 모든 캐릭터의 몸 형태가 아래 4번(캐릭터 롤플레이)에서 정의한 정체성을 그대로 따른다 — 정상적인 인체 비율(어깨 넓은 몸통, 상세한 손가락·근육 등)로 그리지 않는다. 이 캐릭터 형태 규칙은 화풍과 무관하게 항상 고정이다.
2. 인물 등장 여부는 장면 내용에 따라 판단한다 (2026-09-11 수정 — 예전엔 "모든 컷에 인물 필수"였는데, 실제로는 트로피/도장이 뒤집히는 연출/무너지는 성처럼 특정 인물의 행동이 아니라 개념·상황 자체를 상징적으로 보여주는 순수 사물·데이터 컷도 이 이야기에 정당하게 필요하다는 게 확인됨): 대본에 그 순간 누군가 구체적으로 행동하거나 반응한다는 서술이 있으면 그 인물이 프레임에 크게 등장해야 한다 — 그런 씬을 사물이나 배경만 덩그러니 있는 정물화 컷으로 만들지 마라. 반대로 대본이 순수하게 상징/개념을 시각화하는 서술이면(구체적으로 반응하는 인물이 없으면) 억지로 캐릭터를 끼워넣지 않고 사물·배경만으로 구성해도 된다. 인물이 등장하는 경우, 영어 프롬프트는 반드시 다음 순서로 작성한다: [비주얼 톤앤매너] -> [캐릭터 이름/역할 태그(4번 원칙대로 외형 재설명 없이)] -> [캐릭터의 구체적인 표정과 행동(동사)] -> [주변 사물 및 배경].
3. 사물 비유와 캐릭터 리액션의 결합 + 의미 전달용 텍스트 라벨: 인물이 등장하는 컷에서 사물 단독 샷은 안 된다 — 반드시 캐릭터의 물리적 상호작용과 리액션이 결합된 구도로 짠다(위 2번 기준으로 애초에 인물 없는 순수 상징 컷으로 판단됐다면 이 항목은 해당 없음). 예: '무너지는 동전 탑'을 그릴 거라면, "동전 탑이 무너진다"가 아니라 "주인공 캐릭터가 무너지는 동전 탑을 보며 머리를 쥐어뜯고 오열한다"처럼 반드시 캐릭터의 물리적 상호작용과 리액션이 결합된 구도로 짠다. 단, 의미가 헷갈릴 수 있는 사물·수치·비교 항목에는 짧은 한글 단어 라벨을 적극 붙인다 — 그래프의 축·눈금·항목명, 항아리/상자 등에 붙는 카테고리명, 금액 등. 다만 문장형 캡션이나 나레이션 자막 문장은 이미지 안에 넣지 않는다 — 그건 12번(나레이션·자막) 단계가 SRT로 만들고 15번(렌더링)에서 별도로 입힌다.
4. 캐릭터 롤플레이 명확화 (2026-09-11 캐릭터 선택 기능 반영 — 현재 선택된 캐릭터: "${selectedCharacterPreset.label}", 화풍과 무관하게 항상 고정):
${selectedCharacterPreset.description}

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
                      {parseInfos[u.id] && <span className="text-[10px] font-bold text-neutral-500 whitespace-pre-line">{parseInfos[u.id]}</span>}
                    </div>
                  </div>

                  <SceneEditorList
                    scenePrompts={u.scenePrompts || ''}
                    saving={saving}
                    onSave={(text) => save(u.id, text)}
                    characterTabs={selectedCharacterPreset.tabs || []}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
