'use client';

import { useState } from 'react';
import type { ContentUnit, LabeledItem, Site } from '../types';
import { normalizeLabeledItems } from '../utils';
import { LabeledFieldSection } from './step13-14-LabeledLinksPanel';

// 15번(썸네일 제작) 단계 전용 — 2026-09-17 신설, 사용자 요청: "15단계는 => 롱폼일경우
// 썸네일을 만드는 과정" + "제미나이나 클로드가 다른 채널들의 썸네일을 분석해서 썸네일을
// 만드는 단계" + "15단계새로 만들었으면 자동으로 컨텐츠들이 있어야 할꺼 아니야". 14번
// 렌더링 패널(step14-RenderPanel.tsx)과 정확히 같은 구조("콘텐츠 하나에 라벨 붙은 링크/파일
// 여러 개")로 만든다 — 실제 썸네일 분석·제작은 제미나이/클로드에게 프롬프트로 시키고(아래
// "분석 프롬프트 복사" 버튼), 나온 결과 이미지를 여기 업로드해서 콘텐츠별로 관리한다.
//
// 2026-09-18(2차) 추가 — 사용자 지적: "프롬프트 수동 등록 버튼도 없고 수정 삭제 버튼도
// 없고". 지금까지 이미지+프롬프트 미리보기(위 thumbItems.map)는 완전히 읽기 전용이었다 —
// 프롬프트(label)를 실제로 쓰거나 고치려면 아래 LabeledFieldSection의 아주 좁은(7rem)
// 한 줄짜리 라벨 입력칸을 써야 했는데, 여러 줄짜리 실제 프롬프트를 넣기엔 사실상 못 쓰는
// 칸이었고 이미지와 떨어져 있어 어디 붙는 라벨인지도 헷갈렸다. 각 이미지 카드에 바로
// "✏️ 프롬프트 수정"(여러 줄 textarea로 직접 입력/등록) + "🗑 삭제" 버튼을 붙인다.
export function ThumbnailPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const units = site.script_draft?.units || [];
  const [openUnitId, setOpenUnitId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);

  if (units.length === 0) {
    return (
      <div className="border-t border-black/5 pt-3">
        <p className="text-xs text-neutral-300">아직 대본 작성에서 완성된 콘텐츠가 없어요 — 먼저 대본을 완성해주세요.</p>
      </div>
    );
  }

  function buildAnalysisPrompt(title: string) {
    return `롱폼 유튜브 영상 "${title}"의 썸네일을 만들려고 합니다.

1) 이 콘텐츠와 같은 장르(경제/재테크 반전 서사)의 실제 인기 채널 썸네일들을 검색해서 공통 패턴을 분석해주세요 — 문구 글자 수(보통 3~4단어 이하), 색상 대비, 실사 인물 사진 사용 여부, 텍스트 배치(좌/우/상단), 화살표·강조 이모지 사용 여부 등.
2) 그 패턴에 맞춰 이 영상에 쓸 썸네일 문구 3안을 제안해주세요.
3) 그중 하나를 골라, 실제 이미지 생성 프롬프트(구도·텍스트·색상 지정 포함)까지 완성해서 주세요.`;
  }

  async function copyPrompt(unitId: string, title: string) {
    try {
      await navigator.clipboard.writeText(buildAnalysisPrompt(title));
      setCopiedId(unitId);
      setTimeout(() => setCopiedId((cur) => (cur === unitId ? null : cur)), 1500);
    } catch {
      // 클립보드 권한 없는 환경 — 조용히 무시
    }
  }

  async function saveThumbnailItems(unit: ContentUnit, newItems: LabeledItem[]) {
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, unitPatch: { id: unit.id, fields: { thumbnailFiles: newItems } } }),
    });
    onRefresh();
  }

  function startEditPrompt(unitId: string, idx: number, currentLabel: string) {
    setEditingKey(`${unitId}-${idx}`);
    setEditDraft(currentLabel);
  }

  function cancelEditPrompt() {
    setEditingKey(null);
    setEditDraft('');
  }

  async function savePrompt(unit: ContentUnit, idx: number) {
    const key = `${unit.id}-${idx}`;
    const items = normalizeLabeledItems(unit.thumbnailFiles);
    setSavingKey(key);
    try {
      await saveThumbnailItems(unit, items.map((it, i) => (i === idx ? { ...it, label: editDraft } : it)));
      setEditingKey(null);
      setEditDraft('');
    } finally {
      setSavingKey(null);
    }
  }

  async function deleteThumbnail(unit: ContentUnit, idx: number) {
    const items = normalizeLabeledItems(unit.thumbnailFiles);
    const key = `${unit.id}-${idx}`;
    setSavingKey(key);
    try {
      await saveThumbnailItems(unit, items.filter((_, i) => i !== idx));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="border-t border-black/5 pt-3">
      <div className="text-xs font-black text-neutral-500 mb-2">🖼 썸네일 (롱폼 전용)</div>
      <div className="space-y-1.5">
        {units.map((u) => {
          const thumbItems = normalizeLabeledItems(u.thumbnailFiles);
          const fileCount = thumbItems.length;
          const isOpen = openUnitId === u.id;
          return (
            <div key={u.id} className="bg-white border border-neutral-100 rounded-lg overflow-hidden">
              <button
                onClick={() => setOpenUnitId((cur) => (cur === u.id ? null : u.id))}
                className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer"
              >
                <span className={`shrink-0 transition-transform text-neutral-300 ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                <span className="flex-1 min-w-0 truncate text-[11px] font-bold">{u.title}</span>
                <span
                  className={`shrink-0 text-[10px] font-black rounded-full px-2 py-0.5 ${
                    fileCount > 0 ? 'text-emerald-600 bg-emerald-50' : 'text-neutral-300 bg-neutral-50'
                  }`}
                >
                  🖼 {fileCount}개
                </span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 pt-1 border-t border-neutral-50 space-y-3">
                  <button
                    onClick={() => copyPrompt(u.id, u.title)}
                    className="text-[10px] font-black px-2 py-1.5 rounded-lg bg-neutral-900 text-white"
                  >
                    {copiedId === u.id ? '✓ 복사됨' : '🔍 썸네일 분석·제작 프롬프트 복사'}
                  </button>
                  {thumbItems.length > 0 && (
                    <div className="space-y-2">
                      {thumbItems.map((it, idx) => {
                        const key = `${u.id}-${idx}`;
                        const isEditing = editingKey === key;
                        return (
                          <div key={idx} className="border border-neutral-200 rounded-lg p-1.5">
                            <a href={it.url} target="_blank" rel="noopener noreferrer" className="block">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={it.url} alt={it.label || ''} className="w-full max-w-xs mx-auto aspect-video object-cover rounded-lg" />
                            </a>
                            {isEditing ? (
                              <div className="mt-1.5 space-y-1.5">
                                <textarea
                                  value={editDraft}
                                  onChange={(e) => setEditDraft(e.target.value)}
                                  rows={6}
                                  placeholder="이 썸네일에 실제로 쓴(또는 쓸) 프롬프트 전문을 직접 입력하세요"
                                  className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[10px] font-mono"
                                />
                                <div className="flex justify-end gap-1.5">
                                  <button
                                    onClick={cancelEditPrompt}
                                    className="text-[10px] font-black px-2 py-1 rounded-lg bg-white border border-neutral-200 text-neutral-500"
                                  >
                                    취소
                                  </button>
                                  <button
                                    onClick={() => savePrompt(u, idx)}
                                    disabled={savingKey === key}
                                    className="text-[10px] font-black px-2 py-1 rounded-lg bg-black text-white disabled:opacity-40"
                                  >
                                    {savingKey === key ? '저장 중...' : '저장'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {it.label && <p className="text-[10px] text-neutral-500 mt-1 whitespace-pre-wrap break-words">{it.label}</p>}
                                <div className="flex justify-end gap-2 mt-1">
                                  <button
                                    onClick={() => startEditPrompt(u.id, idx, it.label || '')}
                                    className="text-[10px] font-bold text-neutral-400 hover:text-blue-600"
                                  >
                                    ✏️ 프롬프트 {it.label ? '수정' : '수동 등록'}
                                  </button>
                                  <button
                                    onClick={() => deleteThumbnail(u, idx)}
                                    disabled={savingKey === key}
                                    className="text-[10px] font-bold text-neutral-400 hover:text-red-500 disabled:opacity-40"
                                  >
                                    🗑 삭제
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <LabeledFieldSection
                    site={site}
                    unit={u}
                    onRefresh={onRefresh}
                    fieldKey="thumbnailFiles"
                    heading="🖼 썸네일 이미지 링크/파일 추가"
                    linkPlaceholder="썸네일 이미지 링크 붙여넣기 (또는 아래에서 직접 업로드)"
                    fileAccept="image/*"
                    uploadLabel="+ 썸네일 이미지 업로드"
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
