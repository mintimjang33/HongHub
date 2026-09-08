'use client';

import { useScriptWizard } from '../scriptWizard/useScriptWizard';
import type { Site } from '../types';

// 5번(소재 선정) 단계 패널 — 4번 분석 기반으로 추천받거나 직접 적은 소재 후보 중 하나를 확정한다.
// 확정하면(✅ 이 소재로 확정) 6번(콘텐츠 등록) 탭으로 자동 이동한다. 제목·대본 작성은 11번
// (step11-ScriptWritingPanel)의 몫 — 두 패널은 site.script_draft 최상위에 이어지는 같은 위저드
// 상태를 useScriptWizard 훅으로 공유한다(2026-09-08, 번호별로 파일을 찾기 쉽게 분리).
// 2026-09-08 삭제 — GenerateButtons/PasteBox가 원래 stage('materials'|'titles'|'script'|
// 'translate') 파라미터를 받는 범용 컴포넌트였는데, 실제로는 이 패널에서 stage="materials"로만
// 호출되고 있었다(제목·대본 생성은 11번이 별도 프롬프트로 처리, titles/script/translate 단계
// 자체가 죽은 코드였음). useScriptWizard 훅에서 그 죽은 단계들을 걷어내면서(사용자 지적:
// "죽은코드는 정리해"), 여기 stage 파라미터도 같이 없앴다 — 어차피 소재 추천 하나만 남았다.
export function MaterialSelectionPanel({
  site,
  onRefresh,
  onMaterialSelected,
}: {
  site: Site;
  onRefresh: () => void;
  // 소재를 확정하는 순간 "6번 콘텐츠 등록" 탭으로 자동 이동시키는 콜백.
  onMaterialSelected?: () => void;
}) {
  const w = useScriptWizard(site, onRefresh);
  const { draft } = w;

  function GenerateButtons() {
    return (
      <div className="flex gap-1.5 mb-2">
        <button
          onClick={w.copyPrompt}
          disabled={w.copying}
          className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
        >
          {w.copying ? '준비 중...' : w.copied ? '✅ 복사됨!' : '💬 Gemini·Claude 구독으로 만들기'}
        </button>
        <button
          onClick={w.generate}
          disabled={w.generating}
          className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white hover:bg-neutral-800 disabled:opacity-40"
        >
          {w.generating ? '만드는 중... (1분 정도)' : '✨ Gemini Pro로 만들기'}
        </button>
      </div>
    );
  }

  function GenerateHint() {
    return (
      <p className="text-[10px] text-neutral-400 mb-2">
        "✨ Gemini Pro"는 유료 API를 직접 호출해서 바로 저장해요. "💬 Gemini·Claude 구독으로 만들기"는 비용 없이
        프롬프트만 클립보드에 복사해줘요 — Gemini 웹앱이든 Claude(claude.ai나 이 대화)든 아무 구독 채팅에 붙여넣어서
        물어보고, 답변을 아래 붙여넣기 칸에 넣으면 저장돼요. (Vercel에서 도는 앱이라 두 구독 계정을 여기서 자동으로
        대신 불러낼 순 없어요.)
      </p>
    );
  }

  function PasteBox() {
    if (!w.pasteOpen) return null;
    return (
      <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-2 mb-2">
        <textarea
          value={w.pasteText}
          onChange={(e) => w.setPasteText(e.target.value)}
          rows={4}
          placeholder="구독 채팅(Gemini/Claude) 답변을 여기에 붙여넣으세요"
          className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono leading-relaxed mb-1.5"
        />
        <div className="flex justify-end gap-1.5">
          <button onClick={() => w.setPasteOpen(false)} className="text-[11px] font-bold text-neutral-400 hover:text-black px-2">
            취소
          </button>
          <button
            onClick={w.savePasted}
            disabled={w.saving || !w.pasteText.trim()}
            className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
          >
            {w.saving ? '저장 중...' : '붙여넣기 저장'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-black/5 pt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-black text-neutral-500">🎯 소재 선정</span>
        <button onClick={w.resetAll} className="text-[11px] font-bold text-neutral-400 hover:text-red-500 px-2">
          🔄 처음부터
        </button>
      </div>
      <GenerateHint />
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[10px] font-black text-neutral-400">카테고리:</span>
        <button
          onClick={() => w.setCategory('trivia')}
          disabled={(draft.category || 'trivia') === 'trivia'}
          className={`text-[11px] font-black px-3 py-1 rounded-full border ${
            (draft.category || 'trivia') === 'trivia' ? 'bg-black text-white border-black' : 'bg-white text-neutral-500 border-neutral-200 hover:border-neutral-400'
          }`}
        >
          🔧 트리비아
        </button>
        <button
          onClick={() => w.setCategory('disaster')}
          disabled={draft.category === 'disaster'}
          className={`text-[11px] font-black px-3 py-1 rounded-full border ${
            draft.category === 'disaster' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-neutral-500 border-neutral-200 hover:border-red-300'
          }`}
        >
          🚨 대참사·사건
        </button>
      </div>
      {draft.category === 'disaster' && (
        <p className="text-[10px] text-red-500 font-bold mb-2">
          진지한 톤 전용 모드예요 — "정신 나간/환장할 노릇" 같은 트리비아 유행어는 안 나오고, 사실→원인→교훈/개선 구조로 만들어져요.
        </p>
      )}
      {w.error && <p className="text-[11px] text-red-500 font-bold mb-2">{w.error}</p>}

      <div className="bg-white border border-neutral-100 rounded-lg p-3 mb-2">
        <div className="text-[11px] font-black text-neutral-500 mb-2">1️⃣ 소재 추천</div>
        <GenerateButtons />
        <PasteBox />
        {draft.materials && draft.materials.length > 0 ? (
          <div className="space-y-1 mb-2">
            {draft.materials.map((m, idx) =>
              w.editingMaterialIdx === idx ? (
                <div key={idx} className="flex items-start gap-1.5 bg-white border border-blue-200 rounded-lg px-2.5 py-2">
                  <textarea
                    value={w.editingMaterialText}
                    onChange={(e) => w.setEditingMaterialText(e.target.value)}
                    rows={2}
                    className="flex-1 text-[11px] leading-relaxed border border-neutral-200 rounded-lg px-2 py-1"
                    autoFocus
                  />
                  <div className="flex flex-col gap-1 shrink-0">
                    <button onClick={() => w.saveEditedMaterial(idx)} className="text-[10px] font-black text-emerald-600 hover:underline">
                      저장
                    </button>
                    <button onClick={() => w.setEditingMaterialIdx(null)} className="text-[10px] font-bold text-neutral-400 hover:text-black">
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <div key={idx}>
                  <div
                    className={`flex items-start gap-2 text-[11px] rounded-lg px-2.5 py-2 border ${
                      draft.selectedMaterial === m ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-neutral-100 hover:border-neutral-300'
                    }`}
                  >
                    <label className="flex items-start gap-2 flex-1 min-w-0 cursor-pointer">
                      <input type="radio" checked={draft.selectedMaterial === m} onChange={() => w.selectMaterial(m)} className="mt-0.5 shrink-0" />
                      <span className="leading-relaxed">{m}</span>
                    </label>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => {
                          w.setEditingMaterialIdx(idx);
                          w.setEditingMaterialText(m);
                        }}
                        className="text-[10px] font-bold text-neutral-400 hover:text-black"
                      >
                        수정
                      </button>
                      <button onClick={() => w.deleteMaterial(idx)} className="text-[10px] font-black text-neutral-300 hover:text-red-500">
                        ✕
                      </button>
                    </div>
                  </div>
                  {/* 2026-09-07 추가(2차) — 확정 버튼이 목록 맨 아래에 따로 있어서 목록이 길면 체크한
                      항목과 멀어져 안 보인다는 지적. 체크한 바로 그 항목 밑에 바로 붙여서 보여준다. */}
                  {draft.selectedMaterial === m && (
                    <button
                      onClick={() => w.confirmMaterial(m, onMaterialSelected)}
                      className="w-full text-[11px] font-black px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 mt-1 mb-1"
                    >
                      ✅ 이 소재로 확정하고 6번(콘텐츠 등록)으로 이동 (목록에서 제거됨)
                    </button>
                  )}
                </div>
              )
            )}
          </div>
        ) : (
          <p className="text-[11px] text-neutral-300 mb-2">아직 등록된 소재가 없어요.</p>
        )}
        <div className="flex gap-1.5">
          <input
            type="text"
            value={w.newMaterialText}
            onChange={(e) => w.setNewMaterialText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') w.addMaterial();
            }}
            placeholder="아이디어 직접 추가 — 나중에 적용할 소재를 미리 등록해두세요"
            className="flex-1 text-[11px] border border-neutral-200 rounded-lg px-2.5 py-1.5"
          />
          <button
            onClick={w.addMaterial}
            disabled={!w.newMaterialText.trim()}
            className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
          >
            + 추가
          </button>
        </div>
      </div>
    </div>
  );
}
