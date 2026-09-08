'use client';

import { useState } from 'react';
import type { Site } from '../types';
import { CopyButton } from './shared';

// 10번(기획서 작성) 단계 전용 패널. **"기획"은 "계획"과 다르다** — 계획(plan_content)은 파이프라인
// 전체의 일정/절차 문서고, 기획(planningDoc)은 이 콘텐츠 하나가 조회수가 더 잘 나오도록 전략을
// 짜는 것이다(2026-09-04, 사용자 지적). 처음엔 5·7·8·9번 값을 화면에 그대로 다시 보여주기만
// 하는 대시보드로 잘못 만들었다가("저게 기획서야? 그냥 필드 나열 아니야?" 지적), 그 다음엔
// "10단계의 핵심은 독립적으로 기획서를 새로 쓰는 것"이라는 지적으로 에디터를 추가했지만, 그
// 에디터 문구도 여전히 "결정 사항을 종합해서 쓰라"는 요약 톤이었다 — "전략짜는 거라고" 지적을
// 받고서야 placeholder/안내문을 "왜 이 조합이면 조회수가 잘 나올지"를 논증하게 바꿨다. 5·7·8·9번
// 원본값은 "참고 자료"로만 접어두고, 진짜 기획서(planningDoc)는 그걸 근거로 사람이나 별도
// 에이전트가 직접 조회수 전략을 한 편의 글로 써서 저장한다. **⚠️ 9번과 같은 이유의 독립성 규칙**:
// 11번(대본)이 이미 쓰여 있는 콘텐츠라도, 그 대본을 훑어보고 기획서를 짜맞추면 안 된다 — 오직
// 5(소재)·7(자료조사)·8(전략)·9(훅)만 근거로 새로 써야 한다.
export function PlanningDocPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const draft = site.script_draft || {};
  const units = draft.units || [];
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [docDraft, setDocDraft] = useState('');
  const [saving, setSaving] = useState(false);

  async function saveDoc(id: string, planningDoc: string) {
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, unitPatch: { id, fields: { planningDoc } } }),
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      {units.length === 0 && <p className="text-sm text-neutral-300">아직 등록된 콘텐츠가 없어요 — 먼저 6번(콘텐츠 등록)에서 콘텐츠를 등록하세요.</p>}
      {units.map((u) => {
        const factCount = (u.factCheck || '').split(/\n(?=①|②|③|④|⑤|⑥|⑦|⑧|⑨|⑩|■)/).filter((s) => s.trim()).length;
        const inputsReady = Boolean(u.selectedStrategy && u.selectedHook);
        const docWritten = Boolean(u.planningDoc && u.planningDoc.trim());
        return (
          <div key={u.id} className="bg-white border border-neutral-100 rounded-lg overflow-hidden">
            <button onClick={() => setOpenId((cur) => (cur === u.id ? null : u.id))} className="w-full text-left px-3 py-2.5 flex items-center gap-2">
              <span className={`shrink-0 text-neutral-300 transition-transform ${openId === u.id ? 'rotate-90' : ''}`}>▶</span>
              <span className="flex-1 min-w-0 text-sm font-bold truncate">{u.title}</span>
              {docWritten ? (
                <span className="shrink-0 text-xs font-bold text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5">✅ 기획서 작성됨</span>
              ) : inputsReady ? (
                <span className="shrink-0 text-xs font-bold text-amber-600 bg-amber-50 rounded-full px-2 py-0.5">기획서 미작성</span>
              ) : (
                <span className="shrink-0 text-xs font-bold text-neutral-400 bg-neutral-100 rounded-full px-2 py-0.5">8·9번 대기</span>
              )}
            </button>
            {openId === u.id && (
              <div className="px-3 pb-3 pt-1 border-t border-neutral-100 space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-black text-neutral-400">📄 기획서 — 이 콘텐츠 조회수 잘 나오게 만드는 실행 지침서</p>
                    {editingDocId !== u.id && (
                      <div className="shrink-0 flex items-center gap-1.5">
                        <div className="inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-full border border-amber-200 bg-amber-50">
                          <span className="text-amber-700">🔍 제미나이 프롬프트</span>
                          <CopyButton
                            text={`[역할] 너는 우리 채널의 조회수 전략 기획자다. 아래 소재·자료조사·전략·훅을 근거로, 이 콘텐츠가 왜/어떻게 조회수가 잘 나올지 논증하는 게 아니라, 실제로 만들 때 지킬 실행 지침서를 써라.

[출력 형식]
1. 제목 후보(실제 문장 2~3개)
2. 오프닝 초 단위 구성(0:00부터 몇 초까지 뭘 하는지)
3. 본문 리듬(자료들을 어떤 인과관계 순서로 배치할지)
4. 댓글 유도 위치(어느 챕터 끝에 어떤 질문을)
5. 길이 판단(권장 분량과 근거)
6. ⚠️ 위험요소·보완점 최소 2개(자기 칭찬 금지, 진짜 리스크만)

[참고 자료] 우리 채널 정보(벤치마크 대본·캐릭터·이전 대본): https://honghub.vercel.app/share/${site.id}

[소재]
${u.material}

[자료조사]
${u.factCheck || '(없음)'}

[선택된 전략]
${u.selectedStrategy || '(미확정)'}

[선택된 훅]
${u.selectedHook || '(미확정)'}`}
                          />
                        </div>
                        {docWritten && <CopyButton text={u.planningDoc || ''} />}
                        <button
                          onClick={() => {
                            setEditingDocId(u.id);
                            setDocDraft(u.planningDoc || '');
                          }}
                          className="text-xs font-bold text-blue-600 hover:underline"
                        >
                          {docWritten ? '수정' : '작성'}
                        </button>
                      </div>
                    )}
                  </div>
                  {editingDocId === u.id ? (
                    <div className="space-y-1.5">
                      <p className="text-[11px] text-amber-600 bg-amber-50 rounded-lg px-2 py-1.5 leading-relaxed">
                        ⚠️ 이건 "왜 잘 나오는가" 논증문이 아니라 <b>실행 지침서</b>입니다 — 제목 후보·오프닝 초 단위 구성·본문 리듬·댓글유도 위치·길이를 구체적으로 지시하고, <b>위험요소·보완점도 최소 2개 이상</b> 반드시 쓰세요(자기 칭찬 금지). 아래 참고자료(5·7·8·9번)만 근거로 새로 쓰고, 11번에 이미 대본이 있어도 그걸 보고 짜맞추면 안 됩니다.
                      </p>
                      <textarea
                        value={docDraft}
                        onChange={(e) => setDocDraft(e.target.value)}
                        rows={10}
                        placeholder="제목 후보(실제 문장 2~3개) / 오프닝 초 단위 구성 / 본문 리듬(자료 인과관계로 새로 설계) / 댓글 유도 위치 / 길이 판단 / ⚠️위험요소·보완점 최소 2개"
                        className="w-full border border-neutral-200 rounded-lg px-2.5 py-2 text-sm leading-relaxed"
                      />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditingDocId(null)} className="text-xs font-bold text-neutral-400 hover:text-black">
                          취소
                        </button>
                        <button
                          onClick={async () => {
                            await saveDoc(u.id, docDraft);
                            setEditingDocId(null);
                          }}
                          disabled={saving}
                          className="text-xs font-black text-emerald-600 hover:underline"
                        >
                          저장
                        </button>
                      </div>
                    </div>
                  ) : docWritten ? (
                    <p className="text-sm text-neutral-800 whitespace-pre-wrap leading-relaxed bg-neutral-50 rounded-lg p-3">{u.planningDoc}</p>
                  ) : (
                    <p className="text-sm text-neutral-300">
                      아직 실행 지침서가 없어요 — {inputsReady ? '위 "작성" 버튼을 눌러 직접 쓰거나, 대본을 안 보는 별도 에이전트로 작성하세요.' : '먼저 8·9번을 확정하세요.'}
                    </p>
                  )}
                </div>
                <details className="text-xs">
                  <summary className="cursor-pointer text-neutral-400 font-bold">참고자료 (5·7·8·9번 원본값 — 기획서 쓸 때만 참고, 그대로 베끼지 말 것)</summary>
                  <div className="space-y-2 mt-2">
                    <div>
                      <p className="text-xs font-black text-neutral-400 mb-1">5. 소재</p>
                      <p className="text-sm text-neutral-700 whitespace-pre-wrap leading-relaxed">{u.material || '(없음)'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-black text-neutral-400 mb-1">7. 자료조사</p>
                      <p className="text-sm text-neutral-700">
                        {u.factCheck ? `사실 약 ${factCount}개 확보됨` : '아직 없음 — 7번(자료조사)에서 먼저 채우세요.'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-black text-neutral-400 mb-1">8. 전략/컨셉</p>
                      {u.selectedStrategy ? (
                        <>
                          <p className="text-sm font-bold text-neutral-800 whitespace-pre-wrap leading-relaxed">{u.selectedStrategy}</p>
                          {u.strategyReason && (
                            <p className="text-[13px] text-neutral-500 whitespace-pre-wrap leading-relaxed mt-1">{u.strategyReason}</p>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-neutral-300">아직 확정 안 됨 — 8번(전략/컨셉 확정)에서 먼저 고르세요.</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-black text-neutral-400 mb-1">9. 훅/인트로</p>
                      {u.selectedHook ? (
                        <>
                          <p className="text-sm font-bold text-neutral-800 whitespace-pre-wrap leading-relaxed">{u.selectedHook}</p>
                          {u.hookReason && <p className="text-[13px] text-neutral-500 whitespace-pre-wrap leading-relaxed mt-1">{u.hookReason}</p>}
                        </>
                      ) : (
                        <p className="text-sm text-neutral-300">아직 확정 안 됨 — 9번(훅/인트로 설계)에서 먼저 고르세요.</p>
                      )}
                    </div>
                  </div>
                </details>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
