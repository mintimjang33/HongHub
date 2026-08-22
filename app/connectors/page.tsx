'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Connector = {
  id: string;
  name: string;
  tags: string[] | null;
  connected: boolean;
  site_id: string | null;
  notes: string | null;
};

type Site = { id: string; name: string };

const EMPTY_FORM = { name: '', tags: '', connected: true, site_id: '', notes: '' };

export default function ConnectorsPage() {
  const [items, setItems] = useState<Connector[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function load() {
    Promise.all([
      fetch('/api/mcp-connectors').then((r) => r.json()),
      fetch('/api/sites').then((r) => r.json()),
    ])
      .then(([c, s]) => {
        setItems(c.connectors || []);
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

  function openEdit(c: Connector) {
    setEditingId(c.id);
    setForm({
      name: c.name || '',
      tags: (c.tags || []).join(', '),
      connected: c.connected,
      site_id: c.site_id || '',
      notes: c.notes || '',
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      if (editingId) {
        await fetch(`/api/mcp-connectors/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch('/api/mcp-connectors', {
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
    if (!confirm('이 커넥터 기록을 삭제할까요?')) return;
    await fetch(`/api/mcp-connectors/${id}`, { method: 'DELETE' });
    load();
  }

  const siteName = (id: string | null) => sites.find((s) => s.id === id)?.name;

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/" className="text-xs text-neutral-400 font-bold hover:text-black">
              ← HongHub
            </Link>
            <h1 className="text-2xl font-black mt-1">🔌 연결된 MCP 커넥터</h1>
            <p className="text-xs text-neutral-400 mt-1">Claude에 연결해둔 MCP 커넥터 목록 기록</p>
          </div>
          <button onClick={openAdd} className="bg-black text-white text-xs font-black px-5 py-3 rounded-lg hover:bg-neutral-800">
            + 커넥터 추가
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-neutral-400 text-center py-20">불러오는 중...</div>
        ) : items.length === 0 ? (
          <div className="border border-dashed border-neutral-300 rounded-xl p-16 text-center text-sm text-neutral-400">
            아직 기록된 커넥터가 없어요. &quot;+ 커넥터 추가&quot;로 시작해보세요.
          </div>
        ) : (
          <div className="bg-white border border-neutral-200 rounded-xl divide-y divide-neutral-100 shadow-sm">
            {items.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.connected ? 'bg-green-500' : 'bg-neutral-300'}`} />
                  <div className="min-w-0">
                    <div className="font-bold text-sm truncate">{c.name}</div>
                    {(c.notes || (c.site_id && siteName(c.site_id))) && (
                      <div className="text-[11px] text-neutral-400 truncate">
                        {c.site_id && siteName(c.site_id) && <span className="text-blue-500 font-bold">🔗 {siteName(c.site_id)} </span>}
                        {c.notes}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {(c.tags || []).map((t) => (
                    <span key={t} className="text-[11px] font-bold bg-neutral-100 text-neutral-500 px-2.5 py-1 rounded-full">
                      {t}
                    </span>
                  ))}
                  <button onClick={() => openEdit(c)} className="text-[11px] text-neutral-400 font-bold hover:text-black">
                    수정
                  </button>
                  <button onClick={() => handleDelete(c.id)} className="text-[11px] text-red-400 font-bold hover:text-red-600">
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white p-6 max-w-md w-full rounded-xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-black mb-4">{editingId ? '커넥터 수정' : '+ 커넥터 추가'}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">이름 *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="예: 제철먹거리-Mcp"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">태그 (쉼표로 구분)</label>
                <input
                  value={form.tags}
                  onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                  placeholder="웹, 사용자정의"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
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
              <label className="flex items-center gap-2 text-xs font-bold">
                <input
                  type="checkbox"
                  checked={form.connected}
                  onChange={(e) => setForm((f) => ({ ...f, connected: e.target.checked }))}
                />
                연결됨
              </label>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">메모</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="이 커넥터가 뭐 하는 건지, 어느 프로젝트인지 등"
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
                disabled={saving || !form.name.trim()}
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
