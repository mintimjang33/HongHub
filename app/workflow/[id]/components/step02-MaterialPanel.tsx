'use client';

import { useEffect, useState } from 'react';
import type { Channel, SourceItem, ChannelMaterialGroup, ChannelVideoResult } from '../types';
import { CHANNEL_TAG_RE, extractVideoId } from '../utils';
import { VideoPreviewModal } from './shared';

// 워크플로우 페이지에서 바로 소재를 수집하는 패널. 1번에서 이미 등록된 채널들을 그대로 돌아가며
// 채널별 인기 영상을 가져와 조회수순으로 합쳐 보여준다 — 여기서 채널을 새로 찾거나 추가하지 않는다.
export function MaterialPanel({ siteName }: { siteName: string }) {
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
