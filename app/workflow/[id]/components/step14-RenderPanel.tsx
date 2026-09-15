'use client';

import { useEffect, useRef, useState } from 'react';
import type { Site } from '../types';
import { normalizeLabeledItems, CHARACTER_STYLE_PRESETS } from '../utils';
import { LabeledFieldSection } from './step13-14-LabeledLinksPanel';
import { SceneEditorList } from './shared';

// 14번(렌더링) 단계 전용 — 2026-09-16(6차) 신설, 사용자 요청: "1번컨텐츠에 지금 업로드한
// 숏컷파일 등록해주고~ 수동으로 업로드, 삭제 할수있게 해주고~". 이 단계는 12번(나레이션·자막)
// 패널과 정확히 같은 구조("콘텐츠 하나에 라벨 붙은 링크/파일 여러 개")가 필요하다 — Shotcut
// 등에서 작업 중인 편집 프로젝트 파일(.mlt)이 여러 버전으로 쌓일 수 있고, 완성된 최종 렌더링
// 영상 파일도 여기 같이 올려둔다. 새로 만들지 않고 step13-14-LabeledLinksPanel.tsx의
// LabeledFieldSection을 그대로 재사용한다(narrationUrls/subtitleUrls와 완전히 같은 UI/저장
// 로직). 자막처럼 화면 안에서 직접 텍스트 편집을 할 대상이 아니라서 textEditable은 안 넘긴다.
//
// 2026-09-16(10차) 수정 — 사용자 요청: "13단계의 모달을 그대로 14단계에서 볼수있게 해줘~".
// Shotcut으로 실제 조립하는 동안 씬 이미지·자막을 확인하려면 13단계 탭으로 매번 옮겨가야 했다
// — 13단계(step16-17-ImageVideoPanel.tsx)가 쓰는 것과 완전히 같은 <SceneEditorList>를 그대로
// 재사용해서, 14단계 화면 안에서도 똑같은 스토리보드 표 + 이미지/영상 모달(자막 줄 기준 넘기기
// 포함)을 열어볼 수 있게 한다. SRT 로딩(선택된 자막 fetch)은 13단계 패널과 상태를 공유하지
// 않는(다른 컴포넌트 인스턴스) 별도 로직이라, ImageVideoPanel과 동일한 방식으로 이 컴포넌트
// 안에서 독립적으로 다시 로드한다. 캐릭터 탭 분류도 13단계와 동일하게 파이프라인 공유값
// (analysis_result.characterStyle)을 그대로 읽어 쓴다 — 여기서 캐릭터를 새로 고를 필요는
// 없으므로 선택 UI는 넣지 않고 값만 읽는다.
//
// 2026-09-16(11차) 수정 — 사용자 지적: "14단계에선 이미지,영상 분류하는게 아니고~ 앞부분은
// 영상만 있고 자막 9~10번부터 이미지자나? 그럼 있는것만 셋팅해서 보여줘야해". 13단계 표는
// "장면이미지"/"영상장면" 두 열을 항상 나란히 보여주지만, 실제로는 한 씬에 둘 중 하나만 채워져
// 있어서 절반이 늘 "없음"으로 낭비된다 — 14번(참고용 보기)에서는 mergeMediaColumn을 켜서 그
// 씬이 실제로 갖고 있는 것 하나만 "화면" 열 하나로 합쳐 보여준다(shared.tsx SceneEditorList
// 참고).
export function RenderPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const units = site.script_draft?.units || [];
  const [openUnitId, setOpenUnitId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [srtTexts, setSrtTexts] = useState<Record<string, string>>({});
  const [srtErrors, setSrtErrors] = useState<Record<string, string>>({});
  const fetchedSrtRef = useRef<Record<string, boolean>>({});

  const selectedCharacterId = site.analysis_result?.characterStyle || CHARACTER_STYLE_PRESETS[0].id;
  const selectedCharacterPreset = CHARACTER_STYLE_PRESETS.find((p) => p.id === selectedCharacterId) || CHARACTER_STYLE_PRESETS[0];

  useEffect(() => {
    if (!openUnitId) return;
    const u = units.find((x) => x.id === openUnitId);
    // 13단계와 동일 — 12번에서 "최종"으로 체크된 자막(selected:true)을 우선하고, 없으면
    // 배열 첫 항목으로 대체한다.
    const subtitleCandidates = normalizeLabeledItems(u?.subtitleUrls);
    const url = (subtitleCandidates.find((it) => it.selected) || subtitleCandidates[0])?.url;
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

  async function saveScenePrompts(unitId: string, scenePrompts: string) {
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, unitPatch: { id: unitId, fields: { scenePrompts } } }),
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  if (units.length === 0) {
    return (
      <div className="border-t border-black/5 pt-3">
        <p className="text-xs text-neutral-300">아직 대본 작성에서 완성된 콘텐츠가 없어요 — 먼저 대본을 완성해주세요.</p>
      </div>
    );
  }

  return (
    <div className="border-t border-black/5 pt-3">
      <div className="text-xs font-black text-neutral-500 mb-2">🎬 렌더링 파일 (Shotcut 프로젝트 · 최종 영상)</div>
      <div className="space-y-1.5">
        {units.map((u) => {
          const fileCount = normalizeLabeledItems(u.renderFiles).length;
          const isOpen = openUnitId === u.id;
          const srtText = srtTexts[u.id];
          const srtError = srtErrors[u.id];
          return (
            <div key={u.id} className="bg-white border border-neutral-100 rounded-lg overflow-hidden">
              <button
                onClick={() => setOpenUnitId((cur) => (cur === u.id ? null : u.id))}
                className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer"
              >
                <span className={`shrink-0 transition-transform text-neutral-300 ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                {u.category === 'disaster' && <span className="shrink-0 text-[10px]">🚨</span>}
                <span className="flex-1 min-w-0 truncate text-[11px] font-bold">{u.title}</span>
                <span
                  className={`shrink-0 text-[10px] font-black rounded-full px-2 py-0.5 ${
                    fileCount > 0 ? 'text-emerald-600 bg-emerald-50' : 'text-neutral-300 bg-neutral-50'
                  }`}
                >
                  🎬 {fileCount}개
                </span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 pt-1 border-t border-neutral-50 space-y-3">
                  <p className="text-[10px] text-neutral-400">소재: {u.material}</p>
                  <LabeledFieldSection
                    site={site}
                    unit={u}
                    onRefresh={onRefresh}
                    fieldKey="renderFiles"
                    heading="🎬 렌더링 파일"
                    linkPlaceholder="파일 링크 붙여넣기 (또는 아래에서 직접 업로드)"
                    fileAccept=".mlt,.mp4,.mov,.zip,video/*"
                    uploadLabel="+ 파일 업로드 (Shotcut 프로젝트 .mlt / 최종 영상 등)"
                  />
                  {/* 2026-09-16(10차) 추가 — 사용자 요청: "13단계의 모달을 그대로 14단계에서
                      볼수있게 해줘~". Shotcut 조립 중 씬 이미지·자막을 바로바로 확인할 수
                      있게, 13단계와 완전히 같은 스토리보드 표 + 모달을 여기에도 그대로 띄운다. */}
                  <div className="border-t border-neutral-100 pt-3">
                    <div className="text-[10px] font-black text-neutral-400 mb-1">
                      🖼 13단계 스토리보드 (참고용 — 여기서도 이미지/영상 모달을 열어볼 수 있어요)
                    </div>
                    {srtError && <p className="text-[10px] text-red-500 font-bold mb-2">자막을 불러오지 못했습니다({srtError}).</p>}
                    <SceneEditorList
                      scenePrompts={u.scenePrompts || ''}
                      saving={saving}
                      onSave={(text) => saveScenePrompts(u.id, text)}
                      characterTabs={selectedCharacterPreset.tabs || []}
                      srtText={srtText || ''}
                      mergeMediaColumn
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
