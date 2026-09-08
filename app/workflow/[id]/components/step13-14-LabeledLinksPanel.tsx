'use client';

import { useState } from 'react';
import type { Site, ContentUnit, LabeledItem, LabeledField } from '../types';
import { normalizeLabeledItems, uploadSceneMedia } from '../utils';
import { CopyButton } from './shared';

// 13번(나레이션)·14번(자막) 공용 — 16-17번(ImageVideoPanel)과 같은 콘텐츠별 리스트 구조를 쓰되,
// 씬 단위가 아니라 유닛 하나에 링크/파일을 통째로 붙인다. 링크 붙여넣기와 파일 업로드
// (uploadSceneMedia 재사용) 둘 다 지원, 라벨(예: "원본"/"1.3배속", "SRT"/"수정본")로 여러 후보를 구분한다.
export function LabeledLinksPanel({
  site,
  onRefresh,
  fieldKey,
  heading,
  linkPlaceholder,
  fileAccept,
  uploadLabel,
}: {
  site: Site;
  onRefresh: () => void;
  fieldKey: LabeledField;
  heading: string;
  linkPlaceholder: string;
  fileAccept: string;
  uploadLabel: string;
}) {
  const units = site.script_draft?.units || [];
  const [openUnitId, setOpenUnitId] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState('');
  const [linkLabelDraft, setLinkLabelDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  async function saveItems(id: string, items: LabeledItem[]) {
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === id ? { ...u, [fieldKey]: items } : u)) }),
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function addLink(unit: ContentUnit) {
    const value = linkDraft.trim();
    if (!value) return;
    const label = linkLabelDraft.trim();
    setLinkDraft('');
    setLinkLabelDraft('');
    await saveItems(unit.id, [...normalizeLabeledItems(unit[fieldKey]), { label, url: value }]);
  }

  async function handleUpload(unit: ContentUnit, files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError('');
    try {
      const uploaded = await Promise.all(
        Array.from(files).map(async (f) => ({ label: f.name.replace(/\.[^./]+$/, ''), url: await uploadSceneMedia(f) }))
      );
      await saveItems(unit.id, [...normalizeLabeledItems(unit[fieldKey]), ...uploaded]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function removeItem(unit: ContentUnit, idx: number) {
    await saveItems(unit.id, normalizeLabeledItems(unit[fieldKey]).filter((_, i) => i !== idx));
  }

  async function relabelItem(unit: ContentUnit, idx: number, label: string) {
    await saveItems(unit.id, normalizeLabeledItems(unit[fieldKey]).map((item, i) => (i === idx ? { ...item, label } : item)));
  }

  if (units.length === 0) {
    return (
      <div className="border-t border-black/5 pt-3">
        <p className="text-xs text-neutral-300">아직 대본 작성에서 완성된 콘텐츠가 없어요 — 먼저 대본을 완성해주세요.</p>
      </div>
    );
  }

  return (
    <div className="border-t border-black/5 pt-3">
      <div className="text-xs font-black text-neutral-500 mb-2">{heading}</div>
      <div className="space-y-1.5">
        {units.map((u) => {
          const items = normalizeLabeledItems(u[fieldKey]);
          const isOpen = openUnitId === u.id;
          return (
            <div key={u.id} className="bg-white border border-neutral-100 rounded-lg overflow-hidden">
              <button
                onClick={() => {
                  setOpenUnitId((cur) => (cur === u.id ? null : u.id));
                  setLinkDraft('');
                  setUploadError('');
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer"
              >
                <span className={`shrink-0 transition-transform text-neutral-300 ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                {u.category === 'disaster' && <span className="shrink-0 text-[10px]">🚨</span>}
                <span className="flex-1 min-w-0 truncate text-[11px] font-bold">{u.title}</span>
                {items.length > 0 ? (
                  <span className="shrink-0 text-[10px] font-black text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5">
                    {items.length}개
                  </span>
                ) : (
                  <span className="shrink-0 text-[10px] font-black text-neutral-300 bg-neutral-50 rounded-full px-2 py-0.5">없음</span>
                )}
              </button>
              {isOpen && (
                <div className="px-3 pb-3 pt-1 border-t border-neutral-50 space-y-1.5">
                  <p className="text-[10px] text-neutral-400">소재: {u.material}</p>
                  {items.length > 0 && (
                    <div className="space-y-1">
                      {items.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-1.5 bg-neutral-50 border border-neutral-200 rounded-lg px-2 py-1">
                          <input
                            defaultValue={item.label}
                            onBlur={(e) => e.target.value !== item.label && relabelItem(u, idx, e.target.value)}
                            placeholder="라벨(예: 원본, 1.3배속)"
                            className="w-28 shrink-0 border border-neutral-200 rounded px-1.5 py-1 text-[10px] font-bold bg-white"
                          />
                          <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 truncate text-[11px] text-blue-600 hover:underline">
                            {item.url}
                          </a>
                          <CopyButton text={item.url} />
                          <button
                            onClick={() => removeItem(u, idx)}
                            title="삭제"
                            className="shrink-0 text-[10px] font-black text-neutral-400 hover:text-red-500"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-1.5">
                    <input
                      value={linkLabelDraft}
                      onChange={(e) => setLinkLabelDraft(e.target.value)}
                      placeholder="라벨"
                      className="w-24 shrink-0 border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px]"
                    />
                    <input
                      value={linkDraft}
                      onChange={(e) => setLinkDraft(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addLink(u)}
                      placeholder={linkPlaceholder}
                      className="flex-1 border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px]"
                    />
                    <button
                      onClick={() => addLink(u)}
                      disabled={saving || !linkDraft.trim()}
                      className="shrink-0 text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                    >
                      + 추가
                    </button>
                  </div>
                  <label className="inline-block text-[11px] font-bold text-blue-600 hover:underline cursor-pointer">
                    {uploading ? '업로드 중...' : uploadLabel}
                    <input
                      type="file"
                      accept={fileAccept}
                      multiple
                      disabled={uploading}
                      onChange={(e) => {
                        handleUpload(u, e.target.files);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                  </label>
                  {uploadError && <p className="text-[10px] text-red-500 font-bold">{uploadError}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function NarrationPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  return (
    <LabeledLinksPanel
      site={site}
      onRefresh={onRefresh}
      fieldKey="narrationUrls"
      heading="🎙 콘텐츠별 나레이션(TTS)"
      linkPlaceholder="음성 링크 붙여넣기 (ElevenLabs/AI Studio 공유 링크 등)"
      fileAccept="audio/*"
      uploadLabel="+ 음성 파일 업로드"
    />
  );
}

export function SubtitlePanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  return (
    <LabeledLinksPanel
      site={site}
      onRefresh={onRefresh}
      fieldKey="subtitleUrls"
      heading="💬 콘텐츠별 자막"
      linkPlaceholder="자막 링크 붙여넣기"
      fileAccept=".srt,.vtt,.ass,.ssa,.txt"
      uploadLabel="+ 자막 파일 업로드"
    />
  );
}
