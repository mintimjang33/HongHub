'use client';

import { useState } from 'react';
import type { Site } from '../types';
import { parseSceneBlocks, normalizeLabeledItems } from '../utils';
import { CopyButton, SceneEditorList } from './shared';

// 14번(구 16-17번, 씬별 이미지 프롬프트 작성·생성) 단계 패널 — 완성된 콘텐츠 목록에서 이름을
// 클릭하면 펼쳐지면서 그 콘텐츠의 장면별 CLEAN/INFO/영상 프롬프트가 타임라인 순서로 나온다.
// 데이터 자체는 11번(대본 작성)의 콘텐츠 유닛(ContentUnit.scenePrompts)에 저장되지만, 실제로
// 이미지/영상을 만들 때 찾는 곳은 여기라서 이 패널에서도 똑같이 보여주고 편집도 여기서 끝낼 수 있게 한다.
// (코드상 이름은 구버전 "Step6Panel" — 파이프라인이 5~20번 구조로 재편되며 16·17번, 이후 14번으로 옮겨졌다.)
//
// 2026-09-09 수정 — 예전 프롬프트는 "13번에서 뽑은 나레이션을 들으며 챕터별/문단별 시작~끝 초를
// 직접 채워 넣으세요"처럼 사람이 귀로 듣고 타임코드를 수기로 채우는 걸 전제했다. 지금은 13번에서
// faster-whisper(또는 ElevenLabs with-timestamps)로 실측 타임코드가 담긴 자막(SRT) 파일이 이미
// 만들어져 있으므로, 그 링크를 프롬프트 텍스트 안에 그대로 포함시켜 제미나이에게 전달하는 방식으로
// 바꿨다(사용자 지적: "이걸 이렇게 주면 어떻게 해, 홍허브 14단계 복사버튼에 지침이 안 들어가 있어?"
// — 코카콜라 한 유닛에만 쓸 프롬프트를 채팅으로 즉석에서 만들어줬다가, 66개 유닛 전부가 재사용할
// 앱 코드 자체를 안 고쳤다는 지적을 받음).
// ⚠️ 처음엔 <a download> 버튼으로 자막 파일을 따로 받게 했었는데, Supabase Storage 공개 URL이
// Content-Disposition 헤더 없이 text/plain으로만 응답해서(cross-origin이라 download 속성 자체가
// 브라우저에서 무시됨) 클릭하면 다운로드 대신 새 탭에 텍스트가 그냥 열려버렸다(사용자 지적: "왜
// 자막이 다운로드가 안되고 열리는거지"). 별도 다운로드 버튼을 만드는 대신, 자막 URL을 프롬프트
// 텍스트 안에 직접 적어 넣어 복사 버튼 하나로 링크까지 같이 전달되게 했다(사용자 지시: "지침에
// 링크를 적어주면 되자나").
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
          const subtitleItems = normalizeLabeledItems(u.subtitleUrls);
          const subtitleUrl = subtitleItems[0]?.url || '';
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
                    <p className="text-[10px] text-red-500 font-bold mb-2">아직 13번에 자막이 없습니다 — 먼저 13번에서 자막을 등록해주세요. (자막 링크가 아래 프롬프트에 자동으로 포함됩니다)</p>
                  )}

                  <div className="inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-full border border-amber-200 bg-amber-50 mb-2">
                    <span className="text-amber-700">🔍 제미나이 프롬프트 (13번 자막 링크 포함됨)</span>
                    <CopyButton
                      text={`[역할] 너는 우리 채널 영상의 편집 감독(edit director)이다. 완성된 대본과, 아래 자막(SRT) 링크의 정확한 타임코드를 기반으로, 초 단위 스토리보드와 각 장면의 이미지/전환 프롬프트를 설계한다.

[자막(SRT) 링크] ${subtitleUrl || '(아직 13번에 자막이 등록되지 않았습니다 — 먼저 13번에서 자막을 등록하세요)'}
이 링크를 열어서 내용을 확인하고, 거기 담긴 타임코드를 아래 작업 지시의 기준으로 삼아라.

[중요 — 타임코드 처리 원칙] 위 SRT는 실제 나레이션 음성을 정밀 전사한 것으로, 각 줄의 시작~끝 초는 이미 확정된 실측값이다. 이 시간 값을 새로 추측하거나 반올림하지 말고, 반드시 SRT의 타임코드를 그대로 기준 삼아 장면 경계를 정한다 — 여러 줄을 하나의 장면으로 묶을 땐 그 줄들의 시작 초~마지막 줄의 끝 초를 그대로 장면의 startSec/endSec으로 쓴다.

[입력 — 최종 확정 대본 (화면 연출 지시 포함)]
${u.script || '(아직 11번에서 대본이 완성되지 않았습니다)'}

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

[출력 형식 — 반드시 아래 JSON 스키마의 배열 하나만 출력한다. 앞뒤 설명·마크다운 코드펜스 없이 순수 JSON 배열만.]
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

전체 대본 분량(콜드오픈부터 아웃트로까지)만큼 빠짐없이 장면을 다 만들어줘. SRT에 없는 구간을 임의로 지어내지 마.`}
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
