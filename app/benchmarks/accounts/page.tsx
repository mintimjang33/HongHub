'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Benchmark = {
  id: string;
  name: string;
  url: string;
  status: string;
  notes: string | null;
};

export default function BenchmarkAccountsPage() {
  const [items, setItems] = useState<Benchmark[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/benchmarks')
      .then((r) => r.json())
      .then((d) => setItems((d.benchmarks || []).filter((x: Benchmark & { kind: string }) => x.kind === 'account_collection')))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8">
          <Link href="/sources" className="text-xs text-neutral-400 font-bold hover:text-black">
            ← 소스 발굴
          </Link>
          <h1 className="text-2xl font-black mt-1">👥 실계정 모음</h1>
          <p className="text-xs text-neutral-400 mt-1">플랫폼별로 실제 검색·수집한 실계정 리스트(핸들 다수 포함)</p>
        </div>

        {loading ? (
          <div className="text-sm text-neutral-400 text-center py-20">불러오는 중...</div>
        ) : items.length === 0 ? (
          <div className="border border-dashed border-neutral-300 rounded-xl p-16 text-center text-sm text-neutral-400">
            아직 계정 모음이 없어요.
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((b) => (
              <div key={b.id} className="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-start justify-between mb-2">
                  <a href={b.url} target="_blank" rel="noopener noreferrer" className="font-black text-base hover:underline">
                    {b.name}
                  </a>
                  <span className="text-[11px] font-bold bg-neutral-100 px-3 py-1 rounded-full flex-shrink-0">{b.status}</span>
                </div>
                <a href={b.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-neutral-400 hover:underline break-all">
                  {b.url}
                </a>
                {b.notes && <p className="text-xs text-neutral-500 whitespace-pre-wrap border-t border-neutral-100 mt-3 pt-3">{b.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
