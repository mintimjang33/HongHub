'use client';

import { useEffect, useState } from 'react';
import type { ContentUnit, Site, DeployTarget } from '../types';
import { normalizeLabeledItems } from '../utils';

// 16번(계정/콘텐츠 설정) 단계 전용.
//
// 2026-09-18 재설계 — 사용자 지적: "16단계에 계정 선택을 현재 컨텐츠마다 선택하는걸로
// 해뒀는데~ 상단으로 올려서 파이프라인에서 선택하는걸로 해줘~~ 예) 경제학워크플로우 =>
// 업로드 채널 선택". imageStyle/characterStyle(step16-17-ImageVideoPanel.tsx)과 같은 이유 —
// 콘텐츠(유닛)마다 매번 "이걸 어디에 올릴지" 체크하게 하지 않고, 이 워크플로우 전체가 공유하는
// 업로드 채널을 패널 최상단에서 딱 한 번만 고른다(analysis_result.deployAccountIds, 파이프라인
// 전체 공유 — /api/sites/[id] PATCH는 analysis_result 통째 교체라 기존 값을 스프레드해서
// 이 필드만 덮어쓴다). 이 워크플로우에서 만들어지는 모든 콘텐츠는 자동으로 여기서 고른
// 계정들에 업로드된다("해당 워크플로우에서 만들어진 최종 => 선택해둔 채널에 업로드").
// 계정 목록 UI(아바타/연결확인 뱃지/🔄 업데이트 버튼)는 메인화면 "🔐 플랫폼 계정 관리"
// (app/page.tsx)와 완전히 같은 걸 이 패널에도 그대로 둔다 — 사용자 지적: "채널 업데이트
// 버튼은 왜 안들어가 있지???" (여기 계정 목록엔 그 버튼이 없어서 발생한 문제).
//
// 콘텐츠(유닛)별로는 이제 "어느 계정에" 고르지 않고, "무슨 제목/설명/태그/공개범위로 올릴지"만
// 정한다 — 사용자 요청: "컨텐츠 => 등록할때 어떤것들이 필요한지 다른 채널들 보고 파악해서
// 필요한거 있으면 추가해줘". 이미 이 세션에서 실제로 읽어본 U-OneShot의 발행 대상 테이블
// (uos_publish_targets: title, body, visibility, options)을 기준으로 태그(options에 해당)와
// 공개범위(visibility)를 추가했다 — 실제 발행 시스템이 요구하는 필드와 맞춰둬야 나중에
// 그대로 옮겨 쓸 수 있다.
type Account = {
  id: string;
  platform: string;
  account_name: string;
  setting_note: string | null;
  admin_email: string | null;
  credentials: Record<string, string> | null;
};

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

function sortGroupsByProgress(groups: { email: string; accounts: Account[] }[]): { email: string; accounts: Account[] }[] {
  const score = (g: { accounts: Account[] }) => (g.accounts.some((a) => a.credentials?.refresh_token) ? 0 : 1);
  return [...groups].sort((a, b) => score(a) - score(b));
}

function safeParseChannels(json: string | undefined): { id: string; title: string | null }[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getYoutubeConnectionBadge(a: Account): { label: string; className: string } | null {
  if (a.platform !== 'youtube') return null;
  const creds = a.credentials || {};
  if (!creds.refresh_token) return null;
  const verifiedChannels = safeParseChannels(creds._verified_channels);
  if (verifiedChannels.length === 0) return { label: '❔ 확인 안 됨', className: 'bg-neutral-100 text-neutral-400' };
  const isMatch = !!creds.channel_id && verifiedChannels.some((c) => c.id === creds.channel_id);
  return isMatch
    ? { label: '✅ 연결 확인됨', className: 'bg-green-100 text-green-700' }
    : { label: '⚠️ 채널 불일치', className: 'bg-amber-100 text-amber-700' };
}

const PLATFORM_LABELS: Record<string, string> = {
  youtube: '▶️ 유튜브',
  instagram: '📸 인스타그램',
  threads: '🧵 쓰레드',
  facebook: '📘 페이스북',
  tiktok: '🎵 틱톡',
  naver_blog: 'N 네이버 블로그',
};

const VISIBILITY_OPTIONS: { id: 'public' | 'unlisted' | 'private'; label: string }[] = [
  { id: 'public', label: '전체 공개' },
  { id: 'unlisted', label: '일부 공개(링크 아는 사람만)' },
  { id: 'private', label: '비공개' },
];

// 2026-09-18(2차) 추가 — 사용자 지적: "업로드할때 필요한 정보가 이게 다야???". YouTube Data
// API videos.insert가 실제로 요구하는 snippet.categoryId 값 — 흔히 쓰는 것만 추린 목록(전체
// 카테고리는 훨씬 많지만, 이 파이프라인들이 실제로 쓸 만한 것만).
const CATEGORY_OPTIONS: { id: string; label: string }[] = [
  { id: '27', label: '교육' },
  { id: '25', label: '뉴스/정치' },
  { id: '22', label: '인물/블로그' },
  { id: '24', label: '엔터테인먼트' },
  { id: '23', label: '코미디' },
  { id: '28', label: '과학/기술' },
  { id: '26', label: '노하우/스타일' },
  { id: '1', label: '영화/애니메이션' },
];

export function AccountSettingsPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const units = site.script_draft?.units || [];
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [savingAccounts, setSavingAccounts] = useState(false);
  // 2026-09-18(3차) 추가 — 사용자 요청: "평소에 선택된것만 표시해주고 접어놔줘". 채널이 늘어날수록
  // 위 그리드가 한 화면을 가득 채워서, 이미 다 골라둔 뒤에는 매번 열어볼 필요가 없다. 기본은
  // 접어두고 선택된 계정만 요약으로 보여주며, 바꾸고 싶을 때만 펼쳐서 전체 목록을 연다.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openUnitId, setOpenUnitId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftByUnit, setDraftByUnit] = useState<
    Record<
      string,
      {
        title: string;
        body: string;
        tags: string;
        visibility: 'public' | 'unlisted' | 'private';
        categoryId: string;
        madeForKids: boolean | null;
        timeline: string;
        containsAltered: boolean | null;
      }
    >
  >({});

  function reloadAccounts() {
    setAccountsLoading(true);
    fetch('/api/social-accounts')
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts || []))
      .finally(() => setAccountsLoading(false));
  }
  useEffect(reloadAccounts, []);

  async function syncFromYoutube(id: string) {
    setSyncingId(id);
    try {
      const res = await fetch(`/api/social-accounts/${id}/sync`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || '업데이트 실패');
        return;
      }
      reloadAccounts();
    } finally {
      setSyncingId(null);
    }
  }

  const connectedAccounts = accounts.filter((a) => a.credentials && Object.keys(a.credentials).length > 0);
  const selectedAccountIds = new Set(site.analysis_result?.deployAccountIds || []);

  async function toggleDeployAccount(accountId: string) {
    const next = new Set(selectedAccountIds);
    if (next.has(accountId)) next.delete(accountId);
    else next.add(accountId);
    setSavingAccounts(true);
    try {
      await fetch(`/api/sites/${site.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis_result: { ...site.analysis_result, deployAccountIds: Array.from(next) } }),
      });
      onRefresh();
    } finally {
      setSavingAccounts(false);
    }
  }

  function toggleUnit(unitId: string, existing: DeployTarget[]) {
    setOpenUnitId((cur) => (cur === unitId ? null : unitId));
    setDraftByUnit((cur) => {
      if (cur[unitId]) return cur;
      const first = existing[0];
      return {
        ...cur,
        [unitId]: {
          title: first?.title || '',
          body: first?.body || '',
          tags: (first?.tags || []).join(', '),
          visibility: first?.visibility || 'public',
          categoryId: first?.categoryId || '',
          madeForKids: first?.madeForKids ?? null,
          timeline: first?.timeline || '',
          containsAltered: first?.containsAltered ?? null,
        },
      };
    });
  }

  async function saveUnit(unitId: string) {
    const draft = draftByUnit[unitId];
    if (!draft) return;
    const tags = draft.tags.split(',').map((t) => t.trim()).filter(Boolean);
    const targetAccounts = connectedAccounts.filter((a) => selectedAccountIds.has(a.id));
    const targets: DeployTarget[] = targetAccounts.map((a) => ({
      accountId: a.id,
      platform: a.platform,
      accountName: a.account_name,
      title: draft.title,
      body: draft.body,
      tags,
      visibility: draft.visibility,
      categoryId: draft.categoryId || undefined,
      madeForKids: draft.madeForKids ?? undefined,
      timeline: draft.timeline || undefined,
      containsAltered: draft.containsAltered ?? undefined,
    }));
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

  if (!accountsLoading && connectedAccounts.length === 0) {
    return (
      <div className="border-t border-black/5 pt-3">
        <p className="text-xs text-neutral-300">
          아직 연결 완료된 플랫폼 계정이 없어요 — HongHub 메인화면의 &quot;🔐 플랫폼 계정 관리&quot; 섹션에서 계정을 먼저 등록·연결해주세요.
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-black/5 pt-3 space-y-4">
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-xs font-black text-neutral-500">🎯 업로드 채널 선택 (파이프라인 전체 공유)</p>
          <button
            onClick={() => setPickerOpen((cur) => !cur)}
            className="shrink-0 text-[10px] font-bold text-blue-600 hover:underline"
          >
            {pickerOpen ? '접기 ▲' : '채널 변경 ▼'}
          </button>
        </div>
        {!pickerOpen ? (
          <div className="flex flex-wrap gap-1.5">
            {accountsLoading ? (
              <p className="text-[11px] text-neutral-300">계정 목록 불러오는 중...</p>
            ) : selectedAccountIds.size === 0 ? (
              <p className="text-[11px] text-amber-600">선택된 업로드 채널이 없어요 — &quot;채널 변경&quot;을 눌러 골라주세요.</p>
            ) : (
              connectedAccounts
                .filter((a) => selectedAccountIds.has(a.id))
                .map((a) => {
                  const avatarUrl = a.credentials?._avatar_url;
                  return (
                    <span
                      key={a.id}
                      className="flex items-center gap-1 text-[11px] font-bold bg-emerald-50 text-emerald-700 rounded-full px-2 py-1"
                    >
                      {avatarUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatarUrl} alt="" className="w-4 h-4 rounded-full" />
                      )}
                      {PLATFORM_LABELS[a.platform] || a.platform} · {a.account_name}
                    </span>
                  );
                })
            )}
          </div>
        ) : (
          <>
            <p className="text-[10px] text-neutral-400 mb-2">
              여기서 고른 계정들에 이 워크플로우({site.name})에서 만들어지는 모든 콘텐츠가 업로드됩니다. 콘텐츠마다 다시 고를 필요 없어요.
            </p>
            {accountsLoading ? (
              <p className="text-[11px] text-neutral-300">계정 목록 불러오는 중...</p>
            ) : (
              <div className="space-y-2">
            {sortGroupsByProgress(groupAccountsByEmail(connectedAccounts)).map((group) => (
              <div key={group.email || '__none__'} className={group.email ? 'border border-neutral-200 rounded-lg p-1.5' : ''}>
                {group.email && (
                  <p className="inline-block text-[10px] font-black text-neutral-700 bg-neutral-100 rounded px-1.5 py-0.5 mb-1.5">
                    ✉️ {group.email}
                  </p>
                )}
                <div className="grid sm:grid-cols-2 gap-1.5">
                  {group.accounts.map((a) => {
                    const badge = getYoutubeConnectionBadge(a);
                    const avatarUrl = a.credentials?._avatar_url;
                    const canSync = a.platform === 'youtube' && !!a.credentials?.refresh_token;
                    return (
                      <label
                        key={a.id}
                        className="flex items-start gap-1.5 bg-neutral-50 border border-neutral-100 rounded-lg px-2 py-1.5 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedAccountIds.has(a.id)}
                          onChange={() => toggleDeployAccount(a.id)}
                          disabled={savingAccounts}
                          className="mt-0.5 w-3.5 h-3.5 shrink-0"
                        />
                        {avatarUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={avatarUrl} alt="" className="w-5 h-5 rounded-full shrink-0 mt-0.5" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1 flex-wrap">
                            <span className="text-[11px] font-bold truncate">
                              {PLATFORM_LABELS[a.platform] || a.platform} · {a.account_name}
                            </span>
                            {badge && (
                              <span className={`shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-full ${badge.className}`}>{badge.label}</span>
                            )}
                          </span>
                          {a.setting_note && <span className="block text-[10px] text-neutral-400 truncate">{a.setting_note}</span>}
                        </span>
                        {canSync && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              syncFromYoutube(a.id);
                            }}
                            disabled={syncingId === a.id}
                            title="유튜브에서 채널명·핸들·프로필 사진 다시 가져오기"
                            className="shrink-0 text-[10px] font-bold text-neutral-500 hover:underline disabled:opacity-40"
                          >
                            {syncingId === a.id ? '업데이트 중...' : '🔄 업데이트'}
                          </button>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
              </div>
            )}
          </>
        )}
      </div>

      <div>
        <div className="text-xs font-black text-neutral-500 mb-2">📝 콘텐츠별 등록 정보</div>
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
                    {targets.length > 0 ? '✅ 등록됨' : '미등록'}
                  </span>
                </button>
                {isOpen && draft && (
                  <div className="px-3 pb-3 pt-1 border-t border-neutral-50 space-y-2">
                    {selectedAccountIds.size === 0 && (
                      <p className="text-[10px] text-amber-600">위에서 업로드 채널을 먼저 선택해주세요 — 지금 저장하면 어느 계정에도 등록되지 않습니다.</p>
                    )}
                    <FinalOutputCheck unit={u} />
                    {u.sources && u.sources.length > 0 && (
                      <div className="border border-neutral-200 rounded-lg p-2 bg-neutral-50">
                        <p className="text-[10px] font-black text-neutral-500 mb-1">📚 자료 출처 (7번 자료조사에서 등록됨)</p>
                        <ul className="text-[10px] text-neutral-500 list-disc list-inside space-y-0.5 mb-1.5">
                          {u.sources.map((s, i) => (
                            <li key={i} className="break-words">{s}</li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          onClick={() =>
                            setDraftByUnit((cur) => ({
                              ...cur,
                              [u.id]: {
                                ...cur[u.id],
                                body: `${cur[u.id].body}${cur[u.id].body ? '\n\n' : ''}📚 자료 출처\n${u.sources!.map((s) => `· ${s}`).join('\n')}`,
                              },
                            }))
                          }
                          className="text-[10px] font-bold text-blue-600 hover:underline"
                        >
                          ↓ 설명에 추가
                        </button>
                      </div>
                    )}
                    <input
                      value={draft.title}
                      onChange={(e) => setDraftByUnit((cur) => ({ ...cur, [u.id]: { ...cur[u.id], title: e.target.value } }))}
                      placeholder="배포용 제목"
                      className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px]"
                    />
                    <textarea
                      value={draft.body}
                      onChange={(e) => setDraftByUnit((cur) => ({ ...cur, [u.id]: { ...cur[u.id], body: e.target.value } }))}
                      rows={3}
                      placeholder="배포용 설명(캡션/본문 등)"
                      className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px]"
                    />
                    <input
                      value={draft.tags}
                      onChange={(e) => setDraftByUnit((cur) => ({ ...cur, [u.id]: { ...cur[u.id], tags: e.target.value } }))}
                      placeholder="태그 (쉼표로 구분, 예: 경제,반전,코카콜라)"
                      className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px]"
                    />
                    <textarea
                      value={draft.timeline}
                      onChange={(e) => setDraftByUnit((cur) => ({ ...cur, [u.id]: { ...cur[u.id], timeline: e.target.value } }))}
                      rows={4}
                      placeholder={'타임라인/챕터 (실제 벤치마크 채널 형식 그대로 — 한 줄에 하나씩)\n00:00 챕터 제목\n01:15 챕터 제목'}
                      className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px] font-mono"
                    />
                    <div>
                      <p className="text-[10px] font-black text-neutral-400 mb-1">공개 범위</p>
                      <div className="flex gap-1.5">
                        {VISIBILITY_OPTIONS.map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => setDraftByUnit((cur) => ({ ...cur, [u.id]: { ...cur[u.id], visibility: v.id } }))}
                            className={`text-[10px] font-bold px-2 py-1 rounded-lg border ${
                              draft.visibility === v.id ? 'bg-black text-white border-black' : 'bg-white text-neutral-500 border-neutral-200'
                            }`}
                          >
                            {v.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-neutral-400 mb-1">카테고리 (유튜브 업로드 필수 항목)</p>
                      <div className="flex flex-wrap gap-1.5">
                        {CATEGORY_OPTIONS.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setDraftByUnit((cur) => ({ ...cur, [u.id]: { ...cur[u.id], categoryId: c.id } }))}
                            className={`text-[10px] font-bold px-2 py-1 rounded-lg border ${
                              draft.categoryId === c.id ? 'bg-black text-white border-black' : 'bg-white text-neutral-500 border-neutral-200'
                            }`}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-neutral-400 mb-1">
                        아동용 콘텐츠 여부 (필수 — 유튜브 업로드 화면에서 답변을 건너뛸 수 없음)
                      </p>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setDraftByUnit((cur) => ({ ...cur, [u.id]: { ...cur[u.id], madeForKids: false } }))}
                          className={`text-[10px] font-bold px-2 py-1 rounded-lg border ${
                            draft.madeForKids === false ? 'bg-black text-white border-black' : 'bg-white text-neutral-500 border-neutral-200'
                          }`}
                        >
                          아니요, 아동용 아님
                        </button>
                        <button
                          type="button"
                          onClick={() => setDraftByUnit((cur) => ({ ...cur, [u.id]: { ...cur[u.id], madeForKids: true } }))}
                          className={`text-[10px] font-bold px-2 py-1 rounded-lg border ${
                            draft.madeForKids === true ? 'bg-black text-white border-black' : 'bg-white text-neutral-500 border-neutral-200'
                          }`}
                        >
                          예, 아동용
                        </button>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-neutral-400 mb-1">
                        AI로 변경·생성된 콘텐츠 고지 (유튜브 스튜디오 업로드 화면의 실제 체크박스 — 이 파이프라인 영상은 전부 AI로 만들어지므로 사실상 항상 &quot;예&quot;)
                      </p>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setDraftByUnit((cur) => ({ ...cur, [u.id]: { ...cur[u.id], containsAltered: true } }))}
                          className={`text-[10px] font-bold px-2 py-1 rounded-lg border ${
                            draft.containsAltered === true ? 'bg-black text-white border-black' : 'bg-white text-neutral-500 border-neutral-200'
                          }`}
                        >
                          예, AI로 생성/변경됨
                        </button>
                        <button
                          type="button"
                          onClick={() => setDraftByUnit((cur) => ({ ...cur, [u.id]: { ...cur[u.id], containsAltered: false } }))}
                          className={`text-[10px] font-bold px-2 py-1 rounded-lg border ${
                            draft.containsAltered === false ? 'bg-black text-white border-black' : 'bg-white text-neutral-500 border-neutral-200'
                          }`}
                        >
                          아니요
                        </button>
                      </div>
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
    </div>
  );
}

// 2026-09-18(2차) 추가 — 이 등록 화면에서 제목/설명 등만 적을 수 있고, 정작 실제로 업로드될
// "무엇"(최종 영상 파일·최종 썸네일)이 정해져 있는지는 전혀 보여주지 않았다. 14번(renderFiles)·
// 15번(thumbnailFiles) 각각에서 selected:true로 표시해둔 항목을 그대로 읽어와 여기서 확인만
// 시켜준다(수정은 각 단계 화면에서) — 아직 최종 선택이 안 돼 있으면 경고를 띄운다.
function FinalOutputCheck({ unit }: { unit: ContentUnit }) {
  const renderItems = normalizeLabeledItems(unit.renderFiles);
  const thumbItems = normalizeLabeledItems(unit.thumbnailFiles);
  const finalRender = renderItems.find((r) => r.selected) || (renderItems.length === 1 ? renderItems[0] : undefined);
  const finalThumb = thumbItems.find((t) => t.selected) || (thumbItems.length === 1 ? thumbItems[0] : undefined);

  return (
    <div className="border border-neutral-200 rounded-lg p-2 bg-neutral-50 flex items-center gap-3">
      {finalThumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={finalThumb.url} alt="" className="w-16 aspect-video object-cover rounded shrink-0" />
      ) : (
        <div className="w-16 aspect-video bg-neutral-200 rounded shrink-0 flex items-center justify-center text-[9px] text-neutral-400">
          썸네일 없음
        </div>
      )}
      <div className="min-w-0 text-[10px]">
        <p className={finalRender ? 'text-emerald-600 font-bold' : 'text-amber-600 font-bold'}>
          {finalRender ? '✅ 최종 영상 파일 준비됨' : '⚠️ 14번(렌더링)에서 최종 영상 파일이 아직 없어요'}
        </p>
        <p className={finalThumb ? 'text-emerald-600 font-bold' : 'text-amber-600 font-bold'}>
          {finalThumb ? '✅ 최종 썸네일 준비됨' : '⚠️ 15번(썸네일)에서 최종 이미지가 아직 없어요'}
        </p>
      </div>
    </div>
  );
}
