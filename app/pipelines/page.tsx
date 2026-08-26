'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Site = {
  id: string;
  name: string;
  admin_email: string | null;
  benchmark_url: string[] | null;
  notes: string | null;
  start_date: string | null;
  plan_content: string | null;
};

// 콘텐츠 파이프라인(코드 프로젝트가 아닌 채널/워크플로) 항목은
// notes에 이 마커가 들어있는 hub_sites 레코드로 식별한다.
const PIPELINE_MARKER = '코드 프로젝트 아님';

const EMPTY_FORM = {
  name: '',
  admin_email: 'mintimjang33@gmail.com',
  benchmark_url: [''] as string[],
  notes: '',
  start_date: '',
};

export default function PipelinesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function load() {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => {
        const all: Site[] = d.sites || [];
        setSites(all.filter((s) => (s.notes || '').includes(PIPELINE_MARKER)));
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

  function openEdit(s: Site) {
    setEditingId(s.id);
    setForm({
      name: s.name,
      admin_email: s.admin_email || 'mintimjang33@gmail.com',
      benchmark_url: s.benchmark_url && s.benchmark_url.length > 0 ? s.benchmark_url : [''],
      notes: (s.notes || '').replace(PIPELINE_MARKER, '').replace(/^[\s—–-]+/, ''),
      start_date: s.start_date || '',
    });
    setShowForm(true);
  }

  function setUrlValue(i: number, value: string) {
    setForm((f) => {
      const next = [...f.benchmark_url];
      next[i] = value;
      return { ...f, benchmark_url: next };
    });
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const extraNotes = form.notes.trim();
      const notes = `코드 프로젝트 아님 — 콘텐츠 파이프라인.${extraNotes ? ' ' + extraNotes : ''}`;
      const payload = {
        name: form.name.trim(),
        admin_email: form.admin_email || null,
        benchmark_url: form.benchmark_url.map((v) => v.trim()).filter(Boolean),
        notes,
        start_date: form.start_date || null,
      };
      if (editingId) {
        await fetch(`/api/sites/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch('/api/sites', {
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
    if (!confirm('이 파이프라인을 목록에서 삭제할까요?')) return;
    await fetch(`/api/sites/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-black">🧪 파이프라인</h1>
            <p className="text-xs text-neutral-400 mt-1">
              코드가 아니라 &quot;벤치마크 채널 + 제작 워크플로&quot;로 굴리는 콘텐츠 파이프라인 모음
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/" className="text-xs font-black px-5 py-3 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white">
              🏠 홈으로
            </Link>
            <button onClick={openAdd} className="bg-black text-white text-xs font-black px-5 py-3 rounded-lg hover:bg-neutral-800">
              + 파이프라인 추가
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-neutral-400 text-center py-20">불러오는 중...</div>
        ) : sites.length === 0 ? (
          <div className="border border-dashed border-neutral-300 rounded-xl p-16 text-center text-sm text-neutral-400">
            아직 등록된 파이프라인이 없어요. &quot;+ 파이프라인 추가&quot;로 시작해보세요.
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {sites.map((s) => (
              <div key={s.id} className="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-black text-base">{s.name}</h3>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => openEdit(s)} className="text-[11px] text-neutral-400 font-bold hover:text-black">
                      수정
                    </button>
                    <button onClick={() => handleDelete(s.id)} className="text-[11px] text-red-400 font-bold hover:text-red-600">
                      삭제
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-3 text-[11px] text-neutral-400 mb-3">
                  {s.start_date && <span>📅 {s.start_date} 시작</span>}
                  <Link href={`/plan/${s.id}`} className="text-blue-500 font-bold hover:underline">
                    📋 {s.plan_content ? '계획서 보기' : '계획서 작성'}
                  </Link>
                </div>
                {s.benchmark_url && s.benchmark_url.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {s.benchmark_url.map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-bold bg-neutral-100 hover:bg-neutral-200 px-3 py-1.5 rounded-full"
                      >
                        🔍 벤치마킹{s.benchmark_url && s.benchmark_url.length > 1 ? ` ${i + 1}` : ''}
                      </a>
                    ))}
                  </div>
                )}
                {s.notes && (
                  <p className="text-xs text-neutral-500 whitespace-pre-wrap border-t border-neutral-100 pt-3">{s.notes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white p-6 max-w-md w-full rounded-xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-black mb-4">{editingId ? '파이프라인 수정' : '+ 파이프라인 추가'}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">이름 *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="예: 경제학쇼츠"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">관리 이메일</label>
                <input
                  value={form.admin_email}
                  onChange={(e) => setForm((f) => ({ ...f, admin_email: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">시작일</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">🔍 벤치마킹 채널 URL</label>
                <div className="space-y-1.5">
                  {form.benchmark_url.map((v, i) => (
                    <input
                      key={i}
                      value={v}
                      onChange={(e) => setUrlValue(i, e.target.value)}
                      placeholder="https://www.youtube.com/@..."
                      className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, benchmark_url: [...f.benchmark_url, ''] }))}
                    className="text-[11px] text-blue-500 font-bold hover:underline"
                  >
                    + 벤치마킹 URL 추가
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">메모</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 border border-neutral-200 rounded-lg py-2.5 text-sm font-bold hover:bg-neutral-50"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                className="flex-1 bg-black text-white rounded-lg py-2.5 text-sm font-bold hover:bg-neutral-800 disabled:opacity-40"
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
