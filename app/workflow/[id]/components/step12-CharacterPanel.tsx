'use client';

import { useState } from 'react';
import type { Site, ContentUnit, Character } from '../types';
import { CharacterListEditor, CopyButton } from './shared';

// 콘텐츠별 배역(소재를 의인화한 캐릭터)을 파싱하는 응답 형식 — [이름]/[역할]/[설명] 3줄짜리
// 세트가 캐릭터 수만큼 반복된다(대본 챕터마다 배역이 여러 개일 수 있음 — 아래 프롬프트 참고).
function parseCharacterPastes(text: string): Character[] {
  const blocks = text
    .split(/(?=\[이름\])/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks
    .map((block, idx) => {
      const pick = (label: string) => {
        const m = block.match(new RegExp(`\\[${label}\\]([\\s\\S]*?)(?=\\[이름\\]|\\[역할\\]|\\[설명\\]|$)`));
        return m ? m[1].trim() : '';
      };
      return {
        id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        name: pick('이름'),
        role: pick('역할'),
        description: pick('설명'),
      };
    })
    .filter((c) => c.name);
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
    const parsed = parseCharacterPastes(pasteText);
    if (parsed.length === 0) return;
    await saveUnitCharacters([...chars, ...parsed]);
    setPasteOpen(false);
    setPasteText('');
  }

  const host = mainCharacters[0];
  // 2026-09-08 수정 — 처음엔 소재(material) 한 줄만 보고 배역 "하나"를 뽑게 했는데, 실제로는
  // 대본(script) 안에서 챕터마다 상징 사물이 바뀌거나(코카콜라 유닛: 초기형 병→곡선형 병 리디자인
  // 장면) 카메오(백곰, 산타 버전)까지 여러 배역이 필요하다는 게 이미 등록된 데이터로 확인됐다
  // (사용자 지적: "대본안에서 필요한 캐릭터들을 뽑는거 아니야?"). 그래서 필요한 배역을 빠짐없이
  // 찾게 하고, 출력도 캐릭터 하나가 아니라 여러 개(각각 [이름]/[역할]/[설명] 세트 반복)를 받을
  // 수 있게 바꿨다. 대본 자체는 만자 넘는 경우가 많아 통째로 프롬프트에 박아넣으면 복사할 때마다
  // 프롬프트가 거대해지므로, 11번(대본) 프롬프트가 이미 쓰는 같은 공개 링크(/share/[id])를 그대로
  // 재사용해서 "이 제목의 대본을 열어서 읽어라"고 지시한다(사용자 지적: "대본 링크를 전달해야
  // 하는거 아니야?") — 항상 최신 저장본을 링크로 가리키고, 매번 최신 스냅샷을 복사해 넣을 필요가 없다.
  // 2026-09-08 추가 수정 — [설명] 지시가 "Flow 프롬프트에 옮겨 쓸 수 있을 만큼 구체적으로"로만
  // 돼있어서, 한국어 설명으로 대충 채우고 끝날 여지가 있었다(사용자 지적: "이미지 프롬프트를
  // 뽑으라고 한거 맞아?"). 이미 등록된 캐릭터(C02~C05)들의 실제 형식 — 영어로 된 완성형
  // "Character reference sheet, Korean webtoon vector illustration style: ..." 프롬프트 —
  // 을 그대로 템플릿으로 박아서, 설명이 아니라 Flow에 바로 붙여넣을 프롬프트 문장 자체를 쓰게 했다.
  const characterPrompt = `[역할] 너는 우리 채널의 캐릭터 디자이너다. 아래 링크를 열어 "콘텐츠 유닛" 섹션에서 제목이 정확히 "${unit.title}"인 항목을 찾고, 그 대본을 읽어서 이야기 진행상 사물을 의인화한 배역 캐릭터로 등장시켜야 하는 지점을 전부 찾아 각각 캐릭터로 제안해라.

[대본 링크]
https://honghub.vercel.app/share/${site.id}

[채널 캐릭터 규칙 — 반드시 지킬 것]
- 실존 인물을 사람 얼굴 캐릭터로 그리지 않는다. 대신 그 장면의 상징이 되는 사물/브랜드/제품 자체에 팔다리·눈·표정을 붙여 의인화한다(예: 코카콜라 편이면 유리병 캐릭터).
- 실제 인물의 동작이 꼭 필요한 장면은 캐릭터로 만들지 않고 손 클로즈업으로만 표현한다는 게 이 채널의 원칙이니, 배역 자체는 사물 의인화로만 제안해라.
- 대본 전체에서 필요한 배역을 빠짐없이 찾아라 — 같은 사물이라도 챕터가 넘어가며 디자인이 바뀌는 순간(예: 초기형→리디자인)이 있으면 그 각각을 별도 캐릭터로 뽑고, 카메오로 등장하는 관련 브랜드/마스코트가 있으면 그것도 별도로 뽑아라. 결과가 1개일 수도, 여러 개일 수도 있다 — 대본 내용을 보고 판단해라.
- 이 배역들은 이 콘텐츠 하나에서만 쓰고, 채널 전체에 고정되는 캐릭터가 아니다 — 다음 소재에서는 또 다른 사물이 배역이 된다.
- 이미지 안에 텍스트·캡션·라벨·제목을 절대 넣지 않는다 — 각 캐릭터 설명 끝에 "IMPORTANT: absolutely NO text, no captions, no title, no labels anywhere in the image"를 반드시 포함해라.
- 재질/질감 지시는 반드시 "캐릭터 표면 자체의 재질"이라고 명시해라 — 비유를 배경 전체로 오인하지 않게, 배경은 별도로 "plain solid grey background"라고 명확히 지정해라.
${host ? `- 진행자 캐릭터(${host.name})와 같은 화면에 등장해도 어색하지 않게, 톤·스타일(색감·질감·과장 정도)을 맞춰라. 진행자 설명: ${host.description}` : ''}

[이 콘텐츠의 소재]
${unit.material}

[출력 형식 — 캐릭터 하나당 아래 3줄 세트를 반복해라(필요한 만큼), 세트 사이는 빈 줄로 구분. 다른 설명 붙이지 마라]
[이름] (캐릭터 이름 — 한국어/영어 상관없음)
[역할] (한 줄, 한국어 — 등장하는 챕터/장면과 이 콘텐츠에서 맡는 역할)
[설명] (한국어 설명이 아니라, Flow(이미지 생성 AI)에 그대로 붙여넣을 완성된 영어 이미지 생성 프롬프트 문장 그 자체를 써라. 반드시 아래 형식을 따라라: "Character reference sheet, Korean webtoon vector illustration style: [의인화된 사물의 외형·색감·질감·표정·자세를 구체적으로]. Clean line art, flat colors, vector-style graphics, minimalist and lively energy, [색상 팔레트]. Plain solid [색상] grey background, centered composition, character reference sheet presentation, single isolated figure. IMPORTANT: absolutely NO text, no captions, no title, no labels anywhere in the image." — 대괄호 부분을 실제 내용으로 채우고, 나머지 틀·문장 구조는 그대로 따라라)`;

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
          {unit.script ? (
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
          ) : (
            <p className="text-[10px] text-neutral-300 mb-2">대본이 링크로 전달되니, 11번에서 대본을 먼저 작성해야 배역 추천을 받을 수 있어요.</p>
          )}
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
