'use client';

import { useState } from 'react';
import type { Site } from '../types';
import { normalizeLabeledItems } from '../utils';
import { LabeledFieldSection } from './step13-14-LabeledLinksPanel';

// 14번(렌더링) 단계 전용 — 2026-09-16(6차) 신설, 사용자 요청: "1번컨텐츠에 지금 업로드한
// 숏컷파일 등록해주고~ 수동으로 업로드, 삭제 할수있게 해주고~". 이 단계는 12번(나레이션·자막)
// 패널과 정확히 같은 구조("콘텐츠 하나에 라벨 붙은 링크/파일 여러 개")가 필요하다 — Shotcut
// 등에서 작업 중인 편집 프로젝트 파일(.mlt)이 여러 버전으로 쌓일 수 있고, 완성된 최종 렌더링
// 영상 파일도 여기 같이 올려둔다. 새로 만들지 않고 step13-14-LabeledLinksPanel.tsx의
// LabeledFieldSection을 그대로 재사용한다(narrationUrls/subtitleUrls와 완전히 같은 UI/저장
// 로직). 자막처럼 화면 안에서 직접 텍스트 편집을 할 대상이 아니라서 textEditable은 안 넘긴다.
export function RenderPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const units = site.script_draft?.units || [];
  const [openUnitId, setOpenUnitId] = useState<string | null>(null);

  if (units.length === 0) {
    return (
      <div className="border-t border-black/5 pt-3">
        <p className="text-xs text-neutral-300">아직 대본 작성에서 완성된 콘텐츠가 없어요 — 먼저 대본을 완성해주세요.</p>
      </div>
    );
  }

  return (
    <div className="border-t border-black/5 pt-3">
      <div className="text-xs font-black text-neutral-500 mb-2">🎬 렌더링 파일 (Shotcut 프로젝트 · 최종 영상)</div>
      <div className="space-y-1.5">
        {units.map((u) => {
          const fileCount = normalizeLabeledItems(u.renderFiles).length;
          const isOpen = openUnitId === u.id;
          return (
            <div key={u.id} className="bg-white border border-neutral-100 rounded-lg overflow-hidden">
              <button
                onClick={() => setOpenUnitId((cur) => (cur === u.id ? null : u.id))}
                className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer"
              >
                <span className={`shrink-0 transition-transform text-neutral-300 ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                {u.category === 'disaster' && <span className="shrink-0 text-[10px]">🚨</span>}
                <span className="flex-1 min-w-0 truncate text-[11px] font-bold">{u.title}</span>
                <span
                  className={`shrink-0 text-[10px] font-black rounded-full px-2 py-0.5 ${
                    fileCount > 0 ? 'text-emerald-600 bg-emerald-50' : 'text-neutral-300 bg-neutral-50'
                  }`}
                >
                  🎬 {fileCount}개
                </span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 pt-1 border-t border-neutral-50 space-y-3">
                  <p className="text-[10px] text-neutral-400">소재: {u.material}</p>
                  <LabeledFieldSection
                    site={site}
                    unit={u}
                    onRefresh={onRefresh}
                    fieldKey="renderFiles"
                    heading="🎬 렌더링 파일"
                    linkPlaceholder="파일 링크 붙여넣기 (또는 아래에서 직접 업로드)"
                    fileAccept=".mlt,.mp4,.mov,.zip,video/*"
                    uploadLabel="+ 파일 업로드 (Shotcut 프로젝트 .mlt / 최종 영상 등)"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
