'use client';

import { useState } from 'react';
import type { Site } from '../types';

const ANALYSIS_TABS = [
  { key: 'channel', label: '채널' },
  { key: 'title', label: '제목' },
  { key: 'thumbnail', label: '썸네일' },
  { key: 'script', label: '대본' },
  { key: 'comment', label: '댓글' },
  { key: 'duration', label: '시간' },
  { key: 'pace', label: '속도' },
] as const;
type AnalysisTabKey = (typeof ANALYSIS_TABS)[number]['key'];

// 분석 결과(특히 썸네일 탭)에 이미지 URL을 그냥 글자로 적어두면 실제로 어떻게 생겼는지 확인이
// 안 된다는 피드백 — URL을 텍스트째로 두지 않고 실제 썸네일 이미지로 렌더링해서 보여준다.
const IMAGE_URL_RE = /https?:\/\/\S+\.(?:jpg|jpeg|png|webp|gif)(?:\?\S*)?/gi;
function TextWithInlineImages({ text }: { text: string }) {
  const parts = text.split(IMAGE_URL_RE);
  const urls = text.match(IMAGE_URL_RE) || [];
  return (
    <div className="text-xs text-neutral-600 leading-relaxed">
      {parts.map((part, i) => (
        <span key={i}>
          <span className="whitespace-pre-wrap">{part}</span>
          {urls[i] && (
            <a href={urls[i]} target="_blank" rel="noopener noreferrer" className="inline-block align-middle mx-1 my-1">
              <img
                src={urls[i]}
                alt="썸네일 예시"
                className="inline-block h-24 w-auto rounded-lg border border-neutral-200 align-middle hover:border-blue-400"
              />
            </a>
          )}
        </span>
      ))}
    </div>
  );
}

// 2·3번에서 모은 소재를 웹앱이 유료 API로 직접 분석하지 않는다 — Claude(구독)나 Gemini한테
// 채팅으로 "OO 파이프라인 패턴 분석해줘"라고 요청하면, save_pipeline_analysis MCP 툴로
// 여기(hub_sites.analysis_result)에 저장되고, 이 패널은 그 저장된 결과를 읽어서 탭으로 보여주기만 한다.
export function AnalysisPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const [tab, setTab] = useState<AnalysisTabKey>('title');
  const [checked, setChecked] = useState<Record<AnalysisTabKey, boolean>>({
    channel: false,
    title: false,
    thumbnail: false,
    script: false,
    comment: false,
    duration: false,
    pace: false,
  });
  const [analyzing, setAnalyzing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const result = site.analysis_result;
  const selectedCategories = ANALYSIS_TABS.filter((t) => checked[t.key]).map((t) => t.key);

  function toggle(key: AnalysisTabKey) {
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function analyzeWithGemini() {
    if (selectedCategories.length === 0) return setError('분석할 항목을 체크해주세요.');
    setAnalyzing(true);
    setError('');
    try {
      const res = await fetch('/api/analyze-materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, categories: selectedCategories }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '분석 실패');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  }

  // 유료 API 없이 구독(Gemini 웹앱, 또는 이 대화의 Claude)으로 분석하고 싶을 때 쓰는 버튼.
  // 구독 채팅은 외부에서 자동으로 트리거할 방법이 없어서, 소재 데이터를 프롬프트로 만들어
  // 클립보드에 복사해주는 것까지만 하고 — 붙여넣기/실행은 사용자가 직접 한다.
  async function copyPromptForSubscription() {
    if (selectedCategories.length === 0) return setError('분석할 항목을 체크해주세요.');
    setCopying(true);
    setError('');
    try {
      const res = await fetch(`/api/analysis-prompt?siteId=${site.id}&categories=${selectedCategories.join(',')}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '프롬프트 생성 실패');
      await navigator.clipboard.writeText(data.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="border-t border-black/5 pt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-black text-neutral-500">
          🔍 패턴 분석{result?.updated_at && ` — ${new Date(result.updated_at).toLocaleString('ko-KR')} 기준`}
        </span>
        <button onClick={onRefresh} className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white">
          🔄 새로고침
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-3 bg-neutral-50 border border-neutral-100 rounded-lg p-3">
        {ANALYSIS_TABS.map((t) => (
          <label key={t.key} className="flex items-center gap-1.5 text-xs font-bold text-neutral-600 cursor-pointer">
            <input type="checkbox" checked={checked[t.key]} onChange={() => toggle(t.key)} className="w-3.5 h-3.5" />
            {t.label}
          </label>
        ))}
      </div>

      <div className="flex gap-1.5 mb-3">
        <button
          onClick={copyPromptForSubscription}
          disabled={copying}
          className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
        >
          {copying ? '준비 중...' : copied ? '✅ 복사됨!' : '💬 체크한 항목 Gemini·Claude 구독으로 분석하기'}
        </button>
        <button
          onClick={analyzeWithGemini}
          disabled={analyzing}
          className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white hover:bg-neutral-800 disabled:opacity-40"
        >
          {analyzing ? '분석 중... (1분 정도)' : '✨ 체크한 항목 Gemini Pro로 분석하기'}
        </button>
      </div>
      <p className="text-[10px] text-neutral-400 mb-3">
        먼저 분석할 항목을 체크하세요. "✨ Gemini Pro"는 Gemini API(유료, gemini-3.1-pro-preview)를 직접
        호출해서 체크한 것만 바로 분석·저장해요. "💬 Gemini·Claude 구독으로 분석하기"는 API 없이, 체크한
        항목만 프롬프트로 만들어 클립보드에 복사해줘요(비용 없음) — Gemini 웹앱이든 Claude(claude.ai나 이
        대화)든 아무 구독 채팅에나 붙여넣어서 물어보시고, 답변을 다시 붙여넣어주시면 저장해드릴게요. HongHub이
        Vercel에서 돌아가서 두 구독 계정을 여기서 자동으로 대신 불러내는 건 안 되고(로컬 PC에 로그인된 CLI가
        필요), 지금은 이 복사-붙여넣기 방식이 유일한 무료 경로예요.
      </p>
      {error && <p className="text-[11px] text-red-500 font-bold mb-3">{error}</p>}

      <div className="flex gap-1.5 mb-3 border-b border-neutral-100">
        {ANALYSIS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-[11px] font-black px-3 py-2 border-b-2 -mb-px ${
              tab === t.key ? 'border-black text-black' : 'border-transparent text-neutral-400 hover:text-black'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {result?.[tab] ? (
        <TextWithInlineImages text={result[tab] as string} />
      ) : (
        <p className="text-xs text-neutral-300">
          아직 &quot;{ANALYSIS_TABS.find((t) => t.key === tab)?.label}&quot; 분석 결과가 없어요 — 위에서 체크하고 분석을 실행해보세요.
        </p>
      )}
    </div>
  );
}
