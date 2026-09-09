'use client';

import { useEffect, useState } from 'react';
import type { Channel, DiscoverResult } from '../types';
import { CHANNEL_TAG_RE } from '../utils';
import { VideoPreviewModal } from './shared';

// 워크플로우 페이지에서 바로 채널을 추가/조회하는 패널. hub_source_channels에
// [파이프라인:{siteName}] 태그로 저장하므로, 여기서 추가하면 /pipelines, /sources에도 그대로 반영된다.
export function ChannelPanel({ siteName }: { siteName: string }) {
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', url: '', subscriber_count: '' });
  const [editSaving, setEditSaving] = useState(false);

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

  function openEdit(c: Channel) {
    setEditingId(c.id);
    setEditForm({ name: c.name, url: c.url || '', subscriber_count: c.subscriber_count || '' });
  }

  async function handleEditSave() {
    if (!editingId || !editForm.name.trim()) return;
    setEditSaving(true);
    try {
      await fetch(`/api/source-channels/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      setEditingId(null);
      load();
    } finally {
      setEditSaving(false);
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
              {editingId === c.id ? (
                <div className="flex-1 flex items-center gap-1.5">
                  <input
                    value={editForm.name}
                    onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="채널명"
                    className="flex-1 min-w-0 border border-neutral-200 rounded px-2 py-1 text-[11px]"
                  />
                  <input
                    value={editForm.url}
                    onChange={(e) => setEditForm((f) => ({ ...f, url: e.target.value }))}
                    placeholder="URL"
                    className="flex-1 min-w-0 border border-neutral-200 rounded px-2 py-1 text-[11px]"
                  />
                  <input
                    value={editForm.subscriber_count}
                    onChange={(e) => setEditForm((f) => ({ ...f, subscriber_count: e.target.value }))}
                    placeholder="구독자수"
                    className="w-20 shrink-0 border border-neutral-200 rounded px-2 py-1 text-[11px]"
                  />
                  <button
                    onClick={handleEditSave}
                    disabled={editSaving || !editForm.name.trim()}
                    className="shrink-0 text-[11px] font-black px-2.5 py-1 rounded-lg bg-black text-white disabled:opacity-40"
                  >
                    {editSaving ? '저장 중' : '저장'}
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="shrink-0 text-neutral-400 font-bold hover:text-black px-1"
                  >
                    취소
                  </button>
                </div>
              ) : (
                <>
                  <a
                    href={c.url || '#'}
                    target={c.url ? '_blank' : undefined}
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      if (!c.url) e.preventDefault();
                    }}
                    className="flex-1 min-w-0 flex items-center gap-2 hover:underline"
                  >
                    <span className="font-bold truncate">{c.name}</span>
                    {c.subscriber_count && <span className="text-neutral-400 flex-shrink-0">{c.subscriber_count}</span>}
                  </a>
                  {!c.url && (
                    <span className="shrink-0 text-amber-500" title="URL 미등록">
                      ⚠️
                    </span>
                  )}
                  <button
                    onClick={() => openEdit(c)}
                    className="shrink-0 text-blue-500 font-black hover:underline px-1"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => deleteChannel(c.id)}
                    className="shrink-0 text-red-400 font-bold hover:text-red-600 px-1"
                    title="삭제"
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
