'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SceneBlock, Site, Step } from '../types';
import { EMPTY_SCENE_DRAFT, uploadSceneMedia, parseSceneBlocks, serializeSceneBlocks, nextSceneId, sortScenesById } from '../utils';

// 2026-09-13 (4차) 추가 — 사용자 요청: "13단계에서 모달을 띄웠을 때 선택한 이미지를 다운받을
// 수 있어야 하는데 다운로드 버튼이 없어 추가해줘". Supabase Storage 공개 URL은 HongHub와
// 다른 오리진이라, <a href download>만으로는 브라우저가 download 속성을 무시하고 새 탭에서
// 열어버리는 경우가 많다(교차 출처 다운로드 제약) — fetch로 실제 바이트를 받아 blob URL을
// 만든 뒤 숨겨진 <a>를 눌러야 오리진에 상관없이 항상 실제로 저장된다.
// 2026-09-13 (6차) 추가 — 사용자 요청: "한 장면당 타임도 적어줘 예) 0:00~0:09 (9s) 이런 방식으로".
// "0:00-0:09" 형태의 time 문자열에서 초 단위 길이를 계산해 뒤에 "(Ns)"로 덧붙인다. 형식이 안
// 맞으면(자유 텍스트로 남긴 옛 데이터 등) 원문 그대로 돌려준다.
function formatTimeWithDuration(time: string): string {
  const m = time.match(/^(\d+):(\d+)\s*[-~]\s*(\d+):(\d+)$/);
  if (!m) return time;
  const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const end = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
  const dur = end - start;
  return `${time} (${dur}s)`;
}

async function downloadFile(url: string, filename: string) {
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
export function SceneImageModal({
  scenes,
  index,
  onClose,
  onNavigate,
}: {
  scenes: SceneBlock[];
  index: number;
  onClose: () => void;
  onNavigate: (idx: number) => void;
}) {
  const scene = scenes[index];
  const hasPrev = index > 0;
  const hasNext = index < scenes.length - 1;

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' && index < scenes.length - 1) onNavigate(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
      else if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [index, scenes.length, onNavigate, onClose]);

  if (!scene) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-black rounded-xl overflow-hidden w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center px-2 py-1.5 bg-neutral-900">
          <span className="text-white/50 text-[11px] font-mono px-1">
            {scene.id} · {index + 1}/{scenes.length}
          </span>
          <div className="flex items-center gap-1">
            {/* 2026-09-13 (4차) 추가 — 사용자 요청: "13단계에서 모달을 띄웠을 때 선택한
                이미지를 다운받을 수 있어야 하는데 다운로드 버튼이 없어 추가해줘". */}
            {scene.sceneImage && (
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
              aria-label="이전 장면"
            >
              ‹
            </button>
          )}
          {scene.sceneImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={scene.sceneImage} alt={scene.title || scene.id} className="max-w-full max-h-[70vh] object-contain" />
          ) : (
            <div className="text-neutral-500 text-xs py-24">이 장면엔 아직 이미지가 없습니다</div>
          )}
          {hasNext && (
            <button
              type="button"
              onClick={() => onNavigate(index + 1)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/80 hover:text-white text-2xl font-black w-9 h-9 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full"
              aria-label="다음 장면"
            >
              ›
            </button>
          )}
        </div>
        <div className="px-3 py-2 bg-neutral-900 space-y-1 max-h-[30vh] overflow-y-auto">
          {scene.time && <p className="text-white/40 text-[10px] font-mono">{scene.time}</p>}
          <p className="text-white text-[12px] font-bold leading-relaxed">{scene.title || '(장면 설명 없음)'}</p>
          {/* 2026-09-13 (8차) 추가 — 사용자 지적: "지금 스샷에 있는 문구와 대본은 전혀 다른
              느낌" — title(장면 요약)만 보이고 실제 나레이션(대본)은 안 보여서, 화면 문구와
              대본이 다르게 느껴지는 혼란이 있었다. 실제 대본 문장을 같이 보여준다. */}
          {scene.script && (
            <p className="text-white/70 text-[11px] leading-relaxed whitespace-pre-wrap border-t border-white/10 pt-1 mt-1">
              {scene.script}
            </p>
          )}
          {/* 2026-09-13 (9차) 추가, (10차) 순서 변경 — 사용자 요청: "해석을 프롬프트 아래말고
              위쪽으로" — 한국어 해석을 먼저 읽고 나서 원문 영어 프롬프트를 보게 순서를
              바꿨다(note="해석" 필드, 기존에 있었지만 안 쓰이고 있던 필드). */}
          {scene.note && (
            <p className="text-amber-200/80 text-[11px] leading-relaxed whitespace-pre-wrap border-t border-white/10 pt-1 mt-1">
              💡 {scene.note}
            </p>
          )}
          {/* 2026-09-13 (11차) 추가 — 사용자 요청: "모달에서 프롬프트 복사버튼 추가 해줘" —
              지금까지는 표에서만(CopyButton, 아래 SceneEditorList) 프롬프트를 복사할 수 있고
              모달에선 눈으로 보고 직접 드래그해서 복사해야 했다. 다른 곳(표)과 같은
              CopyButton을 그대로 재사용한다. */}
          {scene.imagePrompt && (
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
  index,
  onClose,
  onNavigate,
}: {
  scenes: SceneBlock[];
  index: number;
  onClose: () => void;
  onNavigate: (idx: number) => void;
}) {
  const scene = scenes[index];
  const hasPrev = index > 0;
  const hasNext = index < scenes.length - 1;

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' && index < scenes.length - 1) onNavigate(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
      else if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [index, scenes.length, onNavigate, onClose]);

  if (!scene) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-black rounded-xl overflow-hidden w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center px-2 py-1.5 bg-neutral-900">
          <span className="text-white/50 text-[11px] font-mono px-1">
            {scene.id} · {index + 1}/{scenes.length}
          </span>
          <div className="flex items-center gap-1">
            {scene.sceneVideo && (
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
              aria-label="이전 장면"
            >
              ‹
            </button>
          )}
          {scene.sceneVideo ? (
            <video src={scene.sceneVideo} controls autoPlay className="max-w-full max-h-[70vh]" />
          ) : (
            <div className="text-neutral-500 text-xs py-24">이 장면엔 아직 영상이 없습니다</div>
          )}
          {hasNext && (
            <button
              type="button"
              onClick={() => onNavigate(index + 1)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/80 hover:text-white text-2xl font-black w-9 h-9 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full"
              aria-label="다음 장면"
            >
              ›
            </button>
          )}
        </div>
        <div className="px-3 py-2 bg-neutral-900 space-y-1 max-h-[30vh] overflow-y-auto">
          {scene.time && <p className="text-white/40 text-[10px] font-mono">{scene.time}</p>}
          <p className="text-white text-[12px] font-bold leading-relaxed">{scene.title || '(장면 설명 없음)'}</p>
          {scene.script && (
            <p className="text-white/70 text-[11px] leading-relaxed whitespace-pre-wrap border-t border-white/10 pt-1 mt-1">
              {scene.script}
            </p>
          )}
          {/* 영상 모달은 이미지프롬프트가 아니라 실제로 이 영상을 만든 영상 프롬프트(video)를
              보여준다 — 화면에 나오는 결과물과 같은 프롬프트여야 비교가 맞다. 해석을 먼저,
              원문 영어 프롬프트를 그 아래에 (사용자 요청: "해석을 프롬프트 아래말고 위쪽으로"). */}
          {scene.note && (
            <p className="text-amber-200/80 text-[11px] leading-relaxed whitespace-pre-wrap border-t border-white/10 pt-1 mt-1">
              💡 {scene.note}
            </p>
          )}
          {scene.video && (
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
function parseSceneTimeRange(time: string): [number, number] | null {
  const m = time.match(/^(\d+):(\d+)\s*[-~]\s*(\d+):(\d+)$/);
  if (!m) return null;
  const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const end = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
  return [start, end];
}

// 2026-09-16(2차) 수정 — 처음엔 "장면 기준 행 + 겹치는 SRT 텍스트 이어붙이기"였는데, 사용자가
// 확인 후 "왼쪽 자막에 다른것들을 맞춘게 아니고 기존 씬에 자막을 맞췄네???"라고 지적 — 원하는
// 방향은 반대였다: SRT 줄이 기준(행)이 되고, 그 줄의 시간대에 해당하는 장면(이미지/프롬프트 등)을
// 옆에 붙이는 것(사용자 선택: "SRT 줄 기준(권장)"). subtitleForSceneTime(장면→자막 방향)은 이제
// 안 쓰여서 제거하고, 초를 "0:00" 형식으로 되돌리는 포맷터만 추가한다(아래 startAddForGap이
// 자막 구간에 맞는 장면을 새로 추가할 때 draft.time을 채우는 데 씀).
function formatSecToMMSS(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
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
}) {
  const scenes = parseSceneBlocks(scenePrompts);
  const srtLines = useMemo(() => parseSrtLines(srtText), [srtText]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null); // null=닫힘, -1=새 장면 추가 중
  const [draft, setDraft] = useState<SceneBlock>(EMPTY_SCENE_DRAFT);
  // 2026-09-10 추가 — 장면이미지 썸네일을 클릭하면 이 인덱스로 SceneImageModal을 연다. null=닫힘.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // 2026-09-13 추가 — 장면영상 썸네일을 클릭하면 이 인덱스로 SceneVideoModal을 연다. null=닫힘.
  const [previewVideoIndex, setPreviewVideoIndex] = useState<number | null>(null);
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
  // 여러 자막 줄에 걸친 장면 하나를 다시 개별 줄(장면 없음)로 풀어준다 — "결합"의 반대. 이미지/
  // 프롬프트 등 그 장면에 채운 내용은 사라지므로 확인을 받는다. 풀어놓은 뒤엔 원하는 하위 구간만
  // 다시 체크해서 mergeSelectedIntoScene으로 더 정확한 경계로 다시 묶을 수 있다.
  async function splitScene(idx: number) {
    if (!confirm(`${scenes[idx].id} 장면을 풀어서 다시 자막 줄들로 되돌릴까요? 이 장면에 채운 이미지·프롬프트 등은 사라집니다.`)) return;
    await onSave(serializeSceneBlocks(scenes.filter((_, i) => i !== idx)));
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
  const previewScenes = filteredWithIndex.map((f) => f.s);

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
                <th className="text-left font-black px-2 py-1.5 w-44">자막(SRT)</th>
                <th className="text-left font-black px-2 py-1.5 w-28">장면</th>
                <th className="text-left font-black px-2 py-1.5 w-20">타임</th>
                <th className="text-left font-black px-2 py-1.5 w-20">장면이미지</th>
                <th className="text-left font-black px-2 py-1.5 w-20">영상장면</th>
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
                      <td colSpan={9} className="p-1.5 bg-neutral-50">
                        <SceneDraftForm draft={draft} setDraft={setDraft} onCancel={cancel} onSave={saveDraft} saving={saving} />
                      </td>
                    </tr>
                  );
                }
                const s = row.sceneIdx !== null ? scenes[row.sceneIdx] : null;
                const pos = row.sceneIdx !== null ? filteredWithIndex.findIndex((f) => f.idx === row.sceneIdx) : -1;
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
                    <td className="px-2 py-1.5">
                      {row.entry ? (
                        <p className="text-neutral-600 leading-relaxed">{row.entry.line.text}</p>
                      ) : srtText ? (
                        <span className="text-neutral-300">(매칭 없음)</span>
                      ) : (
                        <span className="text-neutral-300">—</span>
                      )}
                    </td>
                    {row.isFirst &&
                      (s ? (
                        <>
                          <td className="px-2 py-1.5" rowSpan={row.span}>
                            <span className="font-mono text-neutral-400">{s.id}</span>
                            {s.title && <div className="font-bold truncate max-w-[7rem]">{s.title}</div>}
                          </td>
                          <td className="px-2 py-1.5 font-mono text-neutral-500 whitespace-nowrap" rowSpan={row.span}>
                            {s.time ? formatTimeWithDuration(s.time) : '—'}
                          </td>
                          <td className="px-2 py-1.5" rowSpan={row.span}>
                            {/* 2026-09-13 (10차) 수정 — 사용자 요청: "이미지나 영상이 없어도 모달
                                띄어줘 대본,프롬프트,해석 볼수 있게" — 이미지가 아직 없어도 "없음"
                                자리표시자를 눌러서 대본/프롬프트/해석은 미리 확인할 수 있게, 자리
                                표시자도 버튼으로 바꿔 항상 모달을 연다. */}
                            {s.sceneImage ? (
                              <button type="button" onClick={() => setPreviewIndex(pos)} className="block" title="클릭하면 크게 보기 (이 분류 안에서 연달아 볼 수 있어요)">
                                <img
                                  src={s.sceneImage}
                                  alt={s.title}
                                  className="w-14 h-14 object-cover rounded-md border border-neutral-200 hover:opacity-80"
                                />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setPreviewIndex(pos)}
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
                                onClick={() => setPreviewVideoIndex(pos)}
                                className="relative block"
                                title="클릭하면 크게 보기 (이 분류 안에서 연달아 볼 수 있어요)"
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
                                onClick={() => setPreviewVideoIndex(pos)}
                                className="w-14 h-14 rounded-md bg-neutral-50 border border-neutral-200 flex items-center justify-center text-neutral-300 text-[9px] text-center leading-tight hover:border-neutral-300"
                                title="클릭하면 대본·프롬프트·해석 보기 (영상은 아직 없음)"
                              >
                                없음
                              </button>
                            )}
                          </td>
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
                                <button onClick={() => splitScene(row.sceneIdx as number)} className="text-[10px] font-bold text-amber-600 hover:underline text-left">
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
                          <td className="px-2 py-1.5 text-neutral-300" rowSpan={row.span}>
                            (장면 없음)
                          </td>
                          <td className="px-2 py-1.5 font-mono text-neutral-400 whitespace-nowrap" rowSpan={row.span}>
                            {row.group.lines.length > 0
                              ? `${formatSecToMMSS(row.group.lines[0].line.start)}-${formatSecToMMSS(row.group.lines[row.group.lines.length - 1].line.end)}`
                              : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-neutral-300" rowSpan={row.span}>
                            —
                          </td>
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
        <SceneImageModal scenes={previewScenes} index={previewIndex} onClose={() => setPreviewIndex(null)} onNavigate={setPreviewIndex} />
      )}
      {previewVideoIndex !== null && (
        <SceneVideoModal scenes={previewScenes} index={previewVideoIndex} onClose={() => setPreviewVideoIndex(null)} onNavigate={setPreviewVideoIndex} />
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
