'use client';

import { useState } from 'react';
import type { Site } from '../types';
import { splitCandidates, extractRecommendation } from '../utils';
import { CopyButton } from './shared';

// 9번(훅/인트로 설계) 단계 전용 패널 — 본문 쓰기 전 도입부 후보를 여러 버전 적어보고 제일 강한 걸
// 선택한다(script-writer 스킬 4단계에 해당). 클릭률에 가장 큰 영향을 주는 단계라 후보를 남겨둔다.
export function HookPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const draft = site.script_draft || {};
  const units = draft.units || [];
  const [openId, setOpenId] = useState<string | null>(null);
  const [newHookText, setNewHookText] = useState<Record<string, string>>({});
  // 후보 문구 자체를 고치는 용도 — key는 "unitId:idx" — (지우고 다시 쓰지 않고) 인라인으로 바로 수정할 수 있게.
  const [editingHookKey, setEditingHookKey] = useState<string | null>(null);
  const [editHookDraft, setEditHookDraft] = useState('');
  // 2026-09-03 추가 — 왜 이 훅을 골랐는지(StrategyPanel의 "선택 이유"와 동일한 목적). 이전엔 이
  // 필드를 저장할 UI가 없어서 DB에 직접 써넣은 값이 있어도 화면에서 보거나 고칠 수 없었다.
  const [editingReasonId, setEditingReasonId] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // 2026-09-08 — 유닛 하나의 필드만 서버에 보내는 unitPatch를 쓴다. 예전엔 이 화면이 들고 있는
  // units 배열 전체를 통째로 다시 보냈는데, 그 배열이 화면을 마지막으로 불러온 시점의 스냅샷이라서
  // 그 사이 다른 탭/다른 경로(MCP 등)로 갱신된 다른 유닛·다른 필드를 그대로 덮어써버리는 사고가
  // 있었다(8번 전략 단계에서 실제로 겪음). 서버가 unitPatch를 받으면 방금 새로 읽은 최신 units를
  // 기준으로 이 필드만 병합한다.
  async function patchUnit(id: string, fields: Record<string, unknown>) {
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, unitPatch: { id, fields } }),
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function addHook(id: string, text: string) {
    if (!text.trim()) return;
    const unit = units.find((u) => u.id === id);
    const recommendation = extractRecommendation(text);
    await patchUnit(id, {
      hookOptions: [...(unit?.hookOptions || []), ...splitCandidates(text)],
      ...(recommendation ? { hookReason: recommendation } : {}),
    });
  }

  async function deleteHook(id: string, idx: number) {
    const unit = units.find((u) => u.id === id);
    const nextOptions = (unit?.hookOptions || []).filter((_, i) => i !== idx);
    const removed = unit?.hookOptions?.[idx];
    await patchUnit(id, { hookOptions: nextOptions, selectedHook: unit?.selectedHook === removed ? null : unit?.selectedHook });
  }

  // 후보 문구를 고침 — 그 후보가 이미 selectedHook으로 골라져 있었다면 selectedHook도 새 문구로 같이 바꿔서 선택 상태가 안 풀리게 한다.
  async function editHook(id: string, idx: number, newText: string) {
    if (!newText.trim()) return;
    const unit = units.find((u) => u.id === id);
    const oldText = unit?.hookOptions?.[idx];
    const nextOptions = (unit?.hookOptions || []).map((o, i) => (i === idx ? newText.trim() : o));
    await patchUnit(id, { hookOptions: nextOptions, selectedHook: unit?.selectedHook === oldText ? newText.trim() : unit?.selectedHook });
  }

  async function selectHook(id: string, text: string) {
    const unit = units.find((u) => u.id === id);
    await patchUnit(id, { selectedHook: unit?.selectedHook === text ? null : text });
  }

  async function saveReason(id: string, reason: string) {
    await patchUnit(id, { hookReason: reason });
  }

  return (
    <div className="space-y-2">
      {units.length === 0 && <p className="text-sm text-neutral-300">아직 등록된 콘텐츠가 없어요 — 먼저 6번(콘텐츠 등록)에서 콘텐츠를 등록하세요.</p>}
      {units.map((u) => (
        <div key={u.id} className="bg-white border border-neutral-100 rounded-lg overflow-hidden">
          <div className="w-full flex items-center gap-2 px-3 py-2.5">
            <button
              onClick={() => setOpenId((cur) => (cur === u.id ? null : u.id))}
              className="flex-1 min-w-0 flex items-center gap-2 text-left"
            >
              <span className={`shrink-0 text-neutral-300 transition-transform ${openId === u.id ? 'rotate-90' : ''}`}>▶</span>
              <span className="flex-1 min-w-0 text-sm font-bold truncate">{u.title}</span>
            </button>
            {u.selectedHook ? (
              <span className="shrink-0 flex items-center gap-1">
                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5">✅ 확정됨</span>
                {/* 2026-09-08 추가 — "선택 이유" 안에 있던 해제 버튼을 배지 바로 옆으로 옮김(사용자 지적:
                    카드를 펼쳐야만 보이는 곳 말고 확정됨 배지 옆에 바로 있어야 함). 후보 목록과 무관하게
                    언제든 확정 상태 자체를 바로 풀 수 있다. */}
                <button
                  onClick={() => selectHook(u.id, u.selectedHook || '')}
                  disabled={saving}
                  className="text-[10px] font-bold text-neutral-400 hover:text-red-500 disabled:opacity-40"
                  title="확정된 훅 선택을 해제합니다"
                >
                  해제
                </button>
              </span>
            ) : (
              <span className="shrink-0 text-xs font-bold text-neutral-400 bg-neutral-100 rounded-full px-2 py-0.5">미착수</span>
            )}
          </div>
          {openId === u.id && (
            <div className="px-3 pb-3 pt-1 border-t border-neutral-100 space-y-3">
              <p className="text-xs text-neutral-400">소재: {u.material}</p>
              <div className="space-y-1.5">
                <p className="text-xs font-black text-neutral-400">훅/인트로 후보</p>
                {(u.hookOptions || []).length === 0 && (
                  <p className="text-sm text-neutral-300">아직 후보가 없어요 — 아래에서 후보를 추가하세요.</p>
                )}
                {(u.hookOptions || []).map((opt, i) => {
                  const editKey = `${u.id}:${i}`;
                  const isEditing = editingHookKey === editKey;
                  return (
                    <div
                      key={i}
                      className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
                        u.selectedHook === opt ? 'border-emerald-300 bg-emerald-50' : 'border-neutral-200'
                      }`}
                    >
                      {isEditing ? (
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <textarea
                            value={editHookDraft}
                            onChange={(e) => setEditHookDraft(e.target.value)}
                            rows={3}
                            className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-sm leading-relaxed"
                            autoFocus
                          />
                          <div className="flex justify-end gap-2">
                            <button onClick={() => setEditingHookKey(null)} className="text-xs font-bold text-neutral-400 hover:text-black">
                              취소
                            </button>
                            <button
                              onClick={async () => {
                                await editHook(u.id, i, editHookDraft);
                                setEditingHookKey(null);
                              }}
                              disabled={saving || !editHookDraft.trim()}
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
                            onClick={() => selectHook(u.id, opt)}
                            disabled={saving}
                            className={`shrink-0 text-xs font-black hover:underline ${u.selectedHook === opt ? 'text-emerald-600' : 'text-blue-600'}`}
                          >
                            {u.selectedHook === opt ? '✅ 선택됨' : '이 버전 선택'}
                          </button>
                          <button
                            onClick={() => {
                              setEditingHookKey(editKey);
                              setEditHookDraft(opt);
                            }}
                            className="shrink-0 text-xs font-bold text-blue-600 hover:underline"
                          >
                            수정
                          </button>
                          <button
                            onClick={() => deleteHook(u.id, i)}
                            disabled={saving}
                            className="shrink-0 font-black text-neutral-300 hover:text-red-500 disabled:opacity-40"
                            title="후보 삭제"
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-full border border-amber-200 bg-amber-50">
                <span className="text-amber-700">🔍 제미나이 프롬프트</span>
                <CopyButton
                  text={`[역할] 너는 우리 채널의 훅/인트로 작가다. 아래 소재·전략을 바탕으로, 시청자가 3초 안에 스크롤을 멈추게 만들 도입부 문장 후보를 3개 실제 문장으로 써라. 구조 설명이 아니라 그대로 나레이션에 쓸 수 있는 완성된 문장으로 써라.

[판단 기준 — 그냥 느낌으로 고르지 말 것] 각 후보마다 아래 4가지를 반드시 같이 평가해서 점수를 매겨라(각 0~25점, 합산 100점):
1. 신선도(0~25) — 이 도입부의 화법·앵글이 이 장르에서 이미 몇 번이나 재활용됐는가, 얼마나 소진된 방식인가. 소진될수록 낮은 점수.
2. 차별화 크기(0~25) — 다른 후보 대비 이 도입부가 얼마나 강한 정서적 낙차·의외성을 주는가.
3. 3초 이탈 방지력(0~25) — 이 장르를 처음 보는 사람도 이 첫 문장에서 바로 스크롤을 멈추는가, 아니면 맥락 없이는 이해가 안 되는가.
4. 캐릭터 스루라인(0~25) — 이 도입부의 어투가 젠틀맨 루즈(능글맞고 자신감 있는 쇼맨, 반전 순간 망토를 젖히는 캐릭터)와 처음부터 일관되게 어울리는가.
총점 밴드: 80~100 강력추천 / 60~79 무난 / 40~59 보완 필요 / 40미만 재기획 권장.

[출력 형식 — 반드시 정확히 지켜라]
각 후보는 반드시 새 줄 맨 앞에서 "후보1:", "후보2:", "후보3:"처럼 "후보"+숫자+콜론으로 시작해라(예: "옵션 1:", "1.", "첫 번째:" 같은 다른 표기 금지). 이 형식으로 앱이 후보를 자동으로 나눠서 저장하니 절대 바꾸지 마라. "[최종 추천]"은 후보 목록이 끝난 뒤 반드시 이 정확한 대괄호 라벨로 시작해라 — 그래야 앱이 이 부분을 후보와 구분해서 뺀다.
후보1: "[실제 도입부 문장, 2~4문장]" / 신선도 xx·차별화 xx·3초방지력 xx·캐릭터스루라인 xx → 총점 xx
후보2: "[실제 도입부 문장, 2~4문장]" / 총점 xx
후보3: "[실제 도입부 문장, 2~4문장]" / 총점 xx
[최종 추천] 위 후보 중 하나를 골라 그 이유를 설명해라 — 점수가 가장 높은 것을 기계적으로 고르지 말고, 왜 그게 이 채널에 더 맞는지 설명해라.

[참고 자료] 우리 채널 정보(벤치마크 대본·캐릭터·이전 대본): https://honghub.vercel.app/share/${site.id}

[소재]
${u.material}

[선택된 전략]
${u.selectedStrategy || '(아직 미확정 — 소재만으로 판단)'}`}
                />
              </div>
              <div className="bg-neutral-50 border border-neutral-100 rounded-lg p-2.5 space-y-2">
                <p className="text-xs font-black text-neutral-400">+ 훅/인트로 후보 추가</p>
                <textarea
                  value={newHookText[u.id] || ''}
                  onChange={(e) => setNewHookText((prev) => ({ ...prev, [u.id]: e.target.value }))}
                  rows={3}
                  placeholder="도입부 후보 하나를 실제 문장으로 적어보세요"
                  className="w-full border border-neutral-200 rounded-lg px-2.5 py-2 text-sm leading-relaxed"
                />
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      addHook(u.id, newHookText[u.id] || '');
                      setNewHookText((prev) => ({ ...prev, [u.id]: '' }));
                    }}
                    disabled={!(newHookText[u.id] || '').trim()}
                    className="shrink-0 text-sm font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                  >
                    + 후보 추가
                  </button>
                </div>
              </div>
              {/* 2026-09-08 수정 — StrategyPanel(8번)과 같은 버그: selectedHook이 있어야만 이 영역이
                  보여서, "+ 후보 추가"가 자동으로 채워준 hookReason이 있어도 "이 버전 선택"을 누르기
                  전까지는 화면에 아예 안 보였다(사용자 지적: "8단계9단계... 최종추천 결과가 파싱되서
                  기록이 되어야 하는데 안되고 있어" — 8번은 먼저 고쳤는데 9번엔 반영이 안 돼 있었다).
                  선택 여부와 무관하게 이유가 있으면 보여준다. */}
              {(u.selectedHook || u.hookReason) && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-black text-neutral-400">선택 이유</p>
                    {editingReasonId !== u.id && (
                      <div className="shrink-0 flex items-center gap-1.5">
                        {u.hookReason && <CopyButton text={u.hookReason} />}
                        <button
                          onClick={() => {
                            setEditingReasonId(u.id);
                            setReasonDraft(u.hookReason || '');
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
                        rows={4}
                        placeholder="왜 이 훅을 골랐는지 — 대본을 근거로 쓰지 말고 7번(사실)·4번(오프닝공식)·이 콘텐츠의 반전 약속만으로"
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
                  ) : u.hookReason ? (
                    <p className="text-[15px] text-neutral-600 whitespace-pre-wrap leading-relaxed">{u.hookReason}</p>
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
