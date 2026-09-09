'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

type Site = { id: string; name: string; plan_content: string | null };

const TEMPLATE = `# {{프로젝트명}} 계획서

> 작성일: {{YYYY-MM-DD}} · 작성자: {{이름}}
> 이 문서는 나중에 이 프로젝트를 처음 보는 사람(또는 기억이 없는 새 세션)도 이어서 진행할 수 있도록 자기완결적으로 작성합니다.

---

## 0. 한 줄 요약

이 프로젝트가 뭔지, 왜 하는지 2~3문장으로.

## 1. 배경 / 목적 (Why)

- 이 프로젝트를 시작하게 된 계기
- 해결하려는 문제 또는 만들려는 가치
- (참고할 원본 서비스가 있다면) 원본 URL과 벤치마킹 포인트

## 2. 범위 정의 (Scope)

**포함할 것**
- 핵심 기능 1
- 핵심 기능 2

**제외/후순위**
- 지금 안 할 것과 이유

## 3. 기술 스택 / 인프라

| 영역 | 선택 | 비고 |
|---|---|---|
| 프레임워크 | | |
| DB/Auth | | |
| 배포 | | |
| 결제(있다면) | | |

- 깃허브:
- 배포(Vercel):
- 접속 URL:
- 슈퍼베이스:

## 4. 로드맵 (Phase별)

### Phase 1 —
- [ ]
- [ ]

### Phase 2 —
- [ ]

## 5. 리스크 / 주의사항

- 법적/저작권 이슈가 있다면
- 외부 API 정책 제약(예: 매출 조건, 심사 필요 등)이 있다면
- 확정적으로 구현 불가한 것과 그 이유

## 6. 진행 기록 (스프린트 로그)

새 작업을 할 때마다 아래에 이어 붙입니다(최신이 위로 오게).

### {{YYYY-MM-DD}} — {{스프린트 제목}}
- 한 것:
- 발견한 문제 + 원인 + 해결:
- 남은 것:
`;

export default function PlanPage() {
  const params = useParams();
  const id = params.id as string;
  const [site, setSite] = useState<Site | null>(null);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => {
        const found = (d.sites || []).find((s: Site) => s.id === id);
        setSite(found || null);
        setContent(found?.plan_content || '');
      });
  }, [id]);

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/sites/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_content: content }),
      });
      setSavedAt(new Date().toLocaleTimeString('ko-KR'));
    } finally {
      setSaving(false);
    }
  }

  function insertTemplate() {
    if (content.trim() && !confirm('지금 내용을 템플릿으로 덮어쓸까요?')) return;
    setContent(TEMPLATE.replace('{{프로젝트명}}', site?.name || '').replace('{{YYYY-MM-DD}}', new Date().toISOString().slice(0, 10)));
  }

  if (!site) return <div className="min-h-screen bg-neutral-50 p-10 text-sm text-neutral-400">불러오는 중...</div>;

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <Link href="/" className="text-xs text-neutral-400 font-bold hover:text-black">
          ← HongHub
        </Link>
        <div className="flex items-center justify-between mt-1 mb-2">
          <h1 className="text-2xl font-black">📋 {site.name} 계획서</h1>
          <div className="flex gap-2">
            <button onClick={insertTemplate} className="text-xs font-black px-4 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white">
              📐 템플릿 채우기
            </button>
            <button onClick={save} disabled={saving} className="bg-black text-white text-xs font-black px-5 py-2 rounded-lg hover:bg-neutral-800 disabled:opacity-40">
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
        <p className="text-xs text-neutral-400 mb-4">
          이 프로젝트를 Claude가 처음 보는 세션에서도 이어갈 수 있도록 자기완결적으로 적어두는 곳이에요. 파일 업로드 대신 여기서 직접 쓰고, Claude가 MCP로 바로 갱신할 수 있어요.
          {savedAt && <span className="text-green-600 font-bold"> · {savedAt} 저장됨</span>}
        </p>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={32}
          className="w-full border border-neutral-200 rounded-lg p-4 text-xs font-mono leading-relaxed"
          placeholder="아직 계획서가 없어요 — [📐 템플릿 채우기]로 시작해보세요."
        />
      </div>
    </div>
  );
}
