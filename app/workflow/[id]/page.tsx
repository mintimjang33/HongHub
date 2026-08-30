'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

type Site = { id: string; name: string; workflow_content: string | null };
type Step = { n: string; name: string; desc: string; status: string };
type Channel = { id: string; name: string; url: string | null; subscriber_count: string | null; notes: string | null };
type SourceItem = {
  id: string;
  channel_id: string | null;
  source_url: string | null;
  title: string;
  thumbnail_url: string | null;
  transcript: string | null;
  duration_seconds: number | null;
  views: string | null;
};
type ChannelVideoResult = {
  videoId: string;
  title: string;
  url: string;
  views: number;
  viewsLabel: string;
  thumbnail: string;
  durationSeconds: number;
  durationLabel: string;
};
type ChannelMaterialGroup = { channelId: string; channelName: string; videos: ChannelVideoResult[]; error?: string };
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
// "채널 발굴"(1번), "소재 수집"(2번), "대본 수집"(3번) 단계는 이 페이지에서 바로 처리할 수 있게
// 만들어서(ChannelPanel/MaterialPanel/TranscriptPanel) 별도 링크가 필요 없다.
function stepLink(step: Step): { href: string; label: string } | null {
  const text = `${step.name} ${step.desc}`;
  if (isChannelStep(step) || isMaterialStep(step) || isTranscriptStep(step)) return null;
  if (/생성|콘텐츠/.test(text)) return { href: '/sources?tab=generate', label: '🎯 소스 발굴 → 콘텐츠 생성 탭' };
  return null;
}

// 저장된 소재는 videoId 없이 유튜브 URL(source_url)만 갖고 있으므로, 미리보기 모달을 쓰려면
// URL 형태(watch?v=, youtu.be/, shorts/)에서 videoId를 다시 뽑아내야 한다.
function extractVideoId(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (u.hostname.endsWith('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const shortsMatch = u.pathname.match(/^\/shorts\/([^/?]+)/);
      if (shortsMatch) return shortsMatch[1];
    }
  } catch {
    // URL 형식이 아니면 무시
  }
  return null;
}

function isChannelStep(step: Step): boolean {
  return /채널\s*발굴/.test(`${step.name} ${step.desc}`);
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// 영상을 새 탭으로 안 열고 페이지 안에서 바로 확인할 수 있게 하는 작은 모달.
// 확인 → 닫기 → 다음 확인 → 닫기 흐름이 되게, 오버레이 클릭이나 ✕로 바로 닫힌다.
function VideoPreviewModal({ videoId, onClose }: { videoId: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-black rounded-xl overflow-hidden w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end p-1.5 bg-neutral-900">
          <button onClick={onClose} className="text-white/70 hover:text-white text-xs font-black px-2 py-1">
            ✕ 닫기
          </button>
        </div>
        <div className="aspect-[9/16] w-full">
          <iframe
            src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
            className="w-full h-full"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
      </div>
    </div>
  );
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
  const [previewVideoId, setPreviewVideoId] = useState<string | null>(null);

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

  async function deleteChannel(id: string) {
    await fetch(`/api/source-channels/${id}`, { method: 'DELETE' });
    load();
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
                      <img
                        src={r.thumbnail}
                        alt=""
                        onClick={() => setPreviewVideoId(r.videoId)}
                        className="w-14 h-14 object-cover rounded-lg shrink-0 bg-neutral-100 cursor-pointer"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <button onClick={() => setPreviewVideoId(r.videoId)} className="text-xs font-bold truncate block hover:underline text-left">
                        {r.title}
                      </button>
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
      {previewVideoId && <VideoPreviewModal videoId={previewVideoId} onClose={() => setPreviewVideoId(null)} />}

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
            <div
              key={c.id}
              className="flex items-center justify-between gap-2 text-[11px] bg-white hover:bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2"
            >
              <a
                href={c.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 min-w-0 flex items-center gap-2 hover:underline"
              >
                <span className="font-bold truncate">{c.name}</span>
                {c.subscriber_count && <span className="text-neutral-400 flex-shrink-0">{c.subscriber_count}</span>}
              </a>
              <button
                onClick={() => deleteChannel(c.id)}
                className="shrink-0 text-red-400 font-bold hover:text-red-600 px-1"
                title="삭제"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 워크플로우 페이지에서 바로 소재를 수집하는 패널. 1번에서 이미 등록된 채널들을 그대로 돌아가며
// 채널별 인기 영상을 가져와 조회수순으로 합쳐 보여준다 — 여기서 채널을 새로 찾거나 추가하지 않는다.
function MaterialPanel({ siteName }: { siteName: string }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [items, setItems] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [groups, setGroups] = useState<ChannelMaterialGroup[]>([]);
  const [addedVideoIds, setAddedVideoIds] = useState<Set<string>>(new Set());
  const [previewVideoId, setPreviewVideoId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Promise.all([
      fetch('/api/source-channels').then((r) => r.json()),
      fetch('/api/source-items').then((r) => r.json()),
    ])
      .then(([c, i]) => {
        setChannels(c.channels || []);
        setItems(i.items || []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const mineChannels = channels.filter((c) => (c.notes || '').match(CHANNEL_TAG_RE)?.[1] === siteName);
  const mineChannelIds = new Set(mineChannels.map((c) => c.id));
  const mineItems = items.filter((i) => i.channel_id && mineChannelIds.has(i.channel_id));
  const mineItemUrls = new Set(mineItems.map((i) => i.source_url).filter(Boolean));
  const mineItemByUrl = new Map(mineItems.map((i) => [i.source_url, i]));
  const channelById = new Map(channels.map((c) => [c.id, c]));

  async function fetchTopVideos() {
    if (mineChannels.length === 0) {
      setFetchError('1번에 등록된 채널이 없어요.');
      return;
    }
    setFetching(true);
    setFetchError('');
    try {
      // 채널별로 결과를 유지한다 — 하나로 합쳐서 정렬하면 조회수 낮은 채널이 안 보여서
      // "13개 채널 중 몇 개만 나온다"는 걸 알아챌 수 없기 때문에, 채널마다 섹션을 분리해서 보여준다.
      const perChannel: ChannelMaterialGroup[] = await Promise.all(
        mineChannels.map(async (c): Promise<ChannelMaterialGroup> => {
          if (!c.url) return { channelId: c.id, channelName: c.name, videos: [], error: 'URL 미등록' };
          try {
            const res = await fetch(`/api/channel-videos?channelUrl=${encodeURIComponent(c.url)}`);
            const data = await res.json();
            if (!res.ok) return { channelId: c.id, channelName: c.name, videos: [], error: data.error || '가져오기 실패' };
            return { channelId: c.id, channelName: c.name, videos: data.results || [] };
          } catch (err) {
            return { channelId: c.id, channelName: c.name, videos: [], error: err instanceof Error ? err.message : String(err) };
          }
        })
      );
      setGroups(perChannel);
      setExpanded(true);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  }

  async function registerMaterial(channelId: string, r: ChannelVideoResult) {
    setAddedVideoIds((prev) => new Set(prev).add(r.videoId));
    try {
      await fetch('/api/source-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: channelId,
          title: r.title,
          source_url: r.url,
          thumbnail_url: r.thumbnail,
          views: r.viewsLabel,
          duration_seconds: r.durationSeconds,
          content_type: 'TRIVIA',
          platform_fit: [],
          raw_notes: '',
        }),
      });
      load();
    } catch {
      setAddedVideoIds((prev) => {
        const next = new Set(prev);
        next.delete(r.videoId);
        return next;
      });
    }
  }

  async function deleteMaterial(id: string) {
    await fetch(`/api/source-items/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="border-t border-black/5 pt-3">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-black text-neutral-500 hover:text-black"
        >
          <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
          🎯 등록된 소재 ({loading ? '...' : mineItems.length})
        </button>
        <button
          onClick={fetchTopVideos}
          disabled={fetching}
          className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white hover:bg-neutral-800 disabled:opacity-40"
        >
          {fetching ? '가져오는 중...' : '📥 채널별 인기 영상 가져오기'}
        </button>
      </div>
      <p className="text-[10px] text-neutral-400 mb-2">
        1번에 등록된 채널 {mineChannels.length}개를 하나씩 돌면서 채널별 조회수 상위 영상을 가져와요.
      </p>

      {fetchError && <p className="text-[11px] text-red-500 font-bold mb-2">{fetchError}</p>}

      {groups.length > 0 && (
        <div className="space-y-3 max-h-[32rem] overflow-y-auto mb-2">
          {groups.map((g) => (
            <div key={g.channelId} className="border border-neutral-100 rounded-lg p-2">
              <div className="text-[11px] font-black text-neutral-500 mb-1.5 flex items-center justify-between">
                <span>{g.channelName}</span>
                {g.error ? (
                  <span className="text-red-400 font-bold">{g.error}</span>
                ) : (
                  <span className="text-neutral-300">영상 {g.videos.length}개</span>
                )}
              </div>
              {!g.error && g.videos.length === 0 && <p className="text-[11px] text-neutral-300 px-1">가져온 영상 없음</p>}
              <div className="space-y-1.5">
                {g.videos.map((r) => {
                  const already = mineItemUrls.has(r.url) || addedVideoIds.has(r.videoId);
                  const existingItem = mineItemByUrl.get(r.url);
                  return (
                    <div key={r.videoId} className="flex items-center gap-2 bg-white border border-neutral-100 rounded-lg p-2">
                      {r.thumbnail && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.thumbnail}
                          alt=""
                          onClick={() => setPreviewVideoId(r.videoId)}
                          className="w-14 h-14 object-cover rounded-lg shrink-0 bg-neutral-100 cursor-pointer"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <button onClick={() => setPreviewVideoId(r.videoId)} className="text-xs font-bold truncate block hover:underline text-left">
                          {r.title}
                        </button>
                        <div className="text-[11px] text-neutral-400 mt-0.5">조회수 {r.viewsLabel} · {r.durationLabel}</div>
                      </div>
                      <button
                        onClick={() => (existingItem ? deleteMaterial(existingItem.id) : registerMaterial(g.channelId, r))}
                        disabled={already && !existingItem}
                        className={`shrink-0 text-[11px] font-black px-3 py-1.5 rounded-lg ${
                          already
                            ? 'bg-neutral-100 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40'
                            : 'bg-black text-white'
                        }`}
                      >
                        {already ? (existingItem ? '✕ 등록취소' : '등록됨') : '소재등록'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {previewVideoId && <VideoPreviewModal videoId={previewVideoId} onClose={() => setPreviewVideoId(null)} />}

      {expanded && (
        <div className="space-y-1.5">
          {mineItems.length === 0 && <p className="text-[11px] text-neutral-300 px-1">등록된 소재 없음</p>}
          {mineItems.map((i) => {
            const ch = i.channel_id ? channelById.get(i.channel_id) : undefined;
            const videoId = extractVideoId(i.source_url);
            return (
              <div key={i.id} className="flex items-center gap-2 bg-white border border-neutral-100 rounded-lg px-3 py-2">
                {i.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={i.thumbnail_url}
                    alt=""
                    onClick={() => videoId && setPreviewVideoId(videoId)}
                    className={`w-10 h-10 object-cover rounded shrink-0 bg-neutral-100 ${videoId ? 'cursor-pointer' : ''}`}
                  />
                )}
                <div className="flex-1 min-w-0">
                  {videoId ? (
                    <button onClick={() => setPreviewVideoId(videoId)} className="text-[11px] font-bold truncate block hover:underline text-left">
                      {i.title || i.source_url}
                    </button>
                  ) : (
                    <span className="text-[11px] font-bold truncate block">{i.title || i.source_url}</span>
                  )}
                  {ch && (
                    <a href={ch.url || '#'} target="_blank" rel="noopener noreferrer" className="text-[11px] text-neutral-400 hover:underline">
                      {ch.name}
                    </a>
                  )}
                </div>
                <button
                  onClick={() => deleteMaterial(i.id)}
                  className="shrink-0 text-[11px] text-red-400 font-bold hover:text-red-600 px-1"
                  title="삭제"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function isMaterialStep(step: Step): boolean {
  return /소재/.test(`${step.name} ${step.desc}`);
}

function isTranscriptStep(step: Step): boolean {
  return /대본|자막.*수집/.test(`${step.name} ${step.desc}`);
}

// 2번에서 등록된 소재들을 훑어보면서 대본(자막)을 붙여넣어 저장하는 패널.
// 대본 자동 수집은 이 웹앱만으로는 안 되고(U-Caption 크롬 확장 + Claude 필요) 수동 붙여넣기만 지원한다.
function TranscriptPanel({ siteName }: { siteName: string }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [items, setItems] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewVideoId, setPreviewVideoId] = useState<string | null>(null);
  const [fetchingIds, setFetchingIds] = useState<Set<string>>(new Set());
  const [fetchErrors, setFetchErrors] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [thumbFetchingIds, setThumbFetchingIds] = useState<Set<string>>(new Set());
  const [durationFetchingIds, setDurationFetchingIds] = useState<Set<string>>(new Set());

  function load() {
    setLoading(true);
    Promise.all([
      fetch('/api/source-channels').then((r) => r.json()),
      fetch('/api/source-items').then((r) => r.json()),
    ])
      .then(([c, i]) => {
        setChannels(c.channels || []);
        setItems(i.items || []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const mineChannelIds = new Set(channels.filter((c) => (c.notes || '').match(CHANNEL_TAG_RE)?.[1] === siteName).map((c) => c.id));
  const mineItems = items.filter((i) => i.channel_id && mineChannelIds.has(i.channel_id));
  const withTranscript = mineItems.filter((i) => i.transcript && i.transcript.trim());
  const channelById = new Map(channels.map((c) => [c.id, c]));

  function toggleOpen(item: SourceItem) {
    if (openItemId === item.id) {
      setOpenItemId(null);
      return;
    }
    setOpenItemId(item.id);
    setDraft(item.transcript || '');
  }

  async function saveTranscript(id: string) {
    setSaving(true);
    try {
      await fetch(`/api/source-items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: draft }),
      });
      load();
    } finally {
      setSaving(false);
    }
  }

  // U-Caption 큐에 작업을 등록하고, 이 PC의 크롬 확장(로컬 워커, 최대 1분 주기)이 처리할 때까지
  // 몇 초 간격으로 상태를 확인한다. 성공하면 바로 저장하지 않고 검토할 수 있게 입력칸만 채워둔다.
  async function fetchTranscript(item: SourceItem) {
    if (!item.source_url) return;
    setFetchingIds((prev) => new Set(prev).add(item.id));
    setFetchErrors((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    try {
      const res = await fetch('/api/transcript-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.source_url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '작업 등록 실패');
      const jobId = data.jobId;

      for (let attempt = 0; attempt < 18; attempt++) {
        await new Promise((r) => setTimeout(r, 5000));
        const jobRes = await fetch(`/api/transcript-jobs/${jobId}`);
        const job = await jobRes.json();
        if (!jobRes.ok) throw new Error(job.error || '작업 조회 실패');
        if (job.status === 'done') {
          setOpenItemId(item.id);
          setDraft(job.transcript || '');
          return;
        }
        if (job.status === 'error') {
          throw new Error(job.error || '자막을 가져오지 못했어요.');
        }
      }
      throw new Error('1분 30초 안에 끝나지 않았어요 — 크롬에 U-Caption 확장이 켜져 있는지 확인해주세요.');
    } catch (err) {
      setFetchErrors((prev) => ({ ...prev, [item.id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setFetchingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  // "🎬 자동 가져오기" 버튼 하나로 대본·썸네일·길이를 한 번에 시도한다. 대본은 U-Caption 큐라 시간이
  // 걸리고, 썸네일/길이는 유튜브 API라 빠르다 — 병렬로 돌리고, 이미 있는 값은 다시 안 건드린다.
  // 어느 하나가 실패해도 나머지는 계속 진행되고, 실패한 항목만 개별 버튼이 그대로 남아서 다시 시도할 수 있다.
  async function autoFetch(item: SourceItem) {
    await Promise.allSettled([
      fetchTranscript(item),
      item.thumbnail_url ? Promise.resolve() : fetchThumbnail(item),
      item.duration_seconds ? Promise.resolve() : fetchDuration(item),
    ]);
  }

  async function copyLink(item: SourceItem) {
    if (!item.source_url) return;
    try {
      await navigator.clipboard.writeText(item.source_url);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((cur) => (cur === item.id ? null : cur)), 1500);
    } catch {
      // 클립보드 권한이 없는 브라우저 환경이면 조용히 무시
    }
  }

  async function fetchThumbnail(item: SourceItem) {
    if (!item.source_url) return;
    setThumbFetchingIds((prev) => new Set(prev).add(item.id));
    try {
      const res = await fetch(`/api/fetch-thumbnail?url=${encodeURIComponent(item.source_url)}`);
      const data = await res.json();
      if (res.ok && data.image) {
        await fetch(`/api/source-items/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ thumbnail_url: data.image }),
        });
        setFetchErrors((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        load();
      } else {
        setFetchErrors((prev) => ({ ...prev, [item.id]: data.error || '썸네일을 못 가져왔어요.' }));
      }
    } finally {
      setThumbFetchingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function fetchDuration(item: SourceItem) {
    if (!item.source_url) return;
    setDurationFetchingIds((prev) => new Set(prev).add(item.id));
    try {
      const res = await fetch(`/api/fetch-duration?url=${encodeURIComponent(item.source_url)}`);
      const data = await res.json();
      if (res.ok && data.seconds) {
        await fetch(`/api/source-items/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ duration_seconds: data.seconds }),
        });
        setFetchErrors((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        load();
      } else {
        setFetchErrors((prev) => ({ ...prev, [item.id]: data.error || '영상 길이를 못 가져왔어요.' }));
      }
    } finally {
      setDurationFetchingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  return (
    <div className="border-t border-black/5 pt-3">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-black text-neutral-500 hover:text-black mb-2"
      >
        <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        📜 대본 수집 ({loading ? '...' : `${withTranscript.length}/${mineItems.length}`})
      </button>
      <p className="text-[10px] text-neutral-400 mb-2">
        2번에서 등록한 소재들이에요. "🎬 자동 가져오기"는 이 PC에 U-Caption 크롬 확장이 켜져 있어야
        동작해요(최대 1분 정도 걸림, 자막 없는 영상은 실패). 안 되거나 급하면 직접 붙여넣어도 돼요.
      </p>

      {expanded && (
        <div className="space-y-1.5 max-h-[36rem] overflow-y-auto">
          {mineItems.length === 0 && <p className="text-[11px] text-neutral-300 px-1">2번에서 먼저 소재를 등록해주세요.</p>}
          {mineItems.map((i) => {
            const videoId = extractVideoId(i.source_url);
            const has = !!(i.transcript && i.transcript.trim());
            const ch = i.channel_id ? channelById.get(i.channel_id) : undefined;
            return (
              <div key={i.id} className="bg-white border border-neutral-100 rounded-lg p-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {i.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={i.thumbnail_url}
                      alt=""
                      onClick={() => videoId && setPreviewVideoId(videoId)}
                      className={`w-10 h-10 object-cover rounded shrink-0 bg-neutral-100 ${videoId ? 'cursor-pointer' : ''}`}
                    />
                  ) : (
                    <div className="w-10 h-10 shrink-0 rounded bg-neutral-50 border border-dashed border-neutral-200 flex items-center justify-center text-sm text-neutral-300">
                      🖼
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <button onClick={() => (videoId ? setPreviewVideoId(videoId) : undefined)} className="text-[11px] font-bold truncate block text-left hover:underline">
                      {i.title || i.source_url}
                    </button>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {ch && (
                        <a href={ch.url || '#'} target="_blank" rel="noopener noreferrer" className="text-[11px] text-neutral-400 hover:underline">
                          {ch.name}
                        </a>
                      )}
                      {i.views && <span className="text-[11px] text-neutral-400">· 조회수 {i.views}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => copyLink(i)}
                    title="링크 복사"
                    className="shrink-0 text-[11px] font-bold px-2.5 py-1.5 rounded-full border bg-white text-neutral-500 border-neutral-200 hover:border-neutral-300"
                  >
                    {copiedId === i.id ? '복사됨' : '🔗'}
                  </button>
                  <button
                    onClick={() => autoFetch(i)}
                    disabled={fetchingIds.has(i.id)}
                    className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full border bg-white text-neutral-500 border-neutral-200 hover:border-neutral-300 disabled:opacity-40"
                  >
                    {fetchingIds.has(i.id) ? '가져오는 중...' : '🎬 자동 가져오기'}
                  </button>
                  <button
                    onClick={() => fetchThumbnail(i)}
                    disabled={thumbFetchingIds.has(i.id)}
                    title="다시 가져오기"
                    className={`shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full border disabled:opacity-40 ${
                      i.thumbnail_url ? 'bg-neutral-50 text-neutral-500 border-neutral-200 hover:border-neutral-300' : 'bg-white text-neutral-500 border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    {thumbFetchingIds.has(i.id) ? '가져오는 중...' : i.thumbnail_url ? '🖼 썸네일 있음' : '🖼 썸네일 가져오기'}
                  </button>
                  <button
                    onClick={() => fetchDuration(i)}
                    disabled={durationFetchingIds.has(i.id)}
                    title="다시 가져오기"
                    className={`shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full border disabled:opacity-40 ${
                      i.duration_seconds ? 'bg-neutral-50 text-neutral-500 border-neutral-200 hover:border-neutral-300' : 'bg-white text-neutral-500 border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    {durationFetchingIds.has(i.id) ? '가져오는 중...' : i.duration_seconds ? `⏱ ${fmtDuration(i.duration_seconds)}` : '⏱ 길이 가져오기'}
                  </button>
                  <button
                    onClick={() => toggleOpen(i)}
                    className={`shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full border ${
                      has ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-white text-neutral-400 border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    📜 대본 {has ? `있음 (${i.transcript!.length.toLocaleString()}자)` : '없음'}
                  </button>
                </div>
                {fetchErrors[i.id] && <p className="text-[10px] text-red-500 font-bold mt-1.5">{fetchErrors[i.id]}</p>}
                {openItemId === i.id && (
                  <div className="mt-2 pt-2 border-t border-neutral-100">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={5}
                      placeholder="이 영상의 대본/자막 전문을 붙여넣으세요 (U-Caption으로 뽑은 자막 등)"
                      className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono leading-relaxed"
                    />
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[10px] text-neutral-300">{draft.length.toLocaleString()}자</span>
                      <button
                        onClick={() => saveTranscript(i.id)}
                        disabled={saving}
                        className="bg-black text-white text-[11px] font-black px-4 py-2 rounded-lg disabled:opacity-40"
                      >
                        {saving ? '저장 중...' : '대본 저장'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {previewVideoId && <VideoPreviewModal videoId={previewVideoId} onClose={() => setPreviewVideoId(null)} />}
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

function FlowChart({
  steps,
  siteName,
  selected,
  onSelect,
}: {
  steps: Step[];
  siteName: string;
  selected: number;
  onSelect: (i: number) => void;
}) {
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
                  onClick={() => onSelect(i)}
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
          {isMaterialStep(active) && <MaterialPanel siteName={siteName} />}
          {isTranscriptStep(active) && <TranscriptPanel siteName={siteName} />}
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

        <FlowChart steps={steps} siteName={site.name} selected={selectedStep} onSelect={selectStep} />

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
