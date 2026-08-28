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

  function load() {
    fetch('/api/todos')
      .then((r) => r.json())
      .then((d) => setTodos(d.todos || []))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
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

  async function handleComplete(id: string) {
    await fetch(`/api/todos/${id}`, { method: 'DELETE' });
    setTodos((prev) => prev.filter((t) => t.id !== id));
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
                    onClick={() => handleComplete(t.id)}
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
    </div>
  );
}
