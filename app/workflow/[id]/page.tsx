'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

type Site = { id: string; name: string; workflow_content: string | null };
type Step = { n: string; name: string; desc: string; status: string };
type Channel = { id: string; name: string; url: string | null; subscriber_count: string | null; notes: string | null };
type DiscoverResult = {
  videoId: string;
  title: string;
  url: string;
  channelId: string;
  channelTitle: string;
  channelUrl: string;
  subscriberLabel: string;
  viewsLabel: string;
  thumbnail: string;
};

const CHANNEL_TAG_RE = /^\[파이프라인:([^\]]+)\]\s*/;

const TEMPLATE = `# {{프로젝트명}} 워크플로우

> 계획서(무엇을 벤치마킹하는지/어떤 소재인지)와는 별개 문서. 여기는 "어떤 순서로 어떤 도구를 쓰는지"만 담는다.

## 9단계

| # | 단계 | 내용 | 상태({{YYYY-MM-DD}}) |
|---|---|---|---|
| 1 | 채널 발굴 | 벤치마크 후보 채널을 찾아 소스채널로 등록 | |
| 2 | 채널별 소재(영상) 수집 | 채널별 잘 터진 영상의 제목/썸네일/조회수를 소재로 등록 | |
| 3 | 대본(자막) 수집 | 2번 영상들의 실제 대본 확보 | |
| 4 | 분석 | 제목/썸네일/대본에서 공통 패턴(훅/구조/톤) 추출 | |
| 5 | 대본 작성 | 4번 분석 기반 새 대본 작성 | |
| 6 | 이미지/영상 생성 | | |
| 7 | 나레이션(TTS) | | |
| 8 | 자막 | | |
| 9 | 렌더링+일괄배포 | | |

## 막히는 지점 / 다음에 정할 것

-
`;

// "| 1 | 채널 발굴 | 내용... | 상태... |" 형태의 마크다운 표 행을 파싱해서 단계 배열로 만든다.
// 헤더 행(#/단계/내용/상태)과 구분선 행(|---|...)은 건너뛴다. 표가 없거나 형식이 안 맞으면 빈 배열.
function parseSteps(markdown: string): Step[] {
  const lines = markdown.split('\n');
  const steps: Step[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 3) continue;
    const [n, name, desc = '', status = ''] = cells;
    if (!/^\d+$/.test(n)) continue; // 헤더/구분선/숫자 아닌 행 제외
    steps.push({ n, name, desc, status });
  }
  return steps;
}

// 단계 이름/내용에 등장하는 키워드로 실제 작업 페이지 바로가기 링크를 만들어준다.
// 채널 단계는 여기서 바로 추가할 수 있게 만들어서 별도 링크가 필요 없다.
function stepLink(step: Step): { href: string; label: string } | null {
  const text = `${step.name} ${step.desc}`;
  if (/채널/.test(text)) return null;
  if (/대본|자막.*수집|소재/.test(text)) return { href: '/sources?tab=items', label: '🎯 소스 발굴 → 소재 탭에서 "🔗 링크로 가져오기" / "📜 대본"' };
  if (/생성|콘텐츠/.test(text)) return { href: '/sources?tab=generate', label: '🎯 소스 발굴 → 콘텐츠 생성 탭' };
  return null;
}

function isChannelStep(step: Step): boolean {
  return /채널/.test(`${step.name} ${step.desc}`);
}

// 워크플로우 페이지에서 바로 채널을 추가/조회하는 패널. hub_source_channels에
// [파이프라인:{siteName}] 태그로 저장하므로, 여기서 추가하면 /pipelines, /sources에도 그대로 반영된다.
function ChannelPanel({ siteName }: { siteName: string }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', subscriber_count: '' });
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchResults, setSearchResults] = useState<DiscoverResult[]>([]);
  const [addedChannelIds, setAddedChannelIds] = useState<Set<string>>(new Set());

  function load() {
    setLoading(true);
    fetch('/api/source-channels')
      .then((r) => r.json())
      .then((d) => setChannels(d.channels || []))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const mine = channels.filter((c) => (c.notes || '').match(CHANNEL_TAG_RE)?.[1] === siteName);
  const mineUrls = new Set(mine.map((c) => c.url).filter(Boolean));

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError('');
    try {
      const res = await fetch(`/api/discover-channels?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.error || '검색 실패');
        setSearchResults([]);
      } else {
        setSearchResults(data.results || []);
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  async function addFromSearch(r: DiscoverResult) {
    setAddedChannelIds((prev) => new Set(prev).add(r.channelId));
    try {
      await fetch('/api/source-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: r.channelTitle,
          platform: 'youtube',
          url: r.channelUrl,
          subscriber_count: r.subscriberLabel,
          content_types: [],
          platform_fit: [],
          notes: `[파이프라인:${siteName}]`,
          status: '후보',
        }),
      });
      setExpanded(true);
      load();
    } catch {
      setAddedChannelIds((prev) => {
        const next = new Set(prev);
        next.delete(r.channelId);
        return next;
      });
    }
  }

  async function handleAdd() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/source-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          platform: 'youtube',
          url: form.url || null,
          subscriber_count: form.subscriber_count || null,
          content_types: [],
          platform_fit: [],
          notes: `[파이프라인:${siteName}]`,
          status: '후보',
        }),
      });
      setForm({ name: '', url: '', subscriber_count: '' });
      setShowForm(false);
      setExpanded(true);
      load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-t border-black/5 pt-3">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-black text-neutral-500 hover:text-black"
        >
          <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
          🎯 등록된 채널 ({loading ? '...' : mine.length})
        </button>
        <div className="flex gap-1.5">
          <button
            onClick={() => setShowSearch((v) => !v)}
            className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white"
          >
            🔍 채널 찾기
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white hover:bg-neutral-800"
          >
            + 채널 추가
          </button>
        </div>
      </div>

      {showSearch && (
        <div className="bg-white border border-neutral-200 rounded-lg p-3 mb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-black text-neutral-500">🔍 채널 찾기</span>
            <button
              onClick={() => {
                setShowSearch(false);
                setQuery('');
                setSearchResults([]);
                setSearchError('');
              }}
              className="text-[11px] font-bold text-neutral-400 hover:text-black"
            >
              ✕ 닫기
            </button>
          </div>
          <div className="flex gap-2 mb-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="검색어 (예: 건축 상식, 심리 실험)"
              className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-xs"
            />
            <button
              onClick={handleSearch}
              disabled={searching || !query.trim()}
              className="text-[11px] font-black px-4 py-2 rounded-lg bg-black text-white disabled:opacity-40"
            >
              {searching ? '찾는 중...' : '찾기'}
            </button>
          </div>
          <p className="text-[10px] text-neutral-400 mb-2">
            최근 14일 내 조회수 1만 이상 쇼츠를 유튜브에서 검색해서, 채널별로 가장 잘 터진 영상 하나씩만 보여줘요.
          </p>
          {searchError && <p className="text-[11px] text-red-500 font-bold mb-2">{searchError}</p>}
          {searchResults.length > 0 && (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {searchResults.map((r) => {
                const already = mineUrls.has(r.channelUrl) || addedChannelIds.has(r.channelId);
                return (
                  <div key={r.videoId} className="flex items-center gap-2 border border-neutral-100 rounded-lg p-2">
                    {r.thumbnail && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.thumbnail} alt="" className="w-14 h-14 object-cover rounded-lg shrink-0 bg-neutral-100" />
                    )}
                    <div className="flex-1 min-w-0">
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold truncate block hover:underline">
                        {r.title}
                      </a>
                      <div className="text-[11px] text-neutral-400 mt-0.5">
                        {r.channelTitle} · 구독자 {r.subscriberLabel} · 조회수 {r.viewsLabel}
                      </div>
                    </div>
                    <button
                      onClick={() => addFromSearch(r)}
                      disabled={already}
                      className="shrink-0 text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40 disabled:bg-neutral-300"
                    >
                      {already ? '추가됨' : '+ 채널로 추가'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showForm && (
        <div className="bg-white border border-neutral-200 rounded-lg p-3 mb-2 space-y-2">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="채널명 *"
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="URL"
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs"
            />
            <input
              value={form.subscriber_count}
              onChange={(e) => setForm((f) => ({ ...f, subscriber_count: e.target.value }))}
              placeholder="구독자수 (예: 5.2만)"
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs"
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleAdd}
              disabled={saving || !form.name.trim()}
              className="text-[11px] font-black px-4 py-2 rounded-lg bg-black text-white disabled:opacity-40"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      )}

      {expanded && mine.length > 0 && (
        <div className="space-y-1.5">
          {mine.map((c) => (
            <a
              key={c.id}
              href={c.url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 text-[11px] bg-white hover:bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2"
            >
              <span className="font-bold truncate">{c.name}</span>
              {c.subscriber_count && <span className="text-neutral-400 flex-shrink-0">{c.subscriber_count}</span>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function statusTone(status: string): { bg: string; border: string; text: string; label: string } {
  const s = status || '';
  if (/⚠️|막힘|막히는/.test(s)) return { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-600', label: '막힘' };
  if (/미착수/.test(s)) return { bg: 'bg-neutral-50', border: 'border-neutral-200', text: 'text-neutral-400', label: '미착수' };
  if (/진행\s*중|상시/.test(s)) return { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-600', label: '진행 중' };
  if (/검증|완료|확인|가능|결정됨/.test(s)) return { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-600', label: '완료' };
  if (!s.trim()) return { bg: 'bg-neutral-50', border: 'border-neutral-200', text: 'text-neutral-300', label: '-' };
  return { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-600', label: status };
}

function FlowChart({ steps, siteName }: { steps: Step[]; siteName: string }) {
  const [selected, setSelected] = useState(0);
  if (steps.length === 0) return null;
  const active = steps[Math.min(selected, steps.length - 1)];
  const activeTone = statusTone(active.status);
  const link = stepLink(active);

  return (
    <div className="mb-6 bg-white border border-neutral-200 rounded-xl p-5">
      <div className="text-[11px] font-black text-neutral-400 mb-4">🔀 플로우차트 미리보기 — 단계를 클릭하면 오른쪽에 상세가 떠요</div>
      <div className="flex gap-5">
        <div className="w-48 shrink-0 flex flex-col items-center">
          {steps.map((s, i) => {
            const tone = statusTone(s.status);
            const isSelected = i === selected;
            return (
              <div key={i} className="w-full flex flex-col items-center">
                <button
                  onClick={() => setSelected(i)}
                  className={`w-full flex items-center gap-2 border rounded-lg px-2.5 py-2 text-left transition ${
                    isSelected ? `${tone.bg} ${tone.border} ring-2 ring-black/10` : 'bg-white border-neutral-200 hover:border-neutral-300'
                  }`}
                >
                  <span
                    className={`shrink-0 w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center ${
                      isSelected ? 'bg-black text-white' : 'bg-neutral-100 text-neutral-500'
                    }`}
                  >
                    {s.n}
                  </span>
                  <span className="min-w-0 flex-1 text-xs font-bold truncate">{s.name || '(단계명 없음)'}</span>
                  <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${tone.text.replace('text-', 'bg-')}`} />
                </button>
                {i < steps.length - 1 && <div className="w-0.5 h-3 bg-neutral-200" />}
              </div>
            );
          })}
        </div>

        <div className={`flex-1 min-w-0 border rounded-xl p-5 ${activeTone.bg} ${activeTone.border}`}>
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-black text-white text-xs font-black flex items-center justify-center">{active.n}</span>
              <h3 className="font-black text-base">{active.name || '(단계명 없음)'}</h3>
            </div>
            <span className={`shrink-0 text-[10px] font-black px-2.5 py-1 rounded-full bg-white border ${activeTone.border} ${activeTone.text}`}>
              {activeTone.label}
            </span>
          </div>
          {active.desc && <p className="text-sm text-neutral-600 leading-relaxed mb-3">{active.desc}</p>}
          {active.status && <p className="text-xs text-neutral-500 leading-relaxed border-t border-black/5 pt-3 mb-3">{active.status}</p>}
          {isChannelStep(active) && <ChannelPanel siteName={siteName} />}
          {link && (
            <Link
              href={link.href}
              className="inline-block text-xs font-black text-blue-600 hover:underline border-t border-black/5 pt-3 w-full"
            >
              {link.label} →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WorkflowPage() {
  const params = useParams();
  const id = params.id as string;
  const [site, setSite] = useState<Site | null>(null);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  useEffect(() => {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => {
        const found = (d.sites || []).find((s: Site) => s.id === id);
        setSite(found || null);
        setContent(found?.workflow_content || '');
      });
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

        <FlowChart steps={steps} siteName={site.name} />

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
