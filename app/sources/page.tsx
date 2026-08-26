'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

// ---- 타입 ----
type Channel = {
  id: string;
  name: string;
  platform: string;
  url: string | null;
  subscriber_count: string | null;
  content_types: string[];
  platform_fit: string[];
  notes: string | null;
  status: string;
};

type SourceItem = {
  id: string;
  channel_id: string | null;
  title: string;
  source_url: string | null;
  views: string | null;
  content_type: string | null;
  platform_fit: string[];
  raw_notes: string | null;
  status: string;
};

type Persona = {
  id: string;
  name: string;
  is_system: boolean;
};

type GeneratedContent = {
  id: string;
  source_item_id: string | null;
  persona_name: string;
  target_platform: string;
  ai_provider?: string;
  generated_text: string;
  status: string;
  created_at: string;
};

// ---- 상수 ----
const CONTENT_TYPES = ['TRIVIA', 'LIFEHACK', 'EMOTIONAL', 'HUMOR', 'MOTIVATION', 'RANKING', 'PERSONAL_STORY', 'DEBATE'];
const CONTENT_TYPE_LABEL: Record<string, string> = {
  TRIVIA: '🧠 잡학/반전',
  LIFEHACK: '🛠 생활꿀팁',
  EMOTIONAL: '🥹 감동',
  HUMOR: '😂 유머',
  MOTIVATION: '🔥 동기부여',
  RANKING: '📊 랭킹형',
  PERSONAL_STORY: '📖 경험담',
  DEBATE: '💬 논쟁형',
};

const PLATFORMS = [
  { value: 'threads', label: '🧵 쓰레드' },
  { value: 'youtube_shorts', label: '▶️ 유튜브쇼츠' },
  { value: 'tiktok', label: '🎵 틱톡' },
  { value: 'instagram', label: '📷 인스타' },
];

const CHANNEL_PLATFORMS = ['youtube', 'tiktok', 'instagram', 'threads', 'community'];

// 채널 notes 맨 앞의 "[파이프라인:이름]" 태그로 그룹을 판별한다.
const CHANNEL_TAG_RE = /^\[파이프라인:([^\]]+)\]/;
function channelGroup(c: Channel): string {
  return c.notes?.match(CHANNEL_TAG_RE)?.[1] || '미분류';
}

const TABS = [
  { value: 'channels', label: '1. 소스 채널' },
  { value: 'items', label: '2. 소재 큐레이션' },
  { value: 'generate', label: '3. 콘텐츠 생성' },
];

export default function SourcesPage() {
  const [tab, setTab] = useState('channels');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [items, setItems] = useState<SourceItem[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [contents, setContents] = useState<GeneratedContent[]>([]);
  const [loading, setLoading] = useState(true);

  function loadAll() {
    setLoading(true);
    Promise.all([
      fetch('/api/source-channels').then((r) => r.json()),
      fetch('/api/source-items').then((r) => r.json()),
      fetch('/api/personas').then((r) => r.json()),
      fetch('/api/generate-content').then((r) => r.json()),
    ])
      .then(([c, i, p, g]) => {
        setChannels(c.channels || []);
        setItems(i.items || []);
        setPersonas(p.personas || []);
        setContents(g.contents || []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadAll();
  }, []);

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="mb-8">
          <Link href="/" className="text-xs text-neutral-400 font-bold hover:text-black">
            ← HongHub
          </Link>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-black mt-1">🎯 소스 발굴 & 콘텐츠 생성</h1>
            <div className="flex items-center gap-2">
              <Link
                href="/viral-posts"
                className="text-xs font-black px-4 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white"
              >
                🔥 터진 글 분석
              </Link>
              <Link
                href="/benchmarks/accounts"
                className="text-xs font-black px-4 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white"
              >
                👥 계정 모음
              </Link>
              <a
                href="/docs/SOURCE_DISCOVERY_GUIDE.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-black text-blue-500 hover:underline"
              >
                📖 운영 가이드 보기
              </a>
            </div>
          </div>
          <p className="text-xs text-neutral-400 mt-1">
            채널을 찾아 분류하고, 소재를 골라 페르소나에 맞는 플랫폼별 콘텐츠로 만든다
          </p>
        </div>

        <div className="flex gap-2 mb-6">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`text-xs font-black px-5 py-3 rounded-lg border ${
                tab === t.value ? 'bg-black text-white border-black' : 'bg-white border-neutral-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-sm text-neutral-400 text-center py-20">불러오는 중...</div>
        ) : (
          <>
            {tab === 'channels' && <ChannelsTab channels={channels} onChange={loadAll} />}
            {tab === 'items' && <ItemsTab items={items} channels={channels} onChange={loadAll} />}
            {tab === 'generate' && (
              <GenerateTab items={items} personas={personas} contents={contents} onChange={loadAll} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ============ 탭 1: 채널 ============
function ChannelsTab({ channels, onChange }: { channels: Channel[]; onChange: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filterPlatform, setFilterPlatform] = useState('all');
  const [filterGroup, setFilterGroup] = useState('all');
  const [form, setForm] = useState({
    name: '',
    platform: 'youtube',
    url: '',
    subscriber_count: '',
    content_types: [] as string[],
    platform_fit: [] as string[],
    notes: '',
    status: '후보',
  });

  function openAdd() {
    setEditingId(null);
    setForm({ name: '', platform: 'youtube', url: '', subscriber_count: '', content_types: [], platform_fit: [], notes: '', status: '후보' });
    setShowForm(true);
  }

  function openEdit(c: Channel) {
    setEditingId(c.id);
    setForm({
      name: c.name,
      platform: c.platform,
      url: c.url || '',
      subscriber_count: c.subscriber_count || '',
      content_types: c.content_types || [],
      platform_fit: c.platform_fit || [],
      notes: c.notes || '',
      status: c.status,
    });
    setShowForm(true);
  }

  function toggleTag(list: string[], value: string, setter: (v: string[]) => void) {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await fetch(`/api/source-channels/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
      } else {
        await fetch('/api/source-channels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
      }
      setShowForm(false);
      onChange();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('이 채널을 삭제할까요? (연결된 소재는 유지됩니다)')) return;
    await fetch(`/api/source-channels/${id}`, { method: 'DELETE' });
    onChange();
  }

  const byGroup = filterGroup === 'all' ? channels : channels.filter((c) => channelGroup(c) === filterGroup);
  const filtered = filterPlatform === 'all' ? byGroup : byGroup.filter((c) => c.platform === filterPlatform);

  const groupOrder = ['공학쇼츠', '경제학쇼츠', '심리학쇼츠'];
  const groups = Array.from(new Set(channels.map(channelGroup))).sort((a, b) => {
    const ia = groupOrder.indexOf(a);
    const ib = groupOrder.indexOf(b);
    if (a === '미분류') return 1;
    if (b === '미분류') return -1;
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  return (
    <div>
      <div className="flex gap-2 mb-3 border-b border-neutral-200">
        <button
          onClick={() => setFilterGroup('all')}
          className={`text-xs font-black px-4 py-2.5 border-b-2 -mb-px ${
            filterGroup === 'all' ? 'border-black text-black' : 'border-transparent text-neutral-400 hover:text-black'
          }`}
        >
          전체 ({channels.length})
        </button>
        {groups.map((g) => {
          const count = channels.filter((c) => channelGroup(c) === g).length;
          return (
            <button
              key={g}
              onClick={() => setFilterGroup(g)}
              className={`text-xs font-black px-4 py-2.5 border-b-2 -mb-px ${
                filterGroup === g ? 'border-black text-black' : 'border-transparent text-neutral-400 hover:text-black'
              }`}
            >
              {g === '미분류' ? '📭' : '🧪'} {g} ({count})
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterPlatform('all')}
            className={`text-xs font-bold px-4 py-2 rounded-full border ${filterPlatform === 'all' ? 'bg-black text-white border-black' : 'bg-white border-neutral-200'}`}
          >
            전체 ({byGroup.length})
          </button>
          {CHANNEL_PLATFORMS.map((p) => {
            const count = byGroup.filter((c) => c.platform === p).length;
            if (count === 0) return null;
            return (
              <button
                key={p}
                onClick={() => setFilterPlatform(p)}
                className={`text-xs font-bold px-4 py-2 rounded-full border ${filterPlatform === p ? 'bg-black text-white border-black' : 'bg-white border-neutral-200'}`}
              >
                {p} ({count})
              </button>
            );
          })}
        </div>
        <button onClick={openAdd} className="bg-black text-white text-xs font-black px-5 py-3 rounded-lg hover:bg-neutral-800">
          + 채널 추가
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="border border-dashed border-neutral-300 rounded-xl p-16 text-center text-sm text-neutral-400">
          등록된 채널이 없어요. &quot;+ 채널 추가&quot;로 시작해보세요.
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {filtered.map((c) => (
            <div key={c.id} className="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-start justify-between mb-2">
                <div>
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="font-black text-base hover:underline">
                      {c.name}
                    </a>
                  ) : (
                    <span className="font-black text-base">{c.name}</span>
                  )}
                  <div className="text-[11px] text-neutral-400 mt-0.5">
                    {c.platform} {c.subscriber_count && `· 구독자 ${c.subscriber_count}`}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => openEdit(c)} className="text-[11px] text-neutral-400 font-bold hover:text-black">
                    수정
                  </button>
                  <button onClick={() => handleDelete(c.id)} className="text-[11px] text-red-400 font-bold hover:text-red-600">
                    삭제
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className="text-[11px] font-bold bg-neutral-100 px-3 py-1 rounded-full">{c.status}</span>
                {(c.notes || '').match(/^\[파이프라인:([^\]]+)\]/) && (
                  <span className="text-[11px] font-bold bg-amber-50 text-amber-600 px-3 py-1 rounded-full">
                    🧪 {(c.notes || '').match(/^\[파이프라인:([^\]]+)\]/)?.[1]}
                  </span>
                )}
                {(c.content_types || []).map((t) => (
                  <span key={t} className="text-[11px] font-bold bg-purple-50 text-purple-600 px-3 py-1 rounded-full">
                    {CONTENT_TYPE_LABEL[t] || t}
                  </span>
                ))}
              </div>
              {(c.platform_fit || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {c.platform_fit.map((p) => (
                    <span key={p} className="text-[11px] font-bold bg-blue-50 text-blue-600 px-3 py-1 rounded-full">
                      {PLATFORMS.find((pf) => pf.value === p)?.label || p}
                    </span>
                  ))}
                </div>
              )}
              {c.notes && (
                <p className="text-xs text-neutral-500 whitespace-pre-wrap border-t border-neutral-100 mt-3 pt-3">
                  {c.notes.replace(/^\[파이프라인:[^\]]+\]\s*/, '')}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white p-6 max-w-md w-full rounded-xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-black mb-4">{editingId ? '채널 수정' : '+ 채널 추가'}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">채널명 *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-neutral-400 font-bold mb-1 block">플랫폼</label>
                  <select
                    value={form.platform}
                    onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                  >
                    {CHANNEL_PLATFORMS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-neutral-400 font-bold mb-1 block">구독자수</label>
                  <input
                    value={form.subscriber_count}
                    onChange={(e) => setForm((f) => ({ ...f, subscriber_count: e.target.value }))}
                    placeholder="예: 5.2만"
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">URL</label>
                <input
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://..."
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">콘텐츠 유형 (다중 선택)</label>
                <div className="flex flex-wrap gap-1.5">
                  {CONTENT_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTag(form.content_types, t, (v) => setForm((f) => ({ ...f, content_types: v })))}
                      className={`text-[11px] font-bold px-3 py-1.5 rounded-full border ${
                        form.content_types.includes(t) ? 'bg-purple-600 text-white border-purple-600' : 'bg-white border-neutral-200'
                      }`}
                    >
                      {CONTENT_TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">잘 맞는 플랫폼 (다중 선택)</label>
                <div className="flex flex-wrap gap-1.5">
                  {PLATFORMS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => toggleTag(form.platform_fit, p.value, (v) => setForm((f) => ({ ...f, platform_fit: v })))}
                      className={`text-[11px] font-bold px-3 py-1.5 rounded-full border ${
                        form.platform_fit.includes(p.value) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-neutral-200'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
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

// ============ 탭 2: 소재 ============
function ItemsTab({ items, channels, onChange }: { items: SourceItem[]; channels: Channel[]; onChange: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [importUrls, setImportUrls] = useState('');
  const [importProvider, setImportProvider] = useState<'claude' | 'gemini'>('claude');
  const [importing, setImporting] = useState(false);
  const [importLog, setImportLog] = useState<{ url: string; status: 'ok' | 'dup' | 'error'; message: string }[]>([]);
  const [form, setForm] = useState({
    channel_id: '',
    title: '',
    source_url: '',
    views: '',
    content_type: 'TRIVIA',
    platform_fit: [] as string[],
    raw_notes: '',
  });

  function toggleTag(list: string[], value: string, setter: (v: string[]) => void) {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function handleImport() {
    const urls = importUrls
      .split('\n')
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length === 0) return;

    setImporting(true);
    setImportLog([]);
    for (const url of urls) {
      try {
        const res = await fetch('/api/import-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, ai_provider: importProvider }),
        });
        const data = await res.json();
        if (!res.ok) {
          setImportLog((log) => [...log, { url, status: 'error', message: data.error || '실패' }]);
        } else if (data.duplicate) {
          setImportLog((log) => [...log, { url, status: 'dup', message: `이미 등록됨: ${data.item.title}` }]);
        } else {
          setImportLog((log) => [
            ...log,
            { url, status: 'ok', message: `등록됨: ${data.item.title} [${CONTENT_TYPE_LABEL[data.item.content_type] || data.item.content_type}]` },
          ]);
        }
      } catch (err) {
        setImportLog((log) => [...log, { url, status: 'error', message: err instanceof Error ? err.message : String(err) }]);
      }
    }
    setImporting(false);
    setImportUrls('');
    onChange();
  }

  async function handleSave() {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/source-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, channel_id: form.channel_id || null }),
      });
      setShowForm(false);
      setForm({ channel_id: '', title: '', source_url: '', views: '', content_type: 'TRIVIA', platform_fit: [], raw_notes: '' });
      onChange();
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(id: string, status: string) {
    await fetch(`/api/source-items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    onChange();
  }

  async function handleDelete(id: string) {
    if (!confirm('이 소재를 삭제할까요?')) return;
    await fetch(`/api/source-items/${id}`, { method: 'DELETE' });
    onChange();
  }

  const STATUSES = ['미가공', '가공완료', '발행완료'];
  const filtered = filterStatus === 'all' ? items : items.filter((i) => i.status === filterStatus);
  const channelName = (id: string | null) => channels.find((c) => c.id === id)?.name;

  return (
    <div>
      <div className="bg-white border border-neutral-200 rounded-xl p-5 mb-4">
        <h3 className="font-black text-sm mb-1">🔗 링크로 가져오기</h3>
        <p className="text-[11px] text-neutral-400 mb-3">
          쓰레드/유튜브/틱톡/인스타 링크를 한 줄에 하나씩 붙여넣으면, 이미 등록된 건 건너뛰고 새 것만 자동 분석해서 등록해요.
        </p>
        <textarea
          value={importUrls}
          onChange={(e) => setImportUrls(e.target.value)}
          rows={4}
          placeholder={'https://www.youtube.com/watch?v=...\nhttps://www.threads.com/@.../post/...'}
          className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm mb-2 font-mono"
        />
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setImportProvider('claude')}
              className={`text-[11px] font-black px-3 py-1.5 rounded-full border ${
                importProvider === 'claude' ? 'bg-black text-white border-black' : 'bg-white border-neutral-200'
              }`}
            >
              🟣 Claude로 분류
            </button>
            <button
              type="button"
              onClick={() => setImportProvider('gemini')}
              className={`text-[11px] font-black px-3 py-1.5 rounded-full border ${
                importProvider === 'gemini' ? 'bg-black text-white border-black' : 'bg-white border-neutral-200'
              }`}
            >
              🔵 Gemini로 분류
            </button>
          </div>
          <button
            onClick={handleImport}
            disabled={importing || !importUrls.trim()}
            className="bg-black text-white text-xs font-black px-5 py-2.5 rounded-lg disabled:opacity-40"
          >
            {importing ? '가져오는 중...' : '가져오기'}
          </button>
        </div>
        {importLog.length > 0 && (
          <div className="mt-3 space-y-1 border-t border-neutral-100 pt-3">
            {importLog.map((log, i) => (
              <div
                key={i}
                className={`text-[11px] font-bold ${
                  log.status === 'ok' ? 'text-emerald-600' : log.status === 'dup' ? 'text-neutral-400' : 'text-red-500'
                }`}
              >
                {log.status === 'ok' ? '✅' : log.status === 'dup' ? '⏭️' : '❌'} {log.message}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterStatus('all')}
            className={`text-xs font-bold px-4 py-2 rounded-full border ${filterStatus === 'all' ? 'bg-black text-white border-black' : 'bg-white border-neutral-200'}`}
          >
            전체 ({items.length})
          </button>
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`text-xs font-bold px-4 py-2 rounded-full border ${filterStatus === s ? 'bg-black text-white border-black' : 'bg-white border-neutral-200'}`}
            >
              {s} ({items.filter((i) => i.status === s).length})
            </button>
          ))}
        </div>
        <button onClick={() => setShowForm(true)} className="bg-black text-white text-xs font-black px-5 py-3 rounded-lg hover:bg-neutral-800">
          + 소재 직접 추가
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="border border-dashed border-neutral-300 rounded-xl p-16 text-center text-sm text-neutral-400">
          등록된 소재가 없어요.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((it) => (
            <div key={it.id} className="bg-white border border-neutral-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="font-bold text-sm">{it.title}</div>
                  <div className="text-[11px] text-neutral-400 mt-1">
                    {channelName(it.channel_id) && `${channelName(it.channel_id)} · `}
                    {it.views && `조회수 ${it.views}`}
                  </div>
                  {it.raw_notes && <p className="text-xs text-neutral-500 mt-2 whitespace-pre-wrap">{it.raw_notes}</p>}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {it.content_type && (
                      <span className="text-[11px] font-bold bg-purple-50 text-purple-600 px-3 py-1 rounded-full">
                        {CONTENT_TYPE_LABEL[it.content_type] || it.content_type}
                      </span>
                    )}
                    {(it.platform_fit || []).map((p) => (
                      <span key={p} className="text-[11px] font-bold bg-blue-50 text-blue-600 px-3 py-1 rounded-full">
                        {PLATFORMS.find((pf) => pf.value === p)?.label || p}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0 ml-3">
                  <select
                    value={it.status}
                    onChange={(e) => updateStatus(it.id, e.target.value)}
                    className="text-[11px] font-bold border border-neutral-200 rounded-lg px-2 py-1.5"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => handleDelete(it.id)} className="text-[11px] text-red-400 font-bold hover:text-red-600">
                    삭제
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white p-6 max-w-md w-full rounded-xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-black mb-4">+ 소재 추가</h2>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">채널 (선택)</label>
                <select
                  value={form.channel_id}
                  onChange={(e) => setForm((f) => ({ ...f, channel_id: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                >
                  <option value="">미지정</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">제목 *</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-neutral-400 font-bold mb-1 block">출처 URL</label>
                  <input
                    value={form.source_url}
                    onChange={(e) => setForm((f) => ({ ...f, source_url: e.target.value }))}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-neutral-400 font-bold mb-1 block">조회수</label>
                  <input
                    value={form.views}
                    onChange={(e) => setForm((f) => ({ ...f, views: e.target.value }))}
                    placeholder="예: 498.6만"
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">콘텐츠 유형</label>
                <select
                  value={form.content_type}
                  onChange={(e) => setForm((f) => ({ ...f, content_type: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                >
                  {CONTENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {CONTENT_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">잘 맞는 플랫폼 (다중 선택)</label>
                <div className="flex flex-wrap gap-1.5">
                  {PLATFORMS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => toggleTag(form.platform_fit, p.value, (v) => setForm((f) => ({ ...f, platform_fit: v })))}
                      className={`text-[11px] font-bold px-3 py-1.5 rounded-full border ${
                        form.platform_fit.includes(p.value) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-neutral-200'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">
                  사실관계 메모 (원본 문장 그대로 X, 핵심 사실만 요약)
                </label>
                <textarea
                  value={form.raw_notes}
                  onChange={(e) => setForm((f) => ({ ...f, raw_notes: e.target.value }))}
                  rows={4}
                  placeholder="예: 코끼리 코 근육이 10만개라 세밀한 힘조절만 가능해서 오히려 얇은 실을 못 끊음"
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
                disabled={saving || !form.title.trim()}
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

// ============ 탭 3: 생성 ============
function GenerateTab({
  items,
  personas,
  contents,
  onChange,
}: {
  items: SourceItem[];
  personas: Persona[];
  contents: GeneratedContent[];
  onChange: () => void;
}) {
  const [sourceItemId, setSourceItemId] = useState('');
  const [manualTopic, setManualTopic] = useState('');
  const [personaId, setPersonaId] = useState('');
  const [targetPlatform, setTargetPlatform] = useState('threads');
  const [aiProvider, setAiProvider] = useState<'claude' | 'gemini'>('claude');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  async function handleGenerate() {
    setError('');
    if (!personaId) return setError('페르소나를 선택하세요.');
    if (!sourceItemId && !manualTopic.trim()) return setError('소재를 선택하거나 직접 입력하세요.');

    const persona = personas.find((p) => p.id === personaId);
    setGenerating(true);
    try {
      const res = await fetch('/api/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_item_id: sourceItemId || null,
          manual_topic: sourceItemId ? '' : manualTopic,
          persona_id: personaId,
          persona_is_system: persona?.is_system || false,
          target_platform: targetPlatform,
          ai_provider: aiProvider,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '생성 실패');
      } else {
        onChange();
      }
    } finally {
      setGenerating(false);
    }
  }

  const readyItems = items.filter((i) => i.status !== '발행완료');

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="bg-white border border-neutral-200 rounded-xl p-5">
        <h3 className="font-black text-sm mb-4">생성 설정</h3>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-neutral-400 font-bold mb-1 block">AI 엔진</label>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setAiProvider('claude')}
                className={`flex-1 text-xs font-black py-2.5 rounded-lg border ${
                  aiProvider === 'claude' ? 'bg-black text-white border-black' : 'bg-white border-neutral-200'
                }`}
              >
                🟣 Claude
              </button>
              <button
                type="button"
                onClick={() => setAiProvider('gemini')}
                className={`flex-1 text-xs font-black py-2.5 rounded-lg border ${
                  aiProvider === 'gemini' ? 'bg-black text-white border-black' : 'bg-white border-neutral-200'
                }`}
              >
                🔵 Gemini
              </button>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-neutral-400 font-bold mb-1 block">소재 선택 (또는 아래 직접입력)</label>
            <select
              value={sourceItemId}
              onChange={(e) => setSourceItemId(e.target.value)}
              className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
            >
              <option value="">직접 입력</option>
              {readyItems.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title}
                </option>
              ))}
            </select>
          </div>
          {!sourceItemId && (
            <div>
              <label className="text-[11px] text-neutral-400 font-bold mb-1 block">주제 직접 입력</label>
              <textarea
                value={manualTopic}
                onChange={(e) => setManualTopic(e.target.value)}
                rows={3}
                placeholder="어떤 사실/소재로 글을 만들지 적어주세요"
                className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
              />
            </div>
          )}
          <div>
            <label className="text-[11px] text-neutral-400 font-bold mb-1 block">페르소나</label>
            <select
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
              className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
            >
              <option value="">선택하세요</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-neutral-400 font-bold mb-1 block">타겟 플랫폼</label>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setTargetPlatform(p.value)}
                  className={`text-[11px] font-bold px-3 py-1.5 rounded-full border ${
                    targetPlatform === p.value ? 'bg-black text-white border-black' : 'bg-white border-neutral-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-xs text-red-500 font-bold">{error}</p>}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full bg-black text-white text-xs font-black py-3 rounded-lg disabled:opacity-40"
          >
            {generating ? '생성 중...' : '✨ 콘텐츠 생성'}
          </button>
        </div>
      </div>

      <div>
        <h3 className="font-black text-sm mb-4">생성된 콘텐츠 ({contents.length})</h3>
        <div className="space-y-3 max-h-[600px] overflow-y-auto">
          {contents.length === 0 ? (
            <div className="border border-dashed border-neutral-300 rounded-xl p-10 text-center text-xs text-neutral-400">
              아직 생성된 콘텐츠가 없어요.
            </div>
          ) : (
            contents.map((c) => (
              <div key={c.id} className="bg-white border border-neutral-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] font-bold bg-neutral-100 px-3 py-1 rounded-full">
                    {PLATFORMS.find((p) => p.value === c.target_platform)?.label}
                  </span>
                  <span className="text-[11px] text-neutral-400">{c.persona_name}</span>
                  {c.ai_provider && (
                    <span className="text-[11px] font-bold text-neutral-400">
                      {c.ai_provider === 'gemini' ? '🔵 Gemini' : '🟣 Claude'}
                    </span>
                  )}
                </div>
                <p className="text-sm whitespace-pre-wrap">{c.generated_text}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
