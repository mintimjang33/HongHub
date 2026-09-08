'use client';

import { useState } from 'react';
import type { Site, ContentUnit, UnitCategory } from '../types';

// 5번(소재 선정)·11번(대본 작성)이 공유하는 위저드 상태/로직 — 원래 하나의 컴포넌트(Step5Panel)였던
// 것을 번호별로 찾기 쉽게 파일을 나누기 위해 훅으로 뽑았다(2026-09-08). 소재(draft.materials 등)는
// 5번(소재 고르기)과 11번(제목/대본 작성) 둘 다 참조하는 하나의 상태라서 이 훅에 남아있다.
// 2026-09-08 삭제 — "소재→제목 생성→대본 생성→제미나이 비교/업그레이드→finalizeUnit"으로 이어지던
// 옛 단일 위저드는 이제 완전히 죽은 코드였다: 실제 흐름은 5번에서 소재만 확정하고, 6번
// (ContentRegisterPanel)에서 제목을 직접 입력해 유닛을 바로 만든 다음, 11번에서 그 유닛에 제미나이
// 프롬프트로 대본을 작성하는 방식으로 이미 바뀌어 있었다 — 5번은 소재(stage='materials') 생성만
// 쓰고, 11번은 애초에 이 위저드 상태를 전혀 안 쓴다(사용자 지적: "죽은코드는 정리해"). 그래서
// scriptDraftText, selectTitle, saveScript, finalizeUnit, 그리고 제미나이 비교/업그레이드
// (copyComparePrompt/runCompare/runUpgrade 등, 유닛 전용 버전은 이미 이날 앞서 삭제됨)를 전부
// 걷어내고, generate/copyPrompt/savePasted도 원래 4단계(소재/제목/대본/번역) 범용이었던 걸
// 실제로 쓰이는 소재(materials) 생성 하나로 좁혔다. app/api/script-draft/route.ts 쪽 titles/
// script/translate/compare/upgrade 핸들러는 이 UI에서는 더 이상 아무도 안 부르지만, 서버 파일이라
// 더 큰 변경이라 이번엔 손대지 않았다 — 다음에 정리할 때 참고할 것.
export function useScriptWizard(site: Site, onRefresh: () => void) {
  const draft = site.script_draft || {};
  const [generating, setGenerating] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [openUnitId, setOpenUnitId] = useState<string | null>(null);
  // 2026-08-31 추가 — 6번(이미지/영상 생성) 장면 프롬프트를 이 콘텐츠 유닛에 직접 붙여넣기/수정하는 박스 상태.
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewCopyingId, setReviewCopyingId] = useState<string | null>(null);
  const [reviewCopiedId, setReviewCopiedId] = useState<string | null>(null);
  const [reviewPasteOpenId, setReviewPasteOpenId] = useState<string | null>(null);
  const [reviewPasteText, setReviewPasteText] = useState('');
  // 2026-09-07 추가 — AI 검토(review)가 없어도 대본을 바로 수동으로 고칠 수 있는 직접수정 상태.
  // "피드백 반영해서 수정" 버튼은 u.review가 있어야만 뜨는데, 그게 없는 완성 콘텐츠는
  // 수정 수단이 복사/삭제뿐이라 사용자가 직접 텍스트를 고칠 방법이 없었다.
  const [editScriptId, setEditScriptId] = useState<string | null>(null);
  const [editScriptText, setEditScriptText] = useState('');
  const [savingScriptEdit, setSavingScriptEdit] = useState(false);
  const [revisingId, setRevisingId] = useState<string | null>(null);
  const [reviseCopyingId, setReviseCopyingId] = useState<string | null>(null);
  const [reviseCopiedId, setReviseCopiedId] = useState<string | null>(null);
  const [revisePasteOpenId, setRevisePasteOpenId] = useState<string | null>(null);
  const [revisePasteText, setRevisePasteText] = useState('');
  const units = draft.units || [];
  // 소재(아이디어) 목록을 AI 추천/붙여넣기 말고 직접 추가·수정·삭제도 할 수 있게 하는 상태.
  const [newMaterialText, setNewMaterialText] = useState('');
  const [editingMaterialIdx, setEditingMaterialIdx] = useState<number | null>(null);
  const [editingMaterialText, setEditingMaterialText] = useState('');

  async function generate() {
    setGenerating(true);
    setError('');
    try {
      const res = await fetch('/api/script-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, stage: 'materials', category: draft.category || 'trivia' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '생성 실패');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  async function copyPrompt() {
    setCopying(true);
    setError('');
    try {
      const q = new URLSearchParams({ siteId: site.id, stage: 'materials', category: draft.category || 'trivia' });
      const res = await fetch(`/api/script-draft?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '프롬프트 생성 실패');
      await navigator.clipboard.writeText(data.prompt);
      setCopied(true);
      setPasteOpen(true);
      setPasteText('');
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCopying(false);
    }
  }

  async function savePasted() {
    if (!pasteText.trim()) return;
    setSaving(true);
    setError('');
    try {
      const materials = pasteText.split('\n').map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
      const res = await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, materials }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장 실패');
      setPasteOpen(false);
      setPasteText('');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function selectMaterial(m: string) {
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, selectedMaterial: m }),
    });
    onRefresh();
    // 2026-09-08 수정 — 라디오 체크는 미리보기일 뿐이라 6번으로 자동이동하면 안 됨(확정 버튼 confirmMaterial에서만 이동).
  }

  // 2026-09-07 추가(3차) — 라디오 체크는 미리보기/변경만 하고, 확정 버튼을 눌러야 진짜로
  // "이 소재는 다 썼다"는 뜻이라 목록에서 지운다(사용자 지적: 6번으로 넘긴 소재가 5번 목록에
  // 계속 남아있으면 나중에 또 고를 수 있어서 헷갈림). selectedMaterial 자체는 7번(자료조사)·
  // 11번(대본) 프롬프트가 계속 참조하므로 그대로 유지하고, materials 후보 목록에서만 뺀다.
  async function confirmMaterial(m: string, onMaterialSelected?: () => void) {
    const nextMaterials = (draft.materials || []).filter((x) => x !== m);
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, materials: nextMaterials, selectedMaterial: m }),
    });
    onRefresh();
    onMaterialSelected?.();
  }

  // 소재(아이디어)를 AI 추천/붙여넣기 없이 직접 추가·수정·삭제 — 나중에 적용할 수 있게 미리 등록만 해두는 용도.
  async function addMaterial() {
    const text = newMaterialText.trim();
    if (!text) return;
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, materials: [...(draft.materials || []), text] }),
    });
    setNewMaterialText('');
    onRefresh();
  }

  async function saveEditedMaterial(idx: number) {
    const text = editingMaterialText.trim();
    if (!text) return;
    const next = [...(draft.materials || [])];
    const wasSelected = draft.selectedMaterial === next[idx];
    next[idx] = text;
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, materials: next, ...(wasSelected ? { selectedMaterial: text } : {}) }),
    });
    setEditingMaterialIdx(null);
    onRefresh();
  }

  async function deleteMaterial(idx: number) {
    const target = (draft.materials || [])[idx];
    const next = (draft.materials || []).filter((_, i) => i !== idx);
    const wasSelected = draft.selectedMaterial === target;
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, materials: next, ...(wasSelected ? { selectedMaterial: null } : {}) }),
    });
    onRefresh();
  }

  // 트리비아(가벼운 톤)와 대참사/사건(진지한 톤)은 완전히 다른 프롬프트를 쓰므로, 소재 추천 전에 먼저 골라야 한다.
  async function setCategory(category: UnitCategory) {
    if (!confirm(category === 'disaster' ? '"대참사/사건" 모드로 바꿀까요? 지금까지 만든 소재/제목/대본은 초기화돼요.' : '"트리비아" 모드로 바꿀까요? 지금까지 만든 소재/제목/대본은 초기화돼요.')) return;
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, category, materials: null, selectedMaterial: null, titles: null, selectedTitle: null, script: null, titleEn: null, scriptEn: null, titleJa: null, scriptJa: null, sources: null, factCheck: null }),
    });
    onRefresh();
  }

  // 2026-09-08 추가 — 유닛 하나의 필드 몇 개만 바꾸는 저장은 전부 이 함수를 통해서 보낸다. 예전엔
  // 각 호출부가 "이 화면이 들고 있는 units 배열 전체"를 통째로 다시 만들어 서버에 보냈는데, 그
  // 배열은 화면을 마지막으로 불러온 시점의 스냅샷이라서 그 사이 다른 탭이나 다른 경로(예: MCP로
  // 직접 DB에 쓴 결과)로 다른 유닛/다른 필드가 바뀌어 있었다면 그 변경을 통째로 덮어써버리는 사고가
  // 있었다(전략 단계 저장이 몇 분 뒤 조용히 원복된 실사고). 서버(app/api/script-draft/route.ts의
  // PATCH)가 unitPatch를 받으면 방금 새로 읽은 최신 units를 기준으로 이 필드만 병합하므로, 이 화면이
  // 들고 있는 나머지 데이터가 오래됐어도 서버의 최신 상태를 건드리지 않는다. 유닛을 통째로 추가/삭제
  // 하는 것처럼 배열 구조 자체가 바뀌는 작업만 예외적으로 기존 방식(units 전체 교체)을 쓴다.
  async function patchUnitField(unitId: string, fields: Record<string, unknown>) {
    return fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, unitPatch: { id: unitId, fields } }),
    });
  }

  async function setUnitTopic(id: string, topic: string) {
    await patchUnitField(id, { topic });
    onRefresh();
  }

  // Gemini/Claude가 사실확인하면서 출처를 붙여주면(신문사명, 링크 등) 여기 한 줄씩 저장해서
  // 나중에 "그거 어디서 봤냐"는 지적에 근거로 내밀 수 있게 한다.
  async function saveSources(id: string, sourcesText: string) {
    const sources = sourcesText.split('\n').map((s) => s.trim()).filter(Boolean);
    await patchUnitField(id, { sources });
    onRefresh();
  }

  async function resetAll() {
    if (!confirm('소재/제목/대본 선택을 전부 초기화할까요? (완성해서 저장해둔 콘텐츠 목록은 안 지워져요)')) return;
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, materials: null, selectedMaterial: null, titles: null, selectedTitle: null, script: null, titleEn: null, scriptEn: null, titleJa: null, scriptJa: null, sources: null, factCheck: null }),
    });
    onRefresh();
  }

  // 2026-09-04 신규 — 이전엔 이 패널(11번 대본)의 삭제 버튼이 유닛 전체를 지우는 deleteUnit()을 그대로 써서,
  // "대본만 지우려던" 클릭이 유닛 전체(소재·자료조사·전략·훅·기획서까지)를 날려버리는 버그가 있었음(사용자 실사고로 발견).
  // 유닛 전체 삭제는 6번(콘텐츠 등록) 패널에서만 하도록 하고, 이 패널에선 대본(script)·검토결과(review)·
  // 승인상태(status)만 초기화하고 나머지 필드는 그대로 둔다.
  async function clearScript(id: string) {
    if (!confirm('이 콘텐츠의 대본만 지울까요? (소재·자료조사·전략·훅·기획서는 그대로 남아요)')) return;
    await patchUnitField(id, { script: '', status: 'pending', review: null });
    onRefresh();
  }

  // AI 자동 검토 — Gemini Pro로 제목/대본을 4번 분석 패턴 기준으로 채점·평가해서 unit.review에 저장.
  async function reviewUnit(unit: ContentUnit) {
    setReviewingId(unit.id);
    setError('');
    try {
      const res = await fetch('/api/script-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, action: 'review', unitId: unit.id, title: unit.title, script: unit.script }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '검토 실패');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewingId(null);
    }
  }

  // 유료 API 없이, 검토 프롬프트(평가 기준+출력 형식 전부 포함)를 클립보드로 복사만 해준다.
  // 사용자가 이걸 Gemini/Claude 구독 채팅에 붙여넣어 검토받고, 답변을 아래 붙여넣기 칸에 다시 넣으면 저장된다.
  async function copyReviewPrompt(unit: ContentUnit) {
    setReviewCopyingId(unit.id);
    setError('');
    try {
      const q = new URLSearchParams({ siteId: site.id, action: 'review', title: unit.title, script: unit.script, category: unit.category || 'trivia' });
      const res = await fetch(`/api/script-draft?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '검토 프롬프트 생성 실패');
      await navigator.clipboard.writeText(data.prompt);
      setReviewCopiedId(unit.id);
      setReviewPasteOpenId(unit.id);
      setReviewPasteText('');
      setTimeout(() => setReviewCopiedId((cur) => (cur === unit.id ? null : cur)), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewCopyingId(null);
    }
  }

  async function savePastedReview(unitId: string) {
    if (!reviewPasteText.trim()) return;
    setSaving(true);
    setError('');
    try {
      const scoreMatch = reviewPasteText.match(/SCORE:\s*(\d+)/i);
      const feedbackMatch = reviewPasteText.match(/FEEDBACK:\s*([\s\S]*)/i);
      const review = {
        score: scoreMatch ? parseInt(scoreMatch[1], 10) : undefined,
        feedback: feedbackMatch ? feedbackMatch[1].trim() : reviewPasteText.trim(),
        reviewedAt: new Date().toISOString(),
      };
      const res = await patchUnitField(unitId, { review });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장 실패');
      setReviewPasteOpenId(null);
      setReviewPasteText('');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // 검토 피드백을 실제로 반영해서 대본을 고쳐 쓴다 — 검토가 점수만 주고 끝나지 않게.
  async function reviseUnit(unit: ContentUnit) {
    if (!unit.review?.feedback) return;
    setRevisingId(unit.id);
    setError('');
    try {
      const res = await fetch('/api/script-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, action: 'revise', unitId: unit.id, title: unit.title, script: unit.script, feedback: unit.review.feedback, category: unit.category || 'trivia' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '수정 실패');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevisingId(null);
    }
  }

  async function copyRevisePrompt(unit: ContentUnit) {
    if (!unit.review?.feedback) return;
    setReviseCopyingId(unit.id);
    setError('');
    try {
      const q = new URLSearchParams({ siteId: site.id, action: 'revise', title: unit.title, script: unit.script, feedback: unit.review.feedback, category: unit.category || 'trivia' });
      const res = await fetch(`/api/script-draft?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '프롬프트 생성 실패');
      await navigator.clipboard.writeText(data.prompt);
      setReviseCopiedId(unit.id);
      setRevisePasteOpenId(unit.id);
      setRevisePasteText('');
      setTimeout(() => setReviseCopiedId((cur) => (cur === unit.id ? null : cur)), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviseCopyingId(null);
    }
  }

  async function savePastedRevise(unitId: string) {
    if (!revisePasteText.trim()) return;
    setSaving(true);
    setError('');
    try {
      const res = await patchUnitField(unitId, { script: revisePasteText.trim(), review: null, status: 'pending' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장 실패');
      setRevisePasteOpenId(null);
      setRevisePasteText('');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveScriptEdit(unitId: string) {
    setSavingScriptEdit(true);
    setError('');
    try {
      const res = await patchUnitField(unitId, { script: editScriptText });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장 실패');
      setEditScriptId(null);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingScriptEdit(false);
    }
  }

  async function setUnitStatus(id: string, status: ContentUnit['status']) {
    await patchUnitField(id, { status });
    onRefresh();
  }

  // 확정 당시 같이 추천받았던 다른 제목 후보로 바꿔치기 — 대본/번역/검토는 그 제목 기준으로 만든 거라 그대로 두고 제목만 교체.
  async function swapUnitTitle(id: string, newTitle: string) {
    await patchUnitField(id, { title: newTitle });
    onRefresh();
  }

  return {
    draft,
    units,
    generating,
    copying,
    copied,
    pasteOpen,
    setPasteOpen,
    pasteText,
    setPasteText,
    saving,
    error,
    openUnitId,
    setOpenUnitId,
    reviewingId,
    reviewCopyingId,
    reviewCopiedId,
    reviewPasteOpenId,
    reviewPasteText,
    setReviewPasteText,
    editScriptId,
    setEditScriptId,
    editScriptText,
    setEditScriptText,
    savingScriptEdit,
    revisingId,
    reviseCopyingId,
    reviseCopiedId,
    revisePasteOpenId,
    revisePasteText,
    setRevisePasteText,
    newMaterialText,
    setNewMaterialText,
    editingMaterialIdx,
    setEditingMaterialIdx,
    editingMaterialText,
    setEditingMaterialText,
    generate,
    copyPrompt,
    savePasted,
    selectMaterial,
    confirmMaterial,
    addMaterial,
    saveEditedMaterial,
    deleteMaterial,
    setCategory,
    setUnitTopic,
    saveSources,
    resetAll,
    clearScript,
    reviewUnit,
    copyReviewPrompt,
    savePastedReview,
    reviseUnit,
    copyRevisePrompt,
    savePastedRevise,
    saveScriptEdit,
    setUnitStatus,
    swapUnitTitle,
  };
}

export type ScriptWizard = ReturnType<typeof useScriptWizard>;
