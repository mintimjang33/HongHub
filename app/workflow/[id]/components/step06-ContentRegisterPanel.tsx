'use client';

import { useState } from 'react';
import type { Site, ContentUnit } from '../types';

// 6번(콘텐츠 등록) 단계 전용 패널 — 유닛의 제목/소재만 등록·수정·삭제한다.
// 대본은 8번(Step5Panel), 자료조사는 7번(ResearchPanel)의 몫이라 여기서는 건드리지 않는다.
export function ContentRegisterPanel({
  site,
  onRefresh,
  onGoToMaterialSelection,
}: {
  site: Site;
  onRefresh: () => void;
  // "5번 소재 선정"으로 되돌아가서 소재를 체크하는 흐름으로 콘텐츠를 만들고 싶을 때 쓰는 이동 버튼.
  onGoToMaterialSelection?: () => void;
}) {
  const draft = site.script_draft || {};
  const units = draft.units || [];
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newMaterial, setNewMaterial] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editMaterial, setEditMaterial] = useState('');
  const [savingEditId, setSavingEditId] = useState<string | null>(null);

  async function addUnit(title: string, material: string) {
    if (!title.trim()) return;
    setAdding(true);
    try {
      const unit: ContentUnit = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        material: material.trim() || title.trim(),
        title: title.trim(),
        script: '',
        category: draft.category || 'trivia',
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // 2026-09-08 수정 — 5번에서 confirmMaterial()이 selectedMaterial을 세팅해두는데, 여기서
        // 등록을 마쳐도 그 값을 안 지워서 11번(대본 작성) 화면이 이미 등록 끝난 소재를 계속
        // "선택된 소재"로 보여주며 아무도 안 쓰는 옛날 2️⃣제목추천/3️⃣대본 위저드를 되살리는
        // 버그가 있었다(사용자 지적: "컨텐츠 안에 들어가 있어야 하는 내용이 왜 나와있어???").
        // 등록이 끝나면 그 소재는 이 유닛으로 넘어간 것이므로 selectedMaterial을 비운다.
        body: JSON.stringify({
          siteId: site.id,
          units: [...units, unit],
          ...(draft.selectedMaterial === unit.material ? { selectedMaterial: null } : {}),
        }),
      });
      setNewTitle('');
      setNewMaterial('');
      setShowNewForm(false);
      onRefresh();
    } finally {
      setAdding(false);
    }
  }

  async function saveEdit(id: string) {
    setSavingEditId(id);
    try {
      const target = units.find((u) => u.id === id);
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: site.id,
          unitPatch: { id, fields: { title: editTitle.trim() || target?.title, material: editMaterial.trim() || target?.material } },
        }),
      });
      setEditingId(null);
      onRefresh();
    } finally {
      setSavingEditId(null);
    }
  }

  async function deleteUnit(id: string) {
    if (!confirm('이 콘텐츠를 삭제할까요? (대본·자료조사 내용도 같이 지워져요)')) return;
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, units: units.filter((u) => u.id !== id) }),
    });
    onRefresh();
  }

  // 등록을 완전히 지우지 않고 5번(소재 선정) 목록으로 되돌린다(2026-09-08 추가) — deleteUnit과 달리 소재 문구를 materials에
  // 다시 넣어서 5번에서 다시 고를 수 있게 한다. selectedMaterial이 이 유니트의 material과 같으면(보통 그렇다 —
  // confirmMaterial이 그것을 selectedMaterial로 설정해놓고 6번으로 넘겼기 때문) 함께 비운다 — 안 그러면 5번 위저드가
  // 이 소재가 이미 확정된 것처럼 보여준다.
  async function undoUnit(u: ContentUnit) {
    if (!confirm(`"${u.title}" 등록을 취소하고 5번 소재 목록으로 되돌릴까요?`)) return;
    const nextMaterials = (draft.materials || []).includes(u.material) ? draft.materials || [] : [...(draft.materials || []), u.material];
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId: site.id,
        materials: nextMaterials,
        selectedMaterial: draft.selectedMaterial === u.material ? null : draft.selectedMaterial,
        units: units.filter((x) => x.id !== u.id),
      }),
    });
    onRefresh();
    onGoToMaterialSelection?.();
  }

  return (
    <div className="space-y-1.5">
      {showNewForm ? (
        <div className="bg-white border border-neutral-200 rounded-lg p-3 mb-1 space-y-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="콘텐츠 제목 *"
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs"
          />
          <input
            value={newMaterial}
            onChange={(e) => setNewMaterial(e.target.value)}
            placeholder="소재 설명 (비우면 제목과 동일하게 저장)"
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs"
          />
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setShowNewForm(false)} className="text-[11px] font-bold text-neutral-400 hover:text-black px-2">
              취소
            </button>
            <button
              onClick={() => addUnit(newTitle, newMaterial)}
              disabled={adding || !newTitle.trim()}
              className="text-[11px] font-black px-4 py-2 rounded-lg bg-black text-white disabled:opacity-40"
            >
              {adding ? '등록 중...' : '등록'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-1.5 mb-1">
          <button
            onClick={() => setShowNewForm(true)}
            className="flex-1 text-[11px] font-black px-3 py-2 rounded-lg border border-dashed border-neutral-300 text-neutral-500 hover:border-neutral-400 hover:text-black"
          >
            + 새 콘텐츠 등록
          </button>
          {onGoToMaterialSelection && (
            <button
              onClick={onGoToMaterialSelection}
              className="shrink-0 text-[11px] font-bold px-3 py-2 rounded-lg border border-neutral-200 text-neutral-500 hover:border-neutral-400 hover:text-black bg-white"
            >
              🔙 5번에서 소재 고르기
            </button>
          )}
        </div>
      )}
      {units.length === 0 && <p className="text-xs text-neutral-300">아직 등록된 콘텐츠가 없어요 — 5번에서 소재를 체크하면 여기로 자동 이동돼요.</p>}
      {units.map((u) => (
        <div key={u.id} className="bg-white border border-neutral-100 rounded-lg px-3 py-2">
          {editingId === u.id ? (
            <div className="space-y-1.5">
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px]"
                placeholder="제목"
              />
              <input
                value={editMaterial}
                onChange={(e) => setEditMaterial(e.target.value)}
                className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px]"
                placeholder="소재"
              />
              <div className="flex justify-end gap-1.5">
                <button onClick={() => setEditingId(null)} className="text-[10px] font-bold text-neutral-400 hover:text-black">
                  취소
                </button>
                <button
                  onClick={() => saveEdit(u.id)}
                  disabled={savingEditId === u.id}
                  className="text-[10px] font-black text-emerald-600 hover:underline"
                >
                  저장
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold truncate">{u.title}</p>
                <p className="text-[10px] text-neutral-400 truncate">{u.material}</p>
              </div>
              <button
                onClick={() => {
                  setEditingId(u.id);
                  setEditTitle(u.title);
                  setEditMaterial(u.material);
                }}
                className="shrink-0 text-[10px] font-bold text-blue-600 hover:underline"
              >
                수정
              </button>
              <button
                onClick={() => undoUnit(u)}
                className="shrink-0 text-[10px] font-bold text-amber-600 hover:underline"
                title="등록을 취소하고 5번 소재 목록으로 되돌립니다"
              >
                ↩️ 5번으로
              </button>
              <button onClick={() => deleteUnit(u.id)} className="shrink-0 text-[10px] font-black text-neutral-300 hover:text-red-500" title="삭제">
                ✕
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
