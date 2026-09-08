'use client';

import { useState } from 'react';
import type { Site, ContentUnit, Character } from '../types';
import { CharacterListEditor, CopyButton } from './shared';

// 콘텐츠별 배역(소재를 의인화한 캐릭터)을 파싱하는 응답 형식 — [이름]/[역할]/[설명] 3줄.
function parseCharacterPaste(text: string): Character {
  const pick = (label: string) => {
    const m = text.match(new RegExp(`\\[${label}\\]([\\s\\S]*?)(?=\\[이름\\]|\\[역할\\]|\\[설명\\]|$)`));
    return m ? m[1].trim() : '';
  };
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: pick('이름'),
    role: pick('역할'),
    description: pick('설명'),
  };
}

// 유닛(콘텐츠) 하나의 캐릭터 목록 — 자료조사(ResearchPanel) 등과 같은 펼치기 카드 패턴.
// 2026-09-08 추가 — 8~11번(전략/훅/기획서/대본)처럼 "🔍 제미나이 프롬프트" 복사 버튼을 이 카드에도
// 넣었다(사용자 지시: "12번도 제미나이에게 추천 받아볼까?"). 새 유닛마다 이 소재를 의인화한 배역을
// 매번 새로 고민하는 대신, 채널 캐릭터 확정 때 정한 규칙(사물 의인화, 실존 인물은 손 클로즈업으로만,
// 텍스트/캡션 금지, 재질은 "표면 자체의 재질"로 명시)을 프롬프트에 그대로 박아서 제미나이가 그
// 규칙을 지키는 배역을 제안하게 한다. mainCharacters(진행자)는 채널마다 다를 수 있어 하드코딩하지
// 않고 부모(CharacterPanel)가 실제 등록된 값을 그대로 내려준다.
function UnitCharacterCard({
  site,
  unit,
  mainCharacters,
  onRefresh,
}: {
  site: Site;
  unit: ContentUnit;
  mainCharacters: Character[];
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const chars = unit.characters || [];

  async function saveUnitCharacters(next: Character[]) {
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, unitPatch: { id: unit.id, fields: { characters: next } } }),
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function saveParsedCharacter() {
    if (!pasteText.trim()) return;
    await saveUnitCharacters([...chars, parseCharacterPaste(pasteText)]);
    setPasteOpen(false);
    setPasteText('');
  }

  const host = mainCharacters[0];
  const characterPrompt = `[역할] 너는 우리 채널의 캐릭터 디자이너다. 아래 소재를 의인화한 배역 캐릭터 하나를 제안해라.

[채널 캐릭터 규칙 — 반드시 지킬 것]
- 실존 인물을 사람 얼굴 캐릭터로 그리지 않는다. 대신 이 소재의 상징이 되는 사물/브랜드/제품 자체에 팔다리·눈·표정을 붙여 의인화한다(예: 코카콜라 편이면 유리병 캐릭터).
- 실제 인물의 동작이 꼭 필요한 장면은 캐릭터로 만들지 않고 손 클로즈업으로만 표현한다는 게 이 채널의 원칙이니, 배역 자체는 사물 의인화로만 제안해라.
- 이 배역은 이 콘텐츠 하나에서만 쓰고, 채널 전체에 고정되는 캐릭터가 아니다 — 다음 소재에서는 또 다른 사물이 배역이 된다.
- 이미지 안에 텍스트·캡션·라벨·제목을 절대 넣지 않는다 — 설명 끝에 "IMPORTANT: absolutely NO text, no captions, no title, no labels anywhere in the image"를 반드시 포함해라.
- 재질/질감 지시는 반드시 "캐릭터 표면 자체의 재질"이라고 명시해라 — 비유를 배경 전체로 오인하지 않게, 배경은 별도로 "plain solid grey background"라고 명확히 지정해라.
${host ? `- 진행자 캐릭터(${host.name})와 같은 화면에 등장해도 어색하지 않게, 톤·스타일(색감·질감·과장 정도)을 맞춰라. 진행자 설명: ${host.description}` : ''}

[이 콘텐츠의 소재]
${unit.material}

[출력 형식 — 아래 라벨 그대로, 다른 설명 붙이지 마라]
[이름] (캐릭터 이름)
[역할] (한 줄 — 이 콘텐츠에서 맡는 역할)
[설명] (외형·색감·질감·표정·자세 — Flow 이미지 생성 프롬프트에 그대로 옮겨 쓸 수 있을 만큼 구체적으로, 위 NO-text 문구 포함)`;

  return (
    <div className="bg-white border border-neutral-100 rounded-lg overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full text-left px-3 py-2 flex items-center gap-2">
        <span className={`shrink-0 text-neutral-300 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        <span className="flex-1 min-w-0 text-[11px] font-bold truncate">{unit.title}</span>
        <span className="shrink-0 text-[10px] font-bold text-neutral-400 bg-neutral-100 rounded-full px-2 py-0.5">
          캐릭터 {chars.length}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-neutral-100">
          <p className="text-[10px] text-neutral-400 mb-1.5">소재: {unit.material}</p>
          <div className="inline-flex items-center gap-1.5 text-[11px] font-black px-2 py-1 rounded-lg border border-amber-200 bg-amber-50 mb-2">
            <span className="text-amber-700">🔍 제미나이 배역 추천</span>
            <CopyButton text={characterPrompt} />
            <button
              onClick={() => {
                setPasteOpen((v) => !v);
                setPasteText('');
              }}
              className="text-[10px] font-bold text-neutral-400 hover:text-black"
            >
              {pasteOpen ? '접기' : '결과 붙여넣기'}
            </button>
          </div>
          {pasteOpen && (
            <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-2 mb-2">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={5}
                placeholder="구독 채팅(Gemini/Claude) 답변을 여기에 붙여넣으세요 ([이름]/[역할]/[설명] 포함)"
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono leading-relaxed mb-1.5"
              />
              <div className="flex justify-end gap-1.5">
                <button
                  onClick={saveParsedCharacter}
                  disabled={saving || !pasteText.trim()}
                  className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                >
                  {saving ? '저장 중...' : '캐릭터로 저장'}
                </button>
              </div>
            </div>
          )}
          <CharacterListEditor characters={chars} onSave={saveUnitCharacters} saving={saving} emptyText="이 콘텐츠 전용 캐릭터가 아직 없어요." />
        </div>
      )}
    </div>
  );
}

// 12번(채널 캐릭터 시스템 설계) 단계 패널.
export function CharacterPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const mainCharacters = site.script_draft?.characters || [];
  const units = site.script_draft?.units || [];
  const [savingMain, setSavingMain] = useState(false);

  async function saveMainCharacters(next: Character[]) {
    setSavingMain(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, characters: next }),
      });
      onRefresh();
    } finally {
      setSavingMain(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-[11px] text-neutral-400 leading-relaxed">
          채널 전체를 관통하는 진행자처럼, 모든 콘텐츠에 재사용할 캐릭터만 여기 등록하세요. 특정 콘텐츠 하나에서만 쓰는
          배역(소재를 의인화한 캐릭터 등)은 아래 "콘텐츠별 캐릭터"에서 그 콘텐츠 밑에 등록하세요. 지금은 1명뿐이지만
          앞으로 컨셉별로 여러 진행자를 만들어 골라 쓸 수 있게 번호를 붙여둡니다.
        </p>
        <CharacterListEditor
          characters={mainCharacters}
          onSave={saveMainCharacters}
          saving={savingMain}
          emptyText="아직 등록된 메인 캐릭터가 없어요."
          numbered
        />
      </div>
      <div className="space-y-1.5">
        <p className="text-[10px] font-black text-neutral-400">콘텐츠별 캐릭터 — 13번(이미지/영상 생성)에서 프롬프트를 짤 때 여기 설명을 그대로 참고합니다.</p>
        {units.length === 0 && <p className="text-[11px] text-neutral-300">아직 등록된 콘텐츠가 없어요 — 5·6번에서 소재를 먼저 확정하세요.</p>}
        {units.map((u) => (
          <UnitCharacterCard key={u.id} site={site} unit={u} mainCharacters={mainCharacters} onRefresh={onRefresh} />
        ))}
      </div>
    </div>
  );
}
