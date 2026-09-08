'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import type { Site } from './types';
import { TEMPLATE, parseSteps } from './utils';
import { FlowChart } from './components/FlowChart';

export default function WorkflowPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-neutral-50 p-10 text-sm text-neutral-400">불러오는 중...</div>}>
      <WorkflowPageInner />
    </Suspense>
  );
}

function WorkflowPageInner() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [site, setSite] = useState<Site | null>(null);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  // 새로고침해도 보던 단계로 돌아오게 선택된 단계를 URL(?step=N, 1-based)에 저장해둔다.
  const stepParam = Number(searchParams.get('step'));
  const selectedStep = Number.isFinite(stepParam) && stepParam > 0 ? stepParam - 1 : 0;
  function selectStep(i: number) {
    router.replace(`/workflow/${id}?step=${i + 1}`, { scroll: false });
  }

  function loadSite() {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => {
        const found = (d.sites || []).find((s: Site) => s.id === id);
        setSite(found || null);
        setContent(found?.workflow_content || '');
      });
  }

  useEffect(() => {
    loadSite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const steps = useMemo(() => parseSteps(content), [content]);

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/sites/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow_content: content }),
      });
      setSavedAt(new Date().toLocaleTimeString('ko-KR'));
    } finally {
      setSaving(false);
    }
  }

  function insertTemplate() {
    if (content.trim() && !confirm('지금 내용을 템플릿으로 덮어쓸까요?')) return;
    setContent(TEMPLATE.replace('{{프로젝트명}}', site?.name || '').replace(/\{\{YYYY-MM-DD\}\}/g, new Date().toISOString().slice(0, 10)));
    setShowEditor(true);
  }

  if (!site) return <div className="min-h-screen bg-neutral-50 p-10 text-sm text-neutral-400">불러오는 중...</div>;

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <Link href="/pipelines" className="text-xs text-neutral-400 font-bold hover:text-black">
          ← 파이프라인
        </Link>
        <div className="flex items-center justify-between mt-1 mb-2">
          <h1 className="text-2xl font-black">🔧 {site.name} 워크플로우</h1>
          <div className="flex gap-2">
            <button onClick={insertTemplate} className="text-xs font-black px-4 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white">
              📐 템플릿 채우기
            </button>
            <button
              onClick={() => setShowEditor((v) => !v)}
              className="text-xs font-black px-4 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white"
            >
              {showEditor ? '✕ 편집 닫기' : '✏️ 표 편집하기'}
            </button>
            <button onClick={save} disabled={saving} className="bg-black text-white text-xs font-black px-5 py-2 rounded-lg hover:bg-neutral-800 disabled:opacity-40">
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
        <p className="text-xs text-neutral-400 mb-4">
          계획서와는 별개로, 이 파이프라인이 "어떤 순서로 어떤 도구를 쓰는지"만 적어두는 곳이에요. 표를 채우면 아래에 순서도로 자동 표시돼요.
          {savedAt && <span className="text-green-600 font-bold"> · {savedAt} 저장됨</span>}
        </p>

        <FlowChart steps={steps} site={site} selected={selectedStep} onSelect={selectStep} onRefreshSite={loadSite} />

        {(showEditor || steps.length === 0) && (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={28}
            className="w-full border border-neutral-200 rounded-lg p-4 text-xs font-mono leading-relaxed"
            placeholder="아직 워크플로우가 없어요 — [📐 템플릿 채우기]로 시작해보세요."
          />
        )}
      </div>
    </div>
  );
}
