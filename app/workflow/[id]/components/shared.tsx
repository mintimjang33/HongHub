'use client';

import { useEffect, useState } from 'react';
import type { SceneBlock } from '../types';
import { EMPTY_SCENE_DRAFT, uploadSceneMedia, parseSceneBlocks, serializeSceneBlocks, nextSceneId, sortScenesById } from '../utils';

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
          <button onClick={onClose} className="text-white/70 hover:text-white text-xs font-black px-2 py-1">
            ✕ 닫기
          </button>
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
        <div className="px-3 py-2 bg-neutral-900 space-y-0.5">
          {scene.time && <p className="text-white/40 text-[10px] font-mono">{scene.time}</p>}
          <p className="text-white text-[12px] font-bold leading-relaxed">{scene.title || '(장면 설명 없음)'}</p>
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
      <div>
        <p className="text-[10px] font-black text-neutral-400 mb-1">장면이미지 — Flow 등에서 생성한 결과물을 여기 올려두면 스토리보드 썸네일로 보입니다</p>
        {draft.sceneImage ? (
          <div className="flex items-center gap-1.5 mb-1">
            <img src={draft.sceneImage} alt={draft.title} className="w-16 h-16 object-cover rounded-lg border border-neutral-200" />
            <button onClick={() => setDraft({ ...draft, sceneImage: '' })} className="text-[10px] font-black text-neutral-400 hover:text-red-500">
              ✕ 제거
            </button>
          </div>
        ) : (
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
        )}
      </div>
      <textarea
        value={draft.imagePrompt}
        onChange={(e) => setDraft({ ...draft, imagePrompt: e.target.value })}
        rows={3}
        placeholder="이미지 프롬프트 — 위 장면이미지를 생성할 때 쓴(또는 쓸) 프롬프트"
        className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px] font-mono leading-relaxed"
      />
      <textarea
        value={draft.video}
        onChange={(e) => setDraft({ ...draft, video: e.target.value })}
        rows={3}
        placeholder="영상프롬프트 or 전환프롬프트 — 장면이미지를 영상 클립으로 만들 때 쓰는 프롬프트, 또는 다음 장면으로 넘어가는 전환 연출 지시"
        className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px] font-mono leading-relaxed"
      />
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

// 6번 장면 프롬프트 편집 UI — 예전엔 전체를 통짜 텍스트로 붙여넣는 방식뿐이었는데, 장면 하나씩
// 추가/수정/삭제할 수 있게 바꿨다. 저장 시엔 여전히 scenePrompts 문자열 전체를 부모에 돌려준다
// (백엔드/파싱 로직은 그대로 두고 편집 UX만 바꾼 것).
export function SceneEditorList({
  scenePrompts,
  onSave,
  saving,
  characterTabs = [],
}: {
  scenePrompts: string;
  onSave: (text: string) => void | Promise<void>;
  saving: boolean;
  // 2026-09-12 추가 — 현재 선택된 캐릭터 프리셋의 tabs(CharacterStylePreset.tabs). 비어있으면
  // (탭 분류가 필요 없는 프리셋, 예: 포동이/식빵맨) 탭 바 자체를 안 보여준다.
  characterTabs?: { label: string; keywords: string[] }[];
}) {
  const scenes = parseSceneBlocks(scenePrompts);
  const [editingIndex, setEditingIndex] = useState<number | null>(null); // null=닫힘, -1=새 장면 추가 중
  const [draft, setDraft] = useState<SceneBlock>(EMPTY_SCENE_DRAFT);
  // 2026-09-10 추가 — 장면이미지 썸네일을 클릭하면 이 인덱스로 SceneImageModal을 연다. null=닫힘.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // 2026-09-12 추가 — 탭 필터 상태. 'all' | 'none' | 'multi' | 탭 인덱스(문자열).
  const [filterTab, setFilterTab] = useState<string>('all');

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

  // 2026-09-07, 사용자 지시로 13번을 스토리보드 표 형태로 재구성: 타임 / 장면이미지 / 이미지
  // 프롬프트 / 영상프롬프트 or 전환프롬프트 4개 열. 수정 중인 행만 SceneDraftForm으로 펼치고,
  // 나머지는 표 한 줄로 스캔하기 쉽게 보여준다. 좁은 패널이라 가로 스크롤로 감싼다.
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
              {t.label} ({countFor(t.key)})
            </button>
          ))}
        </div>
      )}
      {scenes.length > 0 && filteredWithIndex.length === 0 && (
        <p className="text-[11px] text-neutral-300">이 분류엔 해당하는 장면이 없습니다.</p>
      )}
      {filteredWithIndex.length > 0 && (
        <div className="overflow-x-auto border border-neutral-100 rounded-lg">
          <table className="w-full text-[11px] border-collapse min-w-[640px]">
            <thead>
              <tr className="bg-neutral-50 text-neutral-400">
                <th className="text-left font-black px-2 py-1.5 w-28">장면</th>
                <th className="text-left font-black px-2 py-1.5 w-20">타임</th>
                <th className="text-left font-black px-2 py-1.5 w-20">장면이미지</th>
                <th className="text-left font-black px-2 py-1.5">이미지 프롬프트</th>
                <th className="text-left font-black px-2 py-1.5">영상/전환 프롬프트</th>
                <th className="text-left font-black px-2 py-1.5 w-14">관리</th>
              </tr>
            </thead>
            <tbody>
              {filteredWithIndex.map(({ s, idx }, pos) =>
                editingIndex === idx ? (
                  <tr key={s.id || idx}>
                    <td colSpan={6} className="p-1.5 bg-neutral-50">
                      <SceneDraftForm draft={draft} setDraft={setDraft} onCancel={cancel} onSave={saveDraft} saving={saving} />
                    </td>
                  </tr>
                ) : (
                  <tr key={s.id || idx} className="border-t border-neutral-100 align-top">
                    <td className="px-2 py-1.5">
                      <span className="font-mono text-neutral-400">{s.id}</span>
                      {s.title && <div className="font-bold truncate max-w-[7rem]">{s.title}</div>}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-neutral-500 whitespace-nowrap">{s.time || '—'}</td>
                    <td className="px-2 py-1.5">
                      {s.sceneImage ? (
                        <button type="button" onClick={() => setPreviewIndex(pos)} className="block" title="클릭하면 크게 보기 (이 분류 안에서 연달아 볼 수 있어요)">
                          <img
                            src={s.sceneImage}
                            alt={s.title}
                            className="w-14 h-14 object-cover rounded-md border border-neutral-200 hover:opacity-80"
                          />
                        </button>
                      ) : (
                        <div className="w-14 h-14 rounded-md bg-neutral-50 border border-neutral-200 flex items-center justify-center text-neutral-300 text-[9px] text-center leading-tight">
                          없음
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
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
                    <td className="px-2 py-1.5">
                      {s.video ? (
                        <div className="flex items-start gap-1">
                          <p className="flex-1 min-w-0 text-neutral-600 leading-relaxed line-clamp-3">{s.video}</p>
                          <CopyButton text={s.video} />
                        </div>
                      ) : (
                        <span className="text-neutral-300">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-col gap-1">
                        <button onClick={() => startEdit(idx)} className="text-[10px] font-bold text-blue-600 hover:underline text-left">
                          수정
                        </button>
                        <button onClick={() => removeScene(idx)} className="text-[10px] font-bold text-red-500 hover:underline text-left">
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              )}
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
    </div>
  );
}
