'use client';

import { useMemo, useRef, useState } from 'react';
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

function secondsToSrtTime(t: number): string {
  const clamped = Math.max(0, t);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  const pad = (n: number, len: number) => String(n).padStart(len, '0');
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
}

// 미리보기 화면에서 직접 고친 큐 배열을 다시 표준 SRT 텍스트로 합친다(번호는 1부터 다시 매김).
function serializeSrtCues(cues: SrtCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${secondsToSrtTime(c.start)} --> ${secondsToSrtTime(c.end)}\n${c.text}`).join('\n\n') + '\n';
}

// 콘텐츠(유닛) 하나의 나레이션 또는 자막 중 한 필드만 다루는 조각 — 링크 붙여넣기와 파일 업로드
// (uploadSceneMedia 재사용) 둘 다 지원, 라벨(예: "원본"/"1.3배속", "SRT"/"수정본")로 여러 후보를
// 구분한다. NarrationSubtitlePanel이 유닛 하나당 이 조각을 두 번(나레이션/자막) 나란히 띄운다.
//
// 2026-09-15 추가 — textEditable(자막 섹션에서만 true로 넘김): 외부 프로그램(Subtitle Edit 등)
// 없이도 화면에서 바로 SRT 텍스트를 고칠 수 있게 "편집" 버튼을 추가했다(사용자 요청: "12단계에
// srt 편집기를 구현 못하냐고"). 나레이션 목록을 같이 받아서, 편집 중 오디오를 재생하며 16:9/9:16
// 화면 비율 미리보기 안에 현재 재생 시각에 맞는 자막을 실시간으로 띄운다(사용자 요청: "16:9 나
// 9:16 화면에서 보면서 편집을 할수있었으면 해"). 배경색은 프레임 전체가 아니라 자막 텍스트 자체에
// fit-content 너비로 붙는다(실제 자막 스타일과 동일하게 줄 너비만큼만 색칠 — 사용자 지적: "보통
// 이렇게 나오지 않자나 텍스트 뒤에만 색칠이 있지"). 글자 크기 슬라이더도 추가.
// 2026-09-15(2차) — 미리보기 화면의 자막 텍스트 자체를 contentEditable로 만들어 그 자리에서
// 클릭해 고치면(포커스 아웃 시 저장) 그 큐 하나만 텍스트가 바뀌고 전체 SRT가 다시 합쳐지도록
// 했다(사용자 지적: "편집을 화면에서 하는게 아니네?? 화면에서 편집을 할수있게 해줘"). 이전/다음
// 자막 버튼으로 오디오 재생 없이도 큐 단위로 넘나들 수 있고, 오디오를 재생하면 현재 시각에 맞는
// 큐로 자동 이동한다.
// 2026-09-15(3차) — 미리보기와 원문 SRT 영역을 좌우 flex로 나눴더니, 원문 영역을 <details>로
// 접어도 flex-1이 남은 가로 공간을 계속 차지해서 미리보기 옆에 거대한 빈 공간이 남았다(사용자
// 지적: "이게 크게한거야??? / 오른쪽이 다 비었는데?"). 좌우 2열 대신 위아래 1열로 바꾸고(미리보기
// 위, 접힌 원문 SRT 아래), 미리보기 자체도 더 키웠다(400/225 -> 480/270).
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
  const [previewFontSize, setPreviewFontSize] = useState(15);
  const [selectedCueIdx, setSelectedCueIdx] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const cues = useMemo(() => parseSrtCues(editText), [editText]);
  const selectedCue = cues[selectedCueIdx];

  function seekToCue(idx: number) {
    if (idx < 0 || idx >= cues.length) return;
    setSelectedCueIdx(idx);
    if (audioRef.current) audioRef.current.currentTime = cues[idx].start;
    setPreviewTime(cues[idx].start);
  }

  // 오디오가 재생되면서 현재 시각에 맞는 큐로 선택을 자동으로 따라가게 한다 — 사용자가 재생만
  // 해도 화면 미리보기 캡션이 알아서 넘어간다. prev/next 버튼으로 수동 이동한 직후에는 오디오
  // 위치가 그 큐 시작점으로 맞춰지므로 자연스럽게 이어진다.
  function onAudioTimeUpdate(t: number) {
    setPreviewTime(t);
    const idx = cues.findIndex((c) => t >= c.start && t <= c.end);
    if (idx !== -1 && idx !== selectedCueIdx) setSelectedCueIdx(idx);
  }

  // 미리보기 화면 안의 캡션 텍스트를 직접 클릭해서 고치면(contentEditable), 그 큐 하나만 텍스트를
  // 바꾼 뒤 전체를 다시 표준 SRT로 합쳐서 editText에 반영한다.
  function updateSelectedCueText(newText: string) {
    if (!cues[selectedCueIdx]) return;
    const nextCues = cues.map((c, i) => (i === selectedCueIdx ? { ...c, text: newText } : c));
    setEditText(serializeSrtCues(nextCues));
  }

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
    setSelectedCueIdx(0);
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
                    <div className="flex flex-col gap-2">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
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
                          {cues.length > 0 && (
                            <span className="text-[10px] text-neutral-400 ml-auto">
                              {selectedCueIdx + 1} / {cues.length}
                            </span>
                          )}
                        </div>
                        <div
                          className="bg-neutral-900 rounded-lg overflow-hidden flex items-end relative"
                          style={{
                            width: previewAspect === '16:9' ? 480 : 270,
                            height: previewAspect === '16:9' ? 270 : 480,
                            justifyContent: previewAlign === 'left' ? 'flex-start' : previewAlign === 'right' ? 'flex-end' : 'center',
                          }}
                        >
                          {cues.length > 1 && (
                            <>
                              <button
                                onClick={() => seekToCue(selectedCueIdx - 1)}
                                disabled={selectedCueIdx <= 0}
                                title="이전 자막"
                                className="absolute left-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/50 text-white text-[11px] font-black disabled:opacity-20"
                              >
                                ‹
                              </button>
                              <button
                                onClick={() => seekToCue(selectedCueIdx + 1)}
                                disabled={selectedCueIdx >= cues.length - 1}
                                title="다음 자막"
                                className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/50 text-white text-[11px] font-black disabled:opacity-20"
                              >
                                ›
                              </button>
                            </>
                          )}
                          <p
                            key={selectedCueIdx}
                            contentEditable
                            suppressContentEditableWarning
                            onBlur={(e) => updateSelectedCueText(e.currentTarget.textContent || '')}
                            className="font-bold leading-snug whitespace-pre-wrap overflow-hidden mb-3 outline-none focus:ring-2 focus:ring-blue-400"
                            style={{
                              textAlign: previewAlign,
                              color: previewColor,
                              backgroundColor: previewBg,
                              fontSize: previewFontSize,
                              display: '-webkit-box',
                              WebkitLineClamp: previewLines,
                              WebkitBoxOrient: 'vertical',
                              width: 'fit-content',
                              maxWidth: 'calc(100% - 16px)',
                              padding: '2px 6px',
                              borderRadius: 3,
                              minWidth: 20,
                              cursor: 'text',
                            }}
                          >
                            {selectedCue?.text || ''}
                          </p>
                        </div>
                        <p className="text-[9px] text-neutral-400">화면 속 자막을 직접 클릭해서 고치세요 — 다른 곳 클릭하면 저장됩니다.</p>
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
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold text-neutral-500 shrink-0">글자크기</span>
                          <input
                            type="range"
                            min={10}
                            max={28}
                            value={previewFontSize}
                            onChange={(e) => setPreviewFontSize(Number(e.target.value))}
                            className="flex-1"
                          />
                          <span className="text-[10px] text-neutral-400 w-6 shrink-0">{previewFontSize}</span>
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
                              ref={audioRef}
                              key={previewNarrationUrl}
                              src={previewNarrationUrl}
                              controls
                              onTimeUpdate={(e) => onAudioTimeUpdate(e.currentTarget.currentTime)}
                              style={{ width: previewAspect === '16:9' ? 480 : 270 }}
                            />
                          </div>
                        ) : (
                          <p className="text-[9px] text-neutral-400">나레이션이 등록돼야 오디오랑 같이 미리볼 수 있어요</p>
                        )}
                      </div>
                      <details className="w-64 shrink-0">
                        <summary className="text-[10px] font-bold text-neutral-400 cursor-pointer select-none mb-1">
                          원문 SRT 직접 보기/수정 (고급)
                        </summary>
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          rows={12}
                          className="w-full border border-neutral-200 rounded px-2 py-1.5 text-[10px] font-mono bg-white"
                          placeholder="1&#10;00:00:00,000 --> 00:00:04,000&#10;자막 텍스트"
                        />
                      </details>
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

// 나레이션(TTS) & 자막생성 단계 전용(2026-09-15 — 파일명은 예전 번호 체계의 "13-14"가 남아있지만,
// 현재 워크플로우 문서 기준 번호는 12번이다. 정확한 단계 번호는 파이프라인마다 다를 수 있으니
// 항상 그 파이프라인의 workflow_content를 먼저 확인할 것). 예전엔 나레이션·자막을 각자 콘텐츠 목록을 통째로 훑는
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
