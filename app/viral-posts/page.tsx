'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type ViralPost = {
  id: string;
  platform: string;
  account_name: string;
  post_url: string | null;
  content: string;
  engagement: string | null;
  analysis: string | null;
};

const PLATFORMS = [
  { value: 'threads', label: '🧵 쓰레드' },
  { value: 'instagram', label: '📸 인스타' },
  { value: 'tiktok', label: '🎵 틱톡' },
  { value: 'youtube', label: '▶️ 유튜브' },
];

function platformLabel(v: string) {
  return PLATFORMS.find((p) => p.value === v)?.label || v;
}

const EMPTY_FORM = { platform: 'threads', account_name: '', post_url: '', content: '', engagement: '', analysis: '' };

export default function ViralPostsPage() {
  const [items, setItems] = useState<ViralPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [filterPlatform, setFilterPlatform] = useState<string>('all');

  function load() {
    fetch('/api/viral-posts')
      .then((r) => r.json())
      .then((d) => setItems(d.posts || []))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(p: ViralPost) {
    setEditingId(p.id);
    setForm({
      platform: p.platform,
      account_name: p.account_name,
      post_url: p.post_url || '',
      content: p.content,
      engagement: p.engagement || '',
      analysis: p.analysis || '',
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.account_name.trim() || !form.content.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await fetch(`/api/viral-posts/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
      } else {
        await fetch('/api/viral-posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
      }
      setShowForm(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('이 글을 삭제할까요?')) return;
    await fetch(`/api/viral-posts/${id}`, { method: 'DELETE' });
    load();
  }

  const filtered = filterPlatform === 'all' ? items : items.filter((i) => i.platform === filterPlatform);

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/sources" className="text-xs text-neutral-400 font-bold hover:text-black">
              ← 소스 발굴
            </Link>
            <h1 className="text-2xl font-black mt-1">🔥 터진 글 분석</h1>
            <p className="text-xs text-neutral-400 mt-1">플랫폼별로 실제 반응 좋았던 글의 원문·반응수치·왜 터졌는지 분석</p>
          </div>
          <button onClick={openAdd} className="bg-black text-white text-xs font-black px-5 py-3 rounded-lg hover:bg-neutral-800">
            + 글 추가
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setFilterPlatform('all')}
            className={`text-xs font-bold px-4 py-2 rounded-full border ${filterPlatform === 'all' ? 'bg-black text-white border-black' : 'bg-white border-neutral-200'}`}
          >
            전체 ({items.length})
          </button>
          {PLATFORMS.map((p) => {
            const count = items.filter((i) => i.platform === p.value).length;
            if (count === 0) return null;
            return (
              <button
                key={p.value}
                onClick={() => setFilterPlatform(p.value)}
                className={`text-xs font-bold px-4 py-2 rounded-full border ${filterPlatform === p.value ? 'bg-black text-white border-black' : 'bg-white border-neutral-200'}`}
              >
                {p.label} ({count})
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="text-sm text-neutral-400 text-center py-20">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="border border-dashed border-neutral-300 rounded-xl p-16 text-center text-sm text-neutral-400">
            아직 등록된 글이 없어요. &quot;+ 글 추가&quot;로 시작해보세요.
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((p) => (
              <div key={p.id} className="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold bg-neutral-100 px-2.5 py-1 rounded-full">{platformLabel(p.platform)}</span>
                    <span className="font-black text-sm">@{p.account_name}</span>
                    {p.engagement && (
                      <span className="text-[11px] font-bold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full">{p.engagement}</span>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => openEdit(p)} className="text-[11px] text-neutral-400 font-bold hover:text-black">
                      수정
                    </button>
                    <button onClick={() => handleDelete(p.id)} className="text-[11px] text-red-400 font-bold hover:text-red-600">
                      삭제
                    </button>
                  </div>
                </div>
                <p className="text-sm text-neutral-700 whitespace-pre-wrap bg-neutral-50 border border-neutral-100 rounded-lg p-3 mt-2">
                  {p.content}
                </p>
                {p.post_url && (
                  <a href={p.post_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-500 hover:underline break-all mt-2 block">
                    {p.post_url}
                  </a>
                )}
                {p.analysis && (
                  <div className="text-xs text-neutral-600 whitespace-pre-wrap border-t border-neutral-100 mt-3 pt-3">
                    <span className="font-bold text-neutral-800">💡 왜 터졌나: </span>
                    {p.analysis}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white p-6 max-w-md w-full rounded-xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-black mb-4">{editingId ? '글 수정' : '+ 글 추가'}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">플랫폼</label>
                <select
                  value={form.platform}
                  onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                >
                  {PLATFORMS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">계정 이름 *</label>
                <input
                  value={form.account_name}
                  onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))}
                  placeholder="예: today.pickkkkk"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">게시물 URL (선택)</label>
                <input
                  value={form.post_url}
                  onChange={(e) => setForm((f) => ({ ...f, post_url: e.target.value }))}
                  placeholder="https://..."
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">원문 내용 *</label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                  placeholder="실제 게시물 원문 그대로"
                  rows={5}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">반응 수치 (선택)</label>
                <input
                  value={form.engagement}
                  onChange={(e) => setForm((f) => ({ ...f, engagement: e.target.value }))}
                  placeholder="예: 967 좋아요 · 127댓글 · 45리포스트"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">왜 터졌는지 분석</label>
                <textarea
                  value={form.analysis}
                  onChange={(e) => setForm((f) => ({ ...f, analysis: e.target.value }))}
                  placeholder="첫 줄 훅 방식, 구조, 감정 트리거 등"
                  rows={3}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowForm(false)} className="flex-1 border border-neutral-200 text-xs font-black py-3 rounded-lg">
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.account_name.trim() || !form.content.trim()}
                className="flex-1 bg-black text-white text-xs font-black py-3 rounded-lg disabled:opacity-40"
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
