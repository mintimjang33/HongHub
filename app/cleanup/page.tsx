'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Orphan = { name: string; url: string; size: number | null; createdAt: string };

function formatSize(bytes: number | null) {
  if (bytes == null) return '?';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export default function CleanupPage() {
  const [orphans, setOrphans] = useState<Orphan[] | null>(null);
  const [totalFiles, setTotalFiles] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setOrphans(null);
    setError(null);
    fetch('/api/upload/orphans')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setOrphans(d.orphans || []);
        setTotalFiles(d.totalFiles || 0);
        setSelected(new Set((d.orphans || []).map((o: Orphan) => o.url)));
      })
      .catch((e) => setError(e.message));
  }

  useEffect(load, []);

  function toggle(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`선택한 ${selected.size}개 파일을 영구 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setDeleting(true);
    setError(null);
    try {
      for (const url of selected) {
        const res = await fetch('/api/upload', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || `삭제 실패: ${url}`);
        }
      }
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <Link href="/" className="text-xs text-neutral-400 font-bold hover:text-black">
          ← HongHub
        </Link>
        <div className="flex items-center justify-between mt-1 mb-2">
          <h1 className="text-2xl font-black">🧹 안 쓰는 이미지 정리</h1>
          <div className="flex gap-2">
            <button onClick={load} className="text-xs font-black px-4 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white">
              🔄 다시 스캔
            </button>
            <button
              onClick={deleteSelected}
              disabled={deleting || !orphans || selected.size === 0}
              className="bg-red-600 text-white text-xs font-black px-5 py-2 rounded-lg hover:bg-red-700 disabled:opacity-40"
            >
              {deleting ? '삭제 중...' : `선택 삭제 (${selected.size})`}
            </button>
          </div>
        </div>
        <p className="text-xs text-neutral-400 mb-4">
          honghub-files 저장소에 있지만 어떤 프로젝트의 계획서 본문에서도 링크로 참조되지 않는 파일만 골라서 보여줍니다.
          {totalFiles > 0 && ` (전체 ${totalFiles}개 중 안 쓰는 파일)`} 계획서에서 &quot;삭제&quot;로 지운 이미지, 여러 번 재업로드해서 남은 예전 버전 등이 여기 모입니다.
        </p>
        {error && <p className="text-xs text-red-500 mb-3">오류: {error}</p>}
        {!orphans ? (
          <p className="text-sm text-neutral-400">스캔 중...</p>
        ) : orphans.length === 0 ? (
          <p className="text-sm text-neutral-400 border border-dashed border-neutral-200 rounded-lg p-6 text-center">
            🎉 안 쓰는 파일이 없습니다. 깨끗해요.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {orphans.map((o) => (
              <label
                key={o.url}
                className={`relative border rounded-lg overflow-hidden bg-white cursor-pointer ${
                  selected.has(o.url) ? 'border-red-400 ring-2 ring-red-200' : 'border-neutral-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(o.url)}
                  onChange={() => toggle(o.url)}
                  className="absolute top-1 left-1 z-10 w-4 h-4"
                />
                <img src={o.url} alt={o.name} className="w-full aspect-square object-cover" />
                <div className="p-2">
                  <p className="text-[10px] text-neutral-500 truncate" title={o.name}>{o.name}</p>
                  <p className="text-[9px] text-neutral-400">{formatSize(o.size)}</p>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
