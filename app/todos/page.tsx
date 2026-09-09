'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type Attachment = { url: string; name: string };

type Todo = {
  id: string;
  content: string;
  attachments: Attachment[];
  created_at: string;
};

type Site = { id: string; name: string; plan_content: string | null };

function buildLogEntry(todo: Todo): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [`### ${date} — 오늘의 할일에서 이관`, `- ${todo.content}`];
  for (const a of todo.attachments || []) lines.push(`  - 📎 ${a.name}: ${a.url}`);
  return lines.join('\n');
}

export default function TodosPage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sites, setSites] = useState<Site[]>([]);
  const [completingTodo, setCompletingTodo] = useState<Todo | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [previewText, setPreviewText] = useState('');
  const [completing, setCompleting] = useState(false);

  function load() {
    fetch('/api/todos')
      .then((r) => r.json())
      .then((d) => setTodos(d.todos || []))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => setSites(d.sites || []));
  }, []);

  async function uploadFiles(files: FileList | File[]) {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '업로드 실패');
        setAttachments((prev) => [...prev, { url: data.url, name: data.name }]);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleAdd() {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, attachments }),
      });
      setContent('');
      setAttachments([]);
      load();
    } finally {
      setSaving(false);
    }
  }

  function openCompleteModal(t: Todo) {
    setCompletingTodo(t);
    setSelectedSiteId('');
    setPreviewText(buildLogEntry(t));
  }

  function closeCompleteModal() {
    setCompletingTodo(null);
    setSelectedSiteId('');
    setPreviewText('');
  }

  async function confirmComplete() {
    if (!completingTodo) return;
    setCompleting(true);
    try {
      if (selectedSiteId) {
        const site = sites.find((s) => s.id === selectedSiteId);
        const merged = previewText + (site?.plan_content ? `\n\n---\n\n${site.plan_content}` : '');
        const res = await fetch(`/api/sites/${selectedSiteId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan_content: merged }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          alert(d.error || '계획표 기록에 실패했어요. 삭제하지 않았어요.');
          return;
        }
        setSites((prev) => prev.map((s) => (s.id === selectedSiteId ? { ...s, plan_content: merged } : s)));
      }
      await fetch(`/api/todos/${completingTodo.id}`, { method: 'DELETE' });
      setTodos((prev) => prev.filter((t) => t.id !== completingTodo.id));
      closeCompleteModal();
    } finally {
      setCompleting(false);
    }
  }

  function startEdit(t: Todo) {
    setEditingId(t.id);
    setEditingContent(t.content);
  }

  async function saveEdit(id: string) {
    const trimmed = editingContent.trim();
    if (!trimmed) {
      setEditingId(null);
      return;
    }
    await fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: trimmed }),
    });
    setEditingId(null);
    load();
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-8">
          <Link href="/" className="text-xs text-neutral-400 font-bold hover:text-black">
            ← HongHub
          </Link>
          <h1 className="text-2xl font-black mt-1">✅ 오늘의 할일</h1>
          <p className="text-xs text-neutral-400 mt-1">
            외부에서 급하게 처리한 업무나 해야 할 일을 메모해두는 곳. 완료하면 삭제하세요.
          </p>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
          }}
          className={`bg-white border rounded-xl p-4 mb-8 shadow-sm transition-colors ${
            dragOver ? 'border-blue-400 bg-blue-50' : 'border-neutral-200'
          }`}
        >
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="메모를 입력하거나, 파일을 여기로 드래그해서 첨부하세요..."
            rows={4}
            className="w-full text-sm resize-none outline-none placeholder:text-neutral-300"
          />

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-neutral-100">
              {attachments.map((a, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1.5 text-[11px] font-bold bg-neutral-100 px-3 py-1.5 rounded-full"
                >
                  📎 {a.name}
                  <button onClick={() => removeAttachment(i)} className="text-red-400 hover:text-red-600">
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {dragOver && (
            <div className="text-[11px] text-blue-500 font-bold mt-2">여기에 파일을 놓아 첨부</div>
          )}
          {uploading && <div className="text-[11px] text-neutral-400 mt-2">업로드 중...</div>}

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-neutral-100">
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-[11px] text-neutral-400 font-bold hover:text-black"
              >
                📎 파일 선택
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) uploadFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={saving || uploading || !content.trim()}
              className="bg-black text-white text-xs font-black px-5 py-2.5 rounded-lg hover:bg-neutral-800 disabled:opacity-40"
            >
              {saving ? '추가 중...' : '+ 할일 추가'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-neutral-400 text-center py-20">불러오는 중...</div>
        ) : todos.length === 0 ? (
          <div className="border border-dashed border-neutral-300 rounded-xl p-16 text-center text-sm text-neutral-400">
            할일이 없어요. 위에서 메모를 추가해보세요.
          </div>
        ) : (
          <div className="space-y-3">
            {todos.map((t) => (
              <div key={t.id} className="bg-white border border-neutral-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  {editingId === t.id ? (
                    <textarea
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                      onBlur={() => saveEdit(t.id)}
                      autoFocus
                      rows={3}
                      className="flex-1 text-sm resize-none outline-none border border-neutral-200 rounded-lg px-2 py-1.5"
                    />
                  ) : (
                    <p
                      onClick={() => startEdit(t)}
                      className="flex-1 text-sm whitespace-pre-wrap cursor-text"
                    >
                      {t.content}
                    </p>
                  )}
                  <button
                    onClick={() => openCompleteModal(t)}
                    className="flex-shrink-0 text-[11px] text-neutral-400 font-bold px-3 py-1.5 rounded-full border border-neutral-200 hover:border-green-400 hover:text-green-600"
                  >
                    ✓ 완료
                  </button>
                </div>
                {t.attachments?.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-neutral-100">
                    {t.attachments.map((a, i) => (
                      <a
                        key={i}
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-bold text-blue-600 bg-neutral-50 px-3 py-1.5 rounded-full hover:underline"
                      >
                        📎 {a.name}
                      </a>
                    ))}
                  </div>
                )}
                <div className="text-[10px] text-neutral-300 mt-2">
                  {new Date(t.created_at).toLocaleString('ko-KR')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {completingTodo && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-lg p-5">
            <h2 className="text-sm font-black mb-1">이 할일을 완료 처리할까요?</h2>
            <p className="text-xs text-neutral-400 mb-4">
              프로젝트를 선택하면 계획표(진행 기록)에 아래 내용을 남긴 뒤 삭제해요. 선택하지 않으면 기록 없이 바로 삭제돼요.
            </p>

            <label className="text-[11px] font-bold text-neutral-500 block mb-1">프로젝트 계획표에 기록</label>
            <select
              value={selectedSiteId}
              onChange={(e) => setSelectedSiteId(e.target.value)}
              className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-xs mb-3"
            >
              <option value="">— 기록 없이 그냥 삭제 —</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            {selectedSiteId && (
              <>
                <label className="text-[11px] font-bold text-neutral-500 block mb-1">계획표에 남길 내용 (수정 가능)</label>
                <textarea
                  value={previewText}
                  onChange={(e) => setPreviewText(e.target.value)}
                  rows={5}
                  className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-xs font-mono mb-3"
                />
              </>
            )}

            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                onClick={closeCompleteModal}
                disabled={completing}
                className="text-xs font-black px-4 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 disabled:opacity-40"
              >
                취소
              </button>
              <button
                onClick={confirmComplete}
                disabled={completing}
                className="bg-black text-white text-xs font-black px-4 py-2 rounded-lg hover:bg-neutral-800 disabled:opacity-40"
              >
                {completing ? '처리 중...' : selectedSiteId ? '계획표에 기록하고 삭제' : '그냥 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
