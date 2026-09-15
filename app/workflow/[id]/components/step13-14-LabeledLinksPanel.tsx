'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Site, ContentUnit, LabeledItem, LabeledField } from '../types';
import { normalizeLabeledItems, uploadSceneMedia } from '../utils';
import { CopyButton, downloadFile } from './shared';

// SRT 타임코드("00:00:04,000")를 초 단위 숫자로 변환.
function srtTimeToSeconds(t: string): number {
  const m = t.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4], 10) / 1000;
}

type SrtCue = { start: number; end: number; text: string; textStart: number; textEnd: number };

// SRT 텍스트를 { 시작초, 끝초, 자막텍스트, 원문 안에서의 글자 위치 } 배열로 파싱 — 미리보기에서
// 현재 재생 시각에 맞는 자막 한 줄을 찾는 용도이자, textStart/textEnd는 오른쪽 "원문 SRT" 패널을
// 현재 선택된 큐 위치로 자동 스크롤시키는 데 쓴다. 형식이 깨져 있으면(타임코드 줄이 없는 블록 등)
// 그 블록만 건너뛴다.
function parseSrtCues(text: string): SrtCue[] {
  const sepRegex = /\r?\n\r?\n+/g;
  const blocks: { start: number; end: number }[] = [];
  let blockStart = 0;
  let m: RegExpExecArray | null;
  while ((m = sepRegex.exec(text))) {
    blocks.push({ start: blockStart, end: m.index });
    blockStart = m.index + m[0].length;
  }
  blocks.push({ start: blockStart, end: text.length });

  const cues: SrtCue[] = [];
  for (const { start, end } of blocks) {
    const block = text.slice(start, end);
    const lines = block.split(/\r?\n/).filter((l) => l.trim());
    const timeLine = lines.find((l) => l.includes('-->'));
    if (!timeLine) continue;
    const [startStr, endStr] = timeLine.split('-->');
    const textLines = lines.slice(lines.indexOf(timeLine) + 1);
    if (!startStr || !endStr) continue;
    cues.push({ start: srtTimeToSeconds(startStr), end: srtTimeToSeconds(endStr), text: textLines.join('\n'), textStart: start, textEnd: end });
  }
  return cues;
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

type PreviewStyle = {
  align: 'left' | 'center' | 'right';
  lines: 1 | 2;
  fontSize: number;
  bg: string;
  color: string;
};

const DEFAULT_PREVIEW_STYLE: PreviewStyle = { align: 'center', lines: 2, fontSize: 15, bg: '#000000', color: '#ffffff' };

// 원문 SRT 텍스트영역에서 캐럿을 옮길 때(클릭/방향키) 왼쪽 미리보기와 동기화할지 판단하는 데
// 쓰는 "탐색용" 키 목록 — 일반 타이핑 키는 여기 없어서 문자를 입력할 때마다는 동기화가 안 된다.
const CARET_NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

// 2026-09-16(14차) 추가 — 사용자 지적: "지금 12단계에서 시프트+엔터면 줄바꿈이자나? 그럼 그걸
// srt파일에 적용해줘". 화면 속 자막(contentEditable span)에서 Shift+Enter를 누르면 브라우저가
// 보통 <br>(또는 블록 요소)을 DOM에 직접 넣어서 "보기엔" 줄이 나뉘지만, 바로 아래
// updateSelectedCueText가 읽던 e.currentTarget.textContent는 <br>를 완전히 무시한다
// (예: "가나<br>다라".textContent === "가나다라" — 공백조차 안 남고 그대로 붙어버림). 그 결과
// 화면에서 Shift+Enter로 줄을 나눠도 포커스를 벗어나 저장되는 순간 그 줄바꿈이 사라지고 두 줄이
// 공백 없이 붙어버리는 버그가 있었다. <br>와 블록 요소 경계를 실제 개행문자(\n)로 바꾼 뒤 읽어서,
// 화면에서 나눈 줄바꿈이 실제로 cue.text에 반영되고 serializeSrtCues를 거쳐 SRT 파일에도 그대로
// 물리적 줄바꿈으로 저장되게 한다.
function readEditableTextWithBreaks(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('br').forEach((br) => br.replaceWith(document.createTextNode('\n')));
  clone.querySelectorAll('div, p').forEach((block) => {
    block.insertAdjacentText('beforebegin', '\n');
  });
  return (clone.textContent || '').replace(/^\n+/, '');
}

// 2026-09-16(22차) 추가 — 사용자 지적: "클릭해도 다운로드가 안되는데?" — 이 목록의 파일 링크가
// <a href target="_blank">뿐이라, Supabase Storage 응답의 Content-Type에 따라 브라우저가
// 다운로드 대신 새 탭에 그대로 열어버리는 경우(.mlt는 XML이라 특히 그렇다)가 있었다. 13/14번
// 모달의 이미지·영상 다운로드 버튼(shared.tsx의 downloadFile — fetch로 받아 blob URL을 만들어
// 강제로 저장)과 같은 방식을 여기 파일 목록에도 적용한다. 파일명은 라벨이 있으면
// "라벨+원래 확장자", 없으면 URL의 원래 파일명을 그대로 쓴다.
function filenameForItem(item: LabeledItem): string {
  const urlName = item.url.split('/').pop()?.split('?')[0] || 'file';
  const extMatch = urlName.match(/\.[a-zA-Z0-9]+$/);
  const ext = extMatch ? extMatch[0] : '';
  return item.label ? `${item.label}${ext}` : urlName;
}

// 콘텐츠(유닛) 하나의 나레이션 또는 자막 중 한 필드만 다루는 조각 — 링크 붙여넣기와 파일 업로드
// (uploadSceneMedia 재사용) 둘 다 지원, 라벨(예: "원본"/"1.3배속", "SRT"/"수정본")로 여러 후보를
// 구분한다. NarrationSubtitlePanel이 유닛 하나당 이 조각을 두 번(나레이션/자막) 나란히 띄운다.
//
// 2026-09-15 추가 — textEditable(자막 섹션에서만 true로 넘김): 외부 프로그램(Subtitle Edit 등)
// 없이도 화면에서 바로 SRT 텍스트를 고칠 수 있게 "편집" 버튼을 추가했다. 나레이션 목록을 같이
// 받아서, 편집 중 오디오를 재생하며 16:9/9:16 화면 비율 미리보기 안에 현재 재생 시각에 맞는
// 자막을 실시간으로 띄운다. 미리보기 화면의 자막 텍스트 자체가 contentEditable이라 그 자리에서
// 클릭해 고치면(포커스 아웃 시 저장) 그 큐 하나만 바뀌고 전체 SRT가 다시 합쳐진다. Enter는 커서
// 뒷부분을 다음 자막 화면으로 분리하고, Shift+Enter는 같은 화면 안에서 줄바꿈만 한다. 반대로
// "다음 자막 내용 당겨와 합치기" 버튼(mergeWithNextCue)은 다음 자막의 텍스트를 현재 자막 뒤에
// 붙이고 시간 구간도 합친다(사용자 질문: "다음장면에 있는것을 앞으로 당겨와서 붙일때는 어떻게
// 하면되?" — Enter로 나누는 것의 반대 동작이 없어서 추가). 원문 SRT(고급) 보기는 미리보기
// 오른쪽에 고정 너비(w-72)로 기본 펼쳐서 둔다(사용자 요청: "화면 오른쪽 끝에 자막 원문이 보이게
// 해줘"). 바깥 컨테이너는 flex-wrap 없이 overflow-x-auto만 줘서 컨테이너 폭이 좁아도 줄바꿈으로
// 아래에 떨어지지 않고 항상 오른쪽에 붙는다. 왼쪽 칼럼은 미리보기 박스와 같은 고정 폭
// (width: 480/270)을 줘서 안내 문구 같은 길이가 불확실한 텍스트가 flex item을 옆으로 넓혀버려
// 오른쪽 패널이 뒤로 밀리는 것도 막는다(사용자 지적: "공간이 너무 남잖아").
//
// 2026-09-16 추가 — 지금까지는 왼쪽(미리보기 ‹/›, 재생 추적)→오른쪽(원문 SRT 스크롤) 방향으로만
// 동기화됐다(사용자 지적: "왼쪽 화면에서 화살표로 화면이 선택된 글자에 따라 오른쪽 글자도 같이
// 일치해서 보이는데 오른쪽에서 글자를 선택한것은 왼쪽이 연동되서 이동하지는 않아"). 원문 SRT
// 텍스트영역에서 클릭하거나 방향키로 캐럿을 옮기면(syncSelectedCueFromCaret) 그 위치가 속한
// 큐를 찾아 seekToCue로 왼쪽 미리보기(+오디오 재생 위치)도 같이 옮기도록 반대 방향 동기화를
// 추가했다. 문자를 입력할 때마다는 동작하면 안 되므로(캐럿이 계속 오른쪽으로 밀리면서 타이핑
// 중에 오디오까지 계속 seek되어 방해됨) 클릭과 탐색용 키(CARET_NAV_KEYS)에서만 부른다.
//
// 2026-09-16(15차) 수정 — 정렬/줄수/글자크기/배경·글자색(previewAlign 등)은 처음엔 컴포넌트
// state 기본값으로만 뒀더니 편집창을 닫았다 열 때마다 초기값(중앙/2줄/13px)으로 리셋됐다
// (사용자 지적: "이 설정값은 왜 저장이 안되???"). 처음엔 나레이션 선택(previewNarrationUrl)과
// 똑같이 localStorage에 저장했는데, 사용자가 "로컬에 저장되면 다른곳에서 보면 또 다르게
// 나오는데?? 그러면 안되지~"라고 재지적 — 기기마다 달라지는 게 문제였다. 이제 이 스타일만
// unit.captionStyle(DB, types.ts)에 저장한다(narrationPrefKey는 개인 취향이라 그대로
// localStorage 유지). 아래 saveCaptionStyle 참고.
//
// 2026-09-16(6차) 수정 — export로 변경. 사용자 요청("14단계에서... 수동으로 업로드, 삭제
// 할수있게 해주고~")으로 14번(렌더링) 단계도 "콘텐츠 하나에 라벨 붙은 링크/파일 여러 개"라는
// 완전히 같은 구조(narrationUrls/subtitleUrls와 동일)가 필요해져서, 이 조각을 새로 만든
// step14-RenderPanel.tsx에서도 그대로 재사용할 수 있게 export한다.
export function LabeledFieldSection({
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
  const [previewAlign, setPreviewAlign] = useState<'left' | 'center' | 'right'>(DEFAULT_PREVIEW_STYLE.align);
  const [previewLines, setPreviewLines] = useState<1 | 2>(DEFAULT_PREVIEW_STYLE.lines);
  const [previewBg, setPreviewBg] = useState(DEFAULT_PREVIEW_STYLE.bg);
  const [previewColor, setPreviewColor] = useState(DEFAULT_PREVIEW_STYLE.color);
  const [previewFontSize, setPreviewFontSize] = useState(DEFAULT_PREVIEW_STYLE.fontSize);
  const [selectedCueIdx, setSelectedCueIdx] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rawSrtRef = useRef<HTMLTextAreaElement>(null);

  const cues = useMemo(() => parseSrtCues(editText), [editText]);
  const selectedCue = cues[selectedCueIdx];

  // 왼쪽 미리보기에서 자막을 넘기면(‹/› 버튼, 재생 중 자동 추적) 오른쪽 "원문 SRT" 패널도 같은
  // 자막 위치로 스크롤을 맞춘다 — 줄바꿈 개수로 대략적인 세로 위치를 계산해서 스크롤만 이동시키고
  // 포커스는 뺏지 않는다(포커스를 뺏으면 화면 자막을 편집 중일 때 방해가 된다). editText 자체가
  // 바뀔 때(타이핑 중)는 재스크롤하지 않도록 selectedCueIdx/editingIdx에만 의존시킨다.
  useEffect(() => {
    const ta = rawSrtRef.current;
    if (!ta || !selectedCue) return;
    const before = editText.slice(0, selectedCue.textStart);
    const lineIndex = (before.match(/\n/g) || []).length;
    const style = window.getComputedStyle(ta);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 16;
    const target = lineIndex * lineHeight - ta.clientHeight / 2 + lineHeight;
    ta.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCueIdx, editingIdx]);

  // 마지막으로 골랐던 나레이션을 편집 화면을 다시 열 때마다 기억한다 — 사용자 지적: "이거
  // 마지막했던걸로 자동 저장하게 해줘~ 자꾸 바뀌고 있어서". 콘텐츠(유닛)별로 따로 기억하도록
  // localStorage 키에 unit.id를 넣는다. 기기마다 달라도 무방한 개인 취향이라 그대로 둔다 —
  // 자막 스타일(정렬/줄수/글자크기/색상)과 달리 다른 브라우저에서 다르게 보여도 문제 없음.
  const narrationPrefKey = `honghub_preview_narration_${unit.id}`;

  // 2026-09-16(15차) 수정 — 사용자 지적: "로컬에 저장되면 다른곳에서 보면 또 다르게 나오는데??
  // 그러면 안되지~" → "srt파일과 별도로 줄바꿈/텍스트크기/중앙정렬 이런걸 DB에 저장을 해둬 각
  // 컨텐츠의 자막 설정으로". 정렬/줄수/글자크기/배경·글자색을 더 이상 localStorage에 저장하지
  // 않고, 이 유닛(unit.captionStyle)에 PATCH로 저장한다 — subtitleUrls 등 다른 필드와 같은
  // /api/script-draft unitPatch 경로를 그대로 쓴다. 이제 어느 브라우저/기기에서 열어도 같은
  // 값을 보고, 13/14번(shared.tsx의 SceneImageModal/SceneVideoModal)도 이 값을 그대로 읽어서
  // 적용한다(이전엔 13/14번이 이 설정을 전혀 몰랐다).
  async function saveCaptionStyle(next: Partial<PreviewStyle>) {
    const current: PreviewStyle = { align: previewAlign, lines: previewLines, fontSize: previewFontSize, bg: previewBg, color: previewColor };
    const merged = { ...current, ...next };
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, unitPatch: { id: unit.id, fields: { captionStyle: merged } } }),
      });
      onRefresh();
    } catch {
      // 저장 실패해도 이번 세션 미리보기 동작에는 지장 없음 — 다만 새로고침하거나 다른
      // 기기에서 열면 이 변경이 반영 안 돼 있을 수 있다.
    }
  }

  function updatePreviewAlign(v: 'left' | 'center' | 'right') {
    setPreviewAlign(v);
    saveCaptionStyle({ align: v });
  }
  function updatePreviewLines(v: 1 | 2) {
    setPreviewLines(v);
    saveCaptionStyle({ lines: v });
  }
  function updatePreviewFontSize(v: number) {
    setPreviewFontSize(v);
    saveCaptionStyle({ fontSize: v });
  }
  function updatePreviewBg(v: string) {
    setPreviewBg(v);
    saveCaptionStyle({ bg: v });
  }
  function updatePreviewColor(v: string) {
    setPreviewColor(v);
    saveCaptionStyle({ color: v });
  }

  function seekToCue(idx: number) {
    if (idx < 0 || idx >= cues.length) return;
    setSelectedCueIdx(idx);
    if (audioRef.current) audioRef.current.currentTime = cues[idx].start;
    setPreviewTime(cues[idx].start);
  }

  // 오른쪽 "원문 SRT" 텍스트영역에서 캐럿이 옮겨지면(클릭/방향키) 그 위치가 속한 큐를 찾아
  // seekToCue로 왼쪽 미리보기(+오디오 재생 위치)도 같이 옮긴다 — 위 2026-09-16 주석 참고.
  function syncSelectedCueFromCaret(el: HTMLTextAreaElement) {
    const offset = el.selectionStart;
    const idx = cues.findIndex((c) => offset >= c.textStart && offset < c.textEnd);
    if (idx !== -1 && idx !== selectedCueIdx) seekToCue(idx);
  }

  // 오디오가 "재생 중"일 때만 현재 시각에 맞는 큐로 선택을 자동으로 따라가게 한다. 이걸 일시정지
  // 상태에서도 무조건 돌리면, ‹/› 버튼으로 수동 이동시키자마자 오디오의 currentTime 대입이 비동기로
  // timeupdate 이벤트를 발생시켜 방금 바꾼 selectedCueIdx를 즉시 원래 값으로 되돌려버리는 경쟁
  // 상태가 생긴다(실제로는 바뀌었다가 같은 렌더 사이클 안에서 도로 원상복구됐던 것). 재생 중일
  // 때만 자동 추적하도록 좁혀서 이 충돌을 없앤다.
  function onAudioTimeUpdate(t: number) {
    setPreviewTime(t);
    if (audioRef.current?.paused) return;
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

  // contentEditable 안에서 커서가 있는 문자 위치를 텍스트 오프셋으로 계산한다(중첩 노드가 있어도
  // 안전하도록 Range.toString() 길이로 계산하는 표준적인 방법).
  function getCaretOffset(el: HTMLElement): number {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.focusNode) return el.textContent?.length ?? 0;
    const range = sel.getRangeAt(0).cloneRange();
    range.selectNodeContents(el);
    range.setEnd(sel.focusNode, sel.focusOffset);
    return range.toString().length;
  }

  // 엔터를 누르면 같은 화면 안에서 줄바꿈하는 대신, 커서 위치에서 자막을 둘로 쪼개 뒷부분을
  // 다음 자막 화면으로 넘긴다. 새 큐의 시간은 원래 큐의 구간을 글자수 비율로 나눠서 대략적으로
  // 배정한다 — 실제 발화 속도와 정확히 안 맞을 수 있으니 필요하면 원문 SRT(고급)에서 타임코드를
  // 손으로 다듬을 것.
  function splitSelectedCueAtCaret(el: HTMLElement) {
    const cue = cues[selectedCueIdx];
    if (!cue) return;
    const offset = getCaretOffset(el);
    const full = el.textContent || '';
    const before = full.slice(0, offset).trim();
    const after = full.slice(offset).trim();
    if (!after) return; // 커서가 맨 끝이면 나눌 게 없다
    const totalLen = before.length + after.length || 1;
    const splitAt = cue.start + (cue.end - cue.start) * (before.length / totalLen);
    const nextCues = [...cues];
    nextCues[selectedCueIdx] = { ...cue, end: splitAt, text: before };
    // textStart/textEnd는 곧바로 serializeSrtCues → setEditText로 다시 파싱되면서 버려지는
    // 임시 값이라 실제 위치는 안 맞아도 되지만, 타입상 채워는 둬야 한다.
    nextCues.splice(selectedCueIdx + 1, 0, { start: splitAt, end: cue.end, text: after, textStart: cue.textStart, textEnd: cue.textEnd });
    setEditText(serializeSrtCues(nextCues));
  }

  // Enter로 자막을 나누는 것의 반대 — 다음 자막의 내용을 현재 자막 뒤로 당겨와 하나로 합친다.
  // 시간 구간도 현재 시작 ~ 다음 끝으로 합쳐진다(사용자 질문: "다음장면에 있는것을 앞으로
  // 당겨와서 붙일때는 어떻게 하면되?").
  function mergeWithNextCue() {
    if (selectedCueIdx >= cues.length - 1) return;
    const current = cues[selectedCueIdx];
    const next = cues[selectedCueIdx + 1];
    const merged: SrtCue = {
      start: current.start,
      end: next.end,
      text: `${current.text} ${next.text}`.trim(),
      textStart: current.textStart,
      textEnd: next.textEnd,
    };
    const nextCues = [...cues];
    nextCues.splice(selectedCueIdx, 2, merged);
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

  // 2026-09-16 추가 — 사용자 요청: "12단계에서 수정한 자막파일에 최종 선택 체크박스를
  // 만들어주고... 이 체크한게 13단계로 넘어가게 되는거야". 후보(원본/재생성본 등)가 여러 개
  // 쌓여도 13번(ImageVideoPanel)이 무조건 배열의 첫 번째만 읽던 문제를 고치기 위한 짝 기능 —
  // 이 목록(나레이션 또는 자막) 안에서 정확히 하나만 "최종"으로 표시한다. 체크하면 그 항목만
  // selected:true, 나머지는 전부 false로 내려가고(단일 선택), 체크를 풀면 그 항목만 false가
  // 된다(전부 선택 해제된 상태도 허용 — 그러면 13번은 예전처럼 첫 번째로 fallback한다).
  async function setFinalSelection(idx: number, checked: boolean) {
    const next = items.map((item, i) => (i === idx ? { ...item, selected: checked } : checked ? { ...item, selected: false } : item));
    await saveItems(next);
  }

  async function startEdit(idx: number) {
    setEditError('');
    setEditLoading(true);
    setEditingIdx(idx);
    setPreviewTime(0);
    setSelectedCueIdx(0);
    let savedUrl = '';
    try {
      savedUrl = localStorage.getItem(narrationPrefKey) || '';
    } catch {
      // 프라이빗 모드 등에서 localStorage가 막혀있을 수 있다 — 기본값으로 진행.
    }
    const hasSaved = savedUrl && narrationItems.some((n) => n.url === savedUrl);
    setPreviewNarrationUrl(hasSaved ? savedUrl : narrationItems[0]?.url || '');
    // 2026-09-16(15차) 수정 — 스타일은 이제 localStorage가 아니라 unit.captionStyle(DB)에서 읽는다.
    const savedStyle = unit.captionStyle;
    setPreviewAlign(savedStyle?.align ?? DEFAULT_PREVIEW_STYLE.align);
    setPreviewLines(savedStyle?.lines ?? DEFAULT_PREVIEW_STYLE.lines);
    setPreviewFontSize(savedStyle?.fontSize ?? DEFAULT_PREVIEW_STYLE.fontSize);
    setPreviewBg(savedStyle?.bg ?? DEFAULT_PREVIEW_STYLE.bg);
    setPreviewColor(savedStyle?.color ?? DEFAULT_PREVIEW_STYLE.color);
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
                {/* 2026-09-16(22차) 추가 — 사용자 지적: "클릭해도 다운로드가 안되는데?" — 위
                    링크는 target="_blank"라 새 탭에서 열릴 뿐, 파일 형식(.mlt 등 XML)에 따라
                    브라우저가 그대로 표시해버려 실제 저장은 안 되는 경우가 있었다. 모달의
                    이미지·영상 다운로드와 같은 방식(fetch → blob → 강제 저장)을 여기도 적용. */}
                <button
                  onClick={() => downloadFile(item.url, filenameForItem(item))}
                  title="다운로드"
                  className="shrink-0 text-[10px] font-black text-neutral-400 hover:text-blue-600"
                >
                  ⬇
                </button>
                {/* 2026-09-16 추가 — 최종 선택 체크박스(위 setFinalSelection 주석 참고). title로
                    이 체크가 다음 단계에서 실제로 쓰인다는 걸 명시해서, 그냥 표시용 체크가 아니라
                    실제 동작이 있다는 걸 알 수 있게 한다. */}
                <label
                  className={`shrink-0 flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded cursor-pointer ${
                    item.selected ? 'text-emerald-700 bg-emerald-50' : 'text-neutral-400'
                  }`}
                  title="최종 선택 — 체크한 항목이 다음 단계(13번 등)에서 사용됩니다"
                >
                  <input
                    type="checkbox"
                    checked={!!item.selected}
                    onChange={(e) => setFinalSelection(idx, e.target.checked)}
                    className="w-3.5 h-3.5"
                  />
                  최종
                </label>
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
                    <div className="flex gap-3 items-start overflow-x-auto">
                      <div className="shrink-0 space-y-1.5" style={{ width: previewAspect === '16:9' ? 480 : 270 }}>
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
                        </div>
                        <div
                          className="bg-neutral-900 rounded-lg overflow-hidden flex flex-col justify-end relative"
                          style={{
                            width: previewAspect === '16:9' ? 480 : 270,
                            height: previewAspect === '16:9' ? 270 : 480,
                          }}
                        >
                          {cues.length > 0 && (
                            <span className="absolute top-2 left-1/2 -translate-x-1/2 text-[11px] font-bold text-white bg-black/60 rounded-full px-2 py-0.5">
                              {selectedCueIdx + 1} / {cues.length}
                            </span>
                          )}
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
                          {/* 줄마다 배경이 따로 붙는 실제 자막 느낌을 내려면 배경이 있는 요소가
                              inline이어야 한다(block/-webkit-box는 여러 줄을 하나의 사각형으로
                              뭉쳐버림). 바깥 div로 정렬/줄바꿈 폭을 잡고, 실제 편집 가능한 span은
                              inline + box-decoration-break: clone으로 줄마다 독립된 배경 박스가
                              나오게 한다. */}
                          <div
                            className="px-2 pb-3"
                            style={{
                              textAlign: previewAlign,
                              maxWidth: previewLines === 1 ? '92%' : '70%',
                              marginLeft: previewAlign === 'right' ? 'auto' : previewAlign === 'center' ? 'auto' : undefined,
                              marginRight: previewAlign === 'left' ? 'auto' : previewAlign === 'center' ? 'auto' : undefined,
                            }}
                          >
                            <span
                              key={`${selectedCueIdx}-${cues.length}`}
                              contentEditable
                              suppressContentEditableWarning
                              onBlur={(e) => updateSelectedCueText(readEditableTextWithBreaks(e.currentTarget))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  splitSelectedCueAtCaret(e.currentTarget);
                                }
                                // Shift+Enter는 기본 동작(줄바꿈 삽입)을 그대로 둔다.
                              }}
                              className="font-bold leading-snug outline-none focus:ring-2 focus:ring-blue-400"
                              style={{
                                display: 'inline',
                                color: previewColor,
                                backgroundColor: previewBg,
                                fontSize: previewFontSize,
                                padding: '2px 6px',
                                borderRadius: 3,
                                boxDecorationBreak: 'clone',
                                WebkitBoxDecorationBreak: 'clone',
                                whiteSpace: 'pre-line',
                                cursor: 'text',
                              }}
                            >
                              {selectedCue?.text || ''}
                            </span>
                          </div>
                        </div>
                        <p className="text-[9px] text-neutral-400">
                          화면 속 자막을 직접 클릭해서 고치세요 — 다른 곳 클릭하면 저장됩니다.
                          <br />• <b>Shift+Enter</b>: 커서 위치에서 줄바꿈(원하는 지점에서 한 줄→두 줄로 표시).
                          <br />• <b>Enter</b>: 커서 뒷부분을 잘라 다음 자막 화면으로 넘기기(자막 하나를 둘로 분리).
                          <br />• 아래 <b>&quot;다음 자막 내용 당겨와 합치기&quot;</b> 버튼: Enter로 나눈 것의 반대 — 다음 자막을 지금 자막 뒤로 당겨와 하나로 합치기(시간 구간도 같이 합쳐짐).
                        </p>
                        <button
                          onClick={mergeWithNextCue}
                          disabled={selectedCueIdx >= cues.length - 1}
                          className="text-[10px] font-bold text-blue-600 hover:underline disabled:opacity-30 disabled:no-underline disabled:cursor-not-allowed text-left"
                        >
                          ▸ 다음 자막 내용 당겨와 합치기
                        </button>
                        <div className="flex gap-1">
                          <button
                            onClick={() => updatePreviewAlign('left')}
                            className={`text-[10px] font-black px-1.5 py-1 rounded ${previewAlign === 'left' ? 'bg-black text-white' : 'bg-white border border-neutral-200'}`}
                          >
                            좌
                          </button>
                          <button
                            onClick={() => updatePreviewAlign('center')}
                            className={`text-[10px] font-black px-1.5 py-1 rounded ${previewAlign === 'center' ? 'bg-black text-white' : 'bg-white border border-neutral-200'}`}
                          >
                            중앙
                          </button>
                          <button
                            onClick={() => updatePreviewAlign('right')}
                            className={`text-[10px] font-black px-1.5 py-1 rounded ${previewAlign === 'right' ? 'bg-black text-white' : 'bg-white border border-neutral-200'}`}
                          >
                            우
                          </button>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => updatePreviewLines(1)}
                            className={`text-[10px] font-black px-1.5 py-1 rounded ${previewLines === 1 ? 'bg-black text-white' : 'bg-white border border-neutral-200'}`}
                          >
                            1줄
                          </button>
                          <button
                            onClick={() => updatePreviewLines(2)}
                            className={`text-[10px] font-black px-1.5 py-1 rounded ${previewLines === 2 ? 'bg-black text-white' : 'bg-white border border-neutral-200'}`}
                          >
                            2줄
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold text-neutral-500 shrink-0">글자크기</span>
                          <input
                            type="number"
                            min={8}
                            max={60}
                            value={previewFontSize}
                            onChange={(e) => updatePreviewFontSize(Number(e.target.value) || previewFontSize)}
                            className="w-14 border border-neutral-200 rounded px-1.5 py-1 text-[10px]"
                          />
                          <span className="text-[10px] text-neutral-400">px</span>
                        </div>
                        <div className="flex gap-2 items-center">
                          <label className="flex items-center gap-1 text-[10px] font-bold text-neutral-500">
                            배경
                            <input type="color" value={previewBg} onChange={(e) => updatePreviewBg(e.target.value)} className="w-6 h-6 border border-neutral-200 rounded" />
                          </label>
                          <label className="flex items-center gap-1 text-[10px] font-bold text-neutral-500">
                            글자
                            <input type="color" value={previewColor} onChange={(e) => updatePreviewColor(e.target.value)} className="w-6 h-6 border border-neutral-200 rounded" />
                          </label>
                        </div>
                        {narrationItems.length > 0 ? (
                          <div className="space-y-1">
                            {narrationItems.length > 1 && (
                              <select
                                value={previewNarrationUrl}
                                onChange={(e) => {
                                  setPreviewNarrationUrl(e.target.value);
                                  try {
                                    localStorage.setItem(narrationPrefKey, e.target.value);
                                  } catch {
                                    // 저장 실패해도 이번 세션 미리보기 동작에는 지장 없음.
                                  }
                                }}
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
                      <details open className="w-72 shrink-0">
                        {/* 왼쪽 미리보기 칼럼은 "16:9/9:16" 버튼 줄(높이) + space-y-1.5 간격(6px)만큼
                            내려간 곳에서 박스가 시작한다. summary 한 줄만으로는 그 높이가 안 맞아서
                            원문 SRT 박스 상단이 미리보기 박스 상단보다 위에 떠 있었다(사용자 지적:
                            "라인좀 맞춰주고") — summary에 같은 높이(h-7)+간격(mb-1.5)을 줘서 맞춘다. */}
                        <summary className="h-7 flex items-center text-[10px] font-bold text-neutral-400 cursor-pointer select-none mb-1.5">
                          원문 SRT 직접 보기/수정 (고급)
                        </summary>
                        <textarea
                          ref={rawSrtRef}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onClick={(e) => syncSelectedCueFromCaret(e.currentTarget)}
                          onKeyUp={(e) => {
                            if (CARET_NAV_KEYS.has(e.key)) syncSelectedCueFromCaret(e.currentTarget);
                          }}
                          className="w-full border border-neutral-200 rounded px-2 py-1.5 text-[10px] font-mono bg-white"
                          style={{ height: previewAspect === '16:9' ? 270 : 480 }}
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
