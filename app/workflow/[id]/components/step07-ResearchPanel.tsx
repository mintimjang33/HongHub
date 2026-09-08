'use client';

import { useState } from 'react';
import type { Site, ContentUnit } from '../types';
import { CopyButton } from './shared';

// 7번(자료조사) 단계 전용 패널 — 8번(대본 작성) 패널(Step5Panel)과는 완전히 별개 컴포넌트다.
// 소재 추천/제목 추천/대본 작성 위저드는 전혀 안 보여주고, 6번에서 등록된 콘텐츠 목록만 나열해서
// 콘텐츠별로 자료조사 메모(factCheck)와 출처(sources)만 수동으로 등록·수정·삭제하게 한다.
export function ResearchPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const draft = site.script_draft || {};
  const units = draft.units || [];
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [factCheckDraft, setFactCheckDraft] = useState('');
  const [newSourceText, setNewSourceText] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // 7번에서 바로 콘텐츠를 새로 등록(6번을 거치지 않고) — 대본 없이 제목/소재만으로 먼저 등록해두고
  // 자료조사부터 시작할 수 있게 하는 용도.
  const [showNewUnitForm, setShowNewUnitForm] = useState(false);
  const [newUnitTitle, setNewUnitTitle] = useState('');
  const [newUnitMaterial, setNewUnitMaterial] = useState('');
  const [addingUnit, setAddingUnit] = useState(false);
  // "수정"으로 통째로 고치는 것 말고, 사실 하나 + 출처 하나를 바로 추가하는 용도.
  const [newFindingFact, setNewFindingFact] = useState<Record<string, string>>({});
  const [newFindingSource, setNewFindingSource] = useState<Record<string, string>>({});

  async function addUnit(title: string, material: string) {
    if (!title.trim()) return;
    setAddingUnit(true);
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
        body: JSON.stringify({ siteId: site.id, units: [...units, unit] }),
      });
      setNewUnitTitle('');
      setNewUnitMaterial('');
      setShowNewUnitForm(false);
      onRefresh();
    } finally {
      setAddingUnit(false);
    }
  }

  // 사실 하나 + 출처 하나를 한 번에 추가 — factCheck에는 줄 하나로 붙고, sources에도 그 URL이 같이 들어간다.
  async function addFinding(id: string, fact: string, sourceUrl: string) {
    if (!fact.trim()) return;
    const unit = units.find((u) => u.id === id);
    if (!unit) return;
    const line = sourceUrl.trim() ? `- ${fact.trim()}\n  출처: ${sourceUrl.trim()}` : `- ${fact.trim()}`;
    const nextFactCheck = unit.factCheck ? `${unit.factCheck}\n\n${line}` : line;
    const nextSources =
      sourceUrl.trim() && !(unit.sources || []).includes(sourceUrl.trim()) ? [...(unit.sources || []), sourceUrl.trim()] : unit.sources || [];
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === id ? { ...u, factCheck: nextFactCheck, sources: nextSources } : u)) }),
    });
    onRefresh();
  }

  async function saveFactCheck(id: string, factCheck: string) {
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === id ? { ...u, factCheck } : u)) }),
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function addSource(id: string, url: string) {
    if (!url.trim()) return;
    const unit = units.find((u) => u.id === id);
    const nextSources = [...(unit?.sources || []), url.trim()];
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === id ? { ...u, sources: nextSources } : u)) }),
    });
    onRefresh();
  }

  async function deleteSource(id: string, idx: number) {
    const unit = units.find((u) => u.id === id);
    const nextSources = (unit?.sources || []).filter((_, i) => i !== idx);
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === id ? { ...u, sources: nextSources } : u)) }),
    });
    onRefresh();
  }

  return (
    <div className="space-y-1.5">
      {showNewUnitForm ? (
        <div className="bg-white border border-neutral-200 rounded-lg p-3 mb-1 space-y-2">
          <input
            value={newUnitTitle}
            onChange={(e) => setNewUnitTitle(e.target.value)}
            placeholder="콘텐츠 제목 *"
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs"
          />
          <input
            value={newUnitMaterial}
            onChange={(e) => setNewUnitMaterial(e.target.value)}
            placeholder="소재 설명 (비우면 제목과 동일하게 저장)"
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs"
          />
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setShowNewUnitForm(false)} className="text-[11px] font-bold text-neutral-400 hover:text-black px-2">
              취소
            </button>
            <button
              onClick={() => addUnit(newUnitTitle, newUnitMaterial)}
              disabled={addingUnit || !newUnitTitle.trim()}
              className="text-[11px] font-black px-4 py-2 rounded-lg bg-black text-white disabled:opacity-40"
            >
              {addingUnit ? '등록 중...' : '등록'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowNewUnitForm(true)}
          className="w-full text-[11px] font-black px-3 py-2 rounded-lg border border-dashed border-neutral-300 text-neutral-500 hover:border-neutral-400 hover:text-black mb-1"
        >
          + 새 콘텐츠 등록 (대본 없이 제목만 먼저 등록하고 자료조사부터 시작)
        </button>
      )}
      {units.length === 0 && <p className="text-xs text-neutral-300">아직 등록된 콘텐츠가 없어요 — 위에서 새로 등록하거나, 5·6번에서 소재를 확정하세요.</p>}
      {units.map((u) => (
        <div key={u.id} className="bg-white border border-neutral-100 rounded-lg overflow-hidden">
          <button
            onClick={() => {
              setOpenId((cur) => (cur === u.id ? null : u.id));
              setEditingId(null);
            }}
            className="w-full text-left px-3 py-2 flex items-center gap-2"
          >
            <span className={`shrink-0 text-neutral-300 transition-transform ${openId === u.id ? 'rotate-90' : ''}`}>▶</span>
            <span className="flex-1 min-w-0 text-[11px] font-bold truncate">{u.title}</span>
            {u.factCheck ? (
              <span className="shrink-0 text-[10px] font-bold text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5">✅ 조사됨</span>
            ) : (
              <span className="shrink-0 text-[10px] font-bold text-neutral-400 bg-neutral-100 rounded-full px-2 py-0.5">미조사</span>
            )}
          </button>
          {openId === u.id && (
            <div className="px-3 pb-3 pt-1 border-t border-neutral-100 space-y-2">
              <p className="text-[10px] text-neutral-400">소재: {u.material}</p>
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-[10px] font-black text-neutral-400">자료조사 메모 — 사실은 반드시 출처와 함께 기록</p>
                  {editingId !== u.id && (
                    <div className="shrink-0 flex items-center gap-1.5">
                      <div className="inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-full border border-amber-200 bg-amber-50">
                        <span className="text-amber-700">🔍 제미나이 프롬프트</span>
                        <CopyButton
                          text={`[맥락] 우리는 유튜브 미스터리·경제사 채널을 운영한다. 진행자는 "젠틀맨 루즈"라는 냉소적이고 연극적인 캐릭터이고, 매 영상은 "누구나 아는 사실 이면의 결정적 반전"을 찾아내 15분 분량의 드라마틱한 나레이션 대본으로 만든다. 지금 이 조사는 그 대본을 쓰기 위한 사전 자료조사다.

[역할] 너는 이 채널의 리서처다. 지금 이 자리에서 구글 검색으로 아래 [소재]에 대한 실제 사실을 직접 조사해라. 위 맥락을 이해했다면 어떤 사실이 영상에 쓸모 있을지는 스스로 판단해라 — 단순 정보 나열이 아니라 반전·아이러니가 될 만한 사실 위주로 찾아라.

[소재]
${u.material}

[출력 형식] 번호 매긴 목록으로 사실+출처만 출력해라. 서론·조사팁·질문 붙이지 마라.
① 사실 — 출처: URL
② 사실 — 출처: URL
(최소 15개 이상)

[참고 자료] 우리 채널 정보: https://honghub.vercel.app/share/${site.id}`}
                        />
                      </div>
                      {u.factCheck && <CopyButton text={u.factCheck} />}
                      <button
                        onClick={() => {
                          setEditingId(u.id);
                          setFactCheckDraft(u.factCheck || '');
                        }}
                        className="text-[10px] font-bold text-blue-600 hover:underline"
                      >
                        수정
                      </button>
                    </div>
                  )}
                </div>
                {editingId === u.id ? (
                  <div className="space-y-1">
                    <textarea
                      value={factCheckDraft}
                      onChange={(e) => setFactCheckDraft(e.target.value)}
                      rows={5}
                      placeholder="① 사실 — 출처: URL 형식으로, 사실마다 출처를 짝지어 적으세요"
                      className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px] leading-relaxed"
                    />
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => setEditingId(null)} className="text-[10px] font-bold text-neutral-400 hover:text-black">
                        취소
                      </button>
                      <button
                        onClick={async () => {
                          await saveFactCheck(u.id, factCheckDraft);
                          setEditingId(null);
                        }}
                        disabled={saving}
                        className="text-[10px] font-black text-emerald-600 hover:underline"
                      >
                        저장
                      </button>
                    </div>
                  </div>
                ) : u.factCheck ? (
                  <p className="text-[11px] text-neutral-500 whitespace-pre-wrap leading-relaxed">{u.factCheck}</p>
                ) : (
                  <p className="text-[11px] text-neutral-300">아직 자료조사 메모가 없어요 — &quot;수정&quot;을 눌러서 추가하세요.</p>
                )}
              </div>
              <div className="bg-neutral-50 border border-neutral-100 rounded-lg p-2 space-y-1.5">
                <p className="text-[10px] font-black text-neutral-400">+ 자료조사 추가 (사실 하나 + 출처 하나씩)</p>
                <textarea
                  value={newFindingFact[u.id] || ''}
                  onChange={(e) => setNewFindingFact((prev) => ({ ...prev, [u.id]: e.target.value }))}
                  rows={2}
                  placeholder="새로 확인한 사실 하나"
                  className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px] leading-relaxed"
                />
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newFindingSource[u.id] || ''}
                    onChange={(e) => setNewFindingSource((prev) => ({ ...prev, [u.id]: e.target.value }))}
                    placeholder="이 사실의 출처 URL"
                    className="flex-1 text-[11px] border border-neutral-200 rounded-lg px-2 py-1.5"
                  />
                  <button
                    onClick={() => {
                      addFinding(u.id, newFindingFact[u.id] || '', newFindingSource[u.id] || '');
                      setNewFindingFact((prev) => ({ ...prev, [u.id]: '' }));
                      setNewFindingSource((prev) => ({ ...prev, [u.id]: '' }));
                    }}
                    disabled={!(newFindingFact[u.id] || '').trim()}
                    className="shrink-0 text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                  >
                    + 추가
                  </button>
                </div>
              </div>
              {u.sources && u.sources.length > 0 && (
                <div className="space-y-1">
                  {u.sources.map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px] text-neutral-400">
                      <a href={s} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 truncate hover:underline hover:text-blue-600">
                        {s}
                      </a>
                      <button onClick={() => deleteSource(u.id, i)} className="shrink-0 font-black text-neutral-300 hover:text-red-500" title="출처 삭제">
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newSourceText[u.id] || ''}
                  onChange={(e) => setNewSourceText((prev) => ({ ...prev, [u.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      addSource(u.id, newSourceText[u.id] || '');
                      setNewSourceText((prev) => ({ ...prev, [u.id]: '' }));
                    }
                  }}
                  placeholder="출처 URL 추가"
                  className="flex-1 text-[10px] border border-neutral-200 rounded-lg px-2 py-1"
                />
                <button
                  onClick={() => {
                    addSource(u.id, newSourceText[u.id] || '');
                    setNewSourceText((prev) => ({ ...prev, [u.id]: '' }));
                  }}
                  disabled={!(newSourceText[u.id] || '').trim()}
                  className="shrink-0 text-[10px] font-black px-2.5 py-1 rounded-lg bg-black text-white disabled:opacity-40"
                >
                  + 출처 추가
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
