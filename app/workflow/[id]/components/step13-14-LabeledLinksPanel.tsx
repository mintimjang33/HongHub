'use client';

import { useMemo, useState } from 'react';
import type { Site, ContentUnit, LabeledItem, LabeledField } from '../types';
import { normalizeLabeledItems, uploadSceneMedia } from '../utils';
import { CopyButton } from './shared';

// SRT 타임코드("00:00:04,000")를 초 단위 숫자로 변환.
function srtTimeToSeconds(t: string): number {
  const m = t.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4], 10) / 1000;
}

type SrtCue = { start: number; end: number; text: string };

// SRT 텍스트를 { 시작초, 끝초, 자막텍스트 } 배열로 파싱 — 미리보기에서 현재 재생 시각에 맞는
// 자막 한 줄을 찾는 용도. 형식이 깨져 있으면(타임코드 줄이 없는 블록 등) 그 블록만 건너뛴다.
function parseSrtCues(text: string): SrtCue[] {
  return text
    .split(/\r?\n\r?\n+/)
    .map((block) => {
      const lines = block.split(/\r?\n/).filter((l) => l.trim());
      const timeLine = lines.find((l) => l.includes('-->'));
      if (!timeLine) return null;
      const [startStr, endStr] = timeLine.split('-->');
      const textLines = lines.slice(lines.indexOf(timeLine) + 1);
      if (!startStr || !endStr) return null;
      return { start: srtTimeToSeconds(startStr), end: srtTimeToSeconds(endStr), text: textLines.join('\n') };
    })
    .filter((c): c is SrtCue => c !== null);
}

// 콘텐츠(유닛) 하나의 나레이션 또는 자막 중 한 필드만 다루는 조각 — 링크 붙여넣기와 파일 업로드
// (uploadSceneMedia 재사용) 둘 다 지원, 라벨(예: "원본"/"1.3배속", "SRT"/"수정본")로 여러 후보를
// 구분한다. NarrationSubtitlePanel이 유닛 하나당 이 조각을 두 번(나레이션/자막) 나란히 띄운다.
//
// 2026-09-15 추가 — textEditable(자막 섹션에서만 true로 넘김): 외부 프로그램(Subtitle Edit 등)
// 없이도 화면에서 바로 SRT 텍스트를 고칠 수 있게 "편집" 버튼을 추가했다(사용자 요청: "12단계에
// srt 편집기를 구현 못하냐고"). 파일 내용을 그대로 fetch해서 textarea에 띄우고, 저장하면 그
// 텍스트를 새 파일로 업로드해서 같은 항목의 url만 교체한다(라벨 유지) — 별도 항목을 추가하는
// 게 아니라 "그 자리에서 고치는" 동작이라 저장 시 원래 있던 항목을 대체한다.
// 같은 유닛의 나레이션 목록을 같이 받아서, 편집 중 오디오를 재생하며 16:9/9:16 화면 비율
// 미리보기 안에 현재 재생 시각에 맞는 자막 한 줄을 실시간으로 띄운다(사용자 요청: "16:9 나
// 9:16 화면에서 보면서 편집을 할수있었으면 해") — 정렬/줄수/배경색/글자색도 미리보기에서
// 바로 바꿔볼 수 있다(사용자 요청: "왼쪽정열,우측정열,가운데정열 / 글자줄 1줄,2줄 / 배경색상 /
// 글자색상"). 이 스타일 컨트롤은 지금은 미리보기 전용이다 — 저장은 자막 텍스트만 하고, 이
// 스타일 값 자체를 DB에 저장하거나 실제 렌더링(캡션 프리셋)에 반영하지는 않는다.
function LabeledFieldSection({
  site,
  unit,
  onRefresh,
  fieldKey,
  heading,
  linkPlaceholder,
  fileAccept,
  uploadLabel,
  textEditable,
}: {
  site: Site;
  unit: ContentUnit;
  onRefresh: () => void;
  fieldKey: LabeledField;
  heading: string;
  linkPlaceholder: string;
  fileAccept: string;
  uploadLabel: string;
  textEditable?: boolean;
}) {
  const items = normalizeLabeledItems(unit[fieldKey]);
  const narrationItems = normalizeLabeledItems(unit.narrationUrls);
  const [linkDraft, setLinkDraft] = useState('');
  const [linkLabelDraft, setLinkLabelDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');
  const [previewAspect, setPreviewAspect] = useState<'16:9' | '9:16'>('9:16');
  const [previewTime, setPreviewTime] = useState(0);
  const [previewNarrationUrl, setPreviewNarrationUrl] = useState('');
  const [previewAlign, setPreviewAlign] = useState<'left' | 'center' | 'right'>('center');
  const [previewLines, setPreviewLines] = useState<1 | 2>(2);
  const [previewBg, setPreviewBg] = useState('#000000');
  const [previewColor, setPreviewColor] = useState('#ffffff');

  const cues = useMemo(() => parseSrtCues(editText), [editText]);
  const activeCue = useMemo(() => cues.find((c) => previewTime >= c.start && previewTime <= c.end), [cues, previewTime]);

  async function saveItems(newItems: LabeledItem[]) {
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, unitPatch: { id: unit.id, fields: { [fieldKey]: newItems } } }),
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function addLink() {
    const value = linkDraft.trim();
    if (!value) return;
    const label = linkLabelDraft.trim();
    setLinkDraft('');
    setLinkLabelDraft('');
    await saveItems([...items, { label, url: value }]);
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError('');
    try {
      const uploaded = await Promise.all(
        Array.from(files).map(async (f) => ({ label: f.name.replace(/\.[^./]+$/, ''), url: await uploadSceneMedia(f) }))
      );
      await saveItems([...items, ...uploaded]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function removeItem(idx: number) {
    await saveItems(items.filter((_, i) => i !== idx));
  }

  async function relabelItem(idx: number, label: string) {
    await saveItems(items.map((item, i) => (i === idx ? { ...item, label } : item)));
  }

  async function startEdit(idx: number) {
    setEditError('');
    setEditLoading(true);
    setEditingIdx(idx);
    setPreviewTime(0);
    setPreviewNarrationUrl(narrationItems[0]?.url || '');
    try {
      const res = await fetch(items[idx].url);
      if (!res.ok) throw new Error(`파일을 못 불러왔어요 (${res.status})`);
      setEditText(await res.text());
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditLoading(false);
    }
  }

  function cancelEdit() {
    setEditingIdx(null);
    setEditText('');
    setEditError('');
  }

  async function saveEdit(idx: number) {
    setEditLoading(true);
    setEditError('');
    try {
      const blob = new Blob([editText], { type: 'text/plain' });
      const name = `${items[idx].label || 'subtitle'}.srt`;
      const file = new File([blob], name, { type: 'text/plain' });
      const url = await uploadSceneMedia(file);
      await saveItems(items.map((item, i) => (i === idx ? { ...item, url } : item)));
      setEditingIdx(null);
      setEditText('');
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditLoading(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-black text-neutral-400">{heading}</div>
      {items.length > 0 && (
        <div className="space-y-1">
          {items.map((item, idx) => (
            <div key={idx} className="space-y-1">
              <div className="flex items-center gap-1.5 bg-neutral-50 border border-neutral-200 rounded-lg px-2 py-1">
                <input
                  defaultValue={item.label}
                  onBlur={(e) => e.target.value !== item.label && relabelItem(idx, e.target.value)}
                  placeholder="라벨(예: 원본, 1.3배속)"
                  className="w-28 shrink-0 border border-neutral-200 rounded px-1.5 py-1 text-[10px] font-bold bg-white"
                />
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 truncate text-[11px] text-blue-600 hover:underline">
                  {item.url}
                </a>
                <CopyButton text={item.url} />
                {textEditable && (
                  <button
                    onClick={() => (editingIdx === idx ? cancelEdit() : startEdit(idx))}
                    title="편집"
                    className="shrink-0 text-[10px] font-black text-neutral-400 hover:text-blue-600"
                  >
                    ✏️
                  </button>
                )}
                <button onClick={() => removeItem(idx)} title="삭제" className="shrink-0 text-[10px] font-black text-neutral-400 hover:text-red-500">
                  ✕
                </button>
              </div>
              {textEditable && editingIdx === idx && (
                <div className="border border-blue-200 rounded-lg p-2 bg-blue-50/30 space-y-2">
                  {editLoading && editText === '' ? (
                    <p className="text-[10px] text-neutral-400">불러오는 중...</p>
                  ) : (
                    <div className="flex gap-3 flex-wrap">
                      <div className="shrink-0 space-y-1.5">
                        <div className="flex gap-1">
                          <button
                            onClick={() => setPreviewAspect('16:9')}
                            className={`text-[10px] font-black px-2 py-1 rounded ${previewAspect === '16:9' ? 'bg-black text-white' : 'bg-white border border-neutral-200'}`}
                          >
                            16:9
                          </button>
                          <button
                            onClick={() => setPreviewAspect('9:16')}
                            className={`text-[10px] font-black px-2 py-1 rounded ${previewAspect === '9:16' ? 'bg-black text-white' : 'bg-white border border-neutral-200'}`}
                          >
                            9:16
                          </button>
                        </div>
                        <div
                          className="bg-neutral-900 rounded-lg overflow-hidden flex items-end relative"
                          style={{
                            width: previewAspect === '16:9' ? 220 : 124,
                            height: previewAspect === '16:9' ? 124 : 220,
                            justifyContent: previewAlign === 'left' ? 'flex-start' : previewAlign === 'right' ? 'flex-end' : 'center',
                          }}
                        >
                          <p
                            className="text-[11px] font-bold px-2 pb-3 leading-snug whitespace-pre-wrap overflow-hidden"
                            style={{
                              textAlign: previewAlign,
                              color: previewColor,
                              backgroundColor: previewBg,
                              display: '-webkit-box',
                              WebkitLineClamp: previewLines,
                              WebkitBoxOrient: 'vertical',
                              maxWidth: '100%',
                            }}
                          >
                            {activeCue?.text || ''}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => setPreviewAlign('left')}
                            className={`text-[10px] font-black px-1.5 py-1 rounded ${previewAlign === 'left' ? 'bg-black text-white' : 'bg-white border border-neutral-200'}`}
                          >
                            좌
                          </button>
                          <button
                            onClick={() => setPreviewAlign('center')}
                            className={`text-[10px] font-black px-1.5 py-1 rounded ${previewAlign === 'center' ? 'bg-black text-white' : 'bg-white border border-neutral-200'}`}
                          >
                            중앙
                          </button>
                          <button
                            onClick={() => setPreviewAlign('right')}
                            className={`text-[10px] font-black px-1.5 py-1 rounded ${previewAlign === 'right' ? 'bg-black text-white' : 'bg-white border border-neutral-200'}`}
                          >
                            우
                          </button>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => setPreviewLines(1)}
                            className={`text-[10px] font-black px-1.5 py-1 rounded ${previewLines === 1 ? 'bg-black text-white' : 'bg-white border border-neutral-200'}`}
                          >
                            1줄
                          </button>
                          <button
                            onClick={() => setPreviewLines(2)}
                            className={`text-[10px] font-black px-1.5 py-1 rounded ${previewLines === 2 ? 'bg-black text-white' : 'bg-white border border-neutral-200'}`}
                          >
                            2줄
                          </button>
                        </div>
                        <div className="flex gap-2 items-center">
                          <label className="flex items-center gap-1 text-[10px] font-bold text-neutral-500">
                            배경
                            <input type="color" value={previewBg} onChange={(e) => setPreviewBg(e.target.value)} className="w-6 h-6 border border-neutral-200 rounded" />
                          </label>
                          <label className="flex items-center gap-1 text-[10px] font-bold text-neutral-500">
                            글자
                            <input type="color" value={previewColor} onChange={(e) => setPreviewColor(e.target.value)} className="w-6 h-6 border border-neutral-200 rounded" />
                          </label>
                        </div>
                        {narrationItems.length > 0 ? (
                          <div className="space-y-1">
                            {narrationItems.length > 1 && (
                              <select
                                value={previewNarrationUrl}
                                onChange={(e) => setPreviewNarrationUrl(e.target.value)}
                                className="w-full border border-neutral-200 rounded px-1 py-1 text-[10px]"
                              >
                                {narrationItems.map((n, i) => (
                                  <option key={i} value={n.url}>
                                    {n.label || `나레이션 ${i + 1}`}
                                  </option>
                                ))}
                              </select>
                            )}
                            <audio
                              key={previewNarrationUrl}
                              src={previewNarrationUrl}
                              controls
                              onTimeUpdate={(e) => setPreviewTime(e.currentTarget.currentTime)}
                              style={{ width: previewAspect === '16:9' ? 220 : 124 }}
                            />
                          </div>
                        ) : (
                          <p className="text-[9px] text-neutral-400">나레이션이 등록돼야 오디오랑 같이 미리볼 수 있어요</p>
                        )}
                      </div>
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={14}
                        className="flex-1 min-w-[220px] border border-neutral-200 rounded px-2 py-1.5 text-[11px] font-mono bg-white"
                        placeholder="1&#10;00:00:00,000 --> 00:00:04,000&#10;자막 텍스트"
                      />
                    </div>
                  )}
                  {editError && <p className="text-[10px] text-red-500 font-bold">{editError}</p>}
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => saveEdit(idx)}
                      disabled={editLoading}
                      className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                    >
                      {editLoading ? '저장 중...' : '저장 (새 파일로 교체)'}
                    </button>
                    <button onClick={cancelEdit} className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-neutral-200">
                      취소
                    </button>
                  </div>
                </div>
              )}
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
          onKeyDown={(e) => e.key === 'Enter' && addLink()}
          placeholder={linkPlaceholder}
          className="flex-1 border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px]"
        />
        <button
          onClick={addLink}
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
            handleUpload(e.target.files);
            e.target.value = '';
          }}
          className="hidden"
        />
      </label>
      {uploadError && <p className="text-[10px] text-red-500 font-bold">{uploadError}</p>}
    </div>
  );
}

// 13번(나레이션(TTS) & 자막생성) 전용 — 예전엔 나레이션·자막을 각자 콘텐츠 목록을 통째로 훑는
// 별개 아코디언 두 개로 보여줘서, 콘텐츠 하나의 나레이션·자막을 같이 보려면 두 목록을 각각 펼쳐
// 찾아야 했다(2026-09-09, 사용자 지적: "1번컨텐츠를 열면 함께 확인할수 있도록" — 13·14번을 워크플로우
// 단계에서 하나로 합친 것과 같은 맥락으로, 실제 화면도 콘텐츠 단위로 먼저 묶고 그 안에 나레이션·
// 자막을 같이 두는 구조로 바꿔달라는 요청). 콘텐츠(유닛) 단위로 한 번만 아코디언을 열고, 그 안에서
// LabeledFieldSection을 나레이션/자막 두 번 나란히 띄운다.
export function NarrationSubtitlePanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
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
      <div className="text-xs font-black text-neutral-500 mb-2">🎙 나레이션(TTS) & 💬 자막</div>
      <div className="space-y-1.5">
        {units.map((u) => {
          const narrationCount = normalizeLabeledItems(u.narrationUrls).length;
          const subtitleCount = normalizeLabeledItems(u.subtitleUrls).length;
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
                    narrationCount > 0 ? 'text-emerald-600 bg-emerald-50' : 'text-neutral-300 bg-neutral-50'
                  }`}
                >
                  🎙 {narrationCount}개
                </span>
                <span
                  className={`shrink-0 text-[10px] font-black rounded-full px-2 py-0.5 ${
                    subtitleCount > 0 ? 'text-emerald-600 bg-emerald-50' : 'text-neutral-300 bg-neutral-50'
                  }`}
                >
                  💬 {subtitleCount}개
                </span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 pt-1 border-t border-neutral-50 space-y-3">
                  <p className="text-[10px] text-neutral-400">소재: {u.material}</p>
                  <LabeledFieldSection
                    site={site}
                    unit={u}
                    onRefresh={onRefresh}
                    fieldKey="narrationUrls"
                    heading="🎙 나레이션(TTS)"
                    linkPlaceholder="음성 링크 붙여넣기 (ElevenLabs/AI Studio 공유 링크 등)"
                    fileAccept="audio/*"
                    uploadLabel="+ 음성 파일 업로드"
                  />
                  <LabeledFieldSection
                    site={site}
                    unit={u}
                    onRefresh={onRefresh}
                    fieldKey="subtitleUrls"
                    heading="💬 자막"
                    linkPlaceholder="자막 링크 붙여넣기"
                    fileAccept=".srt,.vtt,.ass,.ssa,.txt"
                    uploadLabel="+ 자막 파일 업로드"
                    textEditable
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
