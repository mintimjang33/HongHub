'use client';

import { useState } from 'react';
import type { ContentUnit, DeployTarget, Site } from '../types';

// 17번(일괄배포) 단계 전용 — 2026-09-19 신설. 사용자 지적: "17단계도 각 컨텐츠별로 배포를
// 했는지에 대한 결과 체크 리스트가 있어야 할꺼 아니야???". 이 단계의 stepDocs 설명서(U-OneShot
// 아키텍처 설명, "17" 키)가 이미 밝혀둔 대로 실제 업로드는 HongHub가 아니라 별도 앱인
// U-OneShot에서 진행되고, HongHub는 그 결과를 API로 자동 조회할 방법이 없다 — 그래서 지금까지
// "16번에서 등록해둔 콘텐츠들이 실제로 올라갔는지" 확인할 화면 자체가 없었다.
//
// 이 패널은 16번(step15-AccountSettingsPanel.tsx)에서 콘텐츠별로 이미 만들어둔 deployTargets
// 배열을 그대로 읽어서, U-OneShot에서 실제로 업로드를 마친 뒤 여기 와서 결과만 수동으로
// 체크/기록하는 체크리스트다(U-OneShot의 uos_publish_targets.status/platform_post_id와 같은
// 목적 — HongHub는 별도 시스템이라 자동 동기화가 안 돼서 사람이 직접 표시한다).
export function DeployChecklistPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const units = site.script_draft?.units || [];
  const [openUnitId, setOpenUnitId] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  if (units.length === 0) {
    return (
      <div className="border-t border-black/5 pt-3">
        <p className="text-xs text-neutral-300">아직 대본 작성에서 완성된 콘텐츠가 없어요 — 먼저 대본을 완성해주세요.</p>
      </div>
    );
  }

  const unitsWithTargets = units.filter((u) => (u.deployTargets || []).length > 0);
  const totalTargets = unitsWithTargets.reduce((sum, u) => sum + (u.deployTargets || []).length, 0);
  const publishedTargets = unitsWithTargets.reduce(
    (sum, u) => sum + (u.deployTargets || []).filter((t) => t.publishStatus === 'published').length,
    0
  );

  async function saveTargets(unit: ContentUnit, targets: DeployTarget[]) {
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, unitPatch: { id: unit.id, fields: { deployTargets: targets } } }),
    });
    onRefresh();
  }

  async function setStatus(unit: ContentUnit, idx: number, status: DeployTarget['publishStatus']) {
    const key = `${unit.id}-${idx}`;
    const targets = unit.deployTargets || [];
    setSavingKey(key);
    try {
      const next = targets.map((t, i) =>
        i === idx
          ? {
              ...t,
              publishStatus: status,
              publishedAt: status === 'published' ? new Date().toISOString() : t.publishedAt,
            }
          : t
      );
      await saveTargets(unit, next);
    } finally {
      setSavingKey(null);
    }
  }

  async function savePublishedUrl(unit: ContentUnit, idx: number, url: string) {
    const key = `${unit.id}-${idx}`;
    const targets = unit.deployTargets || [];
    setSavingKey(key);
    try {
      const next = targets.map((t, i) => (i === idx ? { ...t, publishedUrl: url } : t));
      await saveTargets(unit, next);
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="border-t border-black/5 pt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-black text-neutral-500">✅ 배포 결과 체크리스트</div>
        <span
          className={`text-[10px] font-black rounded-full px-2 py-0.5 ${
            totalTargets > 0 && publishedTargets === totalTargets
              ? 'text-emerald-600 bg-emerald-50'
              : 'text-neutral-500 bg-neutral-100'
          }`}
        >
          {publishedTargets} / {totalTargets} 완료
        </span>
      </div>
      <p className="text-[10px] text-neutral-400 mb-2">
        실제 업로드는 U-OneShot에서 진행됩니다(아래 설명서 참고) — 여기서는 16번에서 등록해둔 콘텐츠별 배포 대상이 실제로 올라갔는지 결과만 체크·기록합니다.
      </p>
      <div className="space-y-1.5">
        {units.map((u) => {
          const targets = u.deployTargets || [];
          const isOpen = openUnitId === u.id;
          const doneCount = targets.filter((t) => t.publishStatus === 'published').length;
          return (
            <div key={u.id} className="bg-white border border-neutral-100 rounded-lg overflow-hidden">
              <button
                onClick={() => setOpenUnitId((cur) => (cur === u.id ? null : u.id))}
                className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer"
              >
                <span className={`shrink-0 transition-transform text-neutral-300 ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                <span className="flex-1 min-w-0 truncate text-[11px] font-bold">{u.title}</span>
                <span
                  className={`shrink-0 text-[10px] font-black rounded-full px-2 py-0.5 ${
                    targets.length === 0
                      ? 'text-neutral-300 bg-neutral-50'
                      : doneCount === targets.length
                      ? 'text-emerald-600 bg-emerald-50'
                      : 'text-amber-600 bg-amber-50'
                  }`}
                >
                  {targets.length === 0 ? '16번 미등록' : `${doneCount}/${targets.length} 완료`}
                </span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 pt-1 border-t border-neutral-50 space-y-2">
                  {targets.length === 0 ? (
                    <p className="text-[10px] text-neutral-400">16번(계정/콘텐츠 설정)에서 이 콘텐츠의 업로드 채널·제목·설명을 먼저 등록해주세요.</p>
                  ) : (
                    targets.map((t, idx) => {
                      const key = `${u.id}-${idx}`;
                      const status = t.publishStatus || 'pending';
                      return (
                        <div key={idx} className="border border-neutral-200 rounded-lg p-2 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold truncate">
                              {t.platform === 'youtube' ? '▶️' : ''} {t.accountName}
                            </span>
                            <div className="flex gap-1 shrink-0">
                              {(
                                [
                                  { id: 'pending', label: '대기중' },
                                  { id: 'published', label: '✅ 완료' },
                                  { id: 'failed', label: '❌ 실패' },
                                ] as const
                              ).map((s) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  onClick={() => setStatus(u, idx, s.id)}
                                  disabled={savingKey === key}
                                  className={`text-[10px] font-bold px-2 py-1 rounded-lg border disabled:opacity-40 ${
                                    status === s.id ? 'bg-black text-white border-black' : 'bg-white text-neutral-500 border-neutral-200'
                                  }`}
                                >
                                  {s.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          {status === 'published' && (
                            <div className="flex items-center gap-1.5">
                              <input
                                defaultValue={t.publishedUrl || ''}
                                onBlur={(e) => {
                                  const v = e.target.value.trim();
                                  if (v !== (t.publishedUrl || '')) savePublishedUrl(u, idx, v);
                                }}
                                placeholder="실제 업로드된 영상 링크 붙여넣기"
                                className="flex-1 min-w-0 border border-neutral-200 rounded-lg px-2 py-1 text-[10px]"
                              />
                              {t.publishedAt && (
                                <span className="shrink-0 text-[9px] text-neutral-400">
                                  {new Date(t.publishedAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
