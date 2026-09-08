'use client';

import { useState } from 'react';
import type { Site } from '../types';
import { parseSceneBlocks } from '../utils';
import { CopyButton, SceneEditorList } from './shared';

// 16·17번(씬별 이미지 프롬프트 작성·생성 / 영상 생성) 단계 패널 — 완성된 콘텐츠 목록에서 이름을
// 클릭하면 펼쳐지면서 그 콘텐츠의 장면별 CLEAN/INFO/영상 프롬프트가 타임라인 순서로 나온다.
// 데이터 자체는 11번(대본 작성)의 콘텐츠 유닛(ContentUnit.scenePrompts)에 저장되지만, 실제로
// 이미지/영상을 만들 때 찾는 곳은 여기라서 이 패널에서도 똑같이 보여주고 편집도 여기서 끝낼 수 있게 한다.
// (코드상 이름은 구버전 "Step6Panel" — 파이프라인이 5~20번 구조로 재편되며 16·17번으로 옮겨졌다.)
export function ImageVideoPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const units = site.script_draft?.units || [];
  const [openUnitId, setOpenUnitId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
                  <div className="inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-full border border-amber-200 bg-amber-50 mb-2">
                    <span className="text-amber-700">🔍 제미나이 프롬프트 (13번 TTS 타임코드 채운 뒤 사용)</span>
                    <CopyButton
                      text={`[역할] 너는 우리 채널 영상의 편집 감독(edit director)이다. 완성된 대본과 실제 TTS 나레이션의 타임코드를 기반으로, 정확한 초 단위 스토리보드와 각 장면의 이미지 생성 프롬프트를 설계한다.

[입력]
- 최종 확정 대본:
${u.script || '(아직 11번에서 대본이 완성되지 않았습니다)'}
- 실제 TTS 낭독 타임코드: [13번에서 뽑은 나레이션을 들으며 챕터별/문단별 시작~끝 초를 직접 채워 넣으세요]

[작업 지시]
1. 6~7초 단위로 장면을 나눈다. 장면 경계는 반드시 위 타임코드에 맞춰, 문장이 끊기는 자연스러운 호흡 지점에서 나눈다 — 임의로 초를 배분하지 않는다.
2. 장면마다 다음 4개 열로 구성된 표를 만든다: (1) 타임(시작~끝, 초 단위) (2) 화면 설명(한국어) (3) 이미지 프롬프트(영어, Flow AI 이미지 생성용) (4) 영상/전환 프롬프트(영어)

[이미지 프롬프트 작성 규칙 — 반드시 지킬 것]
- 진행자가 등장하는 장면은 항상 "젠틀맨 루즈"(검은 톱햇, 금테 외알렌즈, 검은 연미복+금색 안감 망토, 능글맞고 자신감 있는 쇼맨, 반전 순간 망토를 젖히는 제스처)로 묘사한다. 레퍼런스 이미지: https://iwxpjnwktxpscoktfpyl.supabase.co/storage/v1/object/public/honghub-files/character-refs/economics-gentleman-rouge.jpg
- 실존 인물의 동작이 필요한 장면은 얼굴을 그리지 않고 손 클로즈업으로만 표현한다.
- 이 소재의 상징 사물을 의인화한 배역이 등장할 수 있다 — 팔다리·눈·표정을 붙이되 사람 얼굴 캐릭터로 그리지 않는다.
- 이미지 안에 텍스트·캡션·라벨·제목을 절대 넣지 않는다 — 프롬프트 끝에 "IMPORTANT: absolutely NO text, no captions, no title, no labels anywhere in the image"를 반드시 포함한다.
- 재질/질감 지시는 반드시 "캐릭터 표면 자체의 재질"이라고 명시한다 — 배경은 별도로 "plain solid grey background" 등으로 명확히 지정한다.

[출력 형식] 위 표만 챕터 순서대로 전체 대본 분량만큼 빠짐없이 작성해줘. 표 앞뒤에 부연설명 붙이지 마.`}
                    />
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
