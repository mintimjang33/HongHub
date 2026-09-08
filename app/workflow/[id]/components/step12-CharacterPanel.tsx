'use client';

import { useState } from 'react';
import type { Site, ContentUnit, Character } from '../types';
import { CharacterListEditor } from './shared';

// 유닛(콘텐츠) 하나의 캐릭터 목록 — 자료조사(ResearchPanel) 등과 같은 펼치기 카드 패턴.
function UnitCharacterCard({ site, unit, onRefresh }: { site: Site; unit: ContentUnit; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
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
          <UnitCharacterCard key={u.id} site={site} unit={u} onRefresh={onRefresh} />
        ))}
      </div>
    </div>
  );
}
