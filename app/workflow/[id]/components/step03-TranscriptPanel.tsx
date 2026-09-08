'use client';

import { useEffect, useRef, useState } from 'react';
import type { Channel, SourceItem } from '../types';
import { CHANNEL_TAG_RE, extractVideoId, fmtDuration } from '../utils';
import { VideoPreviewModal, ImagePreviewModal } from './shared';

// 2번에서 등록된 소재들을 훑어보면서 대본(자막)을 붙여넣어 저장하는 패널.
// 대본 자동 수집은 이 웹앱만으로는 안 되고(U-Caption 크롬 확장 + Claude 필요) 수동 붙여넣기만 지원한다.
export function TranscriptPanel({ siteName }: { siteName: string }) {
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
  const [commentFetchingIds, setCommentFetchingIds] = useState<Set<string>>(new Set());
  const [openThumbId, setOpenThumbId] = useState<string | null>(null);
  const [openCommentsId, setOpenCommentsId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // 소재 여러 개의 "자동 가져오기"/개별 버튼을 연달아 클릭하면 요청이 한꺼번에 몰려서
  // 유튜브 쪽 레이트리밋에 걸려 전부 실패하던 문제가 있었다 — 클릭한 순서대로 한 번에
  // 하나씩만 실제 요청이 나가도록 전역으로 줄을 세운다(앞 작업이 실패해도 큐는 안 끊긴다).
  const fetchQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  function runQueued<T>(fn: () => Promise<T>): Promise<T> {
    const run = fetchQueueRef.current.then(fn, fn);
    fetchQueueRef.current = run.catch(() => {});
    return run;
  }

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

  // 서버 직접 수집(/api/transcript-fallback, 보통 몇 초면 끝남)을 먼저 시도하고, 그게 실패했을
  // 때만 U-Caption 큐(크롬 확장, 실패하면 탭까지 열어서 긁는 느린 경로라 최대 1분 반 걸릴 수
  // 있음)로 넘어간다 — 둘을 동시에 돌리면 같은 유튜브 엔드포인트에 요청이 겹쳐서 레이트리밋에
  // 더 쉽게 걸리므로, 항상 한 번에 하나씩만 순서대로 시도한다.
  async function fetchTranscript(item: SourceItem) {
    if (!item.source_url) return;
    setFetchingIds((prev) => new Set(prev).add(item.id));
    setFetchErrors((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    try {
      let transcript: string | null = null;
      try {
        transcript = await fetchViaFallback(item.source_url);
      } catch {
        // 서버 직접 수집 실패 — 아래 U-Caption 큐로 넘어간다(동시에 안 돌리고 순서대로).
      }
      if (transcript === null) {
        transcript = await fetchViaUCaptionQueue(item.source_url);
      }
      // 가져오자마자 바로 저장한다 — 저장을 안 하고 draft 입력칸에만 채워두면(예전 방식),
      // 여러 소재를 연달아 자동 가져오기 할 때 draft가 패널 전체에서 하나만 있다 보니 다음
      // 소재를 처리하는 순간 방금 가져온 대본이 저장도 안 된 채 덮어써져 사라지는 문제가 있었다.
      await fetch(`/api/source-items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      setOpenItemId(item.id);
      setDraft(transcript);
      load();
    } catch {
      setFetchErrors((prev) => ({
        ...prev,
        [item.id]: 'U-Caption 크롬 확장도, 서버 자동 수집도 실패했어요 — 직접 붙여넣어주세요.',
      }));
    } finally {
      setFetchingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  // 서버가 직접 유튜브 자막을 긁어오는 방식(크롬 확장 불필요, 보통 몇 초 안에 끝남).
  async function fetchViaFallback(sourceUrl: string): Promise<string> {
    const fbRes = await fetch('/api/transcript-fallback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: sourceUrl }),
    });
    const fb = await fbRes.json();
    if (fbRes.ok && fb.transcript) return fb.transcript;
    // 왜 서버 직접 수집이 실패해서 (느린) U-Caption 큐로 넘어가는지 진단하기 위한 로그 —
    // 사용자에게는 안 보이고(그대로 조용히 다음 방법으로 넘어감) 브라우저 콘솔에만 남는다.
    console.warn('[transcript-fallback] failed, falling back to U-Caption:', fb.reason || fb.error);
    throw new Error(fb.error || '서버 자동 수집 실패');
  }

  // U-Caption 큐에 작업을 등록하고, 이 PC의 크롬 확장(로컬 워커, 최대 1분 주기)이 처리할
  // 때까지 몇 초 간격으로 상태를 확인한다. 확장이 없거나 꺼져있으면 계속 'queued'로 남아있다가
  // 최대 1분 30초 뒤 타임아웃으로 실패한다.
  async function fetchViaUCaptionQueue(sourceUrl: string): Promise<string> {
    const res = await fetch('/api/transcript-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: sourceUrl }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '작업 등록 실패');
    const jobId = data.jobId;

    for (let attempt = 0; attempt < 18; attempt++) {
      await new Promise((r) => setTimeout(r, 5000));
      const jobRes = await fetch(`/api/transcript-jobs/${jobId}`);
      const job = await jobRes.json();
      if (!jobRes.ok) throw new Error(job.error || '작업 조회 실패');
      if (job.status === 'done') return job.transcript || '';
      if (job.status === 'error') throw new Error(job.error || '자막을 가져오지 못했어요.');
    }
    throw new Error('1분 30초 안에 끝나지 않았어요.');
  }

  // "🎬 자동 가져오기" 버튼 하나로 대본·썸네일·길이·댓글을 순서대로 하나씩 시도한다(동시에 안
  // 돌림 — 여러 요청이 겹치면 레이트리밋에 더 쉽게 걸림). 이미 있는 값은 다시 안 건드리고,
  // 어느 하나가 실패해도 다음 항목으로 계속 진행되며, 실패한 항목만 개별 버튼이 그대로 남아서
  // 다시 시도할 수 있다.
  async function autoFetch(item: SourceItem) {
    await fetchTranscript(item);
    if (!item.thumbnail_url) {
      try {
        await fetchThumbnail(item);
      } catch {
        // 실패해도 다음 항목 계속 진행 — 개별 버튼이 그대로 남음
      }
    }
    if (!item.duration_seconds) {
      try {
        await fetchDuration(item);
      } catch {
        // 위와 동일
      }
    }
    if (!item.comment_count) {
      try {
        await fetchComments(item);
      } catch {
        // 위와 동일
      }
    }
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

  async function fetchComments(item: SourceItem) {
    if (!item.source_url) return;
    setCommentFetchingIds((prev) => new Set(prev).add(item.id));
    try {
      const res = await fetch(`/api/fetch-comments?url=${encodeURIComponent(item.source_url)}`);
      const data = await res.json();
      if (res.ok) {
        await fetch(`/api/source-items/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment_count: data.commentCount, top_comments: data.topComments }),
        });
        setFetchErrors((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        load();
      } else {
        setFetchErrors((prev) => ({ ...prev, [item.id]: data.error || '댓글을 못 가져왔어요.' }));
      }
    } finally {
      setCommentFetchingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function deleteItem(id: string) {
    await fetch(`/api/source-items/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="border-t border-black/5 pt-3">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-black text-neutral-500 hover:text-black mb-2"
      >
        <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        📜 대본(자막)·댓글·썸네일·시간 수집 ({loading ? '...' : `${withTranscript.length}/${mineItems.length}`})
      </button>
      <p className="text-[10px] text-neutral-400 mb-2">
        2번에서 등록한 소재들이에요. "🎬 자동 가져오기"는 서버가 직접 자막을 가져오는 걸 먼저 시도하고,
        실패하면 이 PC의 U-Caption 크롬 확장으로 자동 전환돼요(확장이 없거나 꺼져있으면 최대 1분 반 정도 걸리다 실패, 자막 자체가 없는 영상도 실패). 그래도 안 되면 직접 붙여넣어도 돼요.
        댓글 수/상위 댓글도 같이 가져와요("💬 댓글" 배지 클릭하면 목록이 펼쳐져요).
        레이트리밋을 피하려고 여러 개를 눌러도 한 번에 하나씩, 한 소재 안에서도 대본→썸네일→길이→댓글 순서로 하나씩만 처리해요 — 여러 개를 클릭해두면 순서대로 처리되니 기다려주세요.
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
                <div className="flex items-start gap-2">
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
                  <button onClick={() => deleteItem(i.id)} className="shrink-0 text-[11px] text-red-400 font-bold hover:text-red-600 px-1" title="삭제">
                    ✕
                  </button>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mt-2">
                  <button
                    onClick={() => copyLink(i)}
                    title="링크 복사"
                    className="shrink-0 text-[11px] font-bold px-2.5 py-1.5 rounded-full border bg-white text-neutral-500 border-neutral-200 hover:border-neutral-300"
                  >
                    {copiedId === i.id ? '복사됨' : '🔗'}
                  </button>
                  <button
                    onClick={() => runQueued(() => autoFetch(i))}
                    disabled={fetchingIds.has(i.id)}
                    className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full border bg-white text-neutral-500 border-neutral-200 hover:border-neutral-300 disabled:opacity-40"
                  >
                    {fetchingIds.has(i.id) ? '가져오는 중...' : '🎬 자동 가져오기'}
                  </button>
                  <button
                    onClick={() => (i.thumbnail_url ? setOpenThumbId((cur) => (cur === i.id ? null : i.id)) : runQueued(() => fetchThumbnail(i)))}
                    disabled={thumbFetchingIds.has(i.id)}
                    className={`shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full border disabled:opacity-40 ${
                      i.thumbnail_url ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-white text-neutral-400 border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    {thumbFetchingIds.has(i.id) ? '가져오는 중...' : i.thumbnail_url ? '🖼 썸네일 있음' : '🖼 썸네일 없음'}
                  </button>
                  {i.duration_seconds ? (
                    <span className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full border bg-neutral-50 text-neutral-500 border-neutral-200">
                      ⏱ {fmtDuration(i.duration_seconds)}
                    </span>
                  ) : (
                    <button
                      onClick={() => runQueued(() => fetchDuration(i))}
                      disabled={durationFetchingIds.has(i.id)}
                      className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full border bg-white text-neutral-400 border-neutral-200 hover:border-neutral-300 disabled:opacity-40"
                    >
                      {durationFetchingIds.has(i.id) ? '가져오는 중...' : '⏱ 길이 가져오기'}
                    </button>
                  )}
                  <button
                    onClick={() => toggleOpen(i)}
                    className={`shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full border ${
                      has ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-white text-neutral-400 border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    📜 대본 {has ? `있음 (${i.transcript!.length.toLocaleString()}자)` : '없음'}
                  </button>
                  {i.comment_count ? (
                    <button
                      onClick={() => setOpenCommentsId((cur) => (cur === i.id ? null : i.id))}
                      className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full border bg-emerald-50 text-emerald-600 border-emerald-200"
                    >
                      💬 댓글 {i.comment_count.toLocaleString()}개
                    </button>
                  ) : (
                    <button
                      onClick={() => runQueued(() => fetchComments(i))}
                      disabled={commentFetchingIds.has(i.id)}
                      className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full border bg-white text-neutral-400 border-neutral-200 hover:border-neutral-300 disabled:opacity-40"
                    >
                      {commentFetchingIds.has(i.id) ? '가져오는 중...' : '💬 댓글 가져오기'}
                    </button>
                  )}
                </div>
                {fetchErrors[i.id] && <p className="text-[10px] text-red-500 font-bold mt-1.5">{fetchErrors[i.id]}</p>}
                {openCommentsId === i.id && (
                  <div className="mt-2 pt-2 border-t border-neutral-100 space-y-1.5 max-h-56 overflow-y-auto">
                    {(i.top_comments || []).length === 0 ? (
                      <p className="text-[11px] text-neutral-300">댓글 목록을 못 가져왔어요(댓글 사용 중지된 영상일 수 있어요) — 댓글 수만 확인됩니다.</p>
                    ) : (
                      i.top_comments!.map((c, idx) => (
                        <div key={idx} className="text-[11px] bg-neutral-50 rounded-lg px-2.5 py-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-neutral-500 truncate">{c.author}</span>
                            {c.likeCount > 0 && <span className="shrink-0 text-neutral-300">👍 {c.likeCount.toLocaleString()}</span>}
                          </div>
                          <p className="text-neutral-600 whitespace-pre-wrap mt-0.5">{c.text}</p>
                        </div>
                      ))
                    )}
                  </div>
                )}
                {openThumbId === i.id && i.thumbnail_url && (
                  <div className="mt-2 pt-2 border-t border-neutral-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={i.thumbnail_url}
                      alt=""
                      onClick={() => setPreviewImage(i.thumbnail_url)}
                      className="max-w-[200px] rounded-lg cursor-pointer hover:opacity-90"
                    />
                  </div>
                )}
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
      {previewImage && <ImagePreviewModal src={previewImage} onClose={() => setPreviewImage(null)} />}
    </div>
  );
}
