'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import type { Step, Site } from '../types';
import {
  statusTone,
  stepLink,
  isChannelStep,
  isMaterialStep,
  isTranscriptStep,
  isAnalysisStep,
  isMaterialSelectionStep,
  isContentRegisterStep,
  isResearchStep,
  isStrategyStep,
  isHookStep,
  isPlanningDocStep,
  isCharacterStep,
  isScriptStep,
  isImageVideoStep,
  isNarrationStep,
  isSubtitleStep,
} from '../utils';
import { ChannelPanel } from './step01-ChannelPanel';
import { MaterialPanel } from './step02-MaterialPanel';
import { TranscriptPanel } from './step03-TranscriptPanel';
import { AnalysisPanel } from './step04-AnalysisPanel';
import { MaterialSelectionPanel } from './step05-MaterialSelectionPanel';
import { ContentRegisterPanel } from './step06-ContentRegisterPanel';
import { ResearchPanel } from './step07-ResearchPanel';
import { StrategyPanel } from './step08-StrategyPanel';
import { HookPanel } from './step09-HookPanel';
import { PlanningDocPanel } from './step10-PlanningDocPanel';
import { ScriptWritingPanel } from './step11-ScriptWritingPanel';
import { CharacterPanel } from './step12-CharacterPanel';
import { NarrationPanel, SubtitlePanel } from './step13-14-LabeledLinksPanel';
import { ImageVideoPanel } from './step16-17-ImageVideoPanel';

export function FlowChart({
  steps,
  site,
  selected,
  onSelect,
  onRefreshSite,
}: {
  steps: Step[];
  site: Site;
  selected: number;
  onSelect: (i: number) => void;
  onRefreshSite: () => void;
}) {
  const siteName = site.name;
  // 2026-09-08 추가 — 사용자 지적: "10단계에서 8단계,9단계로 이동도 안되네". 단계가 20개까지 늘어나면서
  // 이 칩 목록이 가로 스크롤(overflow-x-auto) 한 줄에 다 안 들어가는데, 선택된 단계가 바뀌어도 스크롤
  // 위치는 그대로라 멀리 떨어진 단계로 점프하면 그 칩 자체가 화면 밖으로 밀려나 있었다 — 클릭이 안
  // 되는 게 아니라 칩이 안 보여서 못 누르는 상황. 선택이 바뀔 때마다 그 칩을 자동으로 화면 안으로
  // 스크롤해서, 어느 단계에서 어느 단계로 이동해도 항상 보이게 한다.
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    chipRefs.current[selected]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selected]);
  if (steps.length === 0) return null;
  const active = steps[Math.min(selected, steps.length - 1)];
  const activeTone = statusTone(active.status);
  const link = stepLink(active);

  return (
    <div className="mb-6 bg-white border border-neutral-200 rounded-xl p-5">
      <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-[11px] font-black text-amber-700 mb-1">🎬 PD(오케스트레이터)의 역할</p>
        <p className="text-[11px] text-amber-700 leading-relaxed">
          세부 작업을 직접 하지 않고 각 단계를 전문 스킬/도구에 위임한다. 산출물이 나왔다고 바로 &quot;완료&quot;로 표시하지 않는다 — 반드시 별도 에이전트(이 세션과 맥락을 공유하지 않는)를 spawn해서 그 산출물이 단계 목적을 실제로 달성했는지 판단시키고, PASS가 나올 때까지 반복해야 완료로 표시할 수 있다. 스스로 판단하고 완료 처리하는 건 원칙 위반.
        </p>
      </div>
      <div className="text-[11px] font-black text-neutral-400 mb-4">🔀 플로우차트 미리보기 — 단계를 클릭하면 오른쪽에 상세가 떠요</div>
      <div className="flex flex-col gap-5">
        <div className="w-full flex items-center overflow-x-auto pb-1">
          {steps.map((s, i) => {
            const tone = statusTone(s.status);
            const isSelected = i === selected;
            return (
              <div key={i} className="flex items-center shrink-0">
                <button
                  ref={(el) => {
                    chipRefs.current[i] = el;
                  }}
                  onClick={() => onSelect(i)}
                  className={`group flex items-center gap-2 border rounded-lg px-2.5 py-2 text-left whitespace-nowrap cursor-pointer transition ${
                    isSelected
                      ? `${tone.bg} ${tone.border} ring-2 ring-black/10`
                      : 'bg-white border-neutral-200 hover:bg-neutral-50 hover:border-neutral-400 hover:shadow-md hover:-translate-y-0.5'
                  }`}
                >
                  <span
                    className={`shrink-0 w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center transition ${
                      isSelected ? 'bg-black text-white' : 'bg-neutral-100 text-neutral-500 group-hover:bg-black group-hover:text-white'
                    }`}
                  >
                    {s.n}
                  </span>
                  <span className="text-xs font-bold">{s.name || '(단계명 없음)'}</span>
                  <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${tone.text.replace('text-', 'bg-')}`} />
                </button>
                {i < steps.length - 1 && <div className="h-0.5 w-4 bg-neutral-200 shrink-0" />}
              </div>
            );
          })}
        </div>

        <div className={`w-full border rounded-xl p-5 ${activeTone.bg} ${activeTone.border}`}>
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-black text-white text-xs font-black flex items-center justify-center">{active.n}</span>
              <h3 className="font-black text-base">{active.name || '(단계명 없음)'}</h3>
            </div>
            <span className={`shrink-0 text-[10px] font-black px-2.5 py-1 rounded-full bg-white border ${activeTone.border} ${activeTone.text}`}>
              {activeTone.label}
            </span>
          </div>
          {active.desc && (
            <details className="mb-3">
              <summary className="cursor-pointer text-xs text-neutral-400 font-bold">단계 설명 보기</summary>
              <p className="text-sm text-neutral-600 leading-relaxed mt-2">{active.desc}</p>
            </details>
          )}
          {active.status && (
            <details className="border-t border-black/5 pt-3 mb-3">
              <summary className="cursor-pointer text-xs text-neutral-400 font-bold">진행 로그 보기</summary>
              <p className="text-xs text-neutral-500 leading-relaxed mt-2">{active.status}</p>
            </details>
          )}
          {isChannelStep(active) && <ChannelPanel siteName={siteName} />}
          {isMaterialStep(active) && <MaterialPanel siteName={siteName} />}
          {isTranscriptStep(active) && <TranscriptPanel siteName={siteName} />}
          {isAnalysisStep(active) && <AnalysisPanel site={site} onRefresh={onRefreshSite} />}
          {isMaterialSelectionStep(active) && (
            <MaterialSelectionPanel
              site={site}
              onRefresh={onRefreshSite}
              onMaterialSelected={() => {
                const idx = steps.findIndex((s) => isContentRegisterStep(s));
                if (idx >= 0) onSelect(idx);
              }}
            />
          )}
          {isContentRegisterStep(active) && (
            <ContentRegisterPanel
              site={site}
              onRefresh={onRefreshSite}
              onGoToMaterialSelection={() => {
                const idx = steps.findIndex((s) => isMaterialSelectionStep(s));
                if (idx >= 0) onSelect(idx);
              }}
            />
          )}
          {isResearchStep(active) && <ResearchPanel site={site} onRefresh={onRefreshSite} />}
          {isStrategyStep(active) && <StrategyPanel site={site} onRefresh={onRefreshSite} />}
          {isHookStep(active) && <HookPanel site={site} onRefresh={onRefreshSite} />}
          {isPlanningDocStep(active) && <PlanningDocPanel site={site} onRefresh={onRefreshSite} />}
          {isCharacterStep(active) && <CharacterPanel site={site} onRefresh={onRefreshSite} />}
          {isScriptStep(active) && <ScriptWritingPanel site={site} onRefresh={onRefreshSite} />}
          {isImageVideoStep(active) && <ImageVideoPanel site={site} onRefresh={onRefreshSite} />}
          {isNarrationStep(active) && <NarrationPanel site={site} onRefresh={onRefreshSite} />}
          {isSubtitleStep(active) && <SubtitlePanel site={site} onRefresh={onRefreshSite} />}
          {link && (
            <Link
              href={link.href}
              className="inline-block text-xs font-black text-blue-600 hover:underline border-t border-black/5 pt-3 w-full"
            >
              {link.label} →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
