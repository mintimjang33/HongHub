'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '로그인 실패');
      router.push(searchParams.get('next') || '/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="bg-white border border-neutral-200 rounded-xl p-8 max-w-sm w-full">
        <h1 className="font-black text-lg mb-1">🏠 HongHub</h1>
        <p className="text-xs text-neutral-400 mb-6">비밀번호를 입력해주세요.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          placeholder="비밀번호"
          className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm mb-3"
        />
        {error && <div className="text-xs text-red-500 mb-3">{error}</div>}
        <button
          type="submit"
          disabled={loading || !password}
          className="w-full bg-black text-white text-xs font-black py-3 rounded-lg disabled:opacity-40"
        >
          {loading ? '확인 중...' : '입장'}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
