'use client';

import { useEffect, useState } from 'react';
import type { Site, ContentUnit, UnitCategory } from '../types';

// 5번(소재 선정)·11번(대본 작성)이 공유하는 위저드 상태/로직 — 원래 하나의 컴포넌트(Step5Panel)였던
// 것을 번호별로 찾기 쉽게 파일을 나누기 위해 훅으로 뽑았다(2026-09-08). 소재→제목→대본이 draft
// (site.script_draft) 최상위에 이어지는 하나의 상태라서, 5번(소재 고르기)과 11번(제목/대본 작성)은
// 화면(JSX)만 다르고 상태는 반드시 같이 써야 한다 — 억지로 상태까지 쪼개면 두 파일이 서로의 상태를
// props로 다시 주고받아야 해서 더 복잡해진다.
export function useScriptWizard(site: Site, onRefresh: () => void) {
  const draft = site.script_draft || {};
  const [generating, setGenerating] = useState<'materials' | 'titles' | 'script' | 'translate' | null>(null);
  const [copying, setCopying] = useState<'materials' | 'titles' | 'script' | 'translate' | null>(null);
  const [copied, setCopied] = useState<'materials' | 'titles' | 'script' | 'translate' | null>(null);
  const [pasteOpen, setPasteOpen] = useState<'materials' | 'titles' | 'script' | 'translate' | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [scriptDraftText, setScriptDraftText] = useState(draft.script || '');
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
  // 한국어 대본 확정 전 "제미나이와 비교" 단계용 상태 — 결과는 고르는 게 아니라 합칠 재료라서
  // draft에 바로 저장하지 않고 여기 임시로만 들고 있는다(2026-08-31).
  const [compareCopying, setCompareCopying] = useState(false);
  const [compareCopied, setCompareCopied] = useState(false);
  const [comparePasteOpen, setComparePasteOpen] = useState(false);
  const [comparePasteText, setComparePasteText] = useState('');
  const [compareRunning, setCompareRunning] = useState(false);
  const [compareResult, setCompareResult] = useState<{ factCheck: string; rewriteTitle?: string; rewriteScript?: string; sources?: string[] } | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeCopying, setUpgradeCopying] = useState(false);
  const [upgradeCopied, setUpgradeCopied] = useState(false);
  const [upgradePasteOpen, setUpgradePasteOpen] = useState(false);
  const [upgradePasteText, setUpgradePasteText] = useState('');
  // 완성된 콘텐츠 유닛용 "제미나이와 비교→업그레이드" 상태 — 위저드 단계와 같은 방식이지만
  // 유닛 하나마다 별개로 열릴 수 있어서 unitId를 같이 들고 있는다(2026-08-31).
  const [unitCompareCopyingId, setUnitCompareCopyingId] = useState<string | null>(null);
  const [unitCompareCopiedId, setUnitCompareCopiedId] = useState<string | null>(null);
  const [unitComparePasteOpenId, setUnitComparePasteOpenId] = useState<string | null>(null);
  const [unitComparePasteText, setUnitComparePasteText] = useState('');
  const [unitCompareRunningId, setUnitCompareRunningId] = useState<string | null>(null);
  const [unitCompareResult, setUnitCompareResult] = useState<{ unitId: string; factCheck: string; rewriteTitle?: string; rewriteScript?: string; sources?: string[] } | null>(null);
  const [unitUpgradingId, setUnitUpgradingId] = useState<string | null>(null);
  const [unitUpgradeCopyingId, setUnitUpgradeCopyingId] = useState<string | null>(null);
  const [unitUpgradeCopiedId, setUnitUpgradeCopiedId] = useState<string | null>(null);
  const [unitUpgradePasteOpenId, setUnitUpgradePasteOpenId] = useState<string | null>(null);
  const [unitUpgradePasteText, setUnitUpgradePasteText] = useState('');
  const units = draft.units || [];
  // 소재(아이디어) 목록을 AI 추천/붙여넣기 말고 직접 추가·수정·삭제도 할 수 있게 하는 상태.
  const [newMaterialText, setNewMaterialText] = useState('');
  const [editingMaterialIdx, setEditingMaterialIdx] = useState<number | null>(null);
  const [editingMaterialText, setEditingMaterialText] = useState('');

  useEffect(() => {
    setScriptDraftText(draft.script || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.script]);

  async function generate(stage: 'materials' | 'titles' | 'script' | 'translate') {
    setGenerating(stage);
    setError('');
    try {
      const body: Record<string, string> = { siteId: site.id, stage, category: draft.category || 'trivia' };
      if (stage === 'titles') body.material = draft.selectedMaterial || '';
      if (stage === 'script') body.title = draft.selectedTitle || '';
      if (stage === 'translate') {
        body.title = draft.selectedTitle || '';
        body.script = scriptDraftText;
      }
      const res = await fetch('/api/script-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '생성 실패');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(null);
    }
  }

  async function copyPrompt(stage: 'materials' | 'titles' | 'script' | 'translate') {
    setCopying(stage);
    setError('');
    try {
      const q = new URLSearchParams({ siteId: site.id, stage, category: draft.category || 'trivia' });
      if (stage === 'titles') q.set('material', draft.selectedMaterial || '');
      if (stage === 'script') q.set('title', draft.selectedTitle || '');
      if (stage === 'translate') {
        q.set('title', draft.selectedTitle || '');
        q.set('script', scriptDraftText);
      }
      const res = await fetch(`/api/script-draft?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '프롬프트 생성 실패');
      await navigator.clipboard.writeText(data.prompt);
      setCopied(stage);
      setPasteOpen(stage);
      setPasteText('');
      setTimeout(() => setCopied((cur) => (cur === stage ? null : cur)), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCopying(null);
    }
  }

  async function savePasted(stage: 'materials' | 'titles' | 'script' | 'translate') {
    if (!pasteText.trim()) return;
    setSaving(true);
    setError('');
    try {
      const patch: Record<string, unknown> = { siteId: site.id };
      if (stage === 'materials') {
        patch.materials = pasteText.split('\n').map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
      } else if (stage === 'titles') {
        patch.titles = pasteText.split('\n').map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
      } else if (stage === 'translate') {
        // stage=translate 응답은 [EN]/[JA]만 온다(한국어는 이미 확정된 상태).
        const enMatch = pasteText.match(/\[EN\]([\s\S]*?)(?=\[JA\]|$)/);
        const jaMatch = pasteText.match(/\[JA\]([\s\S]*?)$/);
        const pickField = (block: string | undefined, field: 'Title' | 'Script') => {
          if (!block) return undefined;
          const m = block.match(new RegExp(`${field}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:Title|Script)\\s*:|$)`, 'i'));
          return m ? m[1].trim() : undefined;
        };
        patch.titleEn = pickField(enMatch?.[1], 'Title') || null;
        patch.scriptEn = pickField(enMatch?.[1], 'Script') || null;
        patch.titleJa = pickField(jaMatch?.[1], 'Title') || null;
        patch.scriptJa = pickField(jaMatch?.[1], 'Script') || null;
      } else {
        // stage=script 응답은 이제 한국어 대본 + 선택적 [SOURCES]만 온다(영어/일본어는 stage=translate로 분리).
        const sourcesMatch = pasteText.match(/\[SOURCES\]([\s\S]*?)$/);
        patch.script = pasteText.replace(/\[SOURCES\][\s\S]*$/, '').trim();
        patch.sources = sourcesMatch
          ? sourcesMatch[1].split('\n').map((s) => s.replace(/^\s*[-*\d.)]+\s*/, '').trim()).filter(Boolean)
          : null;
        // 새 한국어 대본이 나오면 이전 번역/사실확인은 이제 그 대본 것이 아니므로 같이 비운다.
        // (JSON.stringify가 undefined 키는 그냥 통째로 빼먹어서 PATCH에 반영이 안 되니 null로 보내야 한다.)
        patch.titleEn = null;
        patch.scriptEn = null;
        patch.titleJa = null;
        patch.scriptJa = null;
        patch.factCheck = null;
      }
      const res = await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장 실패');
      setPasteOpen(null);
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

  async function setUnitTopic(id: string, topic: string) {
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === id ? { ...u, topic } : u)) }),
    });
    onRefresh();
  }

  // Gemini/Claude가 사실확인하면서 출처를 붙여주면(신문사명, 링크 등) 여기 한 줄씩 저장해서
  // 나중에 "그거 어디서 봤냐"는 지적에 근거로 내밀 수 있게 한다.
  async function saveSources(id: string, sourcesText: string) {
    const sources = sourcesText.split('\n').map((s) => s.trim()).filter(Boolean);
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === id ? { ...u, sources } : u)) }),
    });
    onRefresh();
  }

  async function selectTitle(t: string) {
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, selectedTitle: t }),
    });
    onRefresh();
  }

  function parseComparePaste(text: string): { factCheck: string; rewriteTitle?: string; rewriteScript?: string; sources?: string[] } {
    const factMatch = text.match(/\[FACT-CHECK\]([\s\S]*?)(?=\[REWRITE\]|\[SOURCES\]|$)/);
    const rewriteMatch = text.match(/\[REWRITE\]([\s\S]*?)(?=\[SOURCES\]|$)/);
    const sourcesMatch = text.match(/\[SOURCES\]([\s\S]*?)$/);
    const pickField = (block: string | undefined, field: 'Title' | 'Script') => {
      if (!block) return undefined;
      const m = block.match(new RegExp(`${field}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:Title|Script)\\s*:|$)`, 'i'));
      return m ? m[1].trim() : undefined;
    };
    return {
      factCheck: (factMatch ? factMatch[1] : '').trim(),
      rewriteTitle: pickField(rewriteMatch?.[1], 'Title'),
      rewriteScript: pickField(rewriteMatch?.[1], 'Script'),
      sources: sourcesMatch ? sourcesMatch[1].split('\n').map((s) => s.replace(/^\s*[-*\d.)]+\s*/, '').trim()).filter(Boolean) : undefined,
    };
  }

  // "제미나이와 비교" — 확정 전 제목/대본을 실제 검색 그라운딩으로 사실확인 + 제미나이 자체 버전을 받아온다.
  // 결과는 고르는 게 아니라 다음 단계(업그레이드)에서 원본과 합칠 재료라서 draft에 바로 저장하지 않는다.
  async function copyComparePrompt() {
    setCompareCopying(true);
    setError('');
    try {
      const q = new URLSearchParams({ siteId: site.id, action: 'compare', title: draft.selectedTitle || '', script: scriptDraftText, category: draft.category || 'trivia' });
      const res = await fetch(`/api/script-draft?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '프롬프트 생성 실패');
      await navigator.clipboard.writeText(data.prompt);
      setCompareCopied(true);
      setComparePasteOpen(true);
      setComparePasteText('');
      setTimeout(() => setCompareCopied(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCompareCopying(false);
    }
  }

  function saveComparePaste() {
    if (!comparePasteText.trim()) return;
    setCompareResult(parseComparePaste(comparePasteText));
    setComparePasteOpen(false);
  }

  async function runCompare() {
    setCompareRunning(true);
    setError('');
    try {
      const res = await fetch('/api/script-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, action: 'compare', title: draft.selectedTitle, script: scriptDraftText, category: draft.category || 'trivia' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '비교 실패');
      setCompareResult({ factCheck: data.factCheck || '', rewriteTitle: data.rewriteTitle, rewriteScript: data.rewriteScript, sources: data.sources });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCompareRunning(false);
    }
  }

  // 원본 유지 — 비교는 했지만 제미나이 버전을 반영할 필요가 없다고 판단했을 때. 그래도 사실확인/출처는 남겨둔다.
  async function keepOriginalAfterCompare() {
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, factCheck: compareResult?.factCheck || null, sources: compareResult?.sources || null }),
      });
      setCompareResult(null);
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  // "업그레이드" — 원본과 제미나이 버전 중 하나를 고르는 게 아니라, 둘의 장점을 합친 제3의 최종본을 만든다.
  // (사용자 지적: "교체가 아니라 두개를 보고 업그레이드를 해야지" — 2026-08-31)
  async function runUpgrade() {
    if (!compareResult) return;
    setUpgrading(true);
    setError('');
    try {
      const res = await fetch('/api/script-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: site.id,
          action: 'upgrade',
          title: draft.selectedTitle,
          script: scriptDraftText,
          rewriteTitle: compareResult.rewriteTitle,
          rewriteScript: compareResult.rewriteScript,
          factCheck: compareResult.factCheck,
          category: draft.category || 'trivia',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '업그레이드 실패');
      await applyUpgrade(data.title, data.script);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpgrading(false);
    }
  }

  async function copyUpgradePrompt() {
    if (!compareResult) return;
    setUpgradeCopying(true);
    setError('');
    try {
      const q = new URLSearchParams({
        siteId: site.id,
        action: 'upgrade',
        title: draft.selectedTitle || '',
        script: scriptDraftText,
        rewriteTitle: compareResult.rewriteTitle || '',
        rewriteScript: compareResult.rewriteScript || '',
        factCheck: compareResult.factCheck || '',
        category: draft.category || 'trivia',
      });
      const res = await fetch(`/api/script-draft?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '프롬프트 생성 실패');
      await navigator.clipboard.writeText(data.prompt);
      setUpgradeCopied(true);
      setUpgradePasteOpen(true);
      setUpgradePasteText('');
      setTimeout(() => setUpgradeCopied(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpgradeCopying(false);
    }
  }

  async function saveUpgradePaste() {
    if (!upgradePasteText.trim()) return;
    const pickField = (field: 'Title' | 'Script') => {
      const m = upgradePasteText.match(new RegExp(`${field}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:Title|Script)\\s*:|$)`, 'i'));
      return m ? m[1].trim() : undefined;
    };
    await applyUpgrade(pickField('Title'), pickField('Script'));
    setUpgradePasteOpen(false);
    setUpgradePasteText('');
  }

  async function applyUpgrade(title: string | undefined, script: string | undefined) {
    const nextTitle = title || draft.selectedTitle || '';
    const nextScript = script || scriptDraftText;
    setScriptDraftText(nextScript);
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: site.id,
          selectedTitle: nextTitle,
          script: nextScript,
          factCheck: compareResult?.factCheck || null,
          sources: compareResult?.sources || null,
        }),
      });
      setCompareResult(null);
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function saveScript() {
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, script: scriptDraftText }),
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
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

  // 소재 하나마다 별개 콘텐츠라서, 대본까지 완성되면 units 목록에 하나로 저장해두고
  // 위저드는 비워서 같은 소재 추천 목록에서 바로 다음 걸 이어서 진행할 수 있게 한다.
  async function finalizeUnit() {
    if (!draft.selectedMaterial || !draft.selectedTitle || !scriptDraftText.trim()) return;
    setSaving(true);
    try {
      const unit: ContentUnit = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        material: draft.selectedMaterial,
        title: draft.selectedTitle,
        script: scriptDraftText.trim(),
        category: draft.category || 'trivia',
        materialCandidates: draft.materials,
        titleCandidates: draft.titles,
        titleEn: draft.titleEn,
        scriptEn: draft.scriptEn,
        titleJa: draft.titleJa,
        scriptJa: draft.scriptJa,
        sources: draft.sources,
        factCheck: draft.factCheck,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: site.id,
          units: [...units, unit],
          selectedMaterial: null,
          titles: null,
          selectedTitle: null,
          script: null,
          titleEn: null,
          scriptEn: null,
          titleJa: null,
          scriptJa: null,
          sources: null,
          factCheck: null,
        }),
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  // 2026-09-04 신규 — 이전엔 이 패널(11번 대본)의 삭제 버튼이 유닛 전체를 지우는 deleteUnit()을 그대로 써서,
  // "대본만 지우려던" 클릭이 유닛 전체(소재·자료조사·전략·훅·기획서까지)를 날려버리는 버그가 있었음(사용자 실사고로 발견).
  // 유닛 전체 삭제는 6번(콘텐츠 등록) 패널에서만 하도록 하고, 이 패널에선 대본(script)·검토결과(review)·
  // 승인상태(status)만 초기화하고 나머지 필드는 그대로 둔다.
  async function clearScript(id: string) {
    if (!confirm('이 콘텐츠의 대본만 지울까요? (소재·자료조사·전략·훅·기획서는 그대로 남아요)')) return;
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId: site.id,
        units: units.map((u) => (u.id === id ? { ...u, script: '', status: 'pending' as const, review: undefined } : u)),
      }),
    });
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
      const res = await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === unitId ? { ...u, review } : u)) }),
      });
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
      const res = await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === unitId ? { ...u, script: revisePasteText.trim(), review: undefined, status: 'pending' } : u)) }),
      });
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

  // 완성된 유닛용 "제미나이와 비교→업그레이드" — 위저드 단계 것과 똑같은 규칙이지만 draft가 아니라
  // units 배열의 특정 유닛에 바로 적용한다. AI 검토(review)만 받고 끝나던 걸 개선한 revise와 별개로,
  // "한쪽으로 교체가 아니라 둘을 합쳐서 업그레이드"해야 한다는 지시를 유닛에도 그대로 적용한다(2026-08-31).
  async function copyUnitComparePrompt(unit: ContentUnit) {
    setUnitCompareCopyingId(unit.id);
    setError('');
    try {
      const q = new URLSearchParams({ siteId: site.id, action: 'compare', title: unit.title, script: unit.script, category: unit.category || 'trivia' });
      const res = await fetch(`/api/script-draft?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '프롬프트 생성 실패');
      await navigator.clipboard.writeText(data.prompt);
      setUnitCompareCopiedId(unit.id);
      setUnitComparePasteOpenId(unit.id);
      setUnitComparePasteText('');
      setTimeout(() => setUnitCompareCopiedId((cur) => (cur === unit.id ? null : cur)), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnitCompareCopyingId(null);
    }
  }

  function saveUnitComparePaste(unitId: string) {
    if (!unitComparePasteText.trim()) return;
    setUnitCompareResult({ unitId, ...parseComparePaste(unitComparePasteText) });
    setUnitComparePasteOpenId(null);
  }

  async function runUnitCompare(unit: ContentUnit) {
    setUnitCompareRunningId(unit.id);
    setError('');
    try {
      const res = await fetch('/api/script-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, action: 'compare', title: unit.title, script: unit.script, category: unit.category || 'trivia' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '비교 실패');
      setUnitCompareResult({ unitId: unit.id, factCheck: data.factCheck || '', rewriteTitle: data.rewriteTitle, rewriteScript: data.rewriteScript, sources: data.sources });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnitCompareRunningId(null);
    }
  }

  async function saveScriptEdit(unitId: string) {
    setSavingScriptEdit(true);
    setError('');
    try {
      const res = await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === unitId ? { ...u, script: editScriptText } : u)) }),
      });
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

  async function keepOriginalAfterUnitCompare(unitId: string) {
    if (!unitCompareResult) return;
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === unitId ? { ...u, factCheck: unitCompareResult.factCheck, sources: unitCompareResult.sources } : u)) }),
      });
      setUnitCompareResult(null);
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function runUnitUpgrade(unit: ContentUnit) {
    if (!unitCompareResult || unitCompareResult.unitId !== unit.id) return;
    setUnitUpgradingId(unit.id);
    setError('');
    try {
      const res = await fetch('/api/script-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: site.id,
          action: 'upgrade',
          title: unit.title,
          script: unit.script,
          rewriteTitle: unitCompareResult.rewriteTitle,
          rewriteScript: unitCompareResult.rewriteScript,
          factCheck: unitCompareResult.factCheck,
          category: unit.category || 'trivia',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '업그레이드 실패');
      await applyUnitUpgrade(unit, data.title, data.script);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnitUpgradingId(null);
    }
  }

  async function copyUnitUpgradePrompt(unit: ContentUnit) {
    if (!unitCompareResult || unitCompareResult.unitId !== unit.id) return;
    setUnitUpgradeCopyingId(unit.id);
    setError('');
    try {
      const q = new URLSearchParams({
        siteId: site.id,
        action: 'upgrade',
        title: unit.title,
        script: unit.script,
        rewriteTitle: unitCompareResult.rewriteTitle || '',
        rewriteScript: unitCompareResult.rewriteScript || '',
        factCheck: unitCompareResult.factCheck || '',
        category: unit.category || 'trivia',
      });
      const res = await fetch(`/api/script-draft?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '프롬프트 생성 실패');
      await navigator.clipboard.writeText(data.prompt);
      setUnitUpgradeCopiedId(unit.id);
      setUnitUpgradePasteOpenId(unit.id);
      setUnitUpgradePasteText('');
      setTimeout(() => setUnitUpgradeCopiedId((cur) => (cur === unit.id ? null : cur)), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnitUpgradeCopyingId(null);
    }
  }

  async function saveUnitUpgradePaste(unit: ContentUnit) {
    if (!unitUpgradePasteText.trim()) return;
    const pickField = (field: 'Title' | 'Script') => {
      const m = unitUpgradePasteText.match(new RegExp(`${field}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:Title|Script)\\s*:|$)`, 'i'));
      return m ? m[1].trim() : undefined;
    };
    await applyUnitUpgrade(unit, pickField('Title'), pickField('Script'));
    setUnitUpgradePasteOpenId(null);
    setUnitUpgradePasteText('');
  }

  async function applyUnitUpgrade(unit: ContentUnit, title: string | undefined, script: string | undefined) {
    const nextTitle = title || unit.title;
    const nextScript = script || unit.script;
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: site.id,
          units: units.map((u) =>
            u.id === unit.id
              ? { ...u, title: nextTitle, script: nextScript, factCheck: unitCompareResult?.factCheck, sources: unitCompareResult?.sources, review: undefined, status: 'pending' }
              : u
          ),
        }),
      });
      setUnitCompareResult(null);
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function setUnitStatus(id: string, status: ContentUnit['status']) {
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === id ? { ...u, status } : u)) }),
    });
    onRefresh();
  }

  // 확정 당시 같이 추천받았던 다른 제목 후보로 바꿔치기 — 대본/번역/검토는 그 제목 기준으로 만든 거라 그대로 두고 제목만 교체.
  async function swapUnitTitle(id: string, newTitle: string) {
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === id ? { ...u, title: newTitle } : u)) }),
    });
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
    scriptDraftText,
    setScriptDraftText,
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
    compareCopying,
    compareCopied,
    comparePasteOpen,
    comparePasteText,
    setComparePasteText,
    compareRunning,
    compareResult,
    upgrading,
    upgradeCopying,
    upgradeCopied,
    upgradePasteOpen,
    upgradePasteText,
    setUpgradePasteText,
    unitCompareCopyingId,
    unitCompareCopiedId,
    unitComparePasteOpenId,
    unitComparePasteText,
    setUnitComparePasteText,
    unitCompareRunningId,
    unitCompareResult,
    unitUpgradingId,
    unitUpgradeCopyingId,
    unitUpgradeCopiedId,
    unitUpgradePasteOpenId,
    unitUpgradePasteText,
    setUnitUpgradePasteText,
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
    selectTitle,
    copyComparePrompt,
    saveComparePaste,
    runCompare,
    keepOriginalAfterCompare,
    runUpgrade,
    copyUpgradePrompt,
    saveUpgradePaste,
    saveScript,
    resetAll,
    finalizeUnit,
    clearScript,
    reviewUnit,
    copyReviewPrompt,
    savePastedReview,
    reviseUnit,
    copyRevisePrompt,
    savePastedRevise,
    copyUnitComparePrompt,
    saveUnitComparePaste,
    runUnitCompare,
    saveScriptEdit,
    keepOriginalAfterUnitCompare,
    runUnitUpgrade,
    copyUnitUpgradePrompt,
    saveUnitUpgradePaste,
    setUnitStatus,
    swapUnitTitle,
  };
}

export type ScriptWizard = ReturnType<typeof useScriptWizard>;
