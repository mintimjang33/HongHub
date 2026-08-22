'use client';

import { useEffect, useState } from 'react';

type Site = {
  id: string;
  name: string;
  admin_email: string | null;
  github_url: string | null;
  vercel_url: string | null;
  live_url: string | null;
  supabase_url: string | null;
  benchmark_url: string | null;
  notes: string | null;
  start_date: string | null;
  plan_file_url: string | null;
  plan_file_name: string | null;
};

const KNOWN_EMAILS = [
  'mintimjang33@gmail.com',
  'minsiljang0@gmail.com',
  'minssajang@gmail.com',
  'minsiljjang@gmail.com',
  'jiphj0307@gmail.com',
  'afterschool.rollbook@gmail.com',
  'ssajuboyz@gmail.com',
  'poohssam79@gmail.com',
  'helpfulfood365@gmail.com',
];

const QUICK_LINKS = [
  { label: '유튜브', icon: '▶️', url: 'https://studio.youtube.com' },
  { label: '인스타그램', icon: '📸', url: 'https://www.instagram.com' },
  { label: '쓰레드', icon: '🧵', url: 'https://www.threads.com' },
  { label: '페이스북', icon: '📘', url: 'https://www.facebook.com' },
  { label: '틱톡', icon: '🎵', url: 'https://www.tiktok.com/upload' },
  { label: '네이버 블로그', icon: 'N', url: 'https://blog.naver.com' },
];

const GUIDE_DOCS = [
  { label: '클론 진행 프로세스', desc: '사이트를 클론할 때 거치는 표준 절차', icon: '🧭', url: '/docs/CLONE_PROCESS.md' },
  { label: 'MCP 만드는 법', desc: '새 프로젝트에 MCP 서버 붙이는 방법', icon: '🔌', url: '/docs/MCP_GUIDE.md' },
  { label: '크론/예약작업 가이드', desc: '반복 실행 기능 붙일 때 필수 절차', icon: '⏰', url: '/docs/CRON_GUIDE.md' },
  { label: '계획서 작성 템플릿', desc: '사이트 등록 시 계획서 표준 양식', icon: '📄', url: '/PLAN_TEMPLATE.md' },
];

const LINK_FIELDS: { key: keyof Site; label: string; icon: string }[] = [
  { key: 'live_url', label: '접속', icon: '🌐' },
  { key: 'github_url', label: '깃허브', icon: '🐙' },
  { key: 'vercel_url', label: '배포', icon: '▲' },
  { key: 'supabase_url', label: '슈퍼베이스', icon: '🗄️' },
  { key: 'benchmark_url', label: '벤치마킹', icon: '🔍' },
];

const EMPTY_FORM = {
  name: '',
  admin_email: '',
  github_url: '',
  vercel_url: '',
  live_url: '',
  supabase_url: '',
  benchmark_url: '',
  notes: '',
  start_date: '',
  plan_file_url: '',
  plan_file_name: '',
};

export default function Home() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  function load() {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => setSites(d.sites || []))
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
      name: s.name || '',
      admin_email: s.admin_email || '',
      github_url: s.github_url || '',
      vercel_url: s.vercel_url || '',
      live_url: s.live_url || '',
      supabase_url: s.supabase_url || '',
      benchmark_url: s.benchmark_url || '',
      notes: s.notes || '',
      start_date: s.start_date || '',
      plan_file_url: s.plan_file_url || '',
      plan_file_name: s.plan_file_name || '',
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await fetch(`/api/sites/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
      } else {
        await fetch('/api/sites', {
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

  async function handleFileUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '업로드 실패');
      setForm((f) => ({ ...f, plan_file_url: data.url, plan_file_name: data.name }));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('이 사이트를 목록에서 삭제할까요?')) return;
    await fetch(`/api/sites/${id}`, { method: 'DELETE' });
    load();
  }

  const groups: { email: string; sites: Site[] }[] = [];
  for (const email of KNOWN_EMAILS) {
    const matched = sites.filter((s) => s.admin_email === email);
    if (matched.length > 0) groups.push({ email, sites: matched });
  }
  for (const s of sites) {
    const email = s.admin_email || '';
    if ((!email || !KNOWN_EMAILS.includes(email)) && !groups.some((g) => g.email === (email || '__unassigned__'))) {
      const key = email || '__unassigned__';
      groups.push({ email: key, sites: sites.filter((x) => (x.admin_email || '__unassigned__') === key) });
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-black">🏠 HongHub</h1>
            <p className="text-xs text-neutral-400 mt-1">내 사이트/프로젝트 계정을 한눈에 모아보는 관리 허브</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={openAdd} className="bg-black text-white text-xs font-black px-5 py-3 rounded-lg hover:bg-neutral-800">
              + 사이트 추가
            </button>
            <button
              onClick={() => fetch('/api/auth/logout', { method: 'POST' }).then(() => (window.location.href = '/login'))}
              className="text-xs text-neutral-400 font-bold px-3 py-3 hover:text-black"
            >
              로그아웃
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-8">
          {QUICK_LINKS.map((l) => (
            <a
              key={l.label}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-bold bg-white border border-neutral-200 hover:border-neutral-400 px-4 py-2.5 rounded-full shadow-sm"
            >
              <span>{l.icon}</span> {l.label}
            </a>
          ))}
        </div>

        <div className="mb-8">
          <h2 className="text-xs font-black text-neutral-400 mb-3">📚 가이드 문서</h2>
          <div className="grid md:grid-cols-4 gap-3">
            {GUIDE_DOCS.map((d) => (
              <a
                key={d.url}
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-white border border-neutral-200 hover:border-neutral-400 rounded-xl p-4 shadow-sm"
              >
                <div className="text-xl mb-1">{d.icon}</div>
                <div className="text-xs font-black mb-1">{d.label}</div>
                <div className="text-[11px] text-neutral-400">{d.desc}</div>
              </a>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-neutral-400 text-center py-20">불러오는 중...</div>
        ) : sites.length === 0 ? (
          <div className="border border-dashed border-neutral-300 rounded-xl p-16 text-center text-sm text-neutral-400">
            아직 등록된 사이트가 없어요. &quot;+ 사이트 추가&quot;로 시작해보세요.
          </div>
        ) : (
          <div className="space-y-8">
            {groups.map((g) => (
              <div key={g.email}>
                <h2 className="text-xs font-black text-neutral-400 mb-3 flex items-center gap-2">
                  {g.email === '__unassigned__' ? '📭 미분류' : `✉️ ${g.email}`}
                  <span className="font-normal">({g.sites.length})</span>
                </h2>
                <div className="grid md:grid-cols-2 gap-4">
                  {g.sites.map((s) => (
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
                        {s.plan_file_url && (
                          <a href={s.plan_file_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 font-bold hover:underline">
                            📎 {s.plan_file_name || '계획서'}
                          </a>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {LINK_FIELDS.map((f) => {
                          const url = s[f.key] as string | null;
                          if (!url) return null;
                          return (
                            <a
                              key={f.key}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] font-bold bg-neutral-100 hover:bg-neutral-200 px-3 py-1.5 rounded-full"
                            >
                              {f.icon} {f.label}
                            </a>
                          );
                        })}
                      </div>
                      {s.notes && (
                        <p className="text-xs text-neutral-500 whitespace-pre-wrap border-t border-neutral-100 pt-3">{s.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white p-6 max-w-md w-full rounded-xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-black mb-4">{editingId ? '사이트 수정' : '+ 사이트 추가'}</h2>
            <div className="space-y-3">
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="사이트/프로젝트 이름 *"
                className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
              />
              <input
                value={form.admin_email}
                onChange={(e) => setForm((f) => ({ ...f, admin_email: e.target.value }))}
                placeholder="관리 이메일"
                list="known-emails"
                className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
              />
              <datalist id="known-emails">
                {KNOWN_EMAILS.map((e) => (
                  <option key={e} value={e} />
                ))}
              </datalist>
              <input
                value={form.live_url}
                onChange={(e) => setForm((f) => ({ ...f, live_url: e.target.value }))}
                placeholder="접속 URL (https://...)"
                className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
              />
              <input
                value={form.github_url}
                onChange={(e) => setForm((f) => ({ ...f, github_url: e.target.value }))}
                placeholder="깃허브 URL"
                className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
              />
              <input
                value={form.vercel_url}
                onChange={(e) => setForm((f) => ({ ...f, vercel_url: e.target.value }))}
                placeholder="배포(Vercel) URL"
                className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
              />
              <input
                value={form.supabase_url}
                onChange={(e) => setForm((f) => ({ ...f, supabase_url: e.target.value }))}
                placeholder="슈퍼베이스 대시보드 URL (supabase.com/dashboard/project/...)"
                className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
              />
              <input
                value={form.benchmark_url}
                onChange={(e) => setForm((f) => ({ ...f, benchmark_url: e.target.value }))}
                placeholder="벤치마킹 URL"
                className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
              />
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">시작 날짜</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="메모"
                rows={3}
                className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
              />
              <div className="border-t border-neutral-100 pt-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] text-neutral-400 font-bold">계획서 파일</label>
                  <a href="/PLAN_TEMPLATE.md" target="_blank" className="text-[11px] text-blue-500 font-bold hover:underline">
                    📄 표준 템플릿 보기
                  </a>
                </div>
                {form.plan_file_url ? (
                  <div className="flex items-center justify-between bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-xs">
                    <a href={form.plan_file_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 font-bold truncate">
                      📎 {form.plan_file_name}
                    </a>
                    <button
                      onClick={() => setForm((f) => ({ ...f, plan_file_url: '', plan_file_name: '' }))}
                      className="text-red-400 font-bold ml-2 flex-shrink-0"
                    >
                      제거
                    </button>
                  </div>
                ) : (
                  <input
                    type="file"
                    onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                    disabled={uploading}
                    className="w-full text-xs"
                  />
                )}
                {uploading && <div className="text-[11px] text-neutral-400 mt-1">업로드 중...</div>}
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
