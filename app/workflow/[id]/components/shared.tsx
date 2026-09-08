'use client';

import { useState } from 'react';
import type { SceneBlock, Character, CharacterDraft } from '../types';
import { EMPTY_SCENE_DRAFT, uploadSceneMedia, parseSceneBlocks, serializeSceneBlocks, nextSceneId, sortScenesById, nextCharacterId } from '../utils';

const EMPTY_CHARACTER_DRAFT: CharacterDraft = { id: '', name: '', role: '', description: '', imageUrl: '' };

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

// 6번 장면 프롬프트 편집 UI — 예전엔 전체를 통짜 텍스트로 붙여넣는 방식뿐이었는데, 장면 하나씩
// 추가/수정/삭제할 수 있게 바꿨다. 저장 시엔 여전히 scenePrompts 문자열 전체를 부모에 돌려준다
// (백엔드/파싱 로직은 그대로 두고 편집 UX만 바꾼 것).
export function SceneEditorList({
  scenePrompts,
  onSave,
  saving,
}: {
  scenePrompts: string;
  onSave: (text: string) => void | Promise<void>;
  saving: boolean;
}) {
  const scenes = parseSceneBlocks(scenePrompts);
  const [editingIndex, setEditingIndex] = useState<number | null>(null); // null=닫힘, -1=새 장면 추가 중
  const [draft, setDraft] = useState<SceneBlock>(EMPTY_SCENE_DRAFT);

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

  // 2026-09-07, 사용자 지시로 13번을 스토리보드 표 형태로 재구성: 타임 / 장면이미지 / 이미지
  // 프롬프트 / 영상프롬프트 or 전환프롬프트 4개 열. 수정 중인 행만 SceneDraftForm으로 펼치고,
  // 나머지는 표 한 줄로 스캔하기 쉽게 보여준다. 좁은 패널이라 가로 스크롤로 감싼다.
  return (
    <div className="space-y-1.5 mt-1">
      {scenes.length === 0 && editingIndex === null && <p className="text-[11px] text-neutral-300">아직 없음</p>}
      {scenes.length > 0 && (
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
              {scenes.map((s, idx) =>
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
                        <img src={s.sceneImage} alt={s.title} className="w-14 h-14 object-cover rounded-md border border-neutral-200" />
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
    </div>
  );
}

// 캐릭터 하나를 추가/수정하는 폼 — SceneDraftForm과 같은 패턴(이미지는 uploadSceneMedia로 영구 저장).
export function CharacterDraftForm({
  draft,
  setDraft,
  onCancel,
  onSave,
  saving,
}: {
  draft: CharacterDraft;
  setDraft: (d: CharacterDraft) => void;
  onCancel: () => void;
  onSave: () => void | Promise<void>;
  saving: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  async function handleFile(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError('');
    try {
      const url = await uploadSceneMedia(files[0]);
      setDraft({ ...draft, imageUrl: url });
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
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="이름 (예: 젠틀맨 루즈)"
          className="flex-1 border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px]"
        />
        <input
          value={draft.role}
          onChange={(e) => setDraft({ ...draft, role: e.target.value })}
          placeholder="역할 (예: 메인 화자 / 출연 캐릭터 / 실존 인물)"
          className="flex-1 border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px]"
        />
      </div>
      <textarea
        value={draft.description}
        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        rows={4}
        placeholder="외형/특징 설명 — Flow 프롬프트에 그대로 옮겨 쓸 수 있게 구체적으로"
        className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px] font-mono leading-relaxed"
      />
      <div className="border-t border-neutral-200 pt-1.5">
        {draft.imageUrl && (
          <div className="mb-1.5 flex items-center gap-1.5">
            <img src={draft.imageUrl} alt={draft.name} className="w-16 h-16 object-cover rounded-lg border border-neutral-200" />
            <button onClick={() => setDraft({ ...draft, imageUrl: '' })} className="text-[10px] font-black text-neutral-400 hover:text-red-500">
              ✕ 이미지 제거
            </button>
          </div>
        )}
        {/* 2026-09-08 추가 — 지금까지 파일 업로드(uploadSceneMedia)만 있어서, Flow에서 이미지를
            만든 뒤 로컬로 다운로드→업로드하는 왕복이 필요했다. Flow가 실제 이미지 파일 URL을
            바로 주는 경우(다운로드 없이 "이미지 주소 복사" 등)엔 그 URL을 여기 바로 붙여넣게
            해서 왕복을 없앤다(사용자 지시: "이미지 URL을 직접 붙여넣는 입력칸 추가"). Flow의
            "공유" 페이지 링크(labs.google/fx/tools/flow/shared/...)는 HTML 페이지라 <img> src로
            안 먹히니, 실제 이미지 파일 주소를 넣어야 한다는 걸 placeholder에 짧게 안내한다. */}
        <input
          type="text"
          value={draft.imageUrl}
          onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
          placeholder="이미지 URL 붙여넣기 (실제 이미지 파일 주소 — Flow 공유 페이지 링크는 안 됨)"
          className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px] mb-1.5"
        />
        <label className="inline-block text-[11px] font-bold text-blue-600 hover:underline cursor-pointer">
          {uploading ? '업로드 중...' : draft.imageUrl ? '이미지 교체(파일 업로드)' : '+ 캐릭터 시트 이미지 업로드'}
          <input
            type="file"
            accept="image/*"
            disabled={uploading}
            onChange={(e) => {
              handleFile(e.target.files);
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
          disabled={saving || !draft.name.trim()}
          className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
}

// 12번(채널 캐릭터 시스템 설계) 단계 패널 — 만화책의 "등장인물 소개" 페이지처럼, 이 채널에서
// 반복해서 쓰는 캐릭터(호스트 젠틀맨 루즈, 출연 캐릭터 등)를 등록/수정/삭제한다. 특정 콘텐츠가
// 아니라 채널 전체 자산이라 site.script_draft.characters(최상위)에 저장하고, 13번(이미지/영상
// 생성)에서 프롬프트를 짤 때 여기 설명을 그대로 참고한다.
// CharacterPanel(채널 공용)과 유닛별 캐릭터 목록이 완전히 같은 목록+추가/수정/삭제 UI를 쓰기 때문에
// (2026-09-07, 유닛별 분리 리팩터링 때) 공통 렌더링만 여기로 뽑았다. 저장 방식(어느 API body 필드로
// 보낼지)은 부모가 onSave로 넘겨준다 — 이 컴포넌트는 무엇을 저장하는지 모른다.
export function CharacterListEditor({
  characters,
  onSave,
  saving,
  emptyText,
  numbered,
}: {
  characters: Character[];
  onSave: (next: Character[]) => void | Promise<void>;
  saving: boolean;
  emptyText: string;
  // 2026-09-07 추가 — 메인 캐릭터(진행자) 목록 전용. 지금은 1명뿐이지만, 사용자가 "앞으로 여러
  // 진행자를 만들어서 컨셉에 따라 골라 쓰면 좋겠다"고 해서 순번(1번/2번…)을 카드 위에 표시해둔다.
  numbered?: boolean;
}) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null); // null=닫힘, -1=새 캐릭터 추가 중
  const [draft, setDraft] = useState<CharacterDraft>(EMPTY_CHARACTER_DRAFT);
  // 2026-09-07 추가 — 캐릭터 썸네일이 너무 작아서 클릭하면 ImagePreviewModal(기존 컴포넌트 재사용)로
  // 크게 볼 수 있게 함(사용자 지적: "클릭하면 보이지도 않고").
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  function startEdit(idx: number) {
    setEditingIndex(idx);
    setDraft({ ...characters[idx], imageUrl: characters[idx].imageUrl || '' });
  }
  function startAdd() {
    setEditingIndex(-1);
    setDraft({ ...EMPTY_CHARACTER_DRAFT, id: nextCharacterId(characters) });
  }
  function cancel() {
    setEditingIndex(null);
    setDraft(EMPTY_CHARACTER_DRAFT);
  }
  async function saveDraft() {
    const next = editingIndex === -1 ? [...characters, draft] : characters.map((c, i) => (i === editingIndex ? draft : c));
    await onSave(next);
    setEditingIndex(null);
    setDraft(EMPTY_CHARACTER_DRAFT);
  }
  async function removeCharacter(idx: number) {
    if (!confirm(`"${characters[idx].name}" 캐릭터를 삭제할까요?`)) return;
    await onSave(characters.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-1.5">
      {characters.length === 0 && editingIndex === null && <p className="text-[11px] text-neutral-300">{emptyText}</p>}
      {characters.map((c, idx) =>
        editingIndex === idx ? (
          <CharacterDraftForm key={c.id || idx} draft={draft} setDraft={setDraft} onCancel={cancel} onSave={saveDraft} saving={saving} />
        ) : (
          <div key={c.id || idx}>
            {numbered && <p className="text-[10px] font-black text-neutral-400 mb-0.5 ml-0.5">{idx + 1}번</p>}
            <div className="flex items-start gap-2 bg-white border border-neutral-100 rounded-lg p-2">
              {c.imageUrl ? (
                <button type="button" onClick={() => setPreviewSrc(c.imageUrl!)} className="shrink-0">
                  <img src={c.imageUrl} alt={c.name} className="w-14 h-14 object-cover rounded-lg border border-neutral-200 hover:opacity-80" />
                </button>
              ) : (
                <div className="w-14 h-14 rounded-lg bg-neutral-50 border border-neutral-200 shrink-0 flex items-center justify-center text-neutral-300 text-[10px] text-center leading-tight">
                  이미지
                  <br />
                  없음
                </div>
              )}
              <div className="flex-1 min-w-0">
                {/* 2026-09-08 수정 — 이름+역할을 한 줄에 나란히 두면(이름은 truncate, 역할은
                    shrink-0) 역할 텍스트가 길 때(예: 소재별 배역 설명) 이름이 거의 안 보이게
                    잘렸다(사용자 지적: "이름이 가려서 안보이자나"). 이름/역할/설명을 각자 줄에
                    풀네임으로 세로로 쌓는 걸로 바꿔서 셋 다 안 잘리고 다 보이게 했다. */}
                <p className="text-sm font-bold leading-snug">{c.name}</p>
                {c.role && <p className="text-[10px] font-bold text-neutral-400 mt-0.5 leading-snug">{c.role}</p>}
                {c.description && <p className="text-[11px] text-neutral-500 leading-relaxed mt-1 line-clamp-2">{c.description}</p>}
              </div>
              <div className="shrink-0 flex items-center gap-1.5">
                <button onClick={() => startEdit(idx)} className="text-[11px] font-bold text-blue-600 hover:underline">
                  수정
                </button>
                <button onClick={() => removeCharacter(idx)} className="text-[11px] font-bold text-neutral-400 hover:text-red-500">
                  삭제
                </button>
              </div>
            </div>
          </div>
        )
      )}
      {editingIndex === -1 ? (
        <CharacterDraftForm draft={draft} setDraft={setDraft} onCancel={cancel} onSave={saveDraft} saving={saving} />
      ) : (
        <button onClick={startAdd} className="text-[11px] font-bold text-blue-600 hover:underline">
          + 캐릭터 추가
        </button>
      )}
      {previewSrc && <ImagePreviewModal src={previewSrc} onClose={() => setPreviewSrc(null)} />}
    </div>
  );
}
