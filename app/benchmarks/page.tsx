'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Benchmark = {
  id: string;
  name: string;
  url: string;
  type: string;
  status: string;
  notes: string | null;
  site_id: string | null;
  source_name: string | null;
  source_urls: string[] | null;
  kind: string;
};

type Site = { id: string; name: string };

const TYPES = [
  { value: 'github', label: '🐙 깃허브', icon: '🐙' },
  { value: 'site', label: '🌐 사이트', icon: '🌐' },
  { value: 'notion', label: '📓 노션', icon: '📓' },
  { value: 'other', label: '📦 기타', icon: '📦' },
];

const STATUSES = ['후보', '검토중', '클론예정', '완료', '보류'];

const EMPTY_FORM = { name: '', url: '', type: 'site', status: '후보', notes: '', site_id: '', source_name: '', source_urls: '' };

function typeMeta(type: string) {
  return TYPES.find((t) => t.value === type) || TYPES[3];
}

export default function BenchmarksPage() {
  const [items, setItems] = useState<Benchmark[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [filterType, setFilterType] = useState<string>('all');

  function load() {
    Promise.all([
      fetch('/api/benchmarks').then((r) => r.json()),
      fetch('/api/sites').then((r) => r.json()),
    ])
      .then(([b, s]) => {
        setItems((b.benchmarks || []).filter((x: Benchmark) => x.kind !== 'account_collection'));
        setSites(s.sites || []);
      })
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

  function openEdit(b: Benchmark) {
    setEditingId(b.id);
    setForm({
      name: b.name || '',
      url: b.url || '',
      type: b.type || 'site',
      status: b.status || '후보',
      notes: b.notes || '',
      site_id: b.site_id || '',
      source_name: b.source_name || '',
      source_urls: (b.source_urls || []).join('\n'),
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.url.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        source_urls: form.source_urls.split('\n').map((s) => s.trim()).filter(Boolean),
      };
      if (editingId) {
        await fetch(`/api/benchmarks/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch('/api/benchmarks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      setShowForm(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('이 벤치마킹 아이템을 삭제할까요?')) return;
    await fetch(`/api/benchmarks/${id}`, { method: 'DELETE' });
    load();
  }

  const filtered = filterType === 'all' ? items : items.filter((i) => i.type === filterType);
  const siteName = (id: string | null) => sites.find((s) => s.id === id)?.name;

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/" className="text-xs text-neutral-400 font-bold hover:text-black">
              ← HongHub
            </Link>
            <h1 className="text-2xl font-black mt-1">🔍 벤치마킹 아이템</h1>
            <p className="text-xs text-neutral-400 mt-1">깃허브/사이트/노션 등 나중에 벤치마킹할 후보를 모아두는 곳</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={openAdd} className="bg-black text-white text-xs font-black px-5 py-3 rounded-lg hover:bg-neutral-800">
              + 아이템 추가
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setFilterType('all')}
            className={`text-xs font-bold px-4 py-2 rounded-full border ${filterType === 'all' ? 'bg-black text-white border-black' : 'bg-white border-neutral-200'}`}
          >
            전체 ({items.length})
          </button>
          {TYPES.map((t) => {
            const count = items.filter((i) => i.type === t.value).length;
            if (count === 0) return null;
            return (
              <button
                key={t.value}
                onClick={() => setFilterType(t.value)}
                className={`text-xs font-bold px-4 py-2 rounded-full border ${filterType === t.value ? 'bg-black text-white border-black' : 'bg-white border-neutral-200'}`}
              >
                {t.label} ({count})
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="text-sm text-neutral-400 text-center py-20">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="border border-dashed border-neutral-300 rounded-xl p-16 text-center text-sm text-neutral-400">
            아직 등록된 벤치마킹 아이템이 없어요. &quot;+ 아이템 추가&quot;로 시작해보세요.
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {filtered.map((b) => (
              <div key={b.id} className="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-start justify-between mb-2">
                  <a href={b.url} target="_blank" rel="noopener noreferrer" className="font-black text-base hover:underline">
                    {typeMeta(b.type).icon} {b.name}
                  </a>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => openEdit(b)} className="text-[11px] text-neutral-400 font-bold hover:text-black">
                      수정
                    </button>
                    <button onClick={() => handleDelete(b.id)} className="text-[11px] text-red-400 font-bold hover:text-red-600">
                      삭제
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-[11px] font-bold bg-neutral-100 px-3 py-1 rounded-full">{b.status}</span>
                  {b.site_id && siteName(b.site_id) && (
                    <span className="text-[11px] font-bold bg-blue-50 text-blue-600 px-3 py-1 rounded-full">🔗 {siteName(b.site_id)}</span>
                  )}
                </div>
                <a href={b.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-neutral-400 hover:underline break-all">
                  {b.url}
                </a>
                {b.source_name && (
                  <div className="text-[11px] text-neutral-500 mt-2 pt-2 border-t border-neutral-100">
                    <span className="font-bold">📍 출처: {b.source_name}</span>
                    {(b.source_urls || []).length > 0 && (
                      <div className="flex flex-wrap gap-x-2 mt-1">
                        {(b.source_urls || []).map((u) => (
                          <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline break-all">
                            {u}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {b.notes && <p className="text-xs text-neutral-500 whitespace-pre-wrap border-t border-neutral-100 mt-3 pt-3">{b.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white p-6 max-w-md w-full rounded-xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-black mb-4">{editingId ? '아이템 수정' : '+ 아이템 추가'}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">이름 *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="이름"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">URL *</label>
                <input
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://..."
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-neutral-400 font-bold mb-1 block">종류</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                  >
                    {TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-neutral-400 font-bold mb-1 block">상태</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">관련 프로젝트 (선택)</label>
                <select
                  value={form.site_id}
                  onChange={(e) => setForm((f) => ({ ...f, site_id: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                >
                  <option value="">미지정</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="border-t border-neutral-100 pt-3">
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">출처 이름 (어디서 찾았는지, 선택)</label>
                <input
                  value={form.source_name}
                  onChange={(e) => setForm((f) => ({ ...f, source_name: e.target.value }))}
                  placeholder="예: 남다른AI (유튜브 채널명)"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">출처 링크 (한 줄에 하나씩, 여러 개 가능)</label>
                <textarea
                  value={form.source_urls}
                  onChange={(e) => setForm((f) => ({ ...f, source_urls: e.target.value }))}
                  placeholder={'https://youtube.com/@...\nhttps://blog...'}
                  rows={3}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">메모</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="이 아이템의 활용 방안, 눈여겨본 이유 등"
                  rows={4}
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
                disabled={saving || !form.name.trim() || !form.url.trim()}
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
