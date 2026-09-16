'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SceneBlock, Site, Step, CaptionStyle } from '../types';
import { EMPTY_SCENE_DRAFT, uploadSceneMedia, parseSceneBlocks, serializeSceneBlocks, nextSceneId, sortScenesById } from '../utils';

// 2026-09-17(3차) 추가 — 사용자 요청: "현재 모달 위치를 못 옮기는데 옮길 수 있게 해주고". 씬
// 이미지/영상 미리보기 모달(SceneImageModal/SceneVideoModal)의 상단 바를 드래그해서 모달을
// 화면 안에서 옮길 수 있게 하는 작은 훅 — 두 모달이 구조가 같아서 공용으로 뺐다. 오프셋은
// 화면 중앙(기본 위치) 기준 상대 이동량이라, transform: translate로 얹기만 하면 된다.
function useDraggableModal() {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  useEffect(() => {
    function handleMove(e: MouseEvent) {
      if (!dragRef.current) return;
      setOffset({ x: dragRef.current.baseX + (e.clientX - dragRef.current.startX), y: dragRef.current.baseY + (e.clientY - dragRef.current.startY) });
    }
    function handleUp() {
      dragRef.current = null;
    }
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  function startDrag(e: React.MouseEvent) {
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
  }

  return { offset, startDrag };
}

// 2026-09-13 (4차) 추가 — 사용자 요청: "13단계에서 모달을 띄웠을 때 선택한 이미지를 다운받을
// 수 있어야 하는데 다운로드 버튼이 없어 추가해줘". Supabase Storage 공개 URL은 HongHub와
// 다른 오리진이라, <a href download>만으로는 브라우저가 download 속성을 무시하고 새 탭에서
// 열어버리는 경우가 많다(교차 출처 다운로드 제약) — fetch로 실제 바이트를 받아 blob URL을
// 만든 뒤 숨겨진 <a>를 눌러야 오리진에 상관없이 항상 실제로 저장된다.
// 2026-09-13 (6차) 추가 — 사용자 요청: "한 장면당 타임도 적어줘 예) 0:00~0:09 (9s) 이런 방식으로".
// "0:00-0:09" 형태의 time 문자열에서 초 단위 길이를 계산해 뒤에 "(Ns)"로 덧붙인다. 형식이 안
// 맞으면(자유 텍스트로 남긴 옛 데이터 등) 원문 그대로 돌려준다.
// 2026-09-16(27차) 수정 — 사용자 지적: "왜 이렇게 된거야? 자막이 5초인데?" — 이 필드가 정수 초만
// 담을 수 있어서, 자막(SRT)의 5.5초 같은 실측값을 반올림(5.5→6)해서 저장할 수밖에 없었다.
// "시간"은 자막(실제 나레이션) 기준이어야 하고 편집도 거기 맞춰야 하는 값이므로, 반올림으로
// 정보를 잃으면 안 된다 — 초 자리에 소수점 한 자리까지 담을 수 있도록 정규식을 확장한다(정수
// 초만 있는 기존 데이터는 그대로 계속 읽힌다 — 하위호환).
function formatTimeWithDuration(time: string): string {
  const m = time.match(/^(\d+):(\d+(?:\.\d+)?)\s*[-~]\s*(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) return time;
  const start = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
  const end = parseInt(m[3], 10) * 60 + parseFloat(m[4]);
  const dur = end - start;
  const durStr = Number.isInteger(dur) ? String(dur) : dur.toFixed(1);
  return `${time} (${durStr}s)`;
}

// 2026-09-16(8차) 추가 — 사용자 지적: "원래 자막에서 이건 한줄로 나왔었잖아 그럼 한줄로
// 표시를 해줘야지". 처음엔 글자 수에 비례해 폰트 크기를 줄이는 방식(captionFontSize)으로
// 대응했는데, (9차)에서 긴 줄이 잘리는 부작용을 고치려 최소값을 더 낮췄더니 결국 장면마다
// 자막 길이에 따라 글씨 크기가 들쭉날쭉해지는 문제가 생겼다(사용자 지적, 2026-09-16(12차):
// "13단계에서 글씨 크기가 장면마다 달라~ 12단계에서 그렇게 안했거든~ 1줄은 1줄, 크기 모든곳에서
// 동일"). 12번(나레이션·자막)의 캡션 미리보기는 애초에 글자 수와 무관하게 고정 크기 하나만
// 쓰고, 그 크기에 안 들어가는 긴 줄은 그냥 자연스럽게 줄바꿈되도록 둔다 — 여기도 그 방식을
// 그대로 따른다: 동적 계산 없이 고정 폰트 크기를 쓰고, nowrap을 없애 길면 자연스럽게
// 줄바꿈되게 한다. 대신 12번과 동일하게 boxDecorationBreak: 'clone'을 줘서 줄바꿈되더라도
// 각 줄마다 독립된 배경 박스가 붙는 실제 자막 느낌을 유지한다.
// 2026-09-16(13차) 수정 — 사용자 지적: "글씨크기가 13으로 고정이었는데". 12번의 글자크기는
// 코드 기본값(DEFAULT_PREVIEW_STYLE.fontSize=15)이 아니라 유닛별로 사용자가 직접 조절해서
// localStorage에 저장해둔 값이라, 실제로 이 콘텐츠에서 쓰던 크기는 13이었다 — 코드 기본값이
// 아니라 사용자가 실제로 보고 있던 값에 맞춘다.
// 2026-09-16(15차) 수정 — 12번(step13-14-LabeledLinksPanel.tsx)이 정렬/줄수/글자크기/배경·
// 글자색을 이제 유닛별로 DB(ContentUnit.captionStyle)에 저장해두고, 13번(step16-17-
// ImageVideoPanel.tsx)이 그 값을 SceneEditorList에 captionStyle prop으로 그대로 넘긴다 —
// 12번에서 실제로 조정한 스타일과 13/14번 모달의 캡션 오버레이가 항상 같은 값을 쓰게 하기
// 위함(고정 폰트 크기 하나만 쓰던 방식에서 발전). captionStyle이 아직 없는(그 유닛에서 12번
// 스타일 조정을 한 번도 안 한) 콘텐츠를 위한 안전한 기본값만 여기 남겨둔다.
const DEFAULT_CAPTION_STYLE: CaptionStyle = { align: 'center', lines: 2, fontSize: 13, bg: '#000000', color: '#ffffff' };

export async function downloadFile(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  } catch {
    // 다운로드 실패(네트워크/CORS 등) — 최후 수단으로 새 탭에서 원본 URL을 열어준다.
    window.open(url, '_blank');
  }
}

// 영상을 새 탭으로 안 열고 페이지 안에서 바로 확인할 수 있게 하는 작은 모달.
// 확인 → 닫기 → 다음 확인 → 닫기 흐름이 되게, 오버레이 클릭이나 ✕로 바로 닫힌다.
export function VideoPreviewModal({ videoId, onClose }: { videoId: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-black rounded-xl overflow-hidden w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end p-1.5 bg-neutral-900">
          <button onClick={onClose} className="text-white/70 hover:text-white text-xs font-black px-2 py-1">
            ✕ 닫기
          </button>
        </div>
        <div className="aspect-[9/16] w-full">
          <iframe
            src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
            className="w-full h-full"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
      </div>
    </div>
  );
}

export function ImagePreviewModal({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-black rounded-xl overflow-hidden max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end p-1.5 bg-neutral-900">
          <button onClick={onClose} className="text-white/70 hover:text-white text-xs font-black px-2 py-1">
            ✕ 닫기
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="w-full max-h-[80vh] object-contain" />
      </div>
    </div>
  );
}

// 2026-09-11 추가 — 13번 화풍/캐릭터 선택 칩용 미리보기+선택 모달. 처음엔 칩을 누르면 바로
// 선택되게 만들었는데, 썸네일이 작아서(화풍 13개 한 줄) 실제로 뭘 고르는지 잘 안 보인다는
// 지적("이미지가 너무 잘 안보임")을 받았다. 두 줄로 늘리는 안도 검토했으나, 사용자가 최종적으로
// "한 줄 그대로 두고, 클릭하면 모달로 크게 보여준 다음 선택/취소 하게 하자"고 확정 — 목록 레이아웃은
// 그대로(한 줄, 작은 칩) 두고, 클릭 시에만 이 모달로 원본 크기를 보여준 뒤 확정하게 한다.
// 이미지가 아직 없는 프리셋(referenceImageUrl 빈 문자열)은 깨진 이미지 대신 이모지 플레이스홀더를 보여준다.
export function PresetPickerModal({
  label,
  imageUrl,
  description,
  onConfirm,
  onCancel,
}: {
  label: string;
  imageUrl?: string;
  description?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-white rounded-xl overflow-hidden w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={label} className="w-full max-h-[60vh] object-contain bg-neutral-100" />
        ) : (
          <div className="w-full h-64 bg-neutral-50 flex items-center justify-center text-4xl">🖼️</div>
        )}
        <div className="p-4">
          <p className="text-sm font-black mb-1">{label}</p>
          {description && <p className="text-[11px] text-neutral-500 leading-relaxed mb-3 line-clamp-4">{description}</p>}
          <div className="flex justify-end gap-1.5">
            <button onClick={onCancel} className="text-[11px] font-bold text-neutral-400 hover:text-black px-3 py-1.5">
              취소
            </button>
            <button onClick={onConfirm} className="text-[11px] font-black px-4 py-1.5 rounded-lg bg-black text-white">
              이걸로 선택
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 2026-09-10 추가 — 14번(씬 이미지) 표의 장면이미지 썸네일이 너무 작아서 클릭해도 크게 볼 수
// 없었다(사용자 지적: "클릭해서 크게 볼수가 없어~~"). ImagePreviewModal(캐릭터 썸네일용)을
// 그대로 쓰지 않고 별도로 만든 이유는, 장면은 캐릭터와 달리 여러 개를 순서대로 이어 보는
// 용도가 필요하기 때문 — 이미지 아래에 장면 설명(제목/타임)을 같이 보여주고, 좌우 화살표
// (또는 방향키)로 이전/다음 장면까지 모달을 안 닫고 바로 넘겨볼 수 있게 했다.
// 2026-09-16(7차) 수정 — 사용자 지적: "13단계에 모달이 srt자막 기준이 아니라 씬기준으로
// 보여지고 있음~ 자막기준으로 바꾸려고 함~". (5차)에서는 씬을 기준으로 넘겨보고 그 씬에 묶인
// 자막 줄들을 목록으로만 곁들였는데, 사용자가 원한 건 반대 방향 — ‹/›로 한 번에 넘어가는
// 단위 자체가 "씬"이 아니라 "SRT 자막 줄 하나"여야 한다는 것("자막이 2개가 한 씬이면 장면은
// 2개(이미지는 화면 넘길때까지 보여주면 됨)" — 같은 씬에 묶인 줄 여러 개를 넘기는 동안은
// 같은 이미지가 계속 보이면 된다는 뜻). 그래서 모달의 탐색 배열을 SceneBlock[]이 아니라 이
// ModalNavItem[](자막 줄 하나 = 항목 하나, 그 줄이 속한 씬 인덱스를 같이 들고 있음)로 바꿨다.
// SRT가 아예 없는(로딩 전이거나 자막 자체가 없는) 유닛에서는 lineIdx/text/start/end를 전부
// null로 채운 항목을 씬 개수만큼 만들어 예전과 같은 "씬 기준 넘기기"로 그대로 대체한다.
type ModalNavItem = { lineIdx: number | null; text: string; sceneIdx: number | null; start: number | null; end: number | null };

// 2026-09-16(17차) 추가 — 사용자 요청: "14단계에서 모달을 띄우면 트랙번호 설정, 시간설정,
// 위치설정을 할수 있게". 확인 결과 "시간"은 클립 재생 구간(트리밍)이 아니라 현재 길이를
// 참고로 보여주는 용도(트리밍은 명시적으로 원치 않음)이고, "트랙번호"는 실제로 다른 트랙으로
// 옮기고 싶다는 뜻이었다("위치만 정확하게 셋팅하고 싶은거야 — 숏컷 셋팅파일에다가"). app/api/
// render-position이 실제 .mlt 파일을 읽고/고쳐서 이 값을 돌려준다 — 여기서 같은 모양을 다시
// 선언하는 이유는 서버 전용 라우트 파일을 프런트엔드에서 import할 수 없기 때문.
// 2026-09-16(21차) 추가 — 사용자 요청: "영상의 몇초부토 몇초까지만 사용하고 싶은지 정할수
// 있어?" — inMs/outMs(소스 영상에서 실제로 재생하는 구간)와 sourceMaxMs(그 소스 파일의
// 최대 길이, 이 이상으로는 구간을 늘릴 수 없음)를 추가. app/api/render-position의 ClipPosition과
// 반드시 같은 모양을 유지할 것.
type ClipPosition = {
  file: string;
  positionMs: number;
  durationMs: number;
  trackNumber: number;
  inMs: number;
  outMs: number;
  sourceMaxMs: number;
};

// 밀리초를 "분:초.밀리초"(예: "0:11.000")로 표시 — mlt가 실제로 쓰는 밀리초 정밀도를 그대로
// 보여줘야 한다(사용자 지적: "0:06 이렇게만 나오지만 좀더 디테일하게 나와야 할꺼 같아").
function msToClock(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

// "0:11.000" / "0:11" / "11.5"(초만) 등 여러 표기를 밀리초로 변환. 형식이 안 맞으면 null.
function clockToMs(clock: string): number | null {
  const trimmed = clock.trim();
  let m = trimmed.match(/^(\d+):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (m) {
    const min = parseInt(m[1], 10);
    const s = parseInt(m[2], 10);
    const ms = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) : 0;
    return (min * 60 + s) * 1000 + ms;
  }
  m = trimmed.match(/^(\d+)(?:[.,](\d{1,3}))?$/);
  if (m) {
    const s = parseInt(m[1], 10);
    const ms = m[2] ? parseInt(m[2].padEnd(3, '0').slice(0, 3), 10) : 0;
    return s * 1000 + ms;
  }
  return null;
}

// SceneVideoModal 안에 임베드되는 트랙/위치 입력 필드 — 자체 입력 상태(draft)를 가지므로 별도
// 컴포넌트로 뺐다. info(현재 서버에 저장된 값)가 바뀌면(파일이 바뀌거나 저장 후 갱신되면) 입력칸도
// 그 값으로 다시 맞춘다.
function ClipControlFields({
  info,
  totalTracks,
  onSetPosition,
  onSetTrack,
  onSetRange,
}: {
  info: ClipPosition;
  totalTracks: number;
  onSetPosition: (file: string, positionMs: number) => Promise<void>;
  onSetTrack: (file: string, trackNumber: number) => Promise<void>;
  // 2026-09-16(21차) 추가 — 사용자 요청: "영상의 몇초부토 몇초까지만 사용하고 싶은지 정할수
  // 있어?". 위치(트랙 안 어디서 시작하는지)와는 별개로, 소스 영상 자체에서 어느 구간을 쓸지
  // 지정한다.
  onSetRange: (file: string, inMs: number, outMs: number) => Promise<void>;
}) {
  const [posDraft, setPosDraft] = useState(msToClock(info.positionMs));
  const [trackDraft, setTrackDraft] = useState(String(info.trackNumber));
  const [inDraft, setInDraft] = useState(msToClock(info.inMs));
  const [outDraft, setOutDraft] = useState(msToClock(info.outMs));
  const [savingPos, setSavingPos] = useState(false);
  const [savingTrack, setSavingTrack] = useState(false);
  const [savingRange, setSavingRange] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setPosDraft(msToClock(info.positionMs));
    setTrackDraft(String(info.trackNumber));
    setInDraft(msToClock(info.inMs));
    setOutDraft(msToClock(info.outMs));
  }, [info.file, info.positionMs, info.trackNumber, info.inMs, info.outMs]);

  async function applyPosition() {
    const ms = clockToMs(posDraft);
    if (ms === null) {
      setErr('시간 형식이 올바르지 않습니다. 예: 0:11.000');
      return;
    }
    setErr('');
    setSavingPos(true);
    try {
      await onSetPosition(info.file, ms);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPos(false);
    }
  }

  async function applyTrack() {
    const n = parseInt(trackDraft, 10);
    if (!Number.isFinite(n) || n < 1 || n > totalTracks) {
      setErr(`트랙 번호는 1~${totalTracks} 사이여야 합니다.`);
      return;
    }
    setErr('');
    setSavingTrack(true);
    try {
      await onSetTrack(info.file, n);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingTrack(false);
    }
  }

  // 2026-09-16(24차) 추가 — 사용자 요청: "사용구간의 타임도 적용 오른쪽에 계산해서 표시해줘".
  // 입력칸에 적은 시작~끝만 봐서는 실제로 몇 초짜리 구간인지 바로 계산이 안 되니, 입력값이
  // 바뀔 때마다(아직 "적용"을 안 눌러도) 그 구간 길이를 미리 계산해서 보여준다.
  const rangeDurationLabel = (() => {
    const inMs = clockToMs(inDraft);
    const outMs = clockToMs(outDraft);
    if (inMs === null || outMs === null || outMs <= inMs) return null;
    return `${((outMs - inMs) / 1000).toFixed(3)}s`;
  })();
  // 2026-09-16(26차) 추가 — 사용자 지적: "적용을 해야 하는건지, 적용이 된건지 구분좀 해줘" —
  // 계산된 구간 길이가 지금 입력칸의 임시 값(draft)에서 나온 건지, 실제로 파일에 저장된 값
  // (info.inMs/outMs)과 같은 건지 구분이 안 됐다. 입력칸 값이 서버에 저장된 값과 다르면
  // "아직 적용 안 됨"으로, 같으면(방금 적용했거나 원래 그 값이었거나) "적용됨"으로 표시한다.
  const isRangeDirty = (() => {
    const inMs = clockToMs(inDraft);
    const outMs = clockToMs(outDraft);
    if (inMs === null || outMs === null) return true;
    return inMs !== info.inMs || outMs !== info.outMs;
  })();

  async function applyRange() {
    const inMs = clockToMs(inDraft);
    const outMs = clockToMs(outDraft);
    if (inMs === null || outMs === null) {
      setErr('시간 형식이 올바르지 않습니다. 예: 0:01.000');
      return;
    }
    if (outMs <= inMs) {
      setErr('끝 지점은 시작 지점보다 뒤여야 합니다.');
      return;
    }
    if (outMs > info.sourceMaxMs) {
      setErr(`끝 지점은 원본 영상 길이(${msToClock(info.sourceMaxMs)})를 넘을 수 없습니다.`);
      return;
    }
    setErr('');
    setSavingRange(true);
    try {
      await onSetRange(info.file, inMs, outMs);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingRange(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] text-neutral-400 font-mono">
        클립: {info.file} · 원본 길이 {msToClock(info.sourceMaxMs)}
      </p>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-bold text-neutral-400 w-16 shrink-0">트랙 번호</span>
        <input
          value={trackDraft}
          onChange={(e) => setTrackDraft(e.target.value)}
          className="w-14 border border-neutral-700 bg-neutral-800 rounded-lg px-1.5 py-1 text-[11px] font-mono text-white"
        />
        <span className="text-[10px] text-neutral-500">/ {totalTracks}</span>
        <button onClick={applyTrack} disabled={savingTrack} className="text-[10px] font-black text-blue-400 hover:underline disabled:opacity-40">
          {savingTrack ? '적용 중...' : '적용'}
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-bold text-neutral-400 w-16 shrink-0">타임라인 위치</span>
        <input
          value={posDraft}
          onChange={(e) => setPosDraft(e.target.value)}
          placeholder="0:11.000"
          className="w-28 border border-neutral-700 bg-neutral-800 rounded-lg px-1.5 py-1 text-[11px] font-mono text-white"
        />
        <button onClick={applyPosition} disabled={savingPos} className="text-[10px] font-black text-blue-400 hover:underline disabled:opacity-40">
          {savingPos ? '적용 중...' : '적용'}
        </button>
      </div>
      {/* 2026-09-16(21차) 추가 — 사용자 요청: "영상의 몇초부토 몇초까지만 사용하고 싶은지
          정할수 있어?" — 소스 영상에서 실제로 쓸 구간(시작~끝)을 지정한다. 위 "타임라인 위치"와
          달리 이건 그 영상 파일 자체의 몇 초~몇 초를 보여줄지 정하는 것 — 시작을 늦추면 앞부분을
          자른 것과 같은 효과, 끝을 당기면 뒷부분을 자른 것과 같은 효과다. */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-bold text-neutral-400 w-16 shrink-0">사용 구간</span>
        <input
          value={inDraft}
          onChange={(e) => setInDraft(e.target.value)}
          placeholder="0:00.000"
          className="w-24 border border-neutral-700 bg-neutral-800 rounded-lg px-1.5 py-1 text-[11px] font-mono text-white"
        />
        <span className="text-[10px] text-neutral-500">~</span>
        <input
          value={outDraft}
          onChange={(e) => setOutDraft(e.target.value)}
          placeholder="0:06.000"
          className="w-24 border border-neutral-700 bg-neutral-800 rounded-lg px-1.5 py-1 text-[11px] font-mono text-white"
        />
        <button onClick={applyRange} disabled={savingRange} className="text-[10px] font-black text-blue-400 hover:underline disabled:opacity-40">
          {savingRange ? '적용 중...' : '적용'}
        </button>
        {/* 2026-09-16(25차) 수정 — 사용자 지적: "너무 안보여" — text-neutral-500는 어두운
            모달 배경 위에서 대비가 너무 낮았다. 다른 계산값(원본 길이 등)과 달리 이건 사용자가
            방금 요청해서 새로 넣은 정보라 눈에 띄어야 하므로, 밝은 색+굵게로 확실히 보이게 한다.
            (26차) 수정 — "적용을 해야 하는건지, 적용이 된건지 구분좀 해줘": 입력칸 값이 실제
            저장된 값과 다르면(아직 "적용" 안 누름) 주황색+"미적용", 같으면(적용 완료) 에메랄드
            색+"적용됨"으로 상태 자체를 다르게 보여준다. */}
        {rangeDurationLabel &&
          (isRangeDirty ? (
            <span className="text-[11px] font-bold text-amber-400">({rangeDurationLabel}) · 미적용</span>
          ) : (
            <span className="text-[11px] font-bold text-emerald-400">✓ ({rangeDurationLabel}) 적용됨</span>
          ))}
      </div>
      {err && <p className="text-[10px] text-red-400 font-bold">{err}</p>}
    </div>
  );
}

// SceneVideoModal에 넘기는 렌더링(.mlt) 클립 제어 묶음 — enabled는 14번(mergeMediaColumn)
// 컨텍스트에서만 true (13번에서는 이 패널 자체가 안 보임).
export type ClipControl = {
  enabled: boolean;
  mltUrl: string;
  loading: boolean;
  error: string;
  totalTracks: number;
  info: ClipPosition | null;
  onSetPosition: (file: string, positionMs: number) => Promise<void>;
  onSetTrack: (file: string, trackNumber: number) => Promise<void>;
  onSetRange: (file: string, inMs: number, outMs: number) => Promise<void>;
};

export function SceneImageModal({
  scenes,
  navItems,
  index,
  onClose,
  onNavigate,
  totalLines,
  totalScenes,
  captionStyle,
}: {
  scenes: SceneBlock[];
  navItems: ModalNavItem[];
  index: number;
  onClose: () => void;
  onNavigate: (idx: number) => void;
  totalLines: number;
  totalScenes: number;
  // 2026-09-16(15차) 추가 — 12번에서 유닛별로 저장한 자막 스타일(ContentUnit.captionStyle).
  // 안 넘어오면(옛 데이터, 12번에서 한 번도 조정 안 한 유닛) DEFAULT_CAPTION_STYLE을 쓴다.
  captionStyle?: CaptionStyle;
}) {
  const effectiveCaptionStyle = captionStyle || DEFAULT_CAPTION_STYLE;
  const entry = navItems[index];
  const scene = entry && entry.sceneIdx !== null ? scenes[entry.sceneIdx] : null;
  const hasPrev = index > 0;
  const hasNext = index < navItems.length - 1;
  // 2026-09-17(3차) 추가 — 사용자 요청: "현재 모달 위치를 못 옮기는데 옮길수 있게 해주고".
  const { offset, startDrag } = useDraggableModal();

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' && index < navItems.length - 1) onNavigate(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
      else if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [index, navItems.length, onNavigate, onClose]);

  if (!entry) return null;

  // 2026-09-16(7차) 추가 — 씬에 시간이 있으면 그걸 쓰고, 아직 씬이 없는(gap) 자막 줄이면
  // 그 줄 자신의 시작~끝을 대신 보여준다 — "장면 없음" 구간이어도 최소한 몇 초짜리 구간인지는
  // 알 수 있게.
  const timeLabel = scene?.time
    ? formatTimeWithDuration(scene.time)
    : entry.start !== null && entry.end !== null
      ? formatTimeWithDuration(`${formatSecToMMSS(entry.start)}-${formatSecToMMSS(entry.end)}`)
      : '';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-black rounded-xl overflow-hidden w-full max-w-lg"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 2026-09-17(3차) 추가 — 이 바를 드래그하면 모달이 옮겨진다(cursor-move로 표시). */}
        <div className="flex justify-between items-center px-2 py-1.5 bg-neutral-900 cursor-move" onMouseDown={startDrag}>
          {/* 2026-09-16(7차) 수정 — 사용자 요청: "상단에 넘버를 자막번호, 씬번호로 =>
              # 1 / 전체, S01 / 전체". 자막 줄 번호(#)와 씬 번호(S01)를 각자 따로 보여준다 —
              같은 씬이 여러 줄에 걸쳐 있으면 #만 바뀌고 S01은 그대로 유지된다. */}
          <div className="flex items-center gap-2">
            <span className="text-white/50 text-[11px] font-mono px-1">
              # {entry.lineIdx !== null ? entry.lineIdx + 1 : '—'} / {totalLines}
            </span>
            <span className="text-white/50 text-[11px] font-mono px-1">
              {scene ? scene.id : '—'} / {totalScenes}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* 2026-09-13 (4차) 추가 — 사용자 요청: "13단계에서 모달을 띄웠을 때 선택한
                이미지를 다운받을 수 있어야 하는데 다운로드 버튼이 없어 추가해줘". */}
            {scene?.sceneImage && (
              <button
                onClick={() => downloadFile(scene.sceneImage, `${scene.id}.jpg`)}
                className="text-white/70 hover:text-white text-xs font-black px-2 py-1"
              >
                ⬇ 다운로드
              </button>
            )}
            <button onClick={onClose} className="text-white/70 hover:text-white text-xs font-black px-2 py-1">
              ✕ 닫기
            </button>
          </div>
        </div>
        <div className="relative flex items-center justify-center bg-black min-h-[45vh]">
          {hasPrev && (
            <button
              type="button"
              onClick={() => onNavigate(index - 1)}
              className="absolute left-1.5 top-1/2 -translate-y-1/2 text-white/80 hover:text-white text-2xl font-black w-9 h-9 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full"
              aria-label="이전 자막"
            >
              ‹
            </button>
          )}
          {scene?.sceneImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={scene.sceneImage} alt={scene.title || scene.id} className="max-w-full max-h-[70vh] object-contain" />
          ) : (
            <div className="text-neutral-500 text-xs py-24 text-center px-6">
              {scene ? '이 장면엔 아직 이미지가 없습니다' : '이 자막 구간엔 아직 등록된 장면이 없습니다'}
            </div>
          )}
          {hasNext && (
            <button
              type="button"
              onClick={() => onNavigate(index + 1)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/80 hover:text-white text-2xl font-black w-9 h-9 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full"
              aria-label="다음 자막"
            >
              ›
            </button>
          )}
          {/* 2026-09-16(7차) 추가 — 사용자 요청: "12번에 보여진 자막형태로 화면위에
              보여줘". step13-14-LabeledLinksPanel.tsx의 캡션 미리보기와 같은 스타일(흰 글씨 +
              검은 배경 박스, 화면 하단 중앙)로 지금 이 줄의 자막을 이미지/영상 위에 실제
              캡션처럼 얹어 보여준다. */}
          {entry.text && (
            <div
              className="absolute bottom-4 inset-x-4 pointer-events-none flex"
              style={{
                justifyContent: effectiveCaptionStyle.align === 'left' ? 'flex-start' : effectiveCaptionStyle.align === 'right' ? 'flex-end' : 'center',
              }}
            >
              <span
                className="font-bold inline-block"
                style={{
                  color: effectiveCaptionStyle.color,
                  backgroundColor: effectiveCaptionStyle.bg,
                  fontSize: effectiveCaptionStyle.fontSize,
                  padding: '4px 10px',
                  borderRadius: 3,
                  maxWidth: effectiveCaptionStyle.lines === 1 ? '92%' : '70%',
                  textAlign: effectiveCaptionStyle.align,
                  boxDecorationBreak: 'clone',
                  WebkitBoxDecorationBreak: 'clone',
                  whiteSpace: 'pre-line',
                }}
              >
                {entry.text}
              </span>
            </div>
          )}
        </div>
        <div className="px-3 py-2 bg-neutral-900 space-y-1 max-h-[30vh] overflow-y-auto">
          {/* 2026-09-16(24차) 수정 — 사용자 지적: "아래 타임을 잘보이게 해주고" — 검은 배경
              위에 text-white/40(40% 불투명도)이라 거의 안 보였다. 다른 시간 표기(사용 구간 등)와
              비슷한 밝기로 올리고 두껍게 해서 눈에 띄게 한다. */}
          {timeLabel && <p className="text-white/80 text-[11px] font-bold font-mono">{timeLabel}</p>}
          {/* 2026-09-16(7차) 수정 — 지금 넘어와 있는 자막 줄 텍스트를 눈에 띄게(두껍게) 보여준다
              (사용자 지시: "두껍게"). 예전엔 이 자리에 scene.script(대본 원문)를 옅은 글씨로
              보여줬는데, 이 자막 줄이 이미 그 장면의 실제 최종 자막이라 내용이 겹쳐서
              scene.script 문단은 없앴다(사용자 지시: "삭제"). */}
          {entry.text && (
            <p className="text-white text-[11px] font-bold leading-relaxed">
              # {entry.lineIdx !== null ? entry.lineIdx + 1 : ''} {entry.text}
            </p>
          )}
          {scene && <p className="text-white text-[12px] font-bold leading-relaxed">{scene.title || '(장면 설명 없음)'}</p>}
          {/* 2026-09-13 (9차) 추가, (10차) 순서 변경 — 사용자 요청: "해석을 프롬프트 아래말고
              위쪽으로" — 한국어 해석을 먼저 읽고 나서 원문 영어 프롬프트를 보게 순서를
              바꿨다(note="해석" 필드, 기존에 있었지만 안 쓰이고 있던 필드). */}
          {scene?.note && (
            <p className="text-amber-200/80 text-[11px] leading-relaxed whitespace-pre-wrap border-t border-white/10 pt-1 mt-1">
              💡 {scene.note}
            </p>
          )}
          {/* 2026-09-13 (11차) 추가 — 사용자 요청: "모달에서 프롬프트 복사버튼 추가 해줘" —
              지금까지는 표에서만(CopyButton, 아래 SceneEditorList) 프롬프트를 복사할 수 있고
              모달에선 눈으로 보고 직접 드래그해서 복사해야 했다. 다른 곳(표)과 같은
              CopyButton을 그대로 재사용한다. */}
          {scene?.imagePrompt && (
            <div className="flex items-start gap-1 border-t border-white/10 pt-1 mt-1">
              <p className="flex-1 min-w-0 text-cyan-300/70 text-[10px] font-mono leading-relaxed whitespace-pre-wrap">
                {scene.imagePrompt}
              </p>
              <CopyButton text={scene.imagePrompt} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 2026-09-13 추가 — 사용자 요청: "장면 이미지 오른쪽에 영상장면 추가해줘, 장면 이미지와 동일
// 방식으로". SceneImageModal과 완전히 같은 구조(같은 필터링된 장면 목록 안에서 좌우 화살표로
// 이전/다음 넘겨보기)를 영상용으로 그대로 미러링한다. 기존 SceneImageModal의 시그니처를 바꾸지
// 않고(다른 곳에서 이미 이 컴포넌트를 쓰고 있을 수 있어 영향 범위를 좁히기 위해) 별도 컴포넌트로
// 분리했다.
export function SceneVideoModal({
  scenes,
  navItems,
  index,
  onClose,
  onNavigate,
  totalLines,
  totalScenes,
  clipControl,
  captionStyle,
}: {
  scenes: SceneBlock[];
  navItems: ModalNavItem[];
  index: number;
  onClose: () => void;
  onNavigate: (idx: number) => void;
  totalLines: number;
  totalScenes: number;
  // 2026-09-16(17차) 추가 — 14번(RenderPanel)에서만 넘어온다. 13번 호출부는 이 prop 자체를
  // 안 넘기므로 패널이 안 보인다.
  clipControl?: ClipControl;
  // 2026-09-16(15차) 추가 — SceneImageModal과 동일, 12번에서 저장한 유닛별 자막 스타일.
  captionStyle?: CaptionStyle;
}) {
  const effectiveCaptionStyle = captionStyle || DEFAULT_CAPTION_STYLE;
  const entry = navItems[index];
  const scene = entry && entry.sceneIdx !== null ? scenes[entry.sceneIdx] : null;
  const hasPrev = index > 0;
  const hasNext = index < navItems.length - 1;
  // 2026-09-16(19차) 추가 — 사용자 지적: "2번째 스샷을 보면 초단위가 디테일하게 안나오는데???".
  // <video controls>의 재생시간 표시는 브라우저가 그리는 네이티브 UI라 "0:06 / 0:06"처럼 초
  // 단위로만 나오고 밀리초까지는 커스터마이징할 수 없다 — 대신 재생 시각을 따로 추적해서
  // msToClock(위에서 이미 만든, .mlt 위치 입력과 같은 포맷)으로 정밀하게 보여주는 텍스트를 둔다.
  const [videoTime, setVideoTime] = useState<{ current: number; duration: number } | null>(null);
  useEffect(() => {
    setVideoTime(null);
  }, [scene?.sceneVideo]);
  // 2026-09-17(3차) 추가 — 사용자 요청: "현재 모달 위치를 못 옮기는데 옮길수 있게 해주고".
  const { offset, startDrag } = useDraggableModal();

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' && index < navItems.length - 1) onNavigate(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
      else if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [index, navItems.length, onNavigate, onClose]);

  if (!entry) return null;

  const timeLabel = scene?.time
    ? formatTimeWithDuration(scene.time)
    : entry.start !== null && entry.end !== null
      ? formatTimeWithDuration(`${formatSecToMMSS(entry.start)}-${formatSecToMMSS(entry.end)}`)
      : '';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-black rounded-xl overflow-hidden w-full max-w-lg"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 2026-09-17(3차) 추가 — 이 바를 드래그하면 모달이 옮겨진다(cursor-move로 표시). */}
        <div className="flex justify-between items-center px-2 py-1.5 bg-neutral-900 cursor-move" onMouseDown={startDrag}>
          <div className="flex items-center gap-2">
            <span className="text-white/50 text-[11px] font-mono px-1">
              # {entry.lineIdx !== null ? entry.lineIdx + 1 : '—'} / {totalLines}
            </span>
            <span className="text-white/50 text-[11px] font-mono px-1">
              {scene ? scene.id : '—'} / {totalScenes}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {scene?.sceneVideo && (
              <button
                onClick={() => downloadFile(scene.sceneVideo, `${scene.id}.mp4`)}
                className="text-white/70 hover:text-white text-xs font-black px-2 py-1"
              >
                ⬇ 다운로드
              </button>
            )}
            <button onClick={onClose} className="text-white/70 hover:text-white text-xs font-black px-2 py-1">
              ✕ 닫기
            </button>
          </div>
        </div>
        <div className="relative flex items-center justify-center bg-black min-h-[45vh]">
          {hasPrev && (
            <button
              type="button"
              onClick={() => onNavigate(index - 1)}
              className="absolute left-1.5 top-1/2 -translate-y-1/2 text-white/80 hover:text-white text-2xl font-black w-9 h-9 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full"
              aria-label="이전 자막"
            >
              ‹
            </button>
          )}
          {scene?.sceneVideo ? (
            <video
              src={scene.sceneVideo}
              controls
              autoPlay
              className="max-w-full max-h-[70vh]"
              onTimeUpdate={(e) => setVideoTime({ current: e.currentTarget.currentTime * 1000, duration: e.currentTarget.duration * 1000 || 0 })}
              onLoadedMetadata={(e) => setVideoTime({ current: e.currentTarget.currentTime * 1000, duration: e.currentTarget.duration * 1000 || 0 })}
            />
          ) : (
            <div className="text-neutral-500 text-xs py-24 text-center px-6">
              {scene ? '이 장면엔 아직 영상이 없습니다' : '이 자막 구간엔 아직 등록된 장면이 없습니다'}
            </div>
          )}
          {/* 2026-09-16(19차) 추가 — 브라우저 네이티브 재생시간 표시("0:06 / 0:06")는 밀리초까지
              못 보여주므로, 같은 정밀도(msToClock)로 별도 텍스트를 얹는다. */}
          {videoTime && (
            <span className="absolute top-2 left-2 text-[10px] font-mono text-white bg-black/60 rounded px-1.5 py-0.5 pointer-events-none">
              {msToClock(videoTime.current)} / {msToClock(videoTime.duration)}
            </span>
          )}
          {hasNext && (
            <button
              type="button"
              onClick={() => onNavigate(index + 1)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/80 hover:text-white text-2xl font-black w-9 h-9 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full"
              aria-label="다음 자막"
            >
              ›
            </button>
          )}
          {entry.text && (
            <div
              className="absolute bottom-4 inset-x-4 pointer-events-none flex"
              style={{
                justifyContent: effectiveCaptionStyle.align === 'left' ? 'flex-start' : effectiveCaptionStyle.align === 'right' ? 'flex-end' : 'center',
              }}
            >
              <span
                className="font-bold inline-block"
                style={{
                  color: effectiveCaptionStyle.color,
                  backgroundColor: effectiveCaptionStyle.bg,
                  fontSize: effectiveCaptionStyle.fontSize,
                  padding: '4px 10px',
                  borderRadius: 3,
                  maxWidth: effectiveCaptionStyle.lines === 1 ? '92%' : '70%',
                  textAlign: effectiveCaptionStyle.align,
                  boxDecorationBreak: 'clone',
                  WebkitBoxDecorationBreak: 'clone',
                  whiteSpace: 'pre-line',
                }}
              >
                {entry.text}
              </span>
            </div>
          )}
        </div>
        <div className="px-3 py-2 bg-neutral-900 space-y-1 max-h-[30vh] overflow-y-auto">
          {/* 2026-09-16(19차) 순서 변경 — 사용자 지적: "14단계는 이기능이 주 기능이니까
              영상,이미지 바로 아래에 위치해야해~ 다른 텍스트들 위에~~". 트랙/위치 설정 패널을
              (13번 프롬프트 텍스트들과 달리) 14번의 핵심 기능이므로 영상 바로 아래, 다른 정보
              텍스트보다 먼저 보이게 맨 위로 옮겼다. */}
          {clipControl?.enabled && (
            <div className="pb-1.5 mb-1 border-b border-white/10">
              <p className="text-[10px] font-black text-neutral-400 mb-1">🎬 렌더링 파일(.mlt) 설정</p>
              {!clipControl.mltUrl ? (
                <p className="text-[10px] text-amber-300">
                  아직 Shotcut 프로젝트(.mlt) 파일이 없습니다 — 위 &quot;🎬 렌더링 파일&quot;에서 먼저 업로드해주세요.
                </p>
              ) : clipControl.loading ? (
                <p className="text-[10px] text-neutral-400">불러오는 중...</p>
              ) : clipControl.error ? (
                <p className="text-[10px] text-red-400 font-bold">{clipControl.error}</p>
              ) : !clipControl.info ? (
                <p className="text-[10px] text-neutral-400">
                  이 .mlt 파일에서 {scene ? `${scene.id}.mp4` : '이 장면'} 클립을 찾지 못했습니다(파일명이 장면 ID와 일치해야 합니다).
                </p>
              ) : (
                <ClipControlFields
                  info={clipControl.info}
                  totalTracks={clipControl.totalTracks}
                  onSetPosition={clipControl.onSetPosition}
                  onSetTrack={clipControl.onSetTrack}
                  onSetRange={clipControl.onSetRange}
                />
              )}
            </div>
          )}
          {/* 2026-09-16(24차) 수정 — 사용자 지적: "아래 타임을 잘보이게 해주고" — 검은 배경
              위에 text-white/40(40% 불투명도)이라 거의 안 보였다. 다른 시간 표기(사용 구간 등)와
              비슷한 밝기로 올리고 두껍게 해서 눈에 띄게 한다. */}
          {timeLabel && <p className="text-white/80 text-[11px] font-bold font-mono">{timeLabel}</p>}
          {entry.text && (
            <p className="text-white text-[11px] font-bold leading-relaxed">
              # {entry.lineIdx !== null ? entry.lineIdx + 1 : ''} {entry.text}
            </p>
          )}
          {scene && <p className="text-white text-[12px] font-bold leading-relaxed">{scene.title || '(장면 설명 없음)'}</p>}
          {/* 영상 모달은 이미지프롬프트가 아니라 실제로 이 영상을 만든 영상 프롬프트(video)를
              보여준다 — 화면에 나오는 결과물과 같은 프롬프트여야 비교가 맞다. 해석을 먼저,
              원문 영어 프롬프트를 그 아래에 (사용자 요청: "해석을 프롬프트 아래말고 위쪽으로"). */}
          {scene?.note && (
            <p className="text-amber-200/80 text-[11px] leading-relaxed whitespace-pre-wrap border-t border-white/10 pt-1 mt-1">
              💡 {scene.note}
            </p>
          )}
          {scene?.video && (
            <div className="flex items-start gap-1 border-t border-white/10 pt-1 mt-1">
              <p className="flex-1 min-w-0 text-cyan-300/70 text-[10px] font-mono leading-relaxed whitespace-pre-wrap">
                {scene.video}
              </p>
              <CopyButton text={scene.video} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 프롬프트 한 줄(CLEAN/INFO/영상)을 클립보드에 복사하는 작은 버튼 — 눌렀을 때만 "복사됨"으로 잠깐 바뀐다.
// 2026-09-08 추가 — 선택적 label. 한 카드 안에 복사 버튼이 여러 개(예: 11번의 "전체 복사"/"TTS만
// 복사") 있을 때 전부 "복사"로만 뜨면 뭘 누르는지 구분이 안 돼서, 버튼마다 다른 문구를 넣을 수
// 있게 했다. label을 안 넘기면 기존 그대로 "복사"로 표시된다 — 기존 호출부는 전부 그대로 동작.
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 권한이 없는 브라우저 환경이면 조용히 무시
    }
  }
  return (
    <button
      onClick={handleCopy}
      className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full border bg-white text-neutral-500 border-neutral-200 hover:border-neutral-300"
    >
      {copied ? '복사됨' : label || '복사'}
    </button>
  );
}

// 장면 하나를 추가/수정하는 폼 — id/제목/대본/영상 프롬프트가 기본, CLEAN/INFO는 이미지 2장 방식을 쓸 때만 펼쳐서 채운다.
export function SceneDraftForm({
  draft,
  setDraft,
  onCancel,
  onSave,
  saving,
}: {
  draft: SceneBlock;
  setDraft: (d: SceneBlock) => void;
  onCancel: () => void;
  onSave: () => void | Promise<void>;
  saving: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  // 2026-09-14 추가 — 사용자 요청: "링크는 내가 수동으로 할꺼야~ 저기에 이미지 영상에
  // 링크를 입력하게 하면 되자나?" — 로컬 자동화 대시보드의 "🔗 링크로 등록"과 달리, 여기는
  // 서버가 링크를 대신 열어보지 않는다(Flow 공유 링크를 실제로 열려면 헤드리스 브라우저가
  // 필요한데, Vercel 서버리스에 올리면 타임아웃 위험이 크다고 판단해 보류함). 사용자가 이미
  // 실제 파일 URL로 직접 해석해서 붙여넣는다는 전제로, 입력한 문자열을 그대로
  // sceneImage/sceneVideo에 저장만 한다 — 파일 업로드의 대체 입력 경로일 뿐.
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [videoUrlInput, setVideoUrlInput] = useState('');

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError('');
    try {
      const urls = await Promise.all(Array.from(files).map(uploadSceneMedia));
      setDraft({ ...draft, media: [...draft.media, ...urls] });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleSceneImage(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError('');
    try {
      const url = await uploadSceneMedia(files[0]);
      setDraft({ ...draft, sceneImage: url });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  // 2026-09-13 추가 — 장면영상 업로드. handleSceneImage와 완전히 같은 패턴(단일 파일 →
  // uploadSceneMedia → draft에 URL 한 개 세팅)이고, video/*만 받는다는 것만 다르다.
  async function handleSceneVideo(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError('');
    try {
      const url = await uploadSceneMedia(files[0]);
      setDraft({ ...draft, sceneVideo: url });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-2 space-y-1.5">
      <div className="flex gap-1.5">
        <input
          value={draft.id}
          onChange={(e) => setDraft({ ...draft, id: e.target.value })}
          placeholder="장면 ID (예: S01A)"
          className="w-24 border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px] font-mono"
        />
        <input
          value={draft.time}
          onChange={(e) => setDraft({ ...draft, time: e.target.value })}
          placeholder="타임 (예: 0:00-0:07)"
          className="w-32 border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px] font-mono"
        />
        <input
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="장면 제목 (예: 오프닝훅)"
          className="flex-1 border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px]"
        />
      </div>
      <textarea
        value={draft.script}
        onChange={(e) => setDraft({ ...draft, script: e.target.value })}
        rows={2}
        placeholder="대본 문장 (선택)"
        className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px]"
      />
      <div className="flex gap-3">
        <div className="flex-1">
          <p className="text-[10px] font-black text-neutral-400 mb-1">장면이미지 — Flow 등에서 생성한 결과물을 여기 올려두면 스토리보드 썸네일로 보입니다</p>
          {draft.sceneImage ? (
            <div className="flex items-center gap-1.5 mb-1">
              <img src={draft.sceneImage} alt={draft.title} className="w-16 h-16 object-cover rounded-lg border border-neutral-200" />
              <button onClick={() => setDraft({ ...draft, sceneImage: '' })} className="text-[10px] font-black text-neutral-400 hover:text-red-500">
                ✕ 제거
              </button>
            </div>
          ) : (
            <div>
              <label className="inline-block text-[11px] font-bold text-blue-600 hover:underline cursor-pointer">
                {uploading ? '업로드 중...' : '+ 장면이미지 업로드'}
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploading}
                  onChange={(e) => {
                    handleSceneImage(e.target.files);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </label>
              {/* 2026-09-14 추가 — 사용자 요청: "링크는 내가 수동으로 할꺼야~ 저기에 이미지
                  영상에 링크를 입력하게 하면 되자나?" — 이미 완성된 이미지 URL(Flow 링크를
                  직접 다운로드/재호스팅해서 얻었거나, 다른 경로로 확보한 실제 파일 URL)을
                  파일 선택 없이 바로 붙여넣을 수 있는 대체 입력칸. 업로드 버튼과 동일하게
                  draft.sceneImage만 채워두고, 실제 저장은 아래 "저장" 버튼을 눌러야 반영된다. */}
              <div className="flex items-center gap-1 mt-1">
                <input
                  value={imageUrlInput}
                  onChange={(e) => setImageUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && imageUrlInput.trim()) {
                      setDraft({ ...draft, sceneImage: imageUrlInput.trim() });
                      setImageUrlInput('');
                    }
                  }}
                  placeholder="또는 이미지 링크 붙여넣기"
                  className="flex-1 min-w-0 border border-neutral-200 rounded-lg px-2 py-1 text-[10px]"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!imageUrlInput.trim()) return;
                    setDraft({ ...draft, sceneImage: imageUrlInput.trim() });
                    setImageUrlInput('');
                  }}
                  disabled={!imageUrlInput.trim()}
                  className="shrink-0 text-[10px] font-black px-2 py-1 rounded-lg bg-neutral-100 text-neutral-600 disabled:opacity-40"
                >
                  등록
                </button>
              </div>
            </div>
          )}
        </div>
        {/* 2026-09-13 추가 — 사용자 요청: "장면 이미지 오른쪽에 영상장면 추가해줘, 장면 이미지와
            동일 방식으로(영상 필요한 것들만 몇 개만 등록할 거야)". 대부분의 씬은 비워두면 되고,
            훅/인트로처럼 실제로 영상 클립을 만든 씬만 여기에 올리면 된다. */}
        <div className="flex-1">
          <p className="text-[10px] font-black text-neutral-400 mb-1">장면영상 — 훅/인트로 등 실제로 영상 클립을 만든 장면만 올리면 됩니다(나머지는 비워둠)</p>
          {draft.sceneVideo ? (
            <div className="flex items-center gap-1.5 mb-1">
              <video src={draft.sceneVideo} className="w-16 h-16 object-cover rounded-lg border border-neutral-200" muted />
              <button onClick={() => setDraft({ ...draft, sceneVideo: '' })} className="text-[10px] font-black text-neutral-400 hover:text-red-500">
                ✕ 제거
              </button>
            </div>
          ) : (
            <div>
              <label className="inline-block text-[11px] font-bold text-blue-600 hover:underline cursor-pointer">
                {uploading ? '업로드 중...' : '+ 장면영상 업로드'}
                <input
                  type="file"
                  accept="video/*"
                  disabled={uploading}
                  onChange={(e) => {
                    handleSceneVideo(e.target.files);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </label>
              {/* 2026-09-14 추가 — 이미지와 동일한 링크 붙여넣기 입력칸. */}
              <div className="flex items-center gap-1 mt-1">
                <input
                  value={videoUrlInput}
                  onChange={(e) => setVideoUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && videoUrlInput.trim()) {
                      setDraft({ ...draft, sceneVideo: videoUrlInput.trim() });
                      setVideoUrlInput('');
                    }
                  }}
                  placeholder="또는 영상 링크 붙여넣기"
                  className="flex-1 min-w-0 border border-neutral-200 rounded-lg px-2 py-1 text-[10px]"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!videoUrlInput.trim()) return;
                    setDraft({ ...draft, sceneVideo: videoUrlInput.trim() });
                    setVideoUrlInput('');
                  }}
                  disabled={!videoUrlInput.trim()}
                  className="shrink-0 text-[10px] font-black px-2 py-1 rounded-lg bg-neutral-100 text-neutral-600 disabled:opacity-40"
                >
                  등록
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <textarea
        value={draft.imagePrompt}
        onChange={(e) => setDraft({ ...draft, imagePrompt: e.target.value })}
        rows={3}
        placeholder="이미지 프롬프트 — 위 장면이미지를 생성할 때 쓴(또는 쓸) 프롬프트"
        className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px] font-mono leading-relaxed"
      />
      {/* 2026-09-13 (2차) 수정 — 사용자 지시로 무빙(카메라 지시)과 영상(Flow 생성 프롬프트)을
          완전히 분리(SceneBlock.moving/needsVideoClip/video 참고). 무빙은 정지 이미지에 대한
          연출 지시라 항상 채울 수 있고 Flow에는 절대 안 보낸다 — 항상 펼쳐서 보여준다. 영상은
          "이 씬이 실제로 클립이 필요한가"라는 별도 결정이 먼저 있어야 의미가 있으므로, 체크박스로
          needsVideoClip을 정하고 체크했을 때만 프롬프트 입력창을 펼친다. */}
      <textarea
        value={draft.moving}
        onChange={(e) => setDraft({ ...draft, moving: e.target.value })}
        rows={2}
        placeholder="무빙(전환) 프롬프트 — 정지 이미지의 줌인/패닝 등 카메라 무빙, 또는 다음 장면으로의 전환 연출 지시. Flow에는 안 보내고 14번 렌더링(CapCut/Remotion)에서만 씀"
        className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px] font-mono leading-relaxed"
      />
      <div className="border border-neutral-200 rounded-lg p-1.5 space-y-1.5">
        <label className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-500 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.needsVideoClip}
            onChange={(e) => setDraft({ ...draft, needsVideoClip: e.target.checked })}
          />
          이 장면은 실제 영상 클립이 필요함 (Flow로 생성)
        </label>
        {draft.needsVideoClip && (
          <textarea
            value={draft.video}
            onChange={(e) => setDraft({ ...draft, video: e.target.value })}
            rows={3}
            placeholder="영상 생성 프롬프트 — 위 장면이미지를 실제 Flow 영상 클립으로 만들 때 쓰는 프롬프트"
            className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px] font-mono leading-relaxed"
          />
        )}
      </div>
      <details className="text-[10px]">
        <summary className="cursor-pointer text-neutral-400 font-bold">CLEAN/INFO 이미지 프롬프트 (구버전 이미지 2장 방식 — 지금은 위 "이미지 프롬프트" 하나만 쓰면 됨)</summary>
        <div className="space-y-1.5 mt-1.5">
          <textarea
            value={draft.clean}
            onChange={(e) => setDraft({ ...draft, clean: e.target.value })}
            rows={2}
            placeholder="CLEAN 이미지 프롬프트"
            className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px] font-mono"
          />
          <textarea
            value={draft.info}
            onChange={(e) => setDraft({ ...draft, info: e.target.value })}
            rows={2}
            placeholder="INFO 이미지 프롬프트"
            className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px] font-mono"
          />
        </div>
      </details>
      <div className="border-t border-neutral-200 pt-1.5">
        <p className="text-[10px] font-black text-neutral-400 mb-1">📎 자료 (Flow에서 다운로드한 이미지/영상 첨부)</p>
        {draft.media.length > 0 && (
          <div className="space-y-1 mb-1.5">
            {draft.media.map((url, mi) => (
              <div key={mi} className="flex items-center gap-1.5 bg-white border border-neutral-200 rounded-lg px-2 py-1">
                <a href={url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 truncate text-[11px] text-blue-600 hover:underline">
                  {url}
                </a>
                <button
                  onClick={() => setDraft({ ...draft, media: draft.media.filter((_, i) => i !== mi) })}
                  title="첨부 삭제"
                  className="shrink-0 text-[10px] font-black text-neutral-400 hover:text-red-500"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <label className="inline-block text-[11px] font-bold text-blue-600 hover:underline cursor-pointer">
          {uploading ? '업로드 중...' : '+ 파일 선택'}
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            disabled={uploading}
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
          />
        </label>
        {uploadError && <p className="text-[10px] text-red-500 font-bold mt-1">{uploadError}</p>}
      </div>
      <div className="flex justify-end gap-1.5">
        <button onClick={onCancel} className="text-[11px] font-bold text-neutral-400 hover:text-black px-2">
          취소
        </button>
        <button
          onClick={onSave}
          disabled={saving || !draft.id.trim()}
          className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
}

// 2026-09-12 추가 — 사용자 요청: "13단계에서도 탭별로(전체/루즈 등) 분류해서 일관성 유지가 잘
// 되었는지 확인해볼 수 있게 해줘". CHARACTER_STYLE_PRESETS의 현재 선택된 프리셋이 tabs를 갖고
// 있으면(예: 스틱맨 프리셋의 "젠틀맨 루즈"/"스틱맨"), 각 장면의 imagePrompt 텍스트에서 그 탭의
// keywords를 찾아 매칭되는 탭 번호(인덱스) 배열을 돌려준다 — 하드코딩 없이, 13번 패널 상단에서
// 고른 캐릭터 프리셋이 실제로 갖고 있는 키워드만 그대로 쓴다(화면 분류와 실제 생성 프롬프트가
// 항상 같은 소스를 보게 하기 위함).
function classifyScene(imagePrompt: string, tabs: { label: string; keywords: string[] }[]): number[] {
  if (!imagePrompt) return [];
  return tabs.reduce<number[]>((acc, t, i) => {
    if (t.keywords.some((kw) => kw && imagePrompt.includes(kw))) acc.push(i);
    return acc;
  }, []);
}

// 2026-09-16 추가 — 사용자 요청: "13단계에서 가장 왼쪽에 srt자막이 순서대로 아래로 나열되어야해".
// 12번에서 만든 SRT 원문(초 단위 타임코드)을 {start,end,text}로 파싱한다 — 아래 표의 맨 왼쪽 열이
// 이 배열을 보고 각 장면 시간대에 해당하는 실제 나레이션 문장을 찾아 보여준다. step13-14-
// LabeledLinksPanel.tsx의 parseSrtCues와 파싱 로직은 같지만(파일이 달라 공용 유틸로 뽑지 않고
// 이 화면에 맞게 별도로 둠 — 여긴 편집 위치(textStart/textEnd)가 필요 없이 텍스트만 필요하다),
// 여기서는 텍스트만 필요해서 훨씬 단순하다.
type SrtLine = { start: number; end: number; text: string };
function parseSrtLines(srt: string): SrtLine[] {
  if (!srt) return [];
  const toSec = (t: string) => {
    const m = t.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
    if (!m) return 0;
    return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4], 10) / 1000;
  };
  return srt
    .split(/\r?\n\r?\n+/)
    .map((block) => {
      const rows = block.split(/\r?\n/).filter((l) => l.trim());
      const timeLine = rows.find((l) => l.includes('-->'));
      if (!timeLine) return null;
      const [startStr, endStr] = timeLine.split('-->');
      const text = rows.slice(rows.indexOf(timeLine) + 1).join(' ').trim();
      if (!startStr || !endStr || !text) return null;
      return { start: toSec(startStr), end: toSec(endStr), text };
    })
    .filter((l): l is SrtLine => l !== null);
}

// 장면의 time 문자열("0:00-0:04", formatTimeWithDuration이 읽는 것과 같은 형식)을 초 단위로 변환.
// 2026-09-16(27차) 수정 — formatTimeWithDuration과 같은 이유로 소수점 초를 허용하도록 확장
// (반올림 없이 자막 실측값과 정확히 매칭시키기 위함). 정수 초만 있는 기존 데이터도 그대로 읽힌다.
function parseSceneTimeRange(time: string): [number, number] | null {
  const m = time.match(/^(\d+):(\d+(?:\.\d+)?)\s*[-~]\s*(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const start = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
  const end = parseInt(m[3], 10) * 60 + parseFloat(m[4]);
  return [start, end];
}

// 2026-09-16(2차) 수정 — 처음엔 "장면 기준 행 + 겹치는 SRT 텍스트 이어붙이기"였는데, 사용자가
// 확인 후 "왼쪽 자막에 다른것들을 맞춘게 아니고 기존 씬에 자막을 맞췄네???"라고 지적 — 원하는
// 방향은 반대였다: SRT 줄이 기준(행)이 되고, 그 줄의 시간대에 해당하는 장면(이미지/프롬프트 등)을
// 옆에 붙이는 것(사용자 선택: "SRT 줄 기준(권장)"). subtitleForSceneTime(장면→자막 방향)은 이제
// 안 쓰여서 제거하고, 초를 "0:00" 형식으로 되돌리는 포맷터만 추가한다(아래 startAddForGap이
// 자막 구간에 맞는 장면을 새로 추가할 때 draft.time을 채우는 데 씀).
// 2026-09-16(27차) 수정 — 사용자 지적: "자막이 5초인데? 자막에 맞추라고 했는데?" — 여태 초
// 단위로 반올림(Math.round)해서 저장했는데, 자막(SRT) 실측값은 5.5초처럼 소수점을 갖는 경우가
// 흔해서 반올림하면 "5초"가 "6초"로 뒤바뀌는 등 실제 자막과 눈에 띄게 어긋났다. "시간"은 자막
// (실제 나레이션) 기준으로 편집이 맞춰져야 하는 값이라 정보 손실이 있으면 안 된다 — 반올림 없이
// 소수점 첫째 자리까지 보존하고, 정수 초면(.0이면) 예전처럼 소수점 없이 깔끔하게 표시한다.
function formatSecToMMSS(sec: number): string {
  const totalTenths = Math.max(0, Math.round(sec * 10));
  const m = Math.floor(totalTenths / 600);
  const secTenths = totalTenths % 600;
  const wholeSec = Math.floor(secTenths / 10);
  const tenth = secTenths % 10;
  const secStr = tenth === 0 ? String(wholeSec).padStart(2, '0') : `${String(wholeSec).padStart(2, '0')}.${tenth}`;
  return `${m}:${secStr}`;
}

// 6번 장면 프롬프트 편집 UI — 예전엔 전체를 통짜 텍스트로 붙여넣는 방식뿐이었는데, 장면 하나씩
// 추가/수정/삭제할 수 있게 바꿨다. 저장 시엔 여전히 scenePrompts 문자열 전체를 부모에 돌려준다
// (백엔드/파싱 로직은 그대로 두고 편집 UX만 바꾼 것).
export function SceneEditorList({
  scenePrompts,
  onSave,
  saving,
  characterTabs = [],
  srtText = '',
  mergeMediaColumn = false,
  mltUrl = '',
  captionStyle,
}: {
  scenePrompts: string;
  onSave: (text: string) => void | Promise<void>;
  saving: boolean;
  // 2026-09-12 추가 — 현재 선택된 캐릭터 프리셋의 tabs(CharacterStylePreset.tabs). 비어있으면
  // (탭 분류가 필요 없는 프리셋, 예: 포동이/식빵맨) 탭 바 자체를 안 보여준다.
  characterTabs?: { label: string; keywords: string[] }[];
  // 2026-09-16 추가 — 12번에서 최종 선택된 자막의 원문(ImageVideoPanel이 이미 fetch해서 갖고
  // 있는 srtText를 그대로 넘겨줌). 비어있으면(아직 안 불러왔거나 자막 자체가 없음) 맨 왼쪽 열이
  // 그냥 "—"로 표시된다.
  srtText?: string;
  // 2026-09-16(11차) 추가 — 사용자 지적: "14단계에선 이미지,영상 분류하는게 아니고~ 앞부분은
  // 영상만 있고 자막 9~10번부터 이미지자나? 그럼 있는것만 셋팅해서 보여줘야해". 원래 표는
  // "장면이미지"/"영상장면" 두 열을 항상 나란히 보여주는데, 실제로는 needsVideoClip에 따라
  // 한 씬에 둘 중 하나만 채워져서 나머지 칸은 늘 "없음"으로 낭비된다 — 13번(이미지·영상 생성
  // 작업 화면)에서는 이 구분이 여전히 의미 있어서 그대로 두고, 14번(렌더링, 참고용 보기)에서만
  // true로 넘겨서 "화면" 열 하나로 합친다: sceneVideo가 있으면 영상 썸네일, 없으면(장면이미지
  // 유무 무관) 이미지 썸네일/자리표시자를 보여준다.
  mergeMediaColumn?: boolean;
  // 2026-09-16(17차) 추가 — 사용자 요청: "14번에서 영상 앞의 1초를 잘르는 편집을 해달라는게
  // 아니라, 위치만 정확하게 셋팅하고 싶은거야 — 숏컷 셋팅파일에다가" + "모달을 띄우면 트랙번호
  // 설정, 시간설정, 위치설정을 할수 있게". 등록된 Shotcut 프로젝트(.mlt) 파일의 공개 URL —
  // 있으면(14번) 영상 모달에 실제 .mlt 클립의 트랙/위치 조정 패널이 뜨고, 없으면(13번, 또는
  // 14번인데 아직 .mlt를 안 올린 상태) 패널 자체가 안 뜨거나 "먼저 업로드해주세요" 안내만 뜬다.
  mltUrl?: string;
  // 2026-09-16(15차) 추가 — 12번(step13-14-LabeledLinksPanel.tsx)에서 유닛별로 저장한 자막
  // 스타일(ContentUnit.captionStyle). 13번(step16-17-ImageVideoPanel.tsx)이 그대로 넘겨주고,
  // 이 컴포넌트는 그걸 다시 SceneImageModal/SceneVideoModal에 전달만 한다 — 실제 렌더링은
  // 그 모달들 안에서 한다.
  captionStyle?: CaptionStyle;
}) {
  const scenes = parseSceneBlocks(scenePrompts);
  const srtLines = useMemo(() => parseSrtLines(srtText), [srtText]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null); // null=닫힘, -1=새 장면 추가 중
  const [draft, setDraft] = useState<SceneBlock>(EMPTY_SCENE_DRAFT);
  // 2026-09-10 추가 — 장면이미지 썸네일을 클릭하면 이 인덱스로 SceneImageModal을 연다. null=닫힘.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // 2026-09-13 추가 — 장면영상 썸네일을 클릭하면 이 인덱스로 SceneVideoModal을 연다. null=닫힘.
  const [previewVideoIndex, setPreviewVideoIndex] = useState<number | null>(null);
  // 2026-09-16(17차) 추가 — mltUrl이 있으면(14번) 그 .mlt 파일 안의 클립별 트랙/위치를
  // 한 번에 불러와둔다 — 영상 모달을 열 때마다 다시 fetch하지 않고 여기서 가진 값을 그대로
  // 보여준다(사용자 요청: "현재 모달을 띄우면 현재 설정된 값이 보이면 되겠다").
  const [clipPositions, setClipPositions] = useState<ClipPosition[] | null>(null);
  const [clipTotalTracks, setClipTotalTracks] = useState(0);
  const [clipLoading, setClipLoading] = useState(false);
  const [clipError, setClipError] = useState('');

  useEffect(() => {
    if (!mltUrl) {
      setClipPositions(null);
      setClipTotalTracks(0);
      setClipError('');
      return;
    }
    let cancelled = false;
    setClipLoading(true);
    setClipError('');
    fetch(`/api/render-position?mltUrl=${encodeURIComponent(mltUrl)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setClipError(data.error);
          return;
        }
        setClipPositions(data.clips);
        setClipTotalTracks(data.totalTracks);
      })
      .catch((err) => {
        if (!cancelled) setClipError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setClipLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mltUrl]);

  // 장면 id("S02")와 .mlt 안 실제 파일명("s02.mp4")을 확장자 무관하게 매칭한다 — 실제 업로드된
  // 파일들이 전부 "{장면id}.mp4" 규칙으로 이름 붙여져 있다는 전제(코카콜라 유닛 실측 확인).
  function findClipForScene(scene: SceneBlock | null): ClipPosition | null {
    if (!scene || !clipPositions) return null;
    const idLower = scene.id.toLowerCase();
    return clipPositions.find((c) => c.file.toLowerCase().startsWith(`${idLower}.`)) || null;
  }

  async function setClipPositionMs(file: string, positionMs: number) {
    const res = await fetch('/api/render-position', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mltUrl, file, action: 'position', positionMs }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '위치 저장 실패');
    setClipPositions(data.clips);
    setClipTotalTracks(data.totalTracks);
  }

  async function setClipTrackNumber(file: string, trackNumber: number) {
    const res = await fetch('/api/render-position', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mltUrl, file, action: 'track', trackNumber }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '트랙 저장 실패');
    setClipPositions(data.clips);
    setClipTotalTracks(data.totalTracks);
  }

  // 2026-09-16(21차) 추가 — 사용자 요청: "영상의 몇초부토 몇초까지만 사용하고 싶은지 정할수
  // 있어?". 소스 영상에서 실제로 재생할 구간(시작~끝)을 지정한다 — 위치(트랙 안 시작 시각)와는
  // 별개다.
  async function setClipRange(file: string, inMs: number, outMs: number) {
    const res = await fetch('/api/render-position', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mltUrl, file, action: 'range', inMs, outMs }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '구간 저장 실패');
    setClipPositions(data.clips);
    setClipTotalTracks(data.totalTracks);
  }
  // 2026-09-12 추가 — 탭 필터 상태. 'all' | 'none' | 'multi' | 탭 인덱스(문자열).
  const [filterTab, setFilterTab] = useState<string>('all');
  // 2026-09-16(3차) 추가 — 사용자 요청: "srt자막 각 라인 선택해서 결합,분리 할수있게(묶음=
  // 씬으로)". srtLines 배열 안에서의 원래 위치(0-based)로 선택 상태를 기억한다 — 필터/그룹핑이
  // 바뀌어도 "그 자막 줄" 자체의 식별자는 변하지 않아서 안전하다.
  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set());

  function startEdit(idx: number) {
    setEditingIndex(idx);
    setDraft(scenes[idx]);
  }
  function startAdd() {
    setEditingIndex(-1);
    setDraft({ ...EMPTY_SCENE_DRAFT, id: nextSceneId(scenes) });
  }
  function cancel() {
    setEditingIndex(null);
    setDraft(EMPTY_SCENE_DRAFT);
  }
  async function saveDraft() {
    const merged = editingIndex === -1 ? [...scenes, draft] : scenes.map((s, i) => (i === editingIndex ? draft : s));
    await onSave(serializeSceneBlocks(sortScenesById(merged)));
    setEditingIndex(null);
    setDraft(EMPTY_SCENE_DRAFT);
  }
  async function removeScene(idx: number) {
    if (!confirm(`${scenes[idx].id} 장면을 삭제할까요?`)) return;
    await onSave(serializeSceneBlocks(scenes.filter((_, i) => i !== idx)));
  }
  // 2026-09-09 추가 — 이미지 스타일 규칙이 전면 재정의되면서 옛 규칙으로 만든 씬 전체(예:
  // 코카콜라 101씬)를 통째로 갈아엎어야 하는 상황이 생겼는데, 한 번에 지우는 방법이 없어서
  // "삭제"를 수십 번 눌러야 했다(사용자 지적: "일괄삭제가 없어 추가해줘"). scenePrompts를
  // 빈 문자열로 저장하면 모든 장면이 한 번에 사라진다 — 실수 방지로 confirm에 개수를 보여준다.
  async function removeAll() {
    if (!confirm(`장면 ${scenes.length}개를 전부 삭제할까요? 되돌릴 수 없습니다.`)) return;
    await onSave('');
  }
  // 2026-09-16(2차) 추가 — SRT 줄 기준 표에서, 아직 장면이 없는 구간("장면 없음" 자리)의
  // "+ 장면 추가" 버튼이 부른다. 그 구간의 SRT 시작~끝 초를 그대로 draft.time에 채워서, 사람이
  // 시간을 손으로 다시 재지 않고 바로 이 구간용 장면을 만들 수 있게 한다.
  function startAddForGap(startSec: number, endSec: number) {
    setEditingIndex(-1);
    setDraft({ ...EMPTY_SCENE_DRAFT, id: nextSceneId(scenes), time: `${formatSecToMMSS(startSec)}-${formatSecToMMSS(endSec)}` });
  }

  // 2026-09-16(3차) 추가 — 체크박스로 고른 자막 줄들의 시작~끝을 하나의 씬 시간대로 묶는다.
  // 그 구간에 이미 장면이 하나 걸쳐 있으면 그 장면의 기존 데이터(이미지/프롬프트 등)를 유지한
  // 채 시간만 넓히거나 좁히고(수정 폼이 열려서 사람이 검토 후 저장), 걸쳐 있는 장면이 없으면
  // 새 장면을 만든다. 이미 서로 다른 장면 2개 이상이 선택 구간에 걸쳐 있으면(여러 장면을 한
  // 번에 합치는 경우) 데이터가 조용히 사라질 위험이 있어, 먼저 "분리"로 풀어달라고 안내하고
  // 멈춘다 — 자동으로 아무 걸 지우지 않는다.
  function toggleLineSelected(lineIdx: number) {
    setSelectedLines((cur) => {
      const next = new Set(cur);
      if (next.has(lineIdx)) next.delete(lineIdx);
      else next.add(lineIdx);
      return next;
    });
  }
  function mergeSelectedIntoScene() {
    if (selectedLines.size === 0) return;
    const selectedArr = srtLines.filter((_, i) => selectedLines.has(i));
    if (selectedArr.length === 0) return;
    const rangeStart = Math.min(...selectedArr.map((l) => l.start));
    const rangeEnd = Math.max(...selectedArr.map((l) => l.end));
    const overlappingIdxs: number[] = [];
    scenes.forEach((sc, i) => {
      const r = parseSceneTimeRange(sc.time);
      if (r && r[0] < rangeEnd && r[1] > rangeStart) overlappingIdxs.push(i);
    });
    if (overlappingIdxs.length >= 2) {
      alert('선택한 구간에 이미 장면이 2개 이상 걸쳐 있습니다 — 먼저 "분리"로 풀어준 뒤 다시 묶어주세요(데이터 유실 방지).');
      return;
    }
    if (overlappingIdxs.length === 1) {
      const keepIdx = overlappingIdxs[0];
      setEditingIndex(keepIdx);
      setDraft({ ...scenes[keepIdx], time: `${formatSecToMMSS(rangeStart)}-${formatSecToMMSS(rangeEnd)}` });
    } else {
      setEditingIndex(-1);
      setDraft({ ...EMPTY_SCENE_DRAFT, id: nextSceneId(scenes), time: `${formatSecToMMSS(rangeStart)}-${formatSecToMMSS(rangeEnd)}` });
    }
    setSelectedLines(new Set());
  }
  // 2026-09-16(4차) 수정 — 사용자 지적: "자막을 분리하는건 맞지만 이미지 프롬프트 같은건
  // 사라지면 안되~ 사용자가 삭젤 한게 아니잖아". 원래는 장면을 통째로 지워서 "장면 없음"으로
  // 되돌렸는데, 그러면 사용자가 지운 적 없는 이미지·프롬프트가 같이 사라져버린다. 대신 이 장면을
  // "묶여있던 자막 줄 개수"만큼 쪼개서, 각 조각이 원래 장면의 이미지·프롬프트·무빙·영상 등을
  // 그대로 복사해서 갖게 하고 시간만 그 줄 하나의 실제 구간으로 좁힌다 — 데이터는 하나도 안
  // 사라지고 조각마다 복제된다. 나중에 특정 조각만 이미지가 안 맞으면 그 조각만 "수정"으로 따로
  // 고치면 된다.
  async function splitScene(idx: number, lineRanges: { start: number; end: number }[]) {
    if (lineRanges.length <= 1) return;
    const scene = scenes[idx];
    if (!confirm(`${scene.id} 장면을 자막 줄 ${lineRanges.length}개로 나눌까요? 이미지·프롬프트 등은 각 조각에 그대로 복사되어 유지됩니다(사라지지 않음) — 나중에 조각별로 다시 다르게 고칠 수 있습니다.`)) return;
    const pieces: SceneBlock[] = lineRanges.map((r, i) => ({
      ...scene,
      id: i === 0 ? scene.id : `${scene.id}-${i + 1}`,
      time: `${formatSecToMMSS(r.start)}-${formatSecToMMSS(r.end)}`,
    }));
    const merged = scenes.flatMap((s, i) => (i === idx ? pieces : [s]));
    await onSave(serializeSceneBlocks(sortScenesById(merged)));
  }
  // 형식이 안 맞는 예전 자유 텍스트 — 그대로 보여주되 장면 추가는 여전히 가능하게 둔다.
  if (scenes.length === 0 && scenePrompts.trim()) {
    return (
      <div className="space-y-1.5 mt-1">
        <p className="text-xs text-neutral-600 leading-relaxed whitespace-pre-wrap bg-neutral-50 rounded-lg p-2">{scenePrompts}</p>
        {editingIndex === -1 ? (
          <SceneDraftForm draft={draft} setDraft={setDraft} onCancel={cancel} onSave={saveDraft} saving={saving} />
        ) : (
          <button onClick={startAdd} className="text-[10px] font-bold text-blue-600 hover:underline">
            + 장면 추가
          </button>
        )}
      </div>
    );
  }

  // 2026-09-12 추가 — 탭 유효성: 캐릭터 프리셋을 바꿔서 tabs 구성이 달라지면 이전에 고른 필터가
  // 더 이상 존재하지 않을 수 있다(예: 인덱스 하나만 있던 프리셋에서 없는 프리셋으로 전환) — 그
  // 경우 조용히 '전체'로 되돌린다.
  const validFilterKeys = ['all', 'none', ...(characterTabs.length >= 2 ? ['multi'] : []), ...characterTabs.map((_, i) => String(i))];
  const effectiveFilterTab = validFilterKeys.includes(filterTab) ? filterTab : 'all';

  const matchesByScene = scenes.map((s) => classifyScene(s.imagePrompt, characterTabs));
  const countFor = (key: string) =>
    matchesByScene.filter((m) => {
      if (key === 'all') return true;
      if (key === 'none') return m.length === 0;
      if (key === 'multi') return m.length >= 2;
      return m.includes(Number(key));
    }).length;
  // 2026-09-12 추가 — 사용자 요청: "탭에도 (해당숫자 / 남은숫자)로 표시해줘". 그 분류에 속하는
  // 장면 중 아직 sceneImage(장면이미지)가 없는 것만 센다 — 탭 라벨만 보고도 그 캐릭터 분류에서
  // 이미지 생성이 얼마나 남았는지 바로 알 수 있게 한다.
  const remainingFor = (key: string) =>
    scenes.filter((s, idx) => {
      if (s.sceneImage) return false;
      const m = matchesByScene[idx];
      if (key === 'all') return true;
      if (key === 'none') return m.length === 0;
      if (key === 'multi') return m.length >= 2;
      return m.includes(Number(key));
    }).length;

  const filteredWithIndex = scenes
    .map((s, idx) => ({ s, idx }))
    .filter(({ idx }) => {
      if (characterTabs.length === 0 || effectiveFilterTab === 'all') return true;
      const m = matchesByScene[idx];
      if (effectiveFilterTab === 'none') return m.length === 0;
      if (effectiveFilterTab === 'multi') return m.length >= 2;
      return m.includes(Number(effectiveFilterTab));
    });
  // 2026-09-16(2차) 추가 — SRT 줄이 표의 기준(행)이 되도록 재구성. 처음엔 "장면 기준 행 + 겹치는
  // SRT 텍스트 이어붙이기"로 만들었는데, 사용자가 확인 후 "왼쪽 자막에 다른것들을 맞춘게 아니고
  // 기존 씬에 자막을 맞췄네???"라고 지적 — 반대 방향(SRT가 기준, 장면이 거기 딸려옴)을 원한
  // 것이었다. 후속 확인: "SRT 줄 기준(권장)" 선택, "자막은 다 보여야해"(한 줄도 생략/축약 금지),
  // "자막 페이지가 200페이지가 넘으니 그게 기준"(자막 줄 수가 행 개수의 기준), "자막 몇개에 =
  // 이미지 한씬이 매칭이 될수 있는거지"(여러 자막 줄이 같은 장면에 연속으로 걸리면 그 장면 데이터
  // 칸을 rowSpan으로 합쳐서 한 번만 보여줌). SRT가 아직 없으면(로딩 중이거나 자막 자체가 없는
  // 유닛) 예전처럼 장면 하나당 한 행으로 자동 대체한다.
  const filteredSceneIdxSet = new Set(filteredWithIndex.map((f) => f.idx));

  // 2026-09-16(3차) 수정 — 체크박스/번호가 srtLines 배열 안의 원래 위치(lineIdx)를 안정적으로
  // 참조해야 해서, 각 줄을 SrtLine 그대로가 아니라 {line, lineIdx} 쌍으로 들고 다닌다.
  type LineEntry = { line: SrtLine; lineIdx: number };
  type RowGroup = { sceneIdx: number | null; lines: LineEntry[] };
  const rowGroups: RowGroup[] = (() => {
    if (srtLines.length === 0) {
      return filteredWithIndex.map(({ idx }) => ({ sceneIdx: idx, lines: [] as LineEntry[] }));
    }
    const groups: RowGroup[] = [];
    srtLines.forEach((line, lineIdx) => {
      let matchedIdx: number | null = null;
      for (let i = 0; i < scenes.length; i++) {
        const range = parseSceneTimeRange(scenes[i].time);
        if (range && range[0] < line.end && range[1] > line.start) {
          matchedIdx = i;
          break;
        }
      }
      // 장면이 없는(matchedIdx===null) 구간은 항상 보여준다 — 아직 장면을 안 만든 구간을
      // 그대로 드러내야 "여기 장면이 빠졌다"는 걸 알 수 있다. 캐릭터 탭 필터는 실제로 매칭된
      // 장면에만 적용한다.
      const passesFilter =
        matchedIdx === null || characterTabs.length === 0 || effectiveFilterTab === 'all' || filteredSceneIdxSet.has(matchedIdx);
      if (!passesFilter) return;
      const last = groups[groups.length - 1];
      if (last && last.sceneIdx === matchedIdx) last.lines.push({ line, lineIdx });
      else groups.push({ sceneIdx: matchedIdx, lines: [{ line, lineIdx }] });
    });
    return groups;
  })();

  type FlatRow = { key: string; entry?: LineEntry; sceneIdx: number | null; isFirst: boolean; span: number; group: RowGroup };
  const flatRows: FlatRow[] = [];
  rowGroups.forEach((group, gi) => {
    const span = group.lines.length || 1;
    if (group.lines.length === 0) {
      flatRows.push({ key: `${gi}-0`, sceneIdx: group.sceneIdx, isFirst: true, span, group });
    } else {
      group.lines.forEach((entry, li) => {
        flatRows.push({ key: `${gi}-${li}`, entry, sceneIdx: group.sceneIdx, isFirst: li === 0, span, group });
      });
    }
  });

  // 2026-09-16(7차) 추가 — 사용자 지적: "13단계에 모달이 srt자막 기준이 아니라 씬기준으로
  // 보여지고 있음~ 자막기준으로 바꾸려고 함~". 모달의 ‹/›가 넘기는 단위를 씬이 아니라 flatRows와
  // 완전히 같은 순서의 "자막 줄 하나"로 맞춘다 — 표에서 보이는 순서 그대로 모달에서도 한 줄씩
  // 넘어간다(같은 씬에 묶인 줄 여러 개를 넘기는 동안은 같은 이미지가 계속 보인다). SRT가 아직
  // 없는 유닛(entry가 전혀 없는 fallback)에서는 예전처럼 씬 하나당 항목 하나로 대체한다.
  const navItems: ModalNavItem[] =
    srtLines.length > 0
      ? flatRows
          .filter((r) => !!r.entry)
          .map((r) => ({
            lineIdx: r.entry!.lineIdx,
            text: r.entry!.line.text,
            sceneIdx: r.sceneIdx,
            start: r.entry!.line.start,
            end: r.entry!.line.end,
          }))
      : filteredWithIndex.map(({ idx }) => ({ lineIdx: null, text: '', sceneIdx: idx, start: null, end: null }));

  // 표의 특정 행(row)에서 모달을 열 때, 그 행이 navItems 배열 안에서 몇 번째인지 찾는다 —
  // SRT가 있으면 그 행의 자막 줄 번호로, 없으면(폴백) 그 행의 씬 인덱스로 찾는다.
  function navIndexForRow(row: FlatRow): number {
    if (row.entry) return navItems.findIndex((n) => n.lineIdx === row.entry!.lineIdx);
    return navItems.findIndex((n) => n.sceneIdx === row.sceneIdx);
  }

  // 2026-09-07, 사용자 지시로 13번을 스토리보드 표 형태로 재구성: 타임 / 장면이미지 / 이미지
  // 프롬프트 / 영상프롬프트 or 전환프롬프트 4개 열. 수정 중인 행만 SceneDraftForm으로 펼치고,
  // 나머지는 표 한 줄로 스캔하기 쉽게 보여준다. 좁은 패널이라 가로 스크롤로 감싼다.
  // 2026-09-13 추가 — 장면이미지 오른쪽에 영상장면 열 추가(사용자 요청, 아래 표 참고).
  return (
    <div className="space-y-1.5 mt-1">
      {scenes.length === 0 && editingIndex === null && <p className="text-[11px] text-neutral-300">아직 없음</p>}
      {scenes.length > 0 && (
        <div className="flex justify-end">
          <button onClick={removeAll} className="text-[10px] font-bold text-red-500 hover:underline">
            🗑 전체 삭제 ({scenes.length}개)
          </button>
        </div>
      )}
      {scenes.length > 0 && characterTabs.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {(
            [
              { key: 'all', label: '전체' },
              ...characterTabs.map((t, i) => ({ key: String(i), label: t.label })),
              ...(characterTabs.length >= 2 ? [{ key: 'multi', label: '🎭 같이출연' }] : []),
              { key: 'none', label: '🎨 캐릭터없음' },
            ] as { key: string; label: string }[]
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setFilterTab(t.key)}
              className={`shrink-0 text-[10px] font-black px-2.5 py-1 rounded-full border whitespace-nowrap ${
                effectiveFilterTab === t.key ? 'bg-black text-white border-black' : 'bg-white text-neutral-500 border-neutral-200 hover:border-neutral-300'
              }`}
            >
              {t.label} ({countFor(t.key)} / {remainingFor(t.key)})
            </button>
          ))}
        </div>
      )}
      {scenes.length > 0 && filteredWithIndex.length === 0 && (
        <p className="text-[11px] text-neutral-300">이 분류엔 해당하는 장면이 없습니다.</p>
      )}
      {/* 2026-09-16(3차) 추가 — 체크박스로 자막 줄을 고르면 여기 액션 바가 뜬다. "묶어서 씬
          만들기"는 위 mergeSelectedIntoScene 참고. */}
      {selectedLines.size > 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5">
          <span className="text-[10px] font-black text-blue-700">{selectedLines.size}줄 선택됨</span>
          <button onClick={mergeSelectedIntoScene} className="text-[10px] font-black text-blue-700 hover:underline">
            ▸ 묶어서 씬 만들기
          </button>
          <button onClick={() => setSelectedLines(new Set())} className="text-[10px] font-bold text-neutral-400 hover:underline">
            선택 해제
          </button>
        </div>
      )}
      {flatRows.length > 0 && (
        <div className="overflow-x-auto border border-neutral-100 rounded-lg">
          <table className="w-full text-[11px] border-collapse min-w-[720px]">
            <thead>
              <tr className="bg-neutral-50 text-neutral-400">
                {/* 2026-09-16(3차) 추가 — 확인용 번호 + 결합/분리용 체크박스(사용자 요청:
                    "srt자막 라인에 넘버링이 있으면 좋겠어 확인용", "각 라인 선택해서 결합,
                    분리 할수있게"). */}
                <th className="text-left font-black px-2 py-1.5 w-12">#</th>
                {/* 2026-09-16(2차) — 이제 이 열이 표 전체의 행 기준이다: SRT 줄 하나 = 한 행.
                    같은 장면에 걸리는 연속된 줄들은 오른쪽 장면 칸들을 rowSpan으로 합쳐서
                    한 번만 보여준다(사용자 확정: "SRT 줄 기준(권장)", "자막은 다 보여야해"). */}
                {/* 2026-09-17(3차) 수정 — 사용자 요청: "2번스샷의 13단계 리스트의 '자막/장면/
                    타임' 부분도 합쳐주고". 이제 13/14번 둘 다 자막·장면·타임을 한 칸으로 합친다
                    (예전엔 mergeMediaColumn=14번일 때만 합쳤었다). */}
                <th className="text-left font-black px-2 py-1.5 w-56">자막/장면/타임</th>
                {/* 2026-09-16(11차) — mergeMediaColumn(14번)이면 "화면" 한 칸, 아니면(13번)
                    기존처럼 이미지/영상 두 칸을 따로 보여준다. */}
                {mergeMediaColumn ? (
                  <th className="text-left font-black px-2 py-1.5 w-20">화면</th>
                ) : (
                  <>
                    <th className="text-left font-black px-2 py-1.5 w-20">장면이미지</th>
                    <th className="text-left font-black px-2 py-1.5 w-20">영상장면</th>
                  </>
                )}
                <th className="text-left font-black px-2 py-1.5">이미지 프롬프트</th>
                <th className="text-left font-black px-2 py-1.5">무빙/영상 프롬프트</th>
                <th className="text-left font-black px-2 py-1.5 w-14">관리</th>
              </tr>
            </thead>
            <tbody>
              {flatRows.map((row) => {
                if (row.sceneIdx !== null && editingIndex === row.sceneIdx) {
                  if (!row.isFirst) return null;
                  return (
                    <tr key={row.key}>
                      <td colSpan={mergeMediaColumn ? 6 : 7} className="p-1.5 bg-neutral-50">
                        <SceneDraftForm draft={draft} setDraft={setDraft} onCancel={cancel} onSave={saveDraft} saving={saving} />
                      </td>
                    </tr>
                  );
                }
                const s = row.sceneIdx !== null ? scenes[row.sceneIdx] : null;
                const navIdx = navIndexForRow(row);
                return (
                  <tr key={row.key} className="border-t border-neutral-100 align-top">
                    {/* 2026-09-16(3차) 추가 — 확인용 번호 + 결합/분리용 체크박스. entry가 없으면
                        (이 표가 SRT 없이 장면 기준으로 fallback 중일 때) 체크 자체를 숨긴다 —
                        결합/분리는 실제 자막 줄이 있어야만 의미가 있다. */}
                    <td className="px-2 py-1.5">
                      {row.entry && (
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedLines.has(row.entry.lineIdx)}
                            onChange={() => row.entry && toggleLineSelected(row.entry.lineIdx)}
                            className="w-3.5 h-3.5"
                          />
                          <span className="text-neutral-400 font-mono">{row.entry.lineIdx + 1}</span>
                        </label>
                      )}
                    </td>
                    {/* SRT 줄 하나 = 이 행 하나. 전체를 그대로 보여준다(축약·생략 없음). */}
                    {/* 2026-09-17(3차) 수정 — 사용자 요청: "자막/장면/타임이라고 표시해주고
                        자막을 제일 위로 옮겨줘" + "13단계 리스트의 '자막/장면/타임' 부분도
                        합쳐주고". 13/14번 둘 다 이 칸 안에 자막 텍스트를 먼저, 그 장면의 첫
                        자막 줄에만 장면 정보(id/제목/시간, 또는 장면이 없으면 그 구간 시간)를
                        아래에 같이 보여준다 — rowSpan 대신 매 줄 렌더링이라 첫 줄에서만
                        조건부로 얹는다. */}
                    <td className="px-2 py-1.5">
                      {/* 2026-09-17(3차) 수정 — 사용자 요청: "자막을 제일 위로 옮겨줘". 자막
                          텍스트를 먼저 보여주고, 장면 정보(id/제목/시간)는 그 아래에 구분선과
                          함께 보여준다(13/14번 둘 다 항상 합쳐서 보여줌 — 위 헤더 참고). */}
                      {row.entry ? (
                        <p className="text-neutral-600 leading-relaxed">{row.entry.line.text}</p>
                      ) : srtText ? (
                        <span className="text-neutral-300">(매칭 없음)</span>
                      ) : (
                        <span className="text-neutral-300">—</span>
                      )}
                      {row.isFirst &&
                        (s ? (
                          <div className="mt-1 pt-1 border-t border-neutral-100">
                            <span className="font-mono text-neutral-400">{s.id}</span>
                            {s.title && <div className="font-bold truncate max-w-[10rem]">{s.title}</div>}
                            <div className="font-mono text-neutral-500 whitespace-nowrap">{s.time ? formatTimeWithDuration(s.time) : '—'}</div>
                          </div>
                        ) : (
                          <div className="mt-1 pt-1 border-t border-neutral-100 text-neutral-300">
                            (장면 없음)
                            <div className="font-mono text-neutral-400 whitespace-nowrap">
                              {row.group.lines.length > 0
                                ? `${formatSecToMMSS(row.group.lines[0].line.start)}-${formatSecToMMSS(row.group.lines[row.group.lines.length - 1].line.end)}`
                                : '—'}
                            </div>
                          </div>
                        ))}
                    </td>
                    {row.isFirst &&
                      (s ? (
                        <>
                          {/* 2026-09-16(11차) 수정 — 사용자 지적: "14단계에선 이미지,영상
                              분류하는게 아니고~ 앞부분은 영상만 있고 자막 9~10번부터
                              이미지자나? 그럼 있는것만 셋팅해서 보여줘야해". mergeMediaColumn이
                              true(14번)면 "장면이미지"/"영상장면" 두 칸을 따로 안 두고, 그 씬이
                              실제로 갖고 있는 것 하나만(영상이 있으면 영상, 없으면 이미지) "화면"
                              칸 하나로 합쳐 보여준다. 13번(mergeMediaColumn 기본값 false)은
                              기존 그대로 두 칸을 유지한다 — 이미지 생성 작업 중에는 "이 씬이
                              영상까지 필요한 씬인지"를 한눈에 구분하는 게 여전히 유용하다. */}
                          {mergeMediaColumn ? (
                            <td className="px-2 py-1.5" rowSpan={row.span}>
                              {s.sceneVideo ? (
                                <button
                                  type="button"
                                  onClick={() => setPreviewVideoIndex(navIdx)}
                                  className="relative block"
                                  title="클릭하면 크게 보기 (자막 줄 단위로 이어서 볼 수 있어요)"
                                >
                                  <video
                                    src={s.sceneVideo}
                                    muted
                                    playsInline
                                    preload="metadata"
                                    className="w-14 h-14 object-cover rounded-md border border-neutral-200 hover:opacity-80"
                                  />
                                  <span className="absolute inset-0 flex items-center justify-center text-white text-sm drop-shadow pointer-events-none">▶</span>
                                </button>
                              ) : s.needsVideoClip ? (
                                // 2026-09-16(18차) 추가 — 사용자 지적: "14단계에 구현이
                                // 안되었는데???" — 실제 영상 클립은 대부분 sceneVideo(앱에
                                // 올려둔 미리보기)가 아니라 Shotcut 로컬 파일로만 존재해서,
                                // needsVideoClip이 true여도 sceneVideo가 비어있는 경우가
                                // 대다수였다. 이전엔 sceneVideo가 없으면 무조건 이미지 모달로
                                // 빠져서, 렌더링(.mlt) 트랙/위치 패널이 있는 영상 모달을 열
                                // 방법이 아예 없었다 — needsVideoClip이면 sceneImage가 있어도
                                // (썸네일로만 쓰고) 클릭은 항상 영상 모달을 열게 한다.
                                <button
                                  type="button"
                                  onClick={() => setPreviewVideoIndex(navIdx)}
                                  className="relative block"
                                  title="클릭하면 렌더링(.mlt) 트랙/위치 설정 열기"
                                >
                                  {s.sceneImage ? (
                                    <img
                                      src={s.sceneImage}
                                      alt={s.title}
                                      className="w-14 h-14 object-cover rounded-md border border-neutral-200 hover:opacity-80"
                                    />
                                  ) : (
                                    <div className="w-14 h-14 rounded-md bg-neutral-50 border border-neutral-200 flex items-center justify-center text-neutral-300 text-[9px] text-center leading-tight hover:border-neutral-300">
                                      🎬 설정
                                    </div>
                                  )}
                                  <span className="absolute inset-0 flex items-center justify-center text-white text-sm drop-shadow pointer-events-none">🎬</span>
                                </button>
                              ) : s.sceneImage ? (
                                <button type="button" onClick={() => setPreviewIndex(navIdx)} className="block" title="클릭하면 크게 보기 (자막 줄 단위로 이어서 볼 수 있어요)">
                                  <img
                                    src={s.sceneImage}
                                    alt={s.title}
                                    className="w-14 h-14 object-cover rounded-md border border-neutral-200 hover:opacity-80"
                                  />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setPreviewIndex(navIdx)}
                                  className="w-14 h-14 rounded-md bg-neutral-50 border border-neutral-200 flex items-center justify-center text-neutral-300 text-[9px] text-center leading-tight hover:border-neutral-300"
                                  title="클릭하면 대본·프롬프트·해석 보기 (아직 없음)"
                                >
                                  없음
                                </button>
                              )}
                            </td>
                          ) : (
                            <>
                              <td className="px-2 py-1.5" rowSpan={row.span}>
                                {/* 2026-09-13 (10차) 수정 — 사용자 요청: "이미지나 영상이 없어도 모달
                                    띄어줘 대본,프롬프트,해석 볼수 있게" — 이미지가 아직 없어도 "없음"
                                    자리표시자를 눌러서 대본/프롬프트/해석은 미리 확인할 수 있게, 자리
                                    표시자도 버튼으로 바꿔 항상 모달을 연다. */}
                                {s.sceneImage ? (
                                  <button type="button" onClick={() => setPreviewIndex(navIdx)} className="block" title="클릭하면 크게 보기 (자막 줄 단위로 이어서 볼 수 있어요)">
                                    <img
                                      src={s.sceneImage}
                                      alt={s.title}
                                      className="w-14 h-14 object-cover rounded-md border border-neutral-200 hover:opacity-80"
                                    />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setPreviewIndex(navIdx)}
                                    className="w-14 h-14 rounded-md bg-neutral-50 border border-neutral-200 flex items-center justify-center text-neutral-300 text-[9px] text-center leading-tight hover:border-neutral-300"
                                    title="클릭하면 대본·프롬프트·해석 보기 (이미지는 아직 없음)"
                                  >
                                    없음
                                  </button>
                                )}
                              </td>
                              {/* 2026-09-13 추가 — 장면영상 열. 장면이미지 열과 완전히 같은 방식(썸네일
                                  클릭 → 모달, 없으면 "없음" 자리표시자) — 실제로 영상 클립을 만든 일부
                                  장면에만 채워진다. */}
                              <td className="px-2 py-1.5" rowSpan={row.span}>
                                {s.sceneVideo ? (
                                  <button
                                    type="button"
                                    onClick={() => setPreviewVideoIndex(navIdx)}
                                    className="relative block"
                                    title="클릭하면 크게 보기 (자막 줄 단위로 이어서 볼 수 있어요)"
                                  >
                                    <video
                                      src={s.sceneVideo}
                                      muted
                                      playsInline
                                      preload="metadata"
                                      className="w-14 h-14 object-cover rounded-md border border-neutral-200 hover:opacity-80"
                                    />
                                    <span className="absolute inset-0 flex items-center justify-center text-white text-sm drop-shadow pointer-events-none">▶</span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setPreviewVideoIndex(navIdx)}
                                    className="w-14 h-14 rounded-md bg-neutral-50 border border-neutral-200 flex items-center justify-center text-neutral-300 text-[9px] text-center leading-tight hover:border-neutral-300"
                                    title="클릭하면 대본·프롬프트·해석 보기 (영상은 아직 없음)"
                                  >
                                    없음
                                  </button>
                                )}
                              </td>
                            </>
                          )}
                          <td className="px-2 py-1.5" rowSpan={row.span}>
                            {s.imagePrompt ? (
                              <div className="flex items-start gap-1">
                                <p className="flex-1 min-w-0 text-neutral-600 leading-relaxed line-clamp-3">{s.imagePrompt}</p>
                                <CopyButton text={s.imagePrompt} />
                              </div>
                            ) : (s.clean || s.info) ? (
                              <div className="space-y-1">
                                {s.clean && (
                                  <div className="flex items-start gap-1">
                                    <span className="shrink-0 text-[9px] font-black text-cyan-600 w-9">CLEAN</span>
                                    <p className="flex-1 min-w-0 text-neutral-600 leading-relaxed line-clamp-2">{s.clean}</p>
                                    <CopyButton text={s.clean} />
                                  </div>
                                )}
                                {s.info && (
                                  <div className="flex items-start gap-1">
                                    <span className="shrink-0 text-[9px] font-black text-cyan-600 w-9">INFO</span>
                                    <p className="flex-1 min-w-0 text-neutral-600 leading-relaxed line-clamp-2">{s.info}</p>
                                    <CopyButton text={s.info} />
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-neutral-300">—</span>
                            )}
                          </td>
                          {/* 2026-09-13 (2차) 수정 — 무빙(카메라 지시)과 영상(Flow 생성 프롬프트)을
                              CLEAN/INFO와 같은 방식으로 미니 라벨을 붙여 위아래로 분리해서 보여준다.
                              영상은 needsVideoClip이 true일 때만(실제 값이 있어도) 보여준다 — 체크
                              해제된 상태에서 남아있는 옛 video 값이 착오를 일으키지 않도록. */}
                          <td className="px-2 py-1.5" rowSpan={row.span}>
                            {s.moving || (s.needsVideoClip && s.video) ? (
                              <div className="space-y-1">
                                {s.moving && (
                                  <div className="flex items-start gap-1">
                                    <span className="shrink-0 text-[9px] font-black text-neutral-400 w-9">무빙</span>
                                    <p className="flex-1 min-w-0 text-neutral-600 leading-relaxed line-clamp-2">{s.moving}</p>
                                    <CopyButton text={s.moving} />
                                  </div>
                                )}
                                {s.needsVideoClip && s.video && (
                                  <div className="flex items-start gap-1">
                                    <span className="shrink-0 text-[9px] font-black text-purple-600 w-9">영상</span>
                                    <p className="flex-1 min-w-0 text-neutral-600 leading-relaxed line-clamp-2">{s.video}</p>
                                    <CopyButton text={s.video} />
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-neutral-300">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5" rowSpan={row.span}>
                            <div className="flex flex-col gap-1">
                              <button onClick={() => startEdit(row.sceneIdx as number)} className="text-[10px] font-bold text-blue-600 hover:underline text-left">
                                수정
                              </button>
                              {/* 2026-09-16(3차) 추가 — 이 장면이 자막 줄 2개 이상에 걸쳐 있을
                                  때만 "분리"를 보여준다(1줄짜리는 분리해도 삭제와 같은 뜻이라
                                  굳이 따로 안 보여줌). splitScene 주석 참고. */}
                              {row.span > 1 && (
                                <button
                                  onClick={() =>
                                    splitScene(
                                      row.sceneIdx as number,
                                      row.group.lines.map((e) => ({ start: e.line.start, end: e.line.end }))
                                    )
                                  }
                                  className="text-[10px] font-bold text-amber-600 hover:underline text-left"
                                >
                                  분리
                                </button>
                              )}
                              <button onClick={() => removeScene(row.sceneIdx as number)} className="text-[10px] font-bold text-red-500 hover:underline text-left">
                                삭제
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        // 2026-09-16(2차) 추가 — 이 SRT 구간에 아직 장면이 없다는 뜻. 시간 칸에
                        // 그 구간의 실제 시작~끝을 보여주고, "+ 장면 추가"로 바로 그 시간이 채워진
                        // 장면 등록 폼을 연다(startAddForGap).
                        <>
                          {/* 2026-09-17(3차) 수정 — 장면/타임 정보가 이제 왼쪽 자막 칸 안으로
                              옮겨감(위 참고) — 13/14번 둘 다 여기선 그릴 게 없다. */}
                          {/* 2026-09-16(11차) — mergeMediaColumn(14번)이면 화면 칸 하나만,
                              아니면(13번) 이미지/영상 두 칸을 그대로 유지한다 — 위 헤더/유
                              칼럼 수와 맞춰야 한다. */}
                          {!mergeMediaColumn && (
                            <td className="px-2 py-1.5 text-neutral-300" rowSpan={row.span}>
                              —
                            </td>
                          )}
                          <td className="px-2 py-1.5 text-neutral-300" rowSpan={row.span}>
                            —
                          </td>
                          <td className="px-2 py-1.5 text-neutral-300" rowSpan={row.span}>
                            —
                          </td>
                          <td className="px-2 py-1.5 text-neutral-300" rowSpan={row.span}>
                            —
                          </td>
                          <td className="px-2 py-1.5" rowSpan={row.span}>
                            {row.group.lines.length > 0 && (
                              <button
                                onClick={() => startAddForGap(row.group.lines[0].line.start, row.group.lines[row.group.lines.length - 1].line.end)}
                                className="text-[10px] font-bold text-blue-600 hover:underline text-left"
                              >
                                + 장면 추가
                              </button>
                            )}
                          </td>
                        </>
                      ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editingIndex === -1 && (
        <SceneDraftForm draft={draft} setDraft={setDraft} onCancel={cancel} onSave={saveDraft} saving={saving} />
      )}
      {editingIndex === null && (
        <button
          onClick={startAdd}
          className="w-full text-[11px] font-bold text-blue-600 hover:underline border border-dashed border-blue-200 rounded-lg py-2"
        >
          + 장면 추가
        </button>
      )}
      {previewIndex !== null && (
        <SceneImageModal
          scenes={scenes}
          navItems={navItems}
          index={previewIndex}
          onClose={() => setPreviewIndex(null)}
          onNavigate={setPreviewIndex}
          totalLines={srtLines.length}
          totalScenes={filteredWithIndex.length}
          captionStyle={captionStyle}
        />
      )}
      {previewVideoIndex !== null && (
        <SceneVideoModal
          scenes={scenes}
          navItems={navItems}
          index={previewVideoIndex}
          onClose={() => setPreviewVideoIndex(null)}
          onNavigate={setPreviewVideoIndex}
          totalLines={srtLines.length}
          totalScenes={filteredWithIndex.length}
          captionStyle={captionStyle}
          clipControl={
            mergeMediaColumn
              ? {
                  enabled: true,
                  mltUrl,
                  loading: clipLoading,
                  error: clipError,
                  totalTracks: clipTotalTracks,
                  info: findClipForScene(
                    navItems[previewVideoIndex]?.sceneIdx !== null && navItems[previewVideoIndex]?.sceneIdx !== undefined
                      ? scenes[navItems[previewVideoIndex]!.sceneIdx!]
                      : null
                  ),
                  onSetPosition: setClipPositionMs,
                  onSetTrack: setClipTrackNumber,
                  onSetRange: setClipRange,
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

// 2026-09-13 (3차) 추가 — 사용자 요청: "각 단계별로 설명서를 등록하게끔 해주면 어때?" 지금까지
// 단계 설명(FlowChart.tsx의 "단계 설명 보기")은 workflow_content 마크다운 표의 "내용" 셀 원문을
// 그대로 <p>{desc}</p>로 찍었다 — **볼드**/`코드`/줄바꿈(<br>) 같은 마크다운 기호가 전부 그대로
// 문자로 보여서 "이게 설명서야 작업과정이야?"라는 혼란을 일으켰다(사용자 지적). 근본 원인은
// "한 파이프라인 전체가 workflow_content 텍스트 필드 하나"라 단계 하나만 고치려 해도 4만자 넘는
// 문서 전체를 다시 써야 해서 느리고 사고 위험도 크다는 것 — 그래서 파이프라인 전체 공유값인
// analysis_result(jsonb, 이미 존재하는 컬럼)에 stepDocs를 추가해 단계별로 독립된 "설명서"를
// 둔다(경제학 파이프라인부터 시범 적용, 사용자 확정: "우선 경제학만 우선 해보자"). 등록 흐름은
// 13번 제미나이 프롬프트 왕복과 같은 패턴 — Claude가 정리한 설명서 텍스트를 전달하면, 사용자가
// 이 버튼으로 붙여넣어 등록한다.
const STEP_DOC_INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`)/g;

function renderStepDocInline(line: string, keyPrefix: string) {
  const parts = line.split(STEP_DOC_INLINE_RE).filter((p) => p !== '');
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={`${keyPrefix}-${i}`} className="font-black text-neutral-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={`${keyPrefix}-${i}`} className="bg-neutral-100 text-neutral-700 rounded px-1 py-0.5 text-[12px] font-mono">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

// 마크다운 전체 파서가 아니라, 이 문서들이 실제로 쓰는 표기(굵게/인라인코드/<br> 줄바꿈/빈 줄
// 단락 구분/"- "·숫자. 목록)만 처리하는 가벼운 렌더러 — 새 npm 의존성을 추가하지 않기 위함.
function renderStepDoc(text: string) {
  const normalized = text.replace(/<br\s*\/?>/gi, '\n');
  const paragraphs = normalized.split(/\n{2,}/);
  return paragraphs.map((para, pi) => {
    const lines = para.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) return null;
    const isList = lines.every((l) => /^\s*([-•]|\d+\.)\s/.test(l));
    if (isList) {
      return (
        <ul key={pi} className="mb-3 last:mb-0 pl-4 space-y-1 list-disc">
          {lines.map((line, li) => (
            <li key={li}>{renderStepDocInline(line.replace(/^\s*([-•]|\d+\.)\s/, ''), `${pi}-${li}`)}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={pi} className="mb-3 last:mb-0">
        {lines.map((line, li) => (
          <span key={li}>
            {renderStepDocInline(line, `${pi}-${li}`)}
            {li < lines.length - 1 && <br />}
          </span>
        ))}
      </p>
    );
  });
}

export function StepDocSection({
  site,
  step,
  onRefresh,
}: {
  site: Site;
  step: Step;
  onRefresh: () => void;
}) {
  const stepDocs = site.analysis_result?.stepDocs || {};
  const doc = stepDocs[step.n];
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [saving, setSaving] = useState(false);
  // 2026-09-13 (4차) 추가 — 실사고: persist()가 fetch 응답의 성공 여부(res.ok)를 확인하지 않고
  // 무조건 성공한 것처럼 창을 닫아버렸다. fetch는 네트워크 자체가 끊기지 않는 한 서버가 400/500을
  // 돌려줘도 reject하지 않으므로, 저장이 실제로 실패해도 사용자는 알 방법이 없었다(사용자가 등록
  // 버튼을 눌렀는데 DB엔 아무것도 안 남아있던 사고로 발견). 이제 res.ok를 확인해서 실패하면
  // 에러 메시지를 화면에 남기고 창을 닫지 않는다.
  const [error, setError] = useState('');

  // 2026-09-13 (5차) 수정 — 사용자 지적: "원래 있던 내용이 설명서에 들어 있어야 수정을 하지" —
  // 아직 새 설명서(stepDocs)가 없는 단계는 편집창이 빈 칸으로 열려서, 기존 workflow_content
  // 원문(step.desc)을 처음부터 다시 타이핑/붙여넣기해야 하는 것처럼 보였다. 새 설명서가 없으면
  // 원문을 기본값으로 채워서 열어, 그 자리에서 다듬어 등록할 수 있게 한다.
  function startEdit() {
    setDraftText(doc || step.desc || '');
    setError('');
    setEditing(true);
  }

  async function persist(nextStepDocs: Record<string, string>) {
    const res = await fetch(`/api/sites/${site.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        analysis_result: { ...site.analysis_result, stepDocs: nextStepDocs },
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || `저장 실패 (HTTP ${res.status})`);
    }
    onRefresh();
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      await persist({ ...stepDocs, [step.n]: draftText });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // 2026-09-13 (3차) 추가 — 사용자 확인: "수정 삭제버튼도 다 넣었지?" — 등록만 있고 삭제가
  // 없었던 걸 지적받아 추가. 다른 곳의 삭제 패턴(removeScene 등)과 동일하게 confirm으로 한 번
  // 더 확인한 뒤, stepDocs 객체에서 이 단계 키만 제거해서 저장한다(다른 단계 설명서는 안 건드림).
  async function removeDoc() {
    if (!confirm(`${step.n}번 설명서를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setSaving(true);
    setError('');
    try {
      const next = { ...stepDocs };
      delete next[step.n];
      await persist(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="mb-3 bg-neutral-50 border border-neutral-200 rounded-lg p-3">
        <p className="text-[11px] font-black text-neutral-500 mb-1.5">📖 설명서 등록/수정 — Claude가 정리해준 텍스트를 그대로 붙여넣으세요</p>
        <textarea
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          rows={12}
          placeholder="설명서 본문을 여기 붙여넣으세요"
          className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[12px] font-mono leading-relaxed mb-1.5"
        />
        {error && <p className="text-[11px] text-red-500 font-bold mb-1.5">⚠ {error}</p>}
        <div className="flex justify-end gap-1.5">
          <button onClick={() => setEditing(false)} className="text-[11px] font-bold text-neutral-400 hover:text-black px-2">
            취소
          </button>
          <button
            onClick={save}
            disabled={saving || !draftText.trim()}
            className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
          >
            {saving ? '등록 중...' : '등록'}
          </button>
        </div>
      </div>
    );
  }

  if (doc) {
    // 2026-09-13 (7차) 수정 — 사용자 지적: "13단계 설명서는 왜 안접혀있어?? 원래 접히는
    // 방식인데?" — StepDocSection 도입 전엔 FlowChart.tsx가 <details>로 기본 접힌 채
    // "단계 설명 보기"만 보여줬는데, 새 UI는 등록된 설명서를 항상 펼친 채로 보여줘서 패널이
    // 불필요하게 길어졌다. <details>로 감싸 기본은 접힌 상태(제목 요약만)로 되돌리고, 열어야
    // 본문이 보이게 한다 — 수정/삭제 버튼은 접힌 상태에서도 바로 누를 수 있게 summary 밖에 둔다.
    return (
      <div className="mb-3 bg-white border border-neutral-200 rounded-lg p-4">
        <details>
          <summary className="cursor-pointer text-[11px] font-black text-neutral-400">📖 설명서</summary>
          {error && <p className="text-[11px] text-red-500 font-bold mt-1.5 mb-1.5">⚠ {error}</p>}
          <div className="text-[13px] text-neutral-700 leading-relaxed text-left mt-2">{renderStepDoc(doc)}</div>
        </details>
        <div className="flex items-center justify-end gap-2 mt-2">
          <button onClick={startEdit} className="text-[10px] font-bold text-blue-600 hover:underline">
            수정
          </button>
          <button onClick={removeDoc} disabled={saving} className="text-[10px] font-bold text-red-500 hover:underline disabled:opacity-40">
            삭제
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3">
      {step.desc && (
        <details className="mb-1.5">
          <summary className="cursor-pointer text-xs text-neutral-400 font-bold">단계 설명 보기 (원문 — 아직 설명서 등록 전)</summary>
          <p className="text-sm text-neutral-600 leading-relaxed mt-2 whitespace-pre-wrap">{step.desc}</p>
        </details>
      )}
      <button onClick={startEdit} className="text-[11px] font-bold text-blue-600 hover:underline">
        + 설명서 등록
      </button>
    </div>
  );
}
