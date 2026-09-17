'use client';

import { useEffect, useState } from 'react';
import type { Site, DeployTarget } from '../types';

// 15번(계정/콘텐츠 설정) 단계 전용 — 2026-09-17 신설, 사용자 요청: "15단계에 셋팅을 추가하자~
// 계정이 셋팅되어있으면 해당 컨텐츠 설명 등을 셋팅하는 곳" + "배포할 플랫폼 리스트와~ 그룹?
// => A라는 컨텐츠를 함께 올릴 그룹". 메인화면 "🔐 플랫폼 계정 관리"(hub_social_accounts,
// app/page.tsx)에서 등록해둔 계정 목록을 콘텐츠(유닛)마다 체크해서 "이 콘텐츠를 어느 계정에
// 올릴지" 고르고, 올릴 제목/설명을 같이 정해두는 화면이다. 실제 발행(16번 일괄배포,
// U-OneShot)은 여기서 하지 않는다 — 배포 직전 준비 단계일 뿐.
//
// v1 범위 — 계정별로 다른 제목/설명까지는 아직 안 만들었다: 선택한 계정 전체에 같은 제목/설명
// 하나를 그대로 복사해서 쓴다(DeployTarget 자체는 계정별로 다른 값을 가질 수 있는 모양이라,
// 나중에 계정별 커스터마이즈 UI를 얹어도 데이터 구조는 안 바꿔도 된다).

type Account = {
  id: string;
  platform: string;
  account_name: string;
  setting_note: string | null;
  admin_email: string | null;
};

// 2026-09-17(2차) 추가 — 사용자 요청: "여기에 있는것도 이메일 단위로 묶어줘". 메인화면
// "🔐 플랫폼 계정 관리"에서 이미 관리 이메일별로 묶어서 보여주고 있는데, 이 배포 대상
// 체크박스 목록은 아직 낱개로 평평하게 나열돼있어서 계정이 많아지니 어디 소속인지 안
// 보였다. 같은 그룹핑 로직을 여기도 적용한다.
function groupAccountsByEmail(accounts: Account[]): { email: string; accounts: Account[] }[] {
  const order: string[] = [];
  const map = new Map<string, Account[]>();
  for (const a of accounts) {
    const key = a.admin_email || '';
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(a);
  }
  return order.map((email) => ({ email, accounts: map.get(email)! }));
}

const PLATFORM_LABELS: Record<string, string> = {
  youtube: '▶️ 유튜브',
  instagram: '📸 인스타그램',
  threads: '🧵 쓰레드',
  facebook: '📘 페이스북',
  tiktok: '🎵 틱톡',
  naver_blog: 'N 네이버 블로그',
};

export function AccountSettingsPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const units = site.script_draft?.units || [];
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [openUnitId, setOpenUnitId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 유닛별 편집 draft — 열 때 그 유닛의 기존 deployTargets로부터 초기화한다.
  const [draftByUnit, setDraftByUnit] = useState<
    Record<string, { selected: Set<string>; title: string; body: string }>
  >({});

  useEffect(() => {
    fetch('/api/social-accounts')
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts || []))
      .finally(() => setAccountsLoading(false));
  }, []);

  function toggleUnit(unitId: string, existing: DeployTarget[]) {
    setOpenUnitId((cur) => (cur === unitId ? null : unitId));
    setDraftByUnit((cur) => {
      if (cur[unitId]) return cur;
      return {
        ...cur,
        [unitId]: {
          selected: new Set(existing.map((t) => t.accountId)),
          title: existing[0]?.title || '',
          body: existing[0]?.body || '',
        },
      };
    });
  }

  function toggleAccount(unitId: string, accountId: string) {
    setDraftByUnit((cur) => {
      const d = cur[unitId];
      if (!d) return cur;
      const next = new Set(d.selected);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return { ...cur, [unitId]: { ...d, selected: next } };
    });
  }

  async function saveUnit(unitId: string) {
    const draft = draftByUnit[unitId];
    if (!draft) return;
    const targets: DeployTarget[] = accounts
      .filter((a) => draft.selected.has(a.id))
      .map((a) => ({ accountId: a.id, platform: a.platform, accountName: a.account_name, title: draft.title, body: draft.body }));
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, unitPatch: { id: unitId, fields: { deployTargets: targets } } }),
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  if (units.length === 0) {
    return (
      <div className="border-t border-black/5 pt-3">
        <p className="text-xs text-neutral-300">아직 대본 작성에서 완성된 콘텐츠가 없어요 — 먼저 대본을 완성해주세요.</p>
      </div>
    );
  }

  if (!accountsLoading && accounts.length === 0) {
    return (
      <div className="border-t border-black/5 pt-3">
        <p className="text-xs text-neutral-300">
          아직 등록된 플랫폼 계정이 없어요 — HongHub 메인화면의 &quot;🔐 플랫폼 계정 관리&quot; 섹션에서 계정을 먼저 등록해주세요.
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-black/5 pt-3">
      <div className="text-xs font-black text-neutral-500 mb-2">🔐 계정/콘텐츠 설정</div>
      <div className="space-y-1.5">
        {units.map((u) => {
          const targets = u.deployTargets || [];
          const isOpen = openUnitId === u.id;
          const draft = draftByUnit[u.id];
          return (
            <div key={u.id} className="bg-white border border-neutral-100 rounded-lg overflow-hidden">
              <button
                onClick={() => toggleUnit(u.id, targets)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer"
              >
                <span className={`shrink-0 transition-transform text-neutral-300 ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                <span className="flex-1 min-w-0 truncate text-[11px] font-bold">{u.title}</span>
                <span
                  className={`shrink-0 text-[10px] font-black rounded-full px-2 py-0.5 ${
                    targets.length > 0 ? 'text-emerald-600 bg-emerald-50' : 'text-neutral-300 bg-neutral-50'
                  }`}
                >
                  🎯 {targets.length}개 계정
                </span>
              </button>
              {isOpen && draft && (
                <div className="px-3 pb-3 pt-1 border-t border-neutral-50 space-y-3">
                  <div>
                    <p className="text-[10px] font-black text-neutral-400 mb-1.5">올릴 계정 선택</p>
                    <div className="space-y-2">
                      {groupAccountsByEmail(accounts).map((group) => (
                        <div key={group.email || '__none__'} className={group.email ? 'border border-neutral-200 rounded-lg p-1.5' : ''}>
                          {group.email && (
                            <p className="inline-block text-[10px] font-black text-neutral-700 bg-neutral-100 rounded px-1.5 py-0.5 mb-1.5">
                              ✉️ {group.email}
                            </p>
                          )}
                          <div className="grid sm:grid-cols-2 gap-1.5">
                            {group.accounts.map((a) => (
                              <label
                                key={a.id}
                                className="flex items-start gap-1.5 bg-neutral-50 border border-neutral-100 rounded-lg px-2 py-1.5 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={draft.selected.has(a.id)}
                                  onChange={() => toggleAccount(u.id, a.id)}
                                  className="mt-0.5 w-3.5 h-3.5 shrink-0"
                                />
                                <span className="min-w-0">
                                  <span className="block text-[11px] font-bold truncate">
                                    {PLATFORM_LABELS[a.platform] || a.platform} · {a.account_name}
                                  </span>
                                  {a.setting_note && <span className="block text-[10px] text-neutral-400 truncate">{a.setting_note}</span>}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-neutral-400 mb-1.5">
                      제목·설명 (선택한 계정 전체에 동일하게 적용됩니다)
                    </p>
                    <input
                      value={draft.title}
                      onChange={(e) =>
                        setDraftByUnit((cur) => ({ ...cur, [u.id]: { ...cur[u.id], title: e.target.value } }))
                      }
                      placeholder="배포용 제목"
                      className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px] mb-1.5"
                    />
                    <textarea
                      value={draft.body}
                      onChange={(e) =>
                        setDraftByUnit((cur) => ({ ...cur, [u.id]: { ...cur[u.id], body: e.target.value } }))
                      }
                      rows={3}
                      placeholder="배포용 설명(캡션/본문 등)"
                      className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px]"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={() => saveUnit(u.id)}
                      disabled={saving}
                      className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                    >
                      {saving ? '저장 중...' : '저장'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
