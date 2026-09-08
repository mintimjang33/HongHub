'use client';

import { useState } from 'react';
import type { Site, ContentUnit } from '../types';
import { CopyButton } from './shared';

// 8번(전략/컨셉 확정) 단계 전용 패널 — 7번(자료조사)에서 확보한 자료를 바탕으로 검토한 방향 후보를
// 실제로 다 적어두고, 그중 하나를 선택 + 이유를 기록한다(script-writer 스킬 3단계에 해당).
// ResearchPanel과 완전히 같은 리스트/펼치기 구조를 쓰되, factCheck/sources 대신 strategyOptions/selectedStrategy/strategyReason을 다룬다.
export function StrategyPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const draft = site.script_draft || {};
  const units = draft.units || [];
  const [openId, setOpenId] = useState<string | null>(null);
  const [newOptionText, setNewOptionText] = useState<Record<string, string>>({});
  const [editingReasonId, setEditingReasonId] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');
  // 후보 문구 자체를 고치는 용도 — key는 "unitId:idx" — (지우고 다시 쓰지 않고) 인라인으로 바로 수정할 수 있게.
  const [editingOptionKey, setEditingOptionKey] = useState<string | null>(null);
  const [editOptionDraft, setEditOptionDraft] = useState('');
  const [saving, setSaving] = useState(false);

  async function saveUnits(next: ContentUnit[]) {
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, units: next }),
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function addOption(id: string, text: string) {
    if (!text.trim()) return;
    await saveUnits(units.map((u) => (u.id === id ? { ...u, strategyOptions: [...(u.strategyOptions || []), text.trim()] } : u)));
  }

  async function deleteOption(id: string, idx: number) {
    const unit = units.find((u) => u.id === id);
    const nextOptions = (unit?.strategyOptions || []).filter((_, i) => i !== idx);
    const removed = unit?.strategyOptions?.[idx];
    await saveUnits(
      units.map((u) =>
        u.id === id
          ? { ...u, strategyOptions: nextOptions, selectedStrategy: u.selectedStrategy === removed ? undefined : u.selectedStrategy }
          : u
      )
    );
  }

  // 후보 문구를 고침 — 그 후보가 이미 selectedStrategy로 골라져 있었다면 selectedStrategy도 새 문구로 같이 바꿔서 선택 상태가 안 풀리게 한다.
  async function editOption(id: string, idx: number, newText: string) {
    if (!newText.trim()) return;
    const unit = units.find((u) => u.id === id);
    const oldText = unit?.strategyOptions?.[idx];
    const nextOptions = (unit?.strategyOptions || []).map((o, i) => (i === idx ? newText.trim() : o));
    await saveUnits(
      units.map((u) =>
        u.id === id
          ? { ...u, strategyOptions: nextOptions, selectedStrategy: u.selectedStrategy === oldText ? newText.trim() : u.selectedStrategy }
          : u
      )
    );
  }

  async function selectOption(id: string, text: string) {
    await saveUnits(units.map((u) => (u.id === id ? { ...u, selectedStrategy: u.selectedStrategy === text ? undefined : text } : u)));
  }

  async function saveReason(id: string, reason: string) {
    await saveUnits(units.map((u) => (u.id === id ? { ...u, strategyReason: reason } : u)));
  }

  return (
    <div className="space-y-2">
      {units.length === 0 && <p className="text-sm text-neutral-300">아직 등록된 콘텐츠가 없어요 — 먼저 6번(콘텐츠 등록)에서 콘텐츠를 등록하세요.</p>}
      {units.map((u) => (
        <div key={u.id} className="bg-white border border-neutral-100 rounded-lg overflow-hidden">
          <button onClick={() => setOpenId((cur) => (cur === u.id ? null : u.id))} className="w-full text-left px-3 py-2.5 flex items-center gap-2">
            <span className={`shrink-0 text-neutral-300 transition-transform ${openId === u.id ? 'rotate-90' : ''}`}>▶</span>
            <span className="flex-1 min-w-0 text-sm font-bold truncate">{u.title}</span>
            {u.selectedStrategy ? (
              <span className="shrink-0 text-xs font-bold text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5">✅ 확정됨</span>
            ) : (
              <span className="shrink-0 text-xs font-bold text-neutral-400 bg-neutral-100 rounded-full px-2 py-0.5">미착수</span>
            )}
          </button>
          {openId === u.id && (
            <div className="px-3 pb-3 pt-1 border-t border-neutral-100 space-y-3">
              <p className="text-xs text-neutral-400">소재: {u.material}</p>
              <div className="space-y-1.5">
                <p className="text-xs font-black text-neutral-400">검토한 방향 후보</p>
                {(u.strategyOptions || []).length === 0 && (
                  <p className="text-sm text-neutral-300">아직 후보가 없어요 — 아래에서 후보를 추가하세요.</p>
                )}
                {(u.strategyOptions || []).map((opt, i) => {
                  const editKey = `${u.id}:${i}`;
                  const isEditing = editingOptionKey === editKey;
                  return (
                    <div
                      key={i}
                      className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
                        u.selectedStrategy === opt ? 'border-emerald-300 bg-emerald-50' : 'border-neutral-200'
                      }`}
                    >
                      {isEditing ? (
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <textarea
                            value={editOptionDraft}
                            onChange={(e) => setEditOptionDraft(e.target.value)}
                            rows={2}
                            className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-sm leading-relaxed"
                            autoFocus
                          />
                          <div className="flex justify-end gap-2">
                            <button onClick={() => setEditingOptionKey(null)} className="text-xs font-bold text-neutral-400 hover:text-black">
                              취소
                            </button>
                            <button
                              onClick={async () => {
                                await editOption(u.id, i, editOptionDraft);
                                setEditingOptionKey(null);
                              }}
                              disabled={saving || !editOptionDraft.trim()}
                              className="text-xs font-black text-emerald-600 hover:underline"
                            >
                              저장
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="flex-1 min-w-0 text-sm whitespace-pre-wrap leading-relaxed">{opt}</p>
                          <CopyButton text={opt} />
                          <button
                            onClick={() => selectOption(u.id, opt)}
                            disabled={saving}
                            className={`shrink-0 text-xs font-black hover:underline ${u.selectedStrategy === opt ? 'text-emerald-600' : 'text-blue-600'}`}
                          >
                            {u.selectedStrategy === opt ? '✅ 선택됨' : '이 방향 선택'}
                          </button>
                          <button
                            onClick={() => {
                              setEditingOptionKey(editKey);
                              setEditOptionDraft(opt);
                            }}
                            className="shrink-0 text-xs font-bold text-blue-600 hover:underline"
                          >
                            수정
                          </button>
                          <button onClick={() => deleteOption(u.id, i)} className="shrink-0 font-black text-neutral-300 hover:text-red-500" title="후보 삭제">
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-full border border-amber-200 bg-amber-50">
                <span className="text-amber-700">🔍 제미나이 전략/컨셉 프롬프트</span>
                <CopyButton
                  text={`[역할] 너는 우리 채널(거시서사형 경제사, 진행자 캐릭터 "젠틀맨 루즈" — 검은 톱햇, 금테 외알렌즈, 검은 연미복+금색 안감 망토, 능글맞고 자신감 있는 쇼맨, 반전 순간 망토를 젖히는 시그니처 제스처)의 전략 기획자다. 아래 소재와 자료조사 내용을 바탕으로, 이 콘텐츠를 어떤 앵글로 풀어낼지 방향 후보를 2개 이상 제안해라. 각 후보는 타겟층과 핵심 앵글을 구체적으로 밝혀라.

[판단 기준 — 구조 적합성만으로 고르지 말 것] 각 후보마다 아래 4가지를 반드시 같이 평가해서 점수를 매겨라(각 0~25점, 합산 100점):
1. 신선도(0~25) — 이 소재/반전이 이 장르(또는 인접 트리비아 콘텐츠 전반)에서 이미 몇 번이나 재활용됐는가, 얼마나 소진된 소재인가. 소진될수록 낮은 점수.
2. 차별화 크기(0~25) — 논쟁성·정서적 낙차처럼 실제 조회수를 가르는 것으로 확인된 요인에 이 앵글이 얼마나 해당하는가.
3. 3초 이탈 방지력(0~25) — 이 장르를 처음 보는 사람도 콜드오픈 첫 장면에서 바로 스크롤을 멈추는가, 아니면 맥락 없이는 이해가 안 되는가.
4. 캐릭터 스루라인(0~25) — 인물중심 앵글이라면, 그 인물의 관점이 콜드오픈부터 클로징까지 매 챕터 유지될 수 있는 구조인가(중반부에 "인물 서사"에서 "사실 나열"로 새는 구조는 감점).
총점 밴드: 80~100 강력추천 / 60~79 무난(약점 1곳 있어도 진행 가능) / 40~59 보완 필요 / 40미만 재기획 권장.

[출력 형식]
A) [앵글 이름] — [1~2문장 설명, 왜 이 앵글이 먹히는지] / 신선도 xx·차별화 xx·3초방지력 xx·캐릭터스루라인 xx → 총점 xx
B) [앵글 이름] — [1~2문장 설명] / 총점 xx
(필요하면 C, D도 추가)
[최종 추천] 위 후보 중 하나를 골라 그 이유를 설명해라 — 점수가 가장 높은 것을 기계적으로 고르지 말고, 왜 그게 이 채널에 더 맞는지 설명해라.

[참고 자료] 우리 채널 정보(벤치마크 대본·캐릭터·이전 대본): https://honghub.vercel.app/share/${site.id}

[소재]
${u.material}

[자료조사]
${u.factCheck || '(아직 없음 — 소재 설명만으로 판단)'}`}
                />
              </div>
              <div className="bg-neutral-50 border border-neutral-100 rounded-lg p-2.5 space-y-2">
                <p className="text-xs font-black text-neutral-400">+ 방향 후보 추가 (타겟층/앵글을 구체적으로)</p>
                <textarea
                  value={newOptionText[u.id] || ''}
                  onChange={(e) => setNewOptionText((prev) => ({ ...prev, [u.id]: e.target.value }))}
                  rows={2}
                  placeholder="예: 재테크형 — 투자레슨 프레이밍"
                  className="w-full border border-neutral-200 rounded-lg px-2.5 py-2 text-sm leading-relaxed"
                />
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      addOption(u.id, newOptionText[u.id] || '');
                      setNewOptionText((prev) => ({ ...prev, [u.id]: '' }));
                    }}
                    disabled={!(newOptionText[u.id] || '').trim()}
                    className="shrink-0 text-sm font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                  >
                    + 후보 추가
                  </button>
                </div>
              </div>
              {u.selectedStrategy && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-black text-neutral-400">선택 이유</p>
                    {editingReasonId !== u.id && (
                      <div className="shrink-0 flex items-center gap-1.5">
                        {u.strategyReason && <CopyButton text={u.strategyReason} />}
                        <button
                          onClick={() => {
                            setEditingReasonId(u.id);
                            setReasonDraft(u.strategyReason || '');
                          }}
                          className="text-xs font-bold text-blue-600 hover:underline"
                        >
                          수정
                        </button>
                      </div>
                    )}
                  </div>
                  {editingReasonId === u.id ? (
                    <div className="space-y-1.5">
                      <textarea
                        value={reasonDraft}
                        onChange={(e) => setReasonDraft(e.target.value)}
                        rows={3}
                        placeholder="왜 이 방향을 골랐는지"
                        className="w-full border border-neutral-200 rounded-lg px-2.5 py-2 text-sm leading-relaxed"
                      />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditingReasonId(null)} className="text-xs font-bold text-neutral-400 hover:text-black">
                          취소
                        </button>
                        <button
                          onClick={async () => {
                            await saveReason(u.id, reasonDraft);
                            setEditingReasonId(null);
                          }}
                          disabled={saving}
                          className="text-xs font-black text-emerald-600 hover:underline"
                        >
                          저장
                        </button>
                      </div>
                    </div>
                  ) : u.strategyReason ? (
                    <p className="text-[15px] text-neutral-600 whitespace-pre-wrap leading-relaxed">{u.strategyReason}</p>
                  ) : (
                    <p className="text-sm text-neutral-300">아직 이유가 없어요 — &quot;수정&quot;을 눌러서 추가하세요.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
