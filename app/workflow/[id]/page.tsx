'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

type AnalysisResult = {
  channel?: string;
  title?: string;
  script?: string;
  thumbnail?: string;
  comment?: string;
  duration?: string;
  pace?: string;
  updated_at?: string;
};
// 5번은 소재 하나마다 별개의 완성 콘텐츠라서, 작업 중인 것 하나(소재→제목→대본 위저드)와
// 별개로 완성된 것들을 units 배열에 콘텐츠 단위로 저장한다. 나중에 6~9번(영상/TTS/자막/렌더링)도
// 여기 unit id를 기준으로 진행 상태를 붙일 수 있게 id를 갖고 있다.
type UnitReview = { score?: number; feedback?: string; reviewedAt?: string };
type UnitCategory = 'trivia' | 'disaster';
type ContentUnit = {
  id: string;
  material: string;
  title: string;
  script: string;
  // 2026-08-31 추가 — 대참사/사건은 트리비아용 가벼운 톤을 쓰면 안 돼서 완전히 다른 프롬프트 세트를 쓴다.
  category?: UnitCategory;
  // 공학 파이프라인 내 세부 분야(건축/무기/토목/항공/자연재해 등) — 자유 텍스트, 프리셋 밖도 허용.
  topic?: string;
  // 최종 선택된 것 외에 그때 같이 추천받았던 후보들 — 나중에 다시 참고하거나 다른 걸로 바꾸고 싶을 때를 위해 보존.
  materialCandidates?: string[];
  titleCandidates?: string[];
  titleEn?: string;
  scriptEn?: string;
  titleJa?: string;
  scriptJa?: string;
  review?: UnitReview;
  // 2026-08-31 추가 — 특히 사실관계 검증이 중요한(대참사/사건) 콘텐츠는 나중에 "그거 어디서 봤냐"고
  // 따지고 들 때 근거로 내밀 수 있게 출처를 같이 저장해둔다. 문장 단위까지는 아니고 콘텐츠 단위로.
  sources?: string[];
  // 제미나이와 비교(action=compare)해서 받은 사실확인 결과 — 업그레이드 이후에도 근거로 남겨둔다.
  factCheck?: string;
  // 2026-09-03 추가 — 8번(전략/컨셉 확정) 단계. script-writer 스킬 3단계에 해당. 검토한 방향 후보를
  // 실제로 다 적어두고(하나만 남기지 않고) 그중 뭘 왜 골랐는지까지 남겨야 나중에 "왜 이 앵글이었는지"
  // 되짚을 수 있다.
  strategyOptions?: string[];
  selectedStrategy?: string;
  strategyReason?: string;
  // 2026-09-03 추가 — 9번(훅/인트로 설계) 단계. script-writer 스킬 4단계에 해당. 클릭률에 가장 큰
  // 영향을 주는 단계라 후보 버전을 여러 개 적어보고 제일 강한 걸 고른 기록을 남긴다.
  hookOptions?: string[];
  selectedHook?: string;
  // 2026-08-31 추가 — 6번(이미지/영상 생성) 단계의 장면별 CLEAN/INFO/영상 프롬프트 전문. 파이프라인
  // 전체가 공유하는 workflow_content가 아니라 이 유닛(에피소드) 하나에 귀속시켜서, 소재가 바뀌어도
  // "이게 어느 콘텐츠 프롬프트인지" 헷갈리지 않게 한다.
  scenePrompts?: string;
  // 2026-09-01 추가 — 8번(나레이션 TTS) 단계의 음성 파일/링크. 씬별(scenePrompts)과 달리 나레이션은
  // 콘텐츠 대본 전체에 대해 하나(또는 후보 여러 개) 나오는 거라 유닛에 바로 붙인다. 링크를 직접
  // 붙여넣거나, 파일을 업로드하면(uploadSceneMedia 재사용) 그 URL이 여기 같이 쌓인다.
  // label — 예: "원본"/"1.3배속" 같은 후보 구분용(2026-09-01 추가, 링크만으로는 뭐가 뭔지 구분이 안 돼서).
  narrationUrls?: { label: string; url: string }[];
  // 2026-09-01 추가 — 9번(자막) 단계. narrationUrls와 구조·용도가 완전히 같아서(콘텐츠 하나에
  // 라벨 붙은 링크/파일 여러 개) 같은 LabeledLinksPanel 컴포넌트를 재사용한다.
  subtitleUrls?: { label: string; url: string }[];
  status?: 'pending' | 'approved' | 'rejected';
  createdAt: string;
};
type ScriptDraft = {
  category?: UnitCategory;
  materials?: string[];
  selectedMaterial?: string;
  titles?: string[];
  selectedTitle?: string;
  script?: string;
  titleEn?: string;
  scriptEn?: string;
  titleJa?: string;
  scriptJa?: string;
  sources?: string[];
  factCheck?: string;
  units?: ContentUnit[];
  updated_at?: string;
};
type Site = {
  id: string;
  name: string;
  workflow_content: string | null;
  analysis_result: AnalysisResult | null;
  script_draft: ScriptDraft | null;
};
type Step = { n: string; name: string; desc: string; status: string };
type Channel = { id: string; name: string; url: string | null; subscriber_count: string | null; notes: string | null };
type VideoComment = { author: string; text: string; likeCount: number };
type SourceItem = {
  id: string;
  channel_id: string | null;
  source_url: string | null;
  title: string;
  thumbnail_url: string | null;
  transcript: string | null;
  duration_seconds: number | null;
  views: string | null;
  comment_count: number | null;
  top_comments: VideoComment[] | null;
};
type ChannelVideoResult = {
  videoId: string;
  title: string;
  url: string;
  views: number;
  viewsLabel: string;
  thumbnail: string;
  durationSeconds: number;
  durationLabel: string;
};
type ChannelMaterialGroup = { channelId: string; channelName: string; videos: ChannelVideoResult[]; error?: string };
type DiscoverResult = {
  videoId: string;
  title: string;
  url: string;
  channelId: string;
  channelTitle: string;
  channelUrl: string;
  subscriberLabel: string;
  viewsLabel: string;
  thumbnail: string;
};

const CHANNEL_TAG_RE = /^\[파이프라인:([^\]]+)\]\s*/;

const TEMPLATE = `# {{프로젝트명}} 워크플로우

> 계획서(무엇을 벤치마킹하는지/어떤 소재인지)와는 별개 문서. 여기는 "어떤 순서로 어떤 도구를 쓰는지"만 담는다.

## 9단계

| # | 단계 | 내용 | 상태({{YYYY-MM-DD}}) |
|---|---|---|---|
| 1 | 채널 발굴 | 벤치마크 후보 채널을 찾아 소스채널로 등록 | |
| 2 | 채널별 소재(영상) 수집 | 채널별 잘 터진 영상의 제목/썸네일/조회수를 소재로 등록 | |
| 3 | 대본(자막) 수집 | 2번 영상들의 실제 대본 확보 | |
| 4 | 분석 | 제목/썸네일/대본에서 공통 패턴(훅/구조/톤) 추출 | |
| 5 | 대본 작성 | 4번 분석 기반 새 대본 작성 | |
| 6 | 이미지/영상 생성 | | |
| 7 | 나레이션(TTS) | | |
| 8 | 자막 | | |
| 9 | 렌더링+일괄배포 | | |

## 막히는 지점 / 다음에 정할 것

-
`;

// "| 1 | 채널 발굴 | 내용... | 상태... |" 형태의 마크다운 표 행을 파싱해서 단계 배열로 만든다.
// 헤더 행(#/단계/내용/상태)과 구분선 행(|---|...)은 건너뛴다. 표가 없거나 형식이 안 맞으면 빈 배열.
function parseSteps(markdown: string): Step[] {
  const lines = markdown.split('\n');
  const steps: Step[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 3) continue;
    const [n, name, desc = '', status = ''] = cells;
    if (!/^\d+$/.test(n)) continue; // 헤더/구분선/숫자 아닌 행 제외
    steps.push({ n, name, desc, status });
  }
  return steps;
}

// scenePrompts 텍스트("### S01A 제목 (4초)\n대본: ...\n- CLEAN: ...\n- INFO: ...\n- 영상: ..." 형식,
// 6번 워크시트/워크플로우 문서에서 쓰는 것과 동일한 포맷)를 장면 카드 배열로 파싱한다.
// 형식이 안 맞으면(자유 텍스트로 붙여넣은 경우 등) 빈 배열을 반환하고, 그때는 원문 그대로 보여준다.
function parseSceneBlocks(
  text: string
): { id: string; title: string; script: string; note: string; clean: string; info: string; video: string; media: string[] }[] {
  if (!text) return [];
  const blocks = text
    .split(/\n(?=###\s)/)
    .map((b) => b.trim())
    .filter((b) => b.startsWith('###'));
  return blocks.map((block, idx) => {
    const lines = block.split('\n');
    const header = lines[0].replace(/^###\s*/, '');
    const headerMatch = header.match(/^(\S+)\s+(.*)$/);
    const id = headerMatch ? headerMatch[1] : `S${idx + 1}`;
    const title = headerMatch ? headerMatch[2] : header;
    let script = '';
    let note = '';
    let clean = '';
    let info = '';
    let video = '';
    const media: string[] = [];
    for (const line of lines.slice(1)) {
      if (line.startsWith('대본:')) script = line.replace(/^대본:\s*/, '');
      else if (line.startsWith('- 해석:')) note = line.replace(/^- 해석:\s*/, '');
      else if (line.startsWith('- CLEAN:')) clean = line.replace(/^- CLEAN:\s*/, '');
      else if (line.startsWith('- INFO:')) info = line.replace(/^- INFO:\s*/, '');
      else if (line.startsWith('- 영상:')) video = line.replace(/^- 영상:\s*/, '');
      else if (line.startsWith('- 자료:')) media.push(line.replace(/^- 자료:\s*/, '').trim());
    }
    return { id, title, script, note, clean, info, video, media };
  });
}

type SceneBlock = { id: string; title: string; script: string; note: string; clean: string; info: string; video: string; media: string[] };
const EMPTY_SCENE_DRAFT: SceneBlock = { id: '', title: '', script: '', note: '', clean: '', info: '', video: '', media: [] };

// Flow 등에서 만든 이미지/영상을 다운로드해서 여기로 업로드하면 /api/upload가 honghub-files
// Storage에 영구 저장하고 공개 URL을 돌려준다(Flow 자체 링크는 구글 로그인 세션에 묶이거나
// 임시 CDN이라 나중에 깨질 수 있어서, 항상 우리 쪽에 실물을 복사해두는 것).
async function uploadSceneMedia(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '업로드 실패');
  return data.url as string;
}

// parseSceneBlocks의 역함수 — 장면 배열을 다시 "### id title\n대본: ...\n- CLEAN: ...\n- INFO: ...\n- 영상: ..." 텍스트로 합친다.
// 값이 비어있는 필드는 그 줄 자체를 안 씀(예: 텍스트→영상 직접 생성 방식은 CLEAN/INFO 없이 영상 한 줄만 있어도 됨).
function serializeSceneBlocks(scenes: SceneBlock[]): string {
  return scenes
    .map((s) => {
      const lines = [`### ${s.id}${s.title ? ` ${s.title}` : ''}`];
      if (s.script) lines.push(`대본: ${s.script}`);
      if (s.note) lines.push(`- 해석: ${s.note}`);
      if (s.clean) lines.push(`- CLEAN: ${s.clean}`);
      if (s.info) lines.push(`- INFO: ${s.info}`);
      if (s.video) lines.push(`- 영상: ${s.video}`);
      for (const m of s.media || []) if (m) lines.push(`- 자료: ${m}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

// 기존 장면 id(S01A, S02A...)에서 숫자 부분 최댓값+1로 다음 장면 id를 제안한다.
function nextSceneId(scenes: SceneBlock[]): string {
  let max = 0;
  for (const s of scenes) {
    const m = s.id.match(/(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `S${String(max + 1).padStart(2, '0')}A`;
}

// id에 든 숫자(S01A → 1) 기준 오름차순 정렬 — 순서를 만든 시점이 아니라 항상 번호 순서로 보이게.
function sortScenesById(scenes: SceneBlock[]): SceneBlock[] {
  return [...scenes].sort((a, b) => {
    const na = parseInt((a.id.match(/(\d+)/) || ['', '0'])[1], 10);
    const nb = parseInt((b.id.match(/(\d+)/) || ['', '0'])[1], 10);
    if (na !== nb) return na - nb;
    return a.id.localeCompare(b.id);
  });
}

// 장면 하나를 추가/수정하는 폼 — id/제목/대본/영상 프롬프트가 기본, CLEAN/INFO는 이미지 2장 방식을 쓸 때만 펼쳐서 채운다.
function SceneDraftForm({
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
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="장면 제목 (예: 오프닝훅·4초)"
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
      <textarea
        value={draft.video}
        onChange={(e) => setDraft({ ...draft, video: e.target.value })}
        rows={4}
        placeholder="영상 생성 프롬프트 — 텍스트→영상 직접 생성 방식이면 이 칸 하나만 채우면 됨"
        className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px] font-mono leading-relaxed"
      />
      <details className="text-[10px]">
        <summary className="cursor-pointer text-neutral-400 font-bold">CLEAN/INFO 이미지 프롬프트 (이미지 2장 방식 쓸 때만)</summary>
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
function SceneEditorList({
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
  // 장면 편집 폼에 안 들어가고, 보기 화면에서 첨부 하나만 바로 뗄 수 있게(수정 모드까지 안 열어도 되게).
  async function removeSceneMedia(sceneIdx: number, mediaIdx: number) {
    const next = scenes.map((s, i) => (i === sceneIdx ? { ...s, media: s.media.filter((_, j) => j !== mediaIdx) } : s));
    await onSave(serializeSceneBlocks(next));
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

  return (
    <div className="space-y-1.5 mt-1">
      {scenes.length === 0 && editingIndex === null && <p className="text-[11px] text-neutral-300">아직 없음</p>}
      {scenes.map((s, idx) =>
        editingIndex === idx ? (
          <SceneDraftForm key={s.id || idx} draft={draft} setDraft={setDraft} onCancel={cancel} onSave={saveDraft} saving={saving} />
        ) : (
          <details key={s.id || idx} className="bg-white border border-neutral-100 rounded-lg">
            <summary className="cursor-pointer px-2.5 py-2 text-[11px] font-bold flex items-center gap-2 select-none">
              <span className="text-neutral-400 shrink-0">{s.id}</span>
              <span className="flex-1 min-w-0 truncate">{s.title}</span>
              <span
                role="button"
                onClick={(e) => {
                  e.preventDefault();
                  startEdit(idx);
                }}
                className="shrink-0 text-[10px] font-bold text-blue-600 hover:underline"
              >
                ✏️
              </span>
              <span
                role="button"
                onClick={(e) => {
                  e.preventDefault();
                  removeScene(idx);
                }}
                className="shrink-0 text-[10px] font-bold text-red-500 hover:underline"
              >
                🗑
              </span>
            </summary>
            <div className="px-2.5 pb-2.5 pt-1 border-t border-neutral-50 space-y-1.5">
              {s.script && <p className="text-[11px] text-neutral-500 italic">&quot;{s.script}&quot;</p>}
              {s.note && (
                <p className="text-[11px] text-emerald-700 bg-emerald-50 rounded-md px-2 py-1 leading-relaxed">🇰🇷 {s.note}</p>
              )}
              {s.clean && (
                <div className="flex items-start gap-1.5">
                  <span className="shrink-0 text-[10px] font-black text-cyan-600 mt-0.5 w-10">CLEAN</span>
                  <p className="flex-1 text-[11px] text-neutral-600 leading-relaxed">{s.clean}</p>
                  <CopyButton text={s.clean} />
                </div>
              )}
              {s.info && (
                <div className="flex items-start gap-1.5">
                  <span className="shrink-0 text-[10px] font-black text-cyan-600 mt-0.5 w-10">INFO</span>
                  <p className="flex-1 text-[11px] text-neutral-600 leading-relaxed">{s.info}</p>
                  <CopyButton text={s.info} />
                </div>
              )}
              {s.video && (
                <div className="flex items-start gap-1.5">
                  <span className="shrink-0 text-[10px] font-black text-amber-600 mt-0.5 w-10">영상</span>
                  <p className="flex-1 text-[11px] text-neutral-600 leading-relaxed">{s.video}</p>
                  <CopyButton text={s.video} />
                </div>
              )}
              {s.media.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-neutral-400 mb-1">📎 자료</p>
                  <div className="space-y-1">
                    {s.media.map((url, mi) => (
                      <div key={mi} className="flex items-center gap-1.5 bg-white border border-neutral-200 rounded-lg px-2 py-1">
                        <a href={url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 truncate text-[11px] text-blue-600 hover:underline">
                          {url}
                        </a>
                        <CopyButton text={url} />
                        <button
                          onClick={() => removeSceneMedia(idx, mi)}
                          title="첨부 삭제"
                          className="shrink-0 text-[10px] font-black text-neutral-400 hover:text-red-500"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </details>
        )
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

// 단계 이름/내용에 등장하는 키워드로 실제 작업 페이지 바로가기 링크를 만들어준다.
// "채널 발굴"(1번), "소재 수집"(2번), "대본 수집"(3번) 단계는 이 페이지에서 바로 처리할 수 있게
// 만들어서(ChannelPanel/MaterialPanel/TranscriptPanel) 별도 링크가 필요 없다.
function stepLink(step: Step): { href: string; label: string } | null {
  const text = `${step.name} ${step.desc}`;
  if (
    isChannelStep(step) ||
    isMaterialStep(step) ||
    isTranscriptStep(step) ||
    isAnalysisStep(step) ||
    isScriptStep(step) ||
    isMaterialSelectionStep(step) ||
    isResearchStep(step) ||
    isContentRegisterStep(step) ||
    isStrategyStep(step) ||
    isHookStep(step)
  )
    return null;
  if (/생성|콘텐츠/.test(text)) return { href: '/sources?tab=generate', label: '🎯 소스 발굴 → 콘텐츠 생성 탭' };
  return null;
}

// 저장된 소재는 videoId 없이 유튜브 URL(source_url)만 갖고 있으므로, 미리보기 모달을 쓰려면
// URL 형태(watch?v=, youtu.be/, shorts/)에서 videoId를 다시 뽑아내야 한다.
function extractVideoId(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (u.hostname.endsWith('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const shortsMatch = u.pathname.match(/^\/shorts\/([^/?]+)/);
      if (shortsMatch) return shortsMatch[1];
    }
  } catch {
    // URL 형식이 아니면 무시
  }
  return null;
}

function isChannelStep(step: Step): boolean {
  return /채널\s*발굴/.test(`${step.name} ${step.desc}`);
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// 영상을 새 탭으로 안 열고 페이지 안에서 바로 확인할 수 있게 하는 작은 모달.
// 확인 → 닫기 → 다음 확인 → 닫기 흐름이 되게, 오버레이 클릭이나 ✕로 바로 닫힌다.
function VideoPreviewModal({ videoId, onClose }: { videoId: string; onClose: () => void }) {
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

function ImagePreviewModal({ src, onClose }: { src: string; onClose: () => void }) {
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
function CopyButton({ text }: { text: string }) {
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
      {copied ? '복사됨' : '복사'}
    </button>
  );
}

// 워크플로우 페이지에서 바로 채널을 추가/조회하는 패널. hub_source_channels에
// [파이프라인:{siteName}] 태그로 저장하므로, 여기서 추가하면 /pipelines, /sources에도 그대로 반영된다.
function ChannelPanel({ siteName }: { siteName: string }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', subscriber_count: '' });
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchResults, setSearchResults] = useState<DiscoverResult[]>([]);
  const [addedChannelIds, setAddedChannelIds] = useState<Set<string>>(new Set());
  const [previewVideoId, setPreviewVideoId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', url: '', subscriber_count: '' });
  const [editSaving, setEditSaving] = useState(false);

  function load() {
    setLoading(true);
    fetch('/api/source-channels')
      .then((r) => r.json())
      .then((d) => setChannels(d.channels || []))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const mine = channels.filter((c) => (c.notes || '').match(CHANNEL_TAG_RE)?.[1] === siteName);
  const mineUrls = new Set(mine.map((c) => c.url).filter(Boolean));

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError('');
    try {
      const res = await fetch(`/api/discover-channels?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.error || '검색 실패');
        setSearchResults([]);
      } else {
        setSearchResults(data.results || []);
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  async function addFromSearch(r: DiscoverResult) {
    setAddedChannelIds((prev) => new Set(prev).add(r.channelId));
    try {
      await fetch('/api/source-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: r.channelTitle,
          platform: 'youtube',
          url: r.channelUrl,
          subscriber_count: r.subscriberLabel,
          content_types: [],
          platform_fit: [],
          notes: `[파이프라인:${siteName}]`,
          status: '후보',
        }),
      });
      setExpanded(true);
      load();
    } catch {
      setAddedChannelIds((prev) => {
        const next = new Set(prev);
        next.delete(r.channelId);
        return next;
      });
    }
  }

  async function handleAdd() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/source-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          platform: 'youtube',
          url: form.url || null,
          subscriber_count: form.subscriber_count || null,
          content_types: [],
          platform_fit: [],
          notes: `[파이프라인:${siteName}]`,
          status: '후보',
        }),
      });
      setForm({ name: '', url: '', subscriber_count: '' });
      setShowForm(false);
      setExpanded(true);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function deleteChannel(id: string) {
    await fetch(`/api/source-channels/${id}`, { method: 'DELETE' });
    load();
  }

  function openEdit(c: Channel) {
    setEditingId(c.id);
    setEditForm({ name: c.name, url: c.url || '', subscriber_count: c.subscriber_count || '' });
  }

  async function handleEditSave() {
    if (!editingId || !editForm.name.trim()) return;
    setEditSaving(true);
    try {
      await fetch(`/api/source-channels/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      setEditingId(null);
      load();
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div className="border-t border-black/5 pt-3">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-black text-neutral-500 hover:text-black"
        >
          <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
          🎯 등록된 채널 ({loading ? '...' : mine.length})
        </button>
        <div className="flex gap-1.5">
          <button
            onClick={() => setShowSearch((v) => !v)}
            className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white"
          >
            🔍 채널 찾기
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white hover:bg-neutral-800"
          >
            + 채널 추가
          </button>
        </div>
      </div>

      {showSearch && (
        <div className="bg-white border border-neutral-200 rounded-lg p-3 mb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-black text-neutral-500">🔍 채널 찾기</span>
            <button
              onClick={() => {
                setShowSearch(false);
                setQuery('');
                setSearchResults([]);
                setSearchError('');
              }}
              className="text-[11px] font-bold text-neutral-400 hover:text-black"
            >
              ✕ 닫기
            </button>
          </div>
          <div className="flex gap-2 mb-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="검색어 (예: 건축 상식, 심리 실험)"
              className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-xs"
            />
            <button
              onClick={handleSearch}
              disabled={searching || !query.trim()}
              className="text-[11px] font-black px-4 py-2 rounded-lg bg-black text-white disabled:opacity-40"
            >
              {searching ? '찾는 중...' : '찾기'}
            </button>
          </div>
          <p className="text-[10px] text-neutral-400 mb-2">
            최근 14일 내 조회수 1만 이상 쇼츠를 유튜브에서 검색해서, 채널별로 가장 잘 터진 영상 하나씩만 보여줘요.
          </p>
          {searchError && <p className="text-[11px] text-red-500 font-bold mb-2">{searchError}</p>}
          {searchResults.length > 0 && (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {searchResults.map((r) => {
                const already = mineUrls.has(r.channelUrl) || addedChannelIds.has(r.channelId);
                return (
                  <div key={r.videoId} className="flex items-center gap-2 border border-neutral-100 rounded-lg p-2">
                    {r.thumbnail && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.thumbnail}
                        alt=""
                        onClick={() => setPreviewVideoId(r.videoId)}
                        className="w-14 h-14 object-cover rounded-lg shrink-0 bg-neutral-100 cursor-pointer"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <button onClick={() => setPreviewVideoId(r.videoId)} className="text-xs font-bold truncate block hover:underline text-left">
                        {r.title}
                      </button>
                      <div className="text-[11px] text-neutral-400 mt-0.5">
                        {r.channelTitle} · 구독자 {r.subscriberLabel} · 조회수 {r.viewsLabel}
                      </div>
                    </div>
                    <button
                      onClick={() => addFromSearch(r)}
                      disabled={already}
                      className="shrink-0 text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40 disabled:bg-neutral-300"
                    >
                      {already ? '추가됨' : '+ 채널로 추가'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {previewVideoId && <VideoPreviewModal videoId={previewVideoId} onClose={() => setPreviewVideoId(null)} />}

      {showForm && (
        <div className="bg-white border border-neutral-200 rounded-lg p-3 mb-2 space-y-2">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="채널명 *"
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="URL"
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs"
            />
            <input
              value={form.subscriber_count}
              onChange={(e) => setForm((f) => ({ ...f, subscriber_count: e.target.value }))}
              placeholder="구독자수 (예: 5.2만)"
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs"
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleAdd}
              disabled={saving || !form.name.trim()}
              className="text-[11px] font-black px-4 py-2 rounded-lg bg-black text-white disabled:opacity-40"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      )}

      {expanded && mine.length > 0 && (
        <div className="space-y-1.5">
          {mine.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-2 text-[11px] bg-white hover:bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2"
            >
              {editingId === c.id ? (
                <div className="flex-1 flex items-center gap-1.5">
                  <input
                    value={editForm.name}
                    onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="채널명"
                    className="flex-1 min-w-0 border border-neutral-200 rounded px-2 py-1 text-[11px]"
                  />
                  <input
                    value={editForm.url}
                    onChange={(e) => setEditForm((f) => ({ ...f, url: e.target.value }))}
                    placeholder="URL"
                    className="flex-1 min-w-0 border border-neutral-200 rounded px-2 py-1 text-[11px]"
                  />
                  <input
                    value={editForm.subscriber_count}
                    onChange={(e) => setEditForm((f) => ({ ...f, subscriber_count: e.target.value }))}
                    placeholder="구독자수"
                    className="w-20 shrink-0 border border-neutral-200 rounded px-2 py-1 text-[11px]"
                  />
                  <button
                    onClick={handleEditSave}
                    disabled={editSaving || !editForm.name.trim()}
                    className="shrink-0 text-[11px] font-black px-2.5 py-1 rounded-lg bg-black text-white disabled:opacity-40"
                  >
                    {editSaving ? '저장 중' : '저장'}
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="shrink-0 text-neutral-400 font-bold hover:text-black px-1"
                  >
                    취소
                  </button>
                </div>
              ) : (
                <>
                  <a
                    href={c.url || '#'}
                    target={c.url ? '_blank' : undefined}
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      if (!c.url) e.preventDefault();
                    }}
                    className="flex-1 min-w-0 flex items-center gap-2 hover:underline"
                  >
                    <span className="font-bold truncate">{c.name}</span>
                    {c.subscriber_count && <span className="text-neutral-400 flex-shrink-0">{c.subscriber_count}</span>}
                  </a>
                  {!c.url && (
                    <span className="shrink-0 text-amber-500" title="URL 미등록">
                      ⚠️
                    </span>
                  )}
                  <button
                    onClick={() => openEdit(c)}
                    className="shrink-0 text-blue-500 font-black hover:underline px-1"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => deleteChannel(c.id)}
                    className="shrink-0 text-red-400 font-bold hover:text-red-600 px-1"
                    title="삭제"
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 워크플로우 페이지에서 바로 소재를 수집하는 패널. 1번에서 이미 등록된 채널들을 그대로 돌아가며
// 채널별 인기 영상을 가져와 조회수순으로 합쳐 보여준다 — 여기서 채널을 새로 찾거나 추가하지 않는다.
function MaterialPanel({ siteName }: { siteName: string }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [items, setItems] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [groups, setGroups] = useState<ChannelMaterialGroup[]>([]);
  const [addedVideoIds, setAddedVideoIds] = useState<Set<string>>(new Set());
  const [previewVideoId, setPreviewVideoId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Promise.all([
      fetch('/api/source-channels').then((r) => r.json()),
      fetch('/api/source-items').then((r) => r.json()),
    ])
      .then(([c, i]) => {
        setChannels(c.channels || []);
        setItems(i.items || []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const mineChannels = channels.filter((c) => (c.notes || '').match(CHANNEL_TAG_RE)?.[1] === siteName);
  const mineChannelIds = new Set(mineChannels.map((c) => c.id));
  const mineItems = items.filter((i) => i.channel_id && mineChannelIds.has(i.channel_id));
  const mineItemUrls = new Set(mineItems.map((i) => i.source_url).filter(Boolean));
  const mineItemByUrl = new Map(mineItems.map((i) => [i.source_url, i]));
  const channelById = new Map(channels.map((c) => [c.id, c]));

  async function fetchTopVideos() {
    if (mineChannels.length === 0) {
      setFetchError('1번에 등록된 채널이 없어요.');
      return;
    }
    setFetching(true);
    setFetchError('');
    try {
      // 채널별로 결과를 유지한다 — 하나로 합쳐서 정렬하면 조회수 낮은 채널이 안 보여서
      // "13개 채널 중 몇 개만 나온다"는 걸 알아챌 수 없기 때문에, 채널마다 섹션을 분리해서 보여준다.
      const perChannel: ChannelMaterialGroup[] = await Promise.all(
        mineChannels.map(async (c): Promise<ChannelMaterialGroup> => {
          if (!c.url) return { channelId: c.id, channelName: c.name, videos: [], error: 'URL 미등록' };
          try {
            const res = await fetch(`/api/channel-videos?channelUrl=${encodeURIComponent(c.url)}`);
            const data = await res.json();
            if (!res.ok) return { channelId: c.id, channelName: c.name, videos: [], error: data.error || '가져오기 실패' };
            return { channelId: c.id, channelName: c.name, videos: data.results || [] };
          } catch (err) {
            return { channelId: c.id, channelName: c.name, videos: [], error: err instanceof Error ? err.message : String(err) };
          }
        })
      );
      setGroups(perChannel);
      setExpanded(true);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  }

  async function registerMaterial(channelId: string, r: ChannelVideoResult) {
    setAddedVideoIds((prev) => new Set(prev).add(r.videoId));
    try {
      await fetch('/api/source-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: channelId,
          title: r.title,
          source_url: r.url,
          thumbnail_url: r.thumbnail,
          views: r.viewsLabel,
          duration_seconds: r.durationSeconds,
          content_type: 'TRIVIA',
          platform_fit: [],
          raw_notes: '',
        }),
      });
      load();
    } catch {
      setAddedVideoIds((prev) => {
        const next = new Set(prev);
        next.delete(r.videoId);
        return next;
      });
    }
  }

  async function deleteMaterial(id: string) {
    await fetch(`/api/source-items/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="border-t border-black/5 pt-3">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-black text-neutral-500 hover:text-black"
        >
          <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
          🎯 등록된 소재 ({loading ? '...' : mineItems.length})
        </button>
        <button
          onClick={fetchTopVideos}
          disabled={fetching}
          className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white hover:bg-neutral-800 disabled:opacity-40"
        >
          {fetching ? '가져오는 중...' : '📥 채널별 인기 영상 가져오기'}
        </button>
      </div>
      <p className="text-[10px] text-neutral-400 mb-2">
        1번에 등록된 채널 {mineChannels.length}개를 하나씩 돌면서 채널별 조회수 상위 영상을 가져와요.
      </p>

      {fetchError && <p className="text-[11px] text-red-500 font-bold mb-2">{fetchError}</p>}

      {groups.length > 0 && (
        <div className="space-y-3 max-h-[32rem] overflow-y-auto mb-2">
          {groups.map((g) => (
            <div key={g.channelId} className="border border-neutral-100 rounded-lg p-2">
              <div className="text-[11px] font-black text-neutral-500 mb-1.5 flex items-center justify-between">
                <span>{g.channelName}</span>
                {g.error ? (
                  <span className="text-red-400 font-bold">{g.error}</span>
                ) : (
                  <span className="text-neutral-300">영상 {g.videos.length}개</span>
                )}
              </div>
              {!g.error && g.videos.length === 0 && <p className="text-[11px] text-neutral-300 px-1">가져온 영상 없음</p>}
              <div className="space-y-1.5">
                {g.videos.map((r) => {
                  const already = mineItemUrls.has(r.url) || addedVideoIds.has(r.videoId);
                  const existingItem = mineItemByUrl.get(r.url);
                  return (
                    <div key={r.videoId} className="flex items-center gap-2 bg-white border border-neutral-100 rounded-lg p-2">
                      {r.thumbnail && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.thumbnail}
                          alt=""
                          onClick={() => setPreviewVideoId(r.videoId)}
                          className="w-14 h-14 object-cover rounded-lg shrink-0 bg-neutral-100 cursor-pointer"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <button onClick={() => setPreviewVideoId(r.videoId)} className="text-xs font-bold truncate block hover:underline text-left">
                          {r.title}
                        </button>
                        <div className="text-[11px] text-neutral-400 mt-0.5">조회수 {r.viewsLabel} · {r.durationLabel}</div>
                      </div>
                      <button
                        onClick={() => (existingItem ? deleteMaterial(existingItem.id) : registerMaterial(g.channelId, r))}
                        disabled={already && !existingItem}
                        className={`shrink-0 text-[11px] font-black px-3 py-1.5 rounded-lg ${
                          already
                            ? 'bg-neutral-100 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40'
                            : 'bg-black text-white'
                        }`}
                      >
                        {already ? (existingItem ? '✕ 등록취소' : '등록됨') : '소재등록'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {previewVideoId && <VideoPreviewModal videoId={previewVideoId} onClose={() => setPreviewVideoId(null)} />}

      {expanded && (
        <div className="space-y-1.5">
          {mineItems.length === 0 && <p className="text-[11px] text-neutral-300 px-1">등록된 소재 없음</p>}
          {mineItems.map((i) => {
            const ch = i.channel_id ? channelById.get(i.channel_id) : undefined;
            const videoId = extractVideoId(i.source_url);
            return (
              <div key={i.id} className="flex items-center gap-2 bg-white border border-neutral-100 rounded-lg px-3 py-2">
                {i.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={i.thumbnail_url}
                    alt=""
                    onClick={() => videoId && setPreviewVideoId(videoId)}
                    className={`w-10 h-10 object-cover rounded shrink-0 bg-neutral-100 ${videoId ? 'cursor-pointer' : ''}`}
                  />
                )}
                <div className="flex-1 min-w-0">
                  {videoId ? (
                    <button onClick={() => setPreviewVideoId(videoId)} className="text-[11px] font-bold truncate block hover:underline text-left">
                      {i.title || i.source_url}
                    </button>
                  ) : (
                    <span className="text-[11px] font-bold truncate block">{i.title || i.source_url}</span>
                  )}
                  {ch && (
                    <a href={ch.url || '#'} target="_blank" rel="noopener noreferrer" className="text-[11px] text-neutral-400 hover:underline">
                      {ch.name}
                    </a>
                  )}
                </div>
                <button
                  onClick={() => deleteMaterial(i.id)}
                  className="shrink-0 text-[11px] text-red-400 font-bold hover:text-red-600 px-1"
                  title="삭제"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function isMaterialStep(step: Step): boolean {
  // "5.소재 선정" 단계에도 "소재"가 들어있어서 bare하게 매칭하면 이 단계에도 잘못 걸린다
  // — 2번(채널별 소재 수집)만 매칭하도록 "수집"이 같이 나오는 경우로 좁힌다.
  return /소재.*수집|수집.*소재/.test(`${step.name} ${step.desc}`);
}

function isTranscriptStep(step: Step): boolean {
  // 단순히 "대본"만 매칭하면 4번(제목/썸네일/대본에서... 분석)·5번(대본 작성) 설명에 "대본"이
  // 스쳐지나가는 것까지 걸려버리므로, "대본...수집" 처럼 수집이 뒤에 나오는 경우만 매칭한다.
  return /대본.*수집|자막.*수집/.test(`${step.name} ${step.desc}`);
}

// 2번에서 등록된 소재들을 훑어보면서 대본(자막)을 붙여넣어 저장하는 패널.
// 대본 자동 수집은 이 웹앱만으로는 안 되고(U-Caption 크롬 확장 + Claude 필요) 수동 붙여넣기만 지원한다.
function TranscriptPanel({ siteName }: { siteName: string }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [items, setItems] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewVideoId, setPreviewVideoId] = useState<string | null>(null);
  const [fetchingIds, setFetchingIds] = useState<Set<string>>(new Set());
  const [fetchErrors, setFetchErrors] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [thumbFetchingIds, setThumbFetchingIds] = useState<Set<string>>(new Set());
  const [durationFetchingIds, setDurationFetchingIds] = useState<Set<string>>(new Set());
  const [commentFetchingIds, setCommentFetchingIds] = useState<Set<string>>(new Set());
  const [openThumbId, setOpenThumbId] = useState<string | null>(null);
  const [openCommentsId, setOpenCommentsId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // 소재 여러 개의 "자동 가져오기"/개별 버튼을 연달아 클릭하면 요청이 한꺼번에 몰려서
  // 유튜브 쪽 레이트리밋에 걸려 전부 실패하던 문제가 있었다 — 클릭한 순서대로 한 번에
  // 하나씩만 실제 요청이 나가도록 전역으로 줄을 세운다(앞 작업이 실패해도 큐는 안 끊긴다).
  const fetchQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  function runQueued<T>(fn: () => Promise<T>): Promise<T> {
    const run = fetchQueueRef.current.then(fn, fn);
    fetchQueueRef.current = run.catch(() => {});
    return run;
  }

  function load() {
    setLoading(true);
    Promise.all([
      fetch('/api/source-channels').then((r) => r.json()),
      fetch('/api/source-items').then((r) => r.json()),
    ])
      .then(([c, i]) => {
        setChannels(c.channels || []);
        setItems(i.items || []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const mineChannelIds = new Set(channels.filter((c) => (c.notes || '').match(CHANNEL_TAG_RE)?.[1] === siteName).map((c) => c.id));
  const mineItems = items.filter((i) => i.channel_id && mineChannelIds.has(i.channel_id));
  const withTranscript = mineItems.filter((i) => i.transcript && i.transcript.trim());
  const channelById = new Map(channels.map((c) => [c.id, c]));

  function toggleOpen(item: SourceItem) {
    if (openItemId === item.id) {
      setOpenItemId(null);
      return;
    }
    setOpenItemId(item.id);
    setDraft(item.transcript || '');
  }

  async function saveTranscript(id: string) {
    setSaving(true);
    try {
      await fetch(`/api/source-items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: draft }),
      });
      load();
    } finally {
      setSaving(false);
    }
  }

  // 서버 직접 수집(/api/transcript-fallback, 보통 몇 초면 끝남)을 먼저 시도하고, 그게 실패했을
  // 때만 U-Caption 큐(크롬 확장, 실패하면 탭까지 열어서 긁는 느린 경로라 최대 1분 반 걸릴 수
  // 있음)로 넘어간다 — 둘을 동시에 돌리면 같은 유튜브 엔드포인트에 요청이 겹쳐서 레이트리밋에
  // 더 쉽게 걸리므로, 항상 한 번에 하나씩만 순서대로 시도한다.
  async function fetchTranscript(item: SourceItem) {
    if (!item.source_url) return;
    setFetchingIds((prev) => new Set(prev).add(item.id));
    setFetchErrors((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    try {
      let transcript: string | null = null;
      try {
        transcript = await fetchViaFallback(item.source_url);
      } catch {
        // 서버 직접 수집 실패 — 아래 U-Caption 큐로 넘어간다(동시에 안 돌리고 순서대로).
      }
      if (transcript === null) {
        transcript = await fetchViaUCaptionQueue(item.source_url);
      }
      // 가져오자마자 바로 저장한다 — 저장을 안 하고 draft 입력칸에만 채워두면(예전 방식),
      // 여러 소재를 연달아 자동 가져오기 할 때 draft가 패널 전체에서 하나만 있다 보니 다음
      // 소재를 처리하는 순간 방금 가져온 대본이 저장도 안 된 채 덮어써져 사라지는 문제가 있었다.
      await fetch(`/api/source-items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      setOpenItemId(item.id);
      setDraft(transcript);
      load();
    } catch {
      setFetchErrors((prev) => ({
        ...prev,
        [item.id]: 'U-Caption 크롬 확장도, 서버 자동 수집도 실패했어요 — 직접 붙여넣어주세요.',
      }));
    } finally {
      setFetchingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  // 서버가 직접 유튜브 자막을 긁어오는 방식(크롬 확장 불필요, 보통 몇 초 안에 끝남).
  async function fetchViaFallback(sourceUrl: string): Promise<string> {
    const fbRes = await fetch('/api/transcript-fallback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: sourceUrl }),
    });
    const fb = await fbRes.json();
    if (fbRes.ok && fb.transcript) return fb.transcript;
    // 왜 서버 직접 수집이 실패해서 (느린) U-Caption 큐로 넘어가는지 진단하기 위한 로그 —
    // 사용자에게는 안 보이고(그대로 조용히 다음 방법으로 넘어감) 브라우저 콘솔에만 남는다.
    console.warn('[transcript-fallback] failed, falling back to U-Caption:', fb.reason || fb.error);
    throw new Error(fb.error || '서버 자동 수집 실패');
  }

  // U-Caption 큐에 작업을 등록하고, 이 PC의 크롬 확장(로컬 워커, 최대 1분 주기)이 처리할
  // 때까지 몇 초 간격으로 상태를 확인한다. 확장이 없거나 꺼져있으면 계속 'queued'로 남아있다가
  // 최대 1분 30초 뒤 타임아웃으로 실패한다.
  async function fetchViaUCaptionQueue(sourceUrl: string): Promise<string> {
    const res = await fetch('/api/transcript-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: sourceUrl }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '작업 등록 실패');
    const jobId = data.jobId;

    for (let attempt = 0; attempt < 18; attempt++) {
      await new Promise((r) => setTimeout(r, 5000));
      const jobRes = await fetch(`/api/transcript-jobs/${jobId}`);
      const job = await jobRes.json();
      if (!jobRes.ok) throw new Error(job.error || '작업 조회 실패');
      if (job.status === 'done') return job.transcript || '';
      if (job.status === 'error') throw new Error(job.error || '자막을 가져오지 못했어요.');
    }
    throw new Error('1분 30초 안에 끝나지 않았어요.');
  }

  // "🎬 자동 가져오기" 버튼 하나로 대본·썸네일·길이·댓글을 순서대로 하나씩 시도한다(동시에 안
  // 돌림 — 여러 요청이 겹치면 레이트리밋에 더 쉽게 걸림). 이미 있는 값은 다시 안 건드리고,
  // 어느 하나가 실패해도 다음 항목으로 계속 진행되며, 실패한 항목만 개별 버튼이 그대로 남아서
  // 다시 시도할 수 있다.
  async function autoFetch(item: SourceItem) {
    await fetchTranscript(item);
    if (!item.thumbnail_url) {
      try {
        await fetchThumbnail(item);
      } catch {
        // 실패해도 다음 항목 계속 진행 — 개별 버튼이 그대로 남음
      }
    }
    if (!item.duration_seconds) {
      try {
        await fetchDuration(item);
      } catch {
        // 위와 동일
      }
    }
    if (!item.comment_count) {
      try {
        await fetchComments(item);
      } catch {
        // 위와 동일
      }
    }
  }

  async function copyLink(item: SourceItem) {
    if (!item.source_url) return;
    try {
      await navigator.clipboard.writeText(item.source_url);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((cur) => (cur === item.id ? null : cur)), 1500);
    } catch {
      // 클립보드 권한이 없는 브라우저 환경이면 조용히 무시
    }
  }

  async function fetchThumbnail(item: SourceItem) {
    if (!item.source_url) return;
    setThumbFetchingIds((prev) => new Set(prev).add(item.id));
    try {
      const res = await fetch(`/api/fetch-thumbnail?url=${encodeURIComponent(item.source_url)}`);
      const data = await res.json();
      if (res.ok && data.image) {
        await fetch(`/api/source-items/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ thumbnail_url: data.image }),
        });
        setFetchErrors((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        load();
      } else {
        setFetchErrors((prev) => ({ ...prev, [item.id]: data.error || '썸네일을 못 가져왔어요.' }));
      }
    } finally {
      setThumbFetchingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function fetchDuration(item: SourceItem) {
    if (!item.source_url) return;
    setDurationFetchingIds((prev) => new Set(prev).add(item.id));
    try {
      const res = await fetch(`/api/fetch-duration?url=${encodeURIComponent(item.source_url)}`);
      const data = await res.json();
      if (res.ok && data.seconds) {
        await fetch(`/api/source-items/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ duration_seconds: data.seconds }),
        });
        setFetchErrors((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        load();
      } else {
        setFetchErrors((prev) => ({ ...prev, [item.id]: data.error || '영상 길이를 못 가져왔어요.' }));
      }
    } finally {
      setDurationFetchingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function fetchComments(item: SourceItem) {
    if (!item.source_url) return;
    setCommentFetchingIds((prev) => new Set(prev).add(item.id));
    try {
      const res = await fetch(`/api/fetch-comments?url=${encodeURIComponent(item.source_url)}`);
      const data = await res.json();
      if (res.ok) {
        await fetch(`/api/source-items/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment_count: data.commentCount, top_comments: data.topComments }),
        });
        setFetchErrors((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        load();
      } else {
        setFetchErrors((prev) => ({ ...prev, [item.id]: data.error || '댓글을 못 가져왔어요.' }));
      }
    } finally {
      setCommentFetchingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function deleteItem(id: string) {
    await fetch(`/api/source-items/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="border-t border-black/5 pt-3">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-black text-neutral-500 hover:text-black mb-2"
      >
        <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        📜 대본(자막)·댓글·썸네일·시간 수집 ({loading ? '...' : `${withTranscript.length}/${mineItems.length}`})
      </button>
      <p className="text-[10px] text-neutral-400 mb-2">
        2번에서 등록한 소재들이에요. "🎬 자동 가져오기"는 서버가 직접 자막을 가져오는 걸 먼저 시도하고,
        실패하면 이 PC의 U-Caption 크롬 확장으로 자동 전환돼요(확장이 없거나 꺼져있으면 최대 1분 반 정도 걸리다 실패, 자막 자체가 없는 영상도 실패). 그래도 안 되면 직접 붙여넣어도 돼요.
        댓글 수/상위 댓글도 같이 가져와요("💬 댓글" 배지 클릭하면 목록이 펼쳐져요).
        레이트리밋을 피하려고 여러 개를 눌러도 한 번에 하나씩, 한 소재 안에서도 대본→썸네일→길이→댓글 순서로 하나씩만 처리해요 — 여러 개를 클릭해두면 순서대로 처리되니 기다려주세요.
      </p>

      {expanded && (
        <div className="space-y-1.5 max-h-[36rem] overflow-y-auto">
          {mineItems.length === 0 && <p className="text-[11px] text-neutral-300 px-1">2번에서 먼저 소재를 등록해주세요.</p>}
          {mineItems.map((i) => {
            const videoId = extractVideoId(i.source_url);
            const has = !!(i.transcript && i.transcript.trim());
            const ch = i.channel_id ? channelById.get(i.channel_id) : undefined;
            return (
              <div key={i.id} className="bg-white border border-neutral-100 rounded-lg p-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <button onClick={() => (videoId ? setPreviewVideoId(videoId) : undefined)} className="text-[11px] font-bold truncate block text-left hover:underline">
                      {i.title || i.source_url}
                    </button>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {ch && (
                        <a href={ch.url || '#'} target="_blank" rel="noopener noreferrer" className="text-[11px] text-neutral-400 hover:underline">
                          {ch.name}
                        </a>
                      )}
                      {i.views && <span className="text-[11px] text-neutral-400">· 조회수 {i.views}</span>}
                    </div>
                  </div>
                  <button onClick={() => deleteItem(i.id)} className="shrink-0 text-[11px] text-red-400 font-bold hover:text-red-600 px-1" title="삭제">
                    ✕
                  </button>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mt-2">
                  <button
                    onClick={() => copyLink(i)}
                    title="링크 복사"
                    className="shrink-0 text-[11px] font-bold px-2.5 py-1.5 rounded-full border bg-white text-neutral-500 border-neutral-200 hover:border-neutral-300"
                  >
                    {copiedId === i.id ? '복사됨' : '🔗'}
                  </button>
                  <button
                    onClick={() => runQueued(() => autoFetch(i))}
                    disabled={fetchingIds.has(i.id)}
                    className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full border bg-white text-neutral-500 border-neutral-200 hover:border-neutral-300 disabled:opacity-40"
                  >
                    {fetchingIds.has(i.id) ? '가져오는 중...' : '🎬 자동 가져오기'}
                  </button>
                  <button
                    onClick={() => (i.thumbnail_url ? setOpenThumbId((cur) => (cur === i.id ? null : i.id)) : runQueued(() => fetchThumbnail(i)))}
                    disabled={thumbFetchingIds.has(i.id)}
                    className={`shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full border disabled:opacity-40 ${
                      i.thumbnail_url ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-white text-neutral-400 border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    {thumbFetchingIds.has(i.id) ? '가져오는 중...' : i.thumbnail_url ? '🖼 썸네일 있음' : '🖼 썸네일 없음'}
                  </button>
                  {i.duration_seconds ? (
                    <span className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full border bg-neutral-50 text-neutral-500 border-neutral-200">
                      ⏱ {fmtDuration(i.duration_seconds)}
                    </span>
                  ) : (
                    <button
                      onClick={() => runQueued(() => fetchDuration(i))}
                      disabled={durationFetchingIds.has(i.id)}
                      className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full border bg-white text-neutral-400 border-neutral-200 hover:border-neutral-300 disabled:opacity-40"
                    >
                      {durationFetchingIds.has(i.id) ? '가져오는 중...' : '⏱ 길이 가져오기'}
                    </button>
                  )}
                  <button
                    onClick={() => toggleOpen(i)}
                    className={`shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full border ${
                      has ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-white text-neutral-400 border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    📜 대본 {has ? `있음 (${i.transcript!.length.toLocaleString()}자)` : '없음'}
                  </button>
                  {i.comment_count ? (
                    <button
                      onClick={() => setOpenCommentsId((cur) => (cur === i.id ? null : i.id))}
                      className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full border bg-emerald-50 text-emerald-600 border-emerald-200"
                    >
                      💬 댓글 {i.comment_count.toLocaleString()}개
                    </button>
                  ) : (
                    <button
                      onClick={() => runQueued(() => fetchComments(i))}
                      disabled={commentFetchingIds.has(i.id)}
                      className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full border bg-white text-neutral-400 border-neutral-200 hover:border-neutral-300 disabled:opacity-40"
                    >
                      {commentFetchingIds.has(i.id) ? '가져오는 중...' : '💬 댓글 가져오기'}
                    </button>
                  )}
                </div>
                {fetchErrors[i.id] && <p className="text-[10px] text-red-500 font-bold mt-1.5">{fetchErrors[i.id]}</p>}
                {openCommentsId === i.id && (
                  <div className="mt-2 pt-2 border-t border-neutral-100 space-y-1.5 max-h-56 overflow-y-auto">
                    {(i.top_comments || []).length === 0 ? (
                      <p className="text-[11px] text-neutral-300">댓글 목록을 못 가져왔어요(댓글 사용 중지된 영상일 수 있어요) — 댓글 수만 확인됩니다.</p>
                    ) : (
                      i.top_comments!.map((c, idx) => (
                        <div key={idx} className="text-[11px] bg-neutral-50 rounded-lg px-2.5 py-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-neutral-500 truncate">{c.author}</span>
                            {c.likeCount > 0 && <span className="shrink-0 text-neutral-300">👍 {c.likeCount.toLocaleString()}</span>}
                          </div>
                          <p className="text-neutral-600 whitespace-pre-wrap mt-0.5">{c.text}</p>
                        </div>
                      ))
                    )}
                  </div>
                )}
                {openThumbId === i.id && i.thumbnail_url && (
                  <div className="mt-2 pt-2 border-t border-neutral-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={i.thumbnail_url}
                      alt=""
                      onClick={() => setPreviewImage(i.thumbnail_url)}
                      className="max-w-[200px] rounded-lg cursor-pointer hover:opacity-90"
                    />
                  </div>
                )}
                {openItemId === i.id && (
                  <div className="mt-2 pt-2 border-t border-neutral-100">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={5}
                      placeholder="이 영상의 대본/자막 전문을 붙여넣으세요 (U-Caption으로 뽑은 자막 등)"
                      className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono leading-relaxed"
                    />
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[10px] text-neutral-300">{draft.length.toLocaleString()}자</span>
                      <button
                        onClick={() => saveTranscript(i.id)}
                        disabled={saving}
                        className="bg-black text-white text-[11px] font-black px-4 py-2 rounded-lg disabled:opacity-40"
                      >
                        {saving ? '저장 중...' : '대본 저장'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {previewVideoId && <VideoPreviewModal videoId={previewVideoId} onClose={() => setPreviewVideoId(null)} />}
      {previewImage && <ImagePreviewModal src={previewImage} onClose={() => setPreviewImage(null)} />}
    </div>
  );
}

function isAnalysisStep(step: Step): boolean {
  // desc까지 같이 보면 5번("4번 분석 기반...")의 desc에 "분석"이 스쳐지나가는 것까지 걸리므로 name만 본다.
  return /분석/.test(step.name);
}

function isScriptStep(step: Step): boolean {
  return /대본\s*작성/.test(step.name);
}

// "7.자료조사" 단계 — exact match로 좁혀서 다른 단계 이름에 실수로 안 걸리게 한다.
function isResearchStep(step: Step): boolean {
  return step.name.trim() === '자료조사';
}

// "6.콘텐츠 등록" 단계 — exact match.
function isContentRegisterStep(step: Step): boolean {
  return step.name.trim() === '콘텐츠 등록';
}

// "8.전략/컨셉 확정" 단계 — 이름 뒤에 "(신규)" 같은 부가 표기가 붙을 수 있어서 exact match 대신
// "전략"과 "컨셉"이 둘 다 들어있는지로 느슨하게 판별한다.
function isStrategyStep(step: Step): boolean {
  return /전략/.test(step.name) && /컨셉/.test(step.name);
}

// "9.훅/인트로 설계" 단계 — 위와 같은 이유로 "훅"과 "인트로"가 둘 다 들어있는지로 판별한다.
function isHookStep(step: Step): boolean {
  return /훅/.test(step.name) && /인트로/.test(step.name);
}

// "5.소재 선정" 단계 — 소재/제목/대본 위저드(Step5Panel)의 1단계(소재 목록)가 여기 속한다.
// exact match로 좁혀서 "소재 선정" 외의 다른 단계 이름에 실수로 걸리지 않게 한다.
function isMaterialSelectionStep(step: Step): boolean {
  return step.name.trim() === '소재 선정';
}

function isImageVideoStep(step: Step): boolean {
  return /이미지/.test(step.name) && /영상/.test(step.name);
}

function isNarrationStep(step: Step): boolean {
  return /나레이션|TTS/i.test(step.name);
}

// 3번("대본(자막) 수집")에도 "자막"이 들어있어서 이름 전체가 정확히 "자막"일 때만 매칭한다.
function isSubtitleStep(step: Step): boolean {
  return step.name.trim() === '자막';
}

const ANALYSIS_TABS = [
  { key: 'channel', label: '채널' },
  { key: 'title', label: '제목' },
  { key: 'thumbnail', label: '썸네일' },
  { key: 'script', label: '대본' },
  { key: 'comment', label: '댓글' },
  { key: 'duration', label: '시간' },
  { key: 'pace', label: '속도' },
] as const;
type AnalysisTabKey = (typeof ANALYSIS_TABS)[number]['key'];

// 분석 결과(특히 썸네일 탭)에 이미지 URL을 그냥 글자로 적어두면 실제로 어떻게 생겼는지 확인이
// 안 된다는 피드백 — URL을 텍스트째로 두지 않고 실제 썸네일 이미지로 렌더링해서 보여준다.
const IMAGE_URL_RE = /https?:\/\/\S+\.(?:jpg|jpeg|png|webp|gif)(?:\?\S*)?/gi;
function TextWithInlineImages({ text }: { text: string }) {
  const parts = text.split(IMAGE_URL_RE);
  const urls = text.match(IMAGE_URL_RE) || [];
  return (
    <div className="text-xs text-neutral-600 leading-relaxed">
      {parts.map((part, i) => (
        <span key={i}>
          <span className="whitespace-pre-wrap">{part}</span>
          {urls[i] && (
            <a href={urls[i]} target="_blank" rel="noopener noreferrer" className="inline-block align-middle mx-1 my-1">
              <img
                src={urls[i]}
                alt="썸네일 예시"
                className="inline-block h-24 w-auto rounded-lg border border-neutral-200 align-middle hover:border-blue-400"
              />
            </a>
          )}
        </span>
      ))}
    </div>
  );
}

// 2·3번에서 모은 소재를 웹앱이 유료 API로 직접 분석하지 않는다 — Claude(구독)나 Gemini한테
// 채팅으로 "OO 파이프라인 패턴 분석해줘"라고 요청하면, save_pipeline_analysis MCP 툴로
// 여기(hub_sites.analysis_result)에 저장되고, 이 패널은 그 저장된 결과를 읽어서 탭으로 보여주기만 한다.
function AnalysisPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const [tab, setTab] = useState<AnalysisTabKey>('title');
  const [checked, setChecked] = useState<Record<AnalysisTabKey, boolean>>({
    channel: false,
    title: false,
    thumbnail: false,
    script: false,
    comment: false,
    duration: false,
    pace: false,
  });
  const [analyzing, setAnalyzing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const result = site.analysis_result;
  const selectedCategories = ANALYSIS_TABS.filter((t) => checked[t.key]).map((t) => t.key);

  function toggle(key: AnalysisTabKey) {
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function analyzeWithGemini() {
    if (selectedCategories.length === 0) return setError('분석할 항목을 체크해주세요.');
    setAnalyzing(true);
    setError('');
    try {
      const res = await fetch('/api/analyze-materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, categories: selectedCategories }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '분석 실패');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  }

  // 유료 API 없이 구독(Gemini 웹앱, 또는 이 대화의 Claude)으로 분석하고 싶을 때 쓰는 버튼.
  // 구독 채팅은 외부에서 자동으로 트리거할 방법이 없어서, 소재 데이터를 프롬프트로 만들어
  // 클립보드에 복사해주는 것까지만 하고 — 붙여넣기/실행은 사용자가 직접 한다.
  async function copyPromptForSubscription() {
    if (selectedCategories.length === 0) return setError('분석할 항목을 체크해주세요.');
    setCopying(true);
    setError('');
    try {
      const res = await fetch(`/api/analysis-prompt?siteId=${site.id}&categories=${selectedCategories.join(',')}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '프롬프트 생성 실패');
      await navigator.clipboard.writeText(data.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="border-t border-black/5 pt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-black text-neutral-500">
          🔍 패턴 분석{result?.updated_at && ` — ${new Date(result.updated_at).toLocaleString('ko-KR')} 기준`}
        </span>
        <button onClick={onRefresh} className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white">
          🔄 새로고침
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-3 bg-neutral-50 border border-neutral-100 rounded-lg p-3">
        {ANALYSIS_TABS.map((t) => (
          <label key={t.key} className="flex items-center gap-1.5 text-xs font-bold text-neutral-600 cursor-pointer">
            <input type="checkbox" checked={checked[t.key]} onChange={() => toggle(t.key)} className="w-3.5 h-3.5" />
            {t.label}
          </label>
        ))}
      </div>

      <div className="flex gap-1.5 mb-3">
        <button
          onClick={copyPromptForSubscription}
          disabled={copying}
          className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
        >
          {copying ? '준비 중...' : copied ? '✅ 복사됨!' : '💬 체크한 항목 Gemini·Claude 구독으로 분석하기'}
        </button>
        <button
          onClick={analyzeWithGemini}
          disabled={analyzing}
          className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white hover:bg-neutral-800 disabled:opacity-40"
        >
          {analyzing ? '분석 중... (1분 정도)' : '✨ 체크한 항목 Gemini Pro로 분석하기'}
        </button>
      </div>
      <p className="text-[10px] text-neutral-400 mb-3">
        먼저 분석할 항목을 체크하세요. "✨ Gemini Pro"는 Gemini API(유료, gemini-3.1-pro-preview)를 직접
        호출해서 체크한 것만 바로 분석·저장해요. "💬 Gemini·Claude 구독으로 분석하기"는 API 없이, 체크한
        항목만 프롬프트로 만들어 클립보드에 복사해줘요(비용 없음) — Gemini 웹앱이든 Claude(claude.ai나 이
        대화)든 아무 구독 채팅에나 붙여넣어서 물어보시고, 답변을 다시 붙여넣어주시면 저장해드릴게요. HongHub이
        Vercel에서 돌아가서 두 구독 계정을 여기서 자동으로 대신 불러내는 건 안 되고(로컬 PC에 로그인된 CLI가
        필요), 지금은 이 복사-붙여넣기 방식이 유일한 무료 경로예요.
      </p>
      {error && <p className="text-[11px] text-red-500 font-bold mb-3">{error}</p>}

      <div className="flex gap-1.5 mb-3 border-b border-neutral-100">
        {ANALYSIS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-[11px] font-black px-3 py-2 border-b-2 -mb-px ${
              tab === t.key ? 'border-black text-black' : 'border-transparent text-neutral-400 hover:text-black'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {result?.[tab] ? (
        <TextWithInlineImages text={result[tab] as string} />
      ) : (
        <p className="text-xs text-neutral-300">
          아직 &quot;{ANALYSIS_TABS.find((t) => t.key === tab)?.label}&quot; 분석 결과가 없어요 — 위에서 체크하고 분석을 실행해보세요.
        </p>
      )}
    </div>
  );
}

// 6번(콘텐츠 등록) 단계 전용 패널 — 유닛의 제목/소재만 등록·수정·삭제한다.
// 대본은 8번(Step5Panel), 자료조사는 7번(ResearchPanel)의 몫이라 여기서는 건드리지 않는다.
function ContentRegisterPanel({
  site,
  onRefresh,
  onGoToMaterialSelection,
}: {
  site: Site;
  onRefresh: () => void;
  // "5번 소재 선정"으로 되돌아가서 소재를 체크하는 흐름으로 콘텐츠를 만들고 싶을 때 쓰는 이동 버튼.
  onGoToMaterialSelection?: () => void;
}) {
  const draft = site.script_draft || {};
  const units = draft.units || [];
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newMaterial, setNewMaterial] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editMaterial, setEditMaterial] = useState('');
  const [savingEditId, setSavingEditId] = useState<string | null>(null);

  async function addUnit(title: string, material: string) {
    if (!title.trim()) return;
    setAdding(true);
    try {
      const unit: ContentUnit = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        material: material.trim() || title.trim(),
        title: title.trim(),
        script: '',
        category: draft.category || 'trivia',
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, units: [...units, unit] }),
      });
      setNewTitle('');
      setNewMaterial('');
      setShowNewForm(false);
      onRefresh();
    } finally {
      setAdding(false);
    }
  }

  async function saveEdit(id: string) {
    setSavingEditId(id);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: site.id,
          units: units.map((u) => (u.id === id ? { ...u, title: editTitle.trim() || u.title, material: editMaterial.trim() || u.material } : u)),
        }),
      });
      setEditingId(null);
      onRefresh();
    } finally {
      setSavingEditId(null);
    }
  }

  async function deleteUnit(id: string) {
    if (!confirm('이 콘텐츠를 삭제할까요? (대본·자료조사 내용도 같이 지워져요)')) return;
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, units: units.filter((u) => u.id !== id) }),
    });
    onRefresh();
  }

  return (
    <div className="space-y-1.5">
      {showNewForm ? (
        <div className="bg-white border border-neutral-200 rounded-lg p-3 mb-1 space-y-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="콘텐츠 제목 *"
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs"
          />
          <input
            value={newMaterial}
            onChange={(e) => setNewMaterial(e.target.value)}
            placeholder="소재 설명 (비우면 제목과 동일하게 저장)"
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs"
          />
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setShowNewForm(false)} className="text-[11px] font-bold text-neutral-400 hover:text-black px-2">
              취소
            </button>
            <button
              onClick={() => addUnit(newTitle, newMaterial)}
              disabled={adding || !newTitle.trim()}
              className="text-[11px] font-black px-4 py-2 rounded-lg bg-black text-white disabled:opacity-40"
            >
              {adding ? '등록 중...' : '등록'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-1.5 mb-1">
          <button
            onClick={() => setShowNewForm(true)}
            className="flex-1 text-[11px] font-black px-3 py-2 rounded-lg border border-dashed border-neutral-300 text-neutral-500 hover:border-neutral-400 hover:text-black"
          >
            + 새 콘텐츠 등록
          </button>
          {onGoToMaterialSelection && (
            <button
              onClick={onGoToMaterialSelection}
              className="shrink-0 text-[11px] font-bold px-3 py-2 rounded-lg border border-neutral-200 text-neutral-500 hover:border-neutral-400 hover:text-black bg-white"
            >
              🔙 5번에서 소재 고르기
            </button>
          )}
        </div>
      )}
      {units.length === 0 && <p className="text-xs text-neutral-300">아직 등록된 콘텐츠가 없어요 — 5번에서 소재를 체크하면 여기로 자동 이동돼요.</p>}
      {units.map((u) => (
        <div key={u.id} className="bg-white border border-neutral-100 rounded-lg px-3 py-2">
          {editingId === u.id ? (
            <div className="space-y-1.5">
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px]"
                placeholder="제목"
              />
              <input
                value={editMaterial}
                onChange={(e) => setEditMaterial(e.target.value)}
                className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px]"
                placeholder="소재"
              />
              <div className="flex justify-end gap-1.5">
                <button onClick={() => setEditingId(null)} className="text-[10px] font-bold text-neutral-400 hover:text-black">
                  취소
                </button>
                <button
                  onClick={() => saveEdit(u.id)}
                  disabled={savingEditId === u.id}
                  className="text-[10px] font-black text-emerald-600 hover:underline"
                >
                  저장
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold truncate">{u.title}</p>
                <p className="text-[10px] text-neutral-400 truncate">{u.material}</p>
              </div>
              <button
                onClick={() => {
                  setEditingId(u.id);
                  setEditTitle(u.title);
                  setEditMaterial(u.material);
                }}
                className="shrink-0 text-[10px] font-bold text-blue-600 hover:underline"
              >
                수정
              </button>
              <button onClick={() => deleteUnit(u.id)} className="shrink-0 text-[10px] font-black text-neutral-300 hover:text-red-500" title="삭제">
                ✕
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// 7번(자료조사) 단계 전용 패널 — 8번(대본 작성) 패널(Step5Panel)과는 완전히 별개 컴포넌트다.
// 소재 추천/제목 추천/대본 작성 위저드는 전혀 안 보여주고, 6번에서 등록된 콘텐츠 목록만 나열해서
// 콘텐츠별로 자료조사 메모(factCheck)와 출처(sources)만 수동으로 등록·수정·삭제하게 한다.
function ResearchPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const draft = site.script_draft || {};
  const units = draft.units || [];
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [factCheckDraft, setFactCheckDraft] = useState('');
  const [newSourceText, setNewSourceText] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // 7번에서 바로 콘텐츠를 새로 등록(6번을 거치지 않고) — 대본 없이 제목/소재만으로 먼저 등록해두고
  // 자료조사부터 시작할 수 있게 하는 용도.
  const [showNewUnitForm, setShowNewUnitForm] = useState(false);
  const [newUnitTitle, setNewUnitTitle] = useState('');
  const [newUnitMaterial, setNewUnitMaterial] = useState('');
  const [addingUnit, setAddingUnit] = useState(false);
  // "수정"으로 통째로 고치는 것 말고, 사실 하나 + 출처 하나를 바로 추가하는 용도.
  const [newFindingFact, setNewFindingFact] = useState<Record<string, string>>({});
  const [newFindingSource, setNewFindingSource] = useState<Record<string, string>>({});

  async function addUnit(title: string, material: string) {
    if (!title.trim()) return;
    setAddingUnit(true);
    try {
      const unit: ContentUnit = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        material: material.trim() || title.trim(),
        title: title.trim(),
        script: '',
        category: draft.category || 'trivia',
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, units: [...units, unit] }),
      });
      setNewUnitTitle('');
      setNewUnitMaterial('');
      setShowNewUnitForm(false);
      onRefresh();
    } finally {
      setAddingUnit(false);
    }
  }

  // 사실 하나 + 출처 하나를 한 번에 추가 — factCheck에는 줄 하나로 붙고, sources에도 그 URL이 같이 들어간다.
  async function addFinding(id: string, fact: string, sourceUrl: string) {
    if (!fact.trim()) return;
    const unit = units.find((u) => u.id === id);
    if (!unit) return;
    const line = sourceUrl.trim() ? `- ${fact.trim()}\n  출처: ${sourceUrl.trim()}` : `- ${fact.trim()}`;
    const nextFactCheck = unit.factCheck ? `${unit.factCheck}\n\n${line}` : line;
    const nextSources =
      sourceUrl.trim() && !(unit.sources || []).includes(sourceUrl.trim()) ? [...(unit.sources || []), sourceUrl.trim()] : unit.sources || [];
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === id ? { ...u, factCheck: nextFactCheck, sources: nextSources } : u)) }),
    });
    onRefresh();
  }

  async function saveFactCheck(id: string, factCheck: string) {
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === id ? { ...u, factCheck } : u)) }),
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function addSource(id: string, url: string) {
    if (!url.trim()) return;
    const unit = units.find((u) => u.id === id);
    const nextSources = [...(unit?.sources || []), url.trim()];
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === id ? { ...u, sources: nextSources } : u)) }),
    });
    onRefresh();
  }

  async function deleteSource(id: string, idx: number) {
    const unit = units.find((u) => u.id === id);
    const nextSources = (unit?.sources || []).filter((_, i) => i !== idx);
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === id ? { ...u, sources: nextSources } : u)) }),
    });
    onRefresh();
  }

  return (
    <div className="space-y-1.5">
      {showNewUnitForm ? (
        <div className="bg-white border border-neutral-200 rounded-lg p-3 mb-1 space-y-2">
          <input
            value={newUnitTitle}
            onChange={(e) => setNewUnitTitle(e.target.value)}
            placeholder="콘텐츠 제목 *"
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs"
          />
          <input
            value={newUnitMaterial}
            onChange={(e) => setNewUnitMaterial(e.target.value)}
            placeholder="소재 설명 (비우면 제목과 동일하게 저장)"
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs"
          />
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setShowNewUnitForm(false)} className="text-[11px] font-bold text-neutral-400 hover:text-black px-2">
              취소
            </button>
            <button
              onClick={() => addUnit(newUnitTitle, newUnitMaterial)}
              disabled={addingUnit || !newUnitTitle.trim()}
              className="text-[11px] font-black px-4 py-2 rounded-lg bg-black text-white disabled:opacity-40"
            >
              {addingUnit ? '등록 중...' : '등록'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowNewUnitForm(true)}
          className="w-full text-[11px] font-black px-3 py-2 rounded-lg border border-dashed border-neutral-300 text-neutral-500 hover:border-neutral-400 hover:text-black mb-1"
        >
          + 새 콘텐츠 등록 (대본 없이 제목만 먼저 등록하고 자료조사부터 시작)
        </button>
      )}
      {units.length === 0 && <p className="text-xs text-neutral-300">아직 등록된 콘텐츠가 없어요 — 위에서 새로 등록하거나, 5·6번에서 소재를 확정하세요.</p>}
      {units.map((u) => (
        <div key={u.id} className="bg-white border border-neutral-100 rounded-lg overflow-hidden">
          <button
            onClick={() => {
              setOpenId((cur) => (cur === u.id ? null : u.id));
              setEditingId(null);
            }}
            className="w-full text-left px-3 py-2 flex items-center gap-2"
          >
            <span className={`shrink-0 text-neutral-300 transition-transform ${openId === u.id ? 'rotate-90' : ''}`}>▶</span>
            <span className="flex-1 min-w-0 text-[11px] font-bold truncate">{u.title}</span>
            {u.factCheck ? (
              <span className="shrink-0 text-[10px] font-bold text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5">✅ 조사됨</span>
            ) : (
              <span className="shrink-0 text-[10px] font-bold text-neutral-400 bg-neutral-100 rounded-full px-2 py-0.5">미조사</span>
            )}
          </button>
          {openId === u.id && (
            <div className="px-3 pb-3 pt-1 border-t border-neutral-100 space-y-2">
              <p className="text-[10px] text-neutral-400">소재: {u.material}</p>
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-[10px] font-black text-neutral-400">자료조사 메모 — 사실은 반드시 출처와 함께 기록</p>
                  {editingId !== u.id && (
                    <button
                      onClick={() => {
                        setEditingId(u.id);
                        setFactCheckDraft(u.factCheck || '');
                      }}
                      className="shrink-0 text-[10px] font-bold text-blue-600 hover:underline"
                    >
                      수정
                    </button>
                  )}
                </div>
                {editingId === u.id ? (
                  <div className="space-y-1">
                    <textarea
                      value={factCheckDraft}
                      onChange={(e) => setFactCheckDraft(e.target.value)}
                      rows={5}
                      placeholder="① 사실 — 출처: URL 형식으로, 사실마다 출처를 짝지어 적으세요"
                      className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px] leading-relaxed"
                    />
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => setEditingId(null)} className="text-[10px] font-bold text-neutral-400 hover:text-black">
                        취소
                      </button>
                      <button
                        onClick={async () => {
                          await saveFactCheck(u.id, factCheckDraft);
                          setEditingId(null);
                        }}
                        disabled={saving}
                        className="text-[10px] font-black text-emerald-600 hover:underline"
                      >
                        저장
                      </button>
                    </div>
                  </div>
                ) : u.factCheck ? (
                  <p className="text-[11px] text-neutral-500 whitespace-pre-wrap leading-relaxed">{u.factCheck}</p>
                ) : (
                  <p className="text-[11px] text-neutral-300">아직 자료조사 메모가 없어요 — &quot;수정&quot;을 눌러서 추가하세요.</p>
                )}
              </div>
              <div className="bg-neutral-50 border border-neutral-100 rounded-lg p-2 space-y-1.5">
                <p className="text-[10px] font-black text-neutral-400">+ 자료조사 추가 (사실 하나 + 출처 하나씩)</p>
                <textarea
                  value={newFindingFact[u.id] || ''}
                  onChange={(e) => setNewFindingFact((prev) => ({ ...prev, [u.id]: e.target.value }))}
                  rows={2}
                  placeholder="새로 확인한 사실 하나"
                  className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px] leading-relaxed"
                />
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newFindingSource[u.id] || ''}
                    onChange={(e) => setNewFindingSource((prev) => ({ ...prev, [u.id]: e.target.value }))}
                    placeholder="이 사실의 출처 URL"
                    className="flex-1 text-[11px] border border-neutral-200 rounded-lg px-2 py-1.5"
                  />
                  <button
                    onClick={() => {
                      addFinding(u.id, newFindingFact[u.id] || '', newFindingSource[u.id] || '');
                      setNewFindingFact((prev) => ({ ...prev, [u.id]: '' }));
                      setNewFindingSource((prev) => ({ ...prev, [u.id]: '' }));
                    }}
                    disabled={!(newFindingFact[u.id] || '').trim()}
                    className="shrink-0 text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                  >
                    + 추가
                  </button>
                </div>
              </div>
              {u.sources && u.sources.length > 0 && (
                <div className="space-y-1">
                  {u.sources.map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px] text-neutral-400">
                      <a href={s} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 truncate hover:underline hover:text-blue-600">
                        {s}
                      </a>
                      <button onClick={() => deleteSource(u.id, i)} className="shrink-0 font-black text-neutral-300 hover:text-red-500" title="출처 삭제">
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newSourceText[u.id] || ''}
                  onChange={(e) => setNewSourceText((prev) => ({ ...prev, [u.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      addSource(u.id, newSourceText[u.id] || '');
                      setNewSourceText((prev) => ({ ...prev, [u.id]: '' }));
                    }
                  }}
                  placeholder="출처 URL 추가"
                  className="flex-1 text-[10px] border border-neutral-200 rounded-lg px-2 py-1"
                />
                <button
                  onClick={() => {
                    addSource(u.id, newSourceText[u.id] || '');
                    setNewSourceText((prev) => ({ ...prev, [u.id]: '' }));
                  }}
                  disabled={!(newSourceText[u.id] || '').trim()}
                  className="shrink-0 text-[10px] font-black px-2.5 py-1 rounded-lg bg-black text-white disabled:opacity-40"
                >
                  + 출처 추가
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// 8번(전략/컨셉 확정) 단계 전용 패널 — 7번(자료조사)에서 확보한 자료를 바탕으로 검토한 방향 후보를
// 실제로 다 적어두고, 그중 하나를 선택 + 이유를 기록한다(script-writer 스킬 3단계에 해당).
// ResearchPanel과 완전히 같은 리스트/펼치기 구조를 쓰되, factCheck/sources 대신 strategyOptions/selectedStrategy/strategyReason을 다룬다.
function StrategyPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const draft = site.script_draft || {};
  const units = draft.units || [];
  const [openId, setOpenId] = useState<string | null>(null);
  const [newOptionText, setNewOptionText] = useState<Record<string, string>>({});
  const [editingReasonId, setEditingReasonId] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [saving, setSaving] = useState(false);

  async function saveUnits(next: ContentUnit[]) {
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, units: next }),
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function addOption(id: string, text: string) {
    if (!text.trim()) return;
    await saveUnits(units.map((u) => (u.id === id ? { ...u, strategyOptions: [...(u.strategyOptions || []), text.trim()] } : u)));
  }

  async function deleteOption(id: string, idx: number) {
    const unit = units.find((u) => u.id === id);
    const nextOptions = (unit?.strategyOptions || []).filter((_, i) => i !== idx);
    const removed = unit?.strategyOptions?.[idx];
    await saveUnits(
      units.map((u) =>
        u.id === id
          ? { ...u, strategyOptions: nextOptions, selectedStrategy: u.selectedStrategy === removed ? undefined : u.selectedStrategy }
          : u
      )
    );
  }

  async function selectOption(id: string, text: string) {
    await saveUnits(units.map((u) => (u.id === id ? { ...u, selectedStrategy: u.selectedStrategy === text ? undefined : text } : u)));
  }

  async function saveReason(id: string, reason: string) {
    await saveUnits(units.map((u) => (u.id === id ? { ...u, strategyReason: reason } : u)));
  }

  return (
    <div className="space-y-2">
      {units.length === 0 && <p className="text-sm text-neutral-300">아직 등록된 콘텐츠가 없어요 — 먼저 6번(콘텐츠 등록)에서 콘텐츠를 등록하세요.</p>}
      {units.map((u) => (
        <div key={u.id} className="bg-white border border-neutral-100 rounded-lg overflow-hidden">
          <button onClick={() => setOpenId((cur) => (cur === u.id ? null : u.id))} className="w-full text-left px-3 py-2.5 flex items-center gap-2">
            <span className={`shrink-0 text-neutral-300 transition-transform ${openId === u.id ? 'rotate-90' : ''}`}>▶</span>
            <span className="flex-1 min-w-0 text-sm font-bold truncate">{u.title}</span>
            {u.selectedStrategy ? (
              <span className="shrink-0 text-xs font-bold text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5">✅ 확정됨</span>
            ) : (
              <span className="shrink-0 text-xs font-bold text-neutral-400 bg-neutral-100 rounded-full px-2 py-0.5">미착수</span>
            )}
          </button>
          {openId === u.id && (
            <div className="px-3 pb-3 pt-1 border-t border-neutral-100 space-y-3">
              <p className="text-xs text-neutral-400">소재: {u.material}</p>
              <div className="space-y-1.5">
                <p className="text-xs font-black text-neutral-400">검토한 방향 후보</p>
                {(u.strategyOptions || []).length === 0 && (
                  <p className="text-sm text-neutral-300">아직 후보가 없어요 — 아래에서 후보를 추가하세요.</p>
                )}
                {(u.strategyOptions || []).map((opt, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
                      u.selectedStrategy === opt ? 'border-emerald-300 bg-emerald-50' : 'border-neutral-200'
                    }`}
                  >
                    <p className="flex-1 min-w-0 text-sm whitespace-pre-wrap leading-relaxed">{opt}</p>
                    <button
                      onClick={() => selectOption(u.id, opt)}
                      disabled={saving}
                      className={`shrink-0 text-xs font-black hover:underline ${u.selectedStrategy === opt ? 'text-emerald-600' : 'text-blue-600'}`}
                    >
                      {u.selectedStrategy === opt ? '✅ 선택됨' : '이 방향 선택'}
                    </button>
                    <button onClick={() => deleteOption(u.id, i)} className="shrink-0 font-black text-neutral-300 hover:text-red-500" title="후보 삭제">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <div className="bg-neutral-50 border border-neutral-100 rounded-lg p-2.5 space-y-2">
                <p className="text-xs font-black text-neutral-400">+ 방향 후보 추가 (타겟층/앵글을 구체적으로)</p>
                <textarea
                  value={newOptionText[u.id] || ''}
                  onChange={(e) => setNewOptionText((prev) => ({ ...prev, [u.id]: e.target.value }))}
                  rows={2}
                  placeholder="예: 재테크형 — 투자레슨 프레이밍"
                  className="w-full border border-neutral-200 rounded-lg px-2.5 py-2 text-sm leading-relaxed"
                />
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      addOption(u.id, newOptionText[u.id] || '');
                      setNewOptionText((prev) => ({ ...prev, [u.id]: '' }));
                    }}
                    disabled={!(newOptionText[u.id] || '').trim()}
                    className="shrink-0 text-sm font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                  >
                    + 후보 추가
                  </button>
                </div>
              </div>
              {u.selectedStrategy && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-black text-neutral-400">선택 이유</p>
                    {editingReasonId !== u.id && (
                      <button
                        onClick={() => {
                          setEditingReasonId(u.id);
                          setReasonDraft(u.strategyReason || '');
                        }}
                        className="shrink-0 text-xs font-bold text-blue-600 hover:underline"
                      >
                        수정
                      </button>
                    )}
                  </div>
                  {editingReasonId === u.id ? (
                    <div className="space-y-1.5">
                      <textarea
                        value={reasonDraft}
                        onChange={(e) => setReasonDraft(e.target.value)}
                        rows={3}
                        placeholder="왜 이 방향을 골랐는지"
                        className="w-full border border-neutral-200 rounded-lg px-2.5 py-2 text-sm leading-relaxed"
                      />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditingReasonId(null)} className="text-xs font-bold text-neutral-400 hover:text-black">
                          취소
                        </button>
                        <button
                          onClick={async () => {
                            await saveReason(u.id, reasonDraft);
                            setEditingReasonId(null);
                          }}
                          disabled={saving}
                          className="text-xs font-black text-emerald-600 hover:underline"
                        >
                          저장
                        </button>
                      </div>
                    </div>
                  ) : u.strategyReason ? (
                    <p className="text-[15px] text-neutral-600 whitespace-pre-wrap leading-relaxed">{u.strategyReason}</p>
                  ) : (
                    <p className="text-sm text-neutral-300">아직 이유가 없어요 — &quot;수정&quot;을 눌러서 추가하세요.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// 9번(훅/인트로 설계) 단계 전용 패널 — 본문 쓰기 전 도입부 후보를 여러 버전 적어보고 제일 강한 걸
// 선택한다(script-writer 스킬 4단계에 해당). 클릭률에 가장 큰 영향을 주는 단계라 후보를 남겨둔다.
function HookPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const draft = site.script_draft || {};
  const units = draft.units || [];
  const [openId, setOpenId] = useState<string | null>(null);
  const [newHookText, setNewHookText] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function saveUnits(next: ContentUnit[]) {
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, units: next }),
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function addHook(id: string, text: string) {
    if (!text.trim()) return;
    await saveUnits(units.map((u) => (u.id === id ? { ...u, hookOptions: [...(u.hookOptions || []), text.trim()] } : u)));
  }

  async function deleteHook(id: string, idx: number) {
    const unit = units.find((u) => u.id === id);
    const nextOptions = (unit?.hookOptions || []).filter((_, i) => i !== idx);
    const removed = unit?.hookOptions?.[idx];
    await saveUnits(
      units.map((u) => (u.id === id ? { ...u, hookOptions: nextOptions, selectedHook: u.selectedHook === removed ? undefined : u.selectedHook } : u))
    );
  }

  async function selectHook(id: string, text: string) {
    await saveUnits(units.map((u) => (u.id === id ? { ...u, selectedHook: u.selectedHook === text ? undefined : text } : u)));
  }

  return (
    <div className="space-y-2">
      {units.length === 0 && <p className="text-sm text-neutral-300">아직 등록된 콘텐츠가 없어요 — 먼저 6번(콘텐츠 등록)에서 콘텐츠를 등록하세요.</p>}
      {units.map((u) => (
        <div key={u.id} className="bg-white border border-neutral-100 rounded-lg overflow-hidden">
          <button onClick={() => setOpenId((cur) => (cur === u.id ? null : u.id))} className="w-full text-left px-3 py-2.5 flex items-center gap-2">
            <span className={`shrink-0 text-neutral-300 transition-transform ${openId === u.id ? 'rotate-90' : ''}`}>▶</span>
            <span className="flex-1 min-w-0 text-sm font-bold truncate">{u.title}</span>
            {u.selectedHook ? (
              <span className="shrink-0 text-xs font-bold text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5">✅ 확정됨</span>
            ) : (
              <span className="shrink-0 text-xs font-bold text-neutral-400 bg-neutral-100 rounded-full px-2 py-0.5">미착수</span>
            )}
          </button>
          {openId === u.id && (
            <div className="px-3 pb-3 pt-1 border-t border-neutral-100 space-y-3">
              <p className="text-xs text-neutral-400">소재: {u.material}</p>
              <div className="space-y-1.5">
                <p className="text-xs font-black text-neutral-400">훅/인트로 후보</p>
                {(u.hookOptions || []).length === 0 && (
                  <p className="text-sm text-neutral-300">아직 후보가 없어요 — 아래에서 후보를 추가하세요.</p>
                )}
                {(u.hookOptions || []).map((opt, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
                      u.selectedHook === opt ? 'border-emerald-300 bg-emerald-50' : 'border-neutral-200'
                    }`}
                  >
                    <p className="flex-1 min-w-0 text-sm whitespace-pre-wrap leading-relaxed">{opt}</p>
                    <button
                      onClick={() => selectHook(u.id, opt)}
                      disabled={saving}
                      className={`shrink-0 text-xs font-black hover:underline ${u.selectedHook === opt ? 'text-emerald-600' : 'text-blue-600'}`}
                    >
                      {u.selectedHook === opt ? '✅ 선택됨' : '이 버전 선택'}
                    </button>
                    <button onClick={() => deleteHook(u.id, i)} className="shrink-0 font-black text-neutral-300 hover:text-red-500" title="후보 삭제">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <div className="bg-neutral-50 border border-neutral-100 rounded-lg p-2.5 space-y-2">
                <p className="text-xs font-black text-neutral-400">+ 훅/인트로 후보 추가</p>
                <textarea
                  value={newHookText[u.id] || ''}
                  onChange={(e) => setNewHookText((prev) => ({ ...prev, [u.id]: e.target.value }))}
                  rows={3}
                  placeholder="도입부 후보 하나를 실제 문장으로 적어보세요"
                  className="w-full border border-neutral-200 rounded-lg px-2.5 py-2 text-sm leading-relaxed"
                />
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      addHook(u.id, newHookText[u.id] || '');
                      setNewHookText((prev) => ({ ...prev, [u.id]: '' }));
                    }}
                    disabled={!(newHookText[u.id] || '').trim()}
                    className="shrink-0 text-sm font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                  >
                    + 후보 추가
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// 5번(대본 작성) 단계 패널 — 소재 추천 → 제목 추천 → 대본, 3단계를 순서대로 진행한다.
// 각 단계는 4번과 동일한 하이브리드 방식(유료 Gemini Pro / 무료 구독-복사)을 쓴다.
// hideMaterials: "7번 대본 작성" 탭에서 열렸을 때는 true — 소재 선정은 "5번 소재 선정" 탭의 몫이라
// 1️⃣소재 추천 섹션은 숨기고, 이미 선택된 소재를 이어받아 제목/대본 작업과 완성 콘텐츠 목록만 보여준다.
function Step5Panel({
  site,
  onRefresh,
  hideMaterials,
  onMaterialSelected,
}: {
  site: Site;
  onRefresh: () => void;
  hideMaterials?: boolean;
  // 소재를 체크하는 순간 "6번 콘텐츠 등록" 탭으로 자동 이동시키는 콜백(5번 탭에서만 넘겨줌).
  onMaterialSelected?: () => void;
}) {
  const draft = site.script_draft || {};
  const [generating, setGenerating] = useState<'materials' | 'titles' | 'script' | 'translate' | null>(null);
  const [copying, setCopying] = useState<'materials' | 'titles' | 'script' | 'translate' | null>(null);
  const [copied, setCopied] = useState<'materials' | 'titles' | 'script' | 'translate' | null>(null);
  const [pasteOpen, setPasteOpen] = useState<'materials' | 'titles' | 'script' | 'translate' | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [scriptDraftText, setScriptDraftText] = useState(draft.script || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [openUnitId, setOpenUnitId] = useState<string | null>(null);
  // 2026-08-31 추가 — 6번(이미지/영상 생성) 장면 프롬프트를 이 콘텐츠 유닛에 직접 붙여넣기/수정하는 박스 상태.
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewCopyingId, setReviewCopyingId] = useState<string | null>(null);
  const [reviewCopiedId, setReviewCopiedId] = useState<string | null>(null);
  const [reviewPasteOpenId, setReviewPasteOpenId] = useState<string | null>(null);
  const [reviewPasteText, setReviewPasteText] = useState('');
  const [revisingId, setRevisingId] = useState<string | null>(null);
  const [reviseCopyingId, setReviseCopyingId] = useState<string | null>(null);
  const [reviseCopiedId, setReviseCopiedId] = useState<string | null>(null);
  const [revisePasteOpenId, setRevisePasteOpenId] = useState<string | null>(null);
  const [revisePasteText, setRevisePasteText] = useState('');
  // 한국어 대본 확정 전 "제미나이와 비교" 단계용 상태 — 결과는 고르는 게 아니라 합칠 재료라서
  // draft에 바로 저장하지 않고 여기 임시로만 들고 있는다(2026-08-31).
  const [compareCopying, setCompareCopying] = useState(false);
  const [compareCopied, setCompareCopied] = useState(false);
  const [comparePasteOpen, setComparePasteOpen] = useState(false);
  const [comparePasteText, setComparePasteText] = useState('');
  const [compareRunning, setCompareRunning] = useState(false);
  const [compareResult, setCompareResult] = useState<{ factCheck: string; rewriteTitle?: string; rewriteScript?: string; sources?: string[] } | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeCopying, setUpgradeCopying] = useState(false);
  const [upgradeCopied, setUpgradeCopied] = useState(false);
  const [upgradePasteOpen, setUpgradePasteOpen] = useState(false);
  const [upgradePasteText, setUpgradePasteText] = useState('');
  // 완성된 콘텐츠 유닛용 "제미나이와 비교→업그레이드" 상태 — 위저드 단계와 같은 방식이지만
  // 유닛 하나마다 별개로 열릴 수 있어서 unitId를 같이 들고 있는다(2026-08-31).
  const [unitCompareCopyingId, setUnitCompareCopyingId] = useState<string | null>(null);
  const [unitCompareCopiedId, setUnitCompareCopiedId] = useState<string | null>(null);
  const [unitComparePasteOpenId, setUnitComparePasteOpenId] = useState<string | null>(null);
  const [unitComparePasteText, setUnitComparePasteText] = useState('');
  const [unitCompareRunningId, setUnitCompareRunningId] = useState<string | null>(null);
  const [unitCompareResult, setUnitCompareResult] = useState<{ unitId: string; factCheck: string; rewriteTitle?: string; rewriteScript?: string; sources?: string[] } | null>(null);
  const [unitUpgradingId, setUnitUpgradingId] = useState<string | null>(null);
  const [unitUpgradeCopyingId, setUnitUpgradeCopyingId] = useState<string | null>(null);
  const [unitUpgradeCopiedId, setUnitUpgradeCopiedId] = useState<string | null>(null);
  const [unitUpgradePasteOpenId, setUnitUpgradePasteOpenId] = useState<string | null>(null);
  const [unitUpgradePasteText, setUnitUpgradePasteText] = useState('');
  const units = draft.units || [];
  // 소재(아이디어) 목록을 AI 추천/붙여넣기 말고 직접 추가·수정·삭제도 할 수 있게 하는 상태.
  const [newMaterialText, setNewMaterialText] = useState('');
  const [editingMaterialIdx, setEditingMaterialIdx] = useState<number | null>(null);
  const [editingMaterialText, setEditingMaterialText] = useState('');

  useEffect(() => {
    setScriptDraftText(draft.script || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.script]);

  async function generate(stage: 'materials' | 'titles' | 'script' | 'translate') {
    setGenerating(stage);
    setError('');
    try {
      const body: Record<string, string> = { siteId: site.id, stage, category: draft.category || 'trivia' };
      if (stage === 'titles') body.material = draft.selectedMaterial || '';
      if (stage === 'script') body.title = draft.selectedTitle || '';
      if (stage === 'translate') {
        body.title = draft.selectedTitle || '';
        body.script = scriptDraftText;
      }
      const res = await fetch('/api/script-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '생성 실패');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(null);
    }
  }

  async function copyPrompt(stage: 'materials' | 'titles' | 'script' | 'translate') {
    setCopying(stage);
    setError('');
    try {
      const q = new URLSearchParams({ siteId: site.id, stage, category: draft.category || 'trivia' });
      if (stage === 'titles') q.set('material', draft.selectedMaterial || '');
      if (stage === 'script') q.set('title', draft.selectedTitle || '');
      if (stage === 'translate') {
        q.set('title', draft.selectedTitle || '');
        q.set('script', scriptDraftText);
      }
      const res = await fetch(`/api/script-draft?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '프롬프트 생성 실패');
      await navigator.clipboard.writeText(data.prompt);
      setCopied(stage);
      setPasteOpen(stage);
      setPasteText('');
      setTimeout(() => setCopied((cur) => (cur === stage ? null : cur)), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCopying(null);
    }
  }

  async function savePasted(stage: 'materials' | 'titles' | 'script' | 'translate') {
    if (!pasteText.trim()) return;
    setSaving(true);
    setError('');
    try {
      const patch: Record<string, unknown> = { siteId: site.id };
      if (stage === 'materials') {
        patch.materials = pasteText.split('\n').map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
      } else if (stage === 'titles') {
        patch.titles = pasteText.split('\n').map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
      } else if (stage === 'translate') {
        // stage=translate 응답은 [EN]/[JA]만 온다(한국어는 이미 확정된 상태).
        const enMatch = pasteText.match(/\[EN\]([\s\S]*?)(?=\[JA\]|$)/);
        const jaMatch = pasteText.match(/\[JA\]([\s\S]*?)$/);
        const pickField = (block: string | undefined, field: 'Title' | 'Script') => {
          if (!block) return undefined;
          const m = block.match(new RegExp(`${field}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:Title|Script)\\s*:|$)`, 'i'));
          return m ? m[1].trim() : undefined;
        };
        patch.titleEn = pickField(enMatch?.[1], 'Title') || null;
        patch.scriptEn = pickField(enMatch?.[1], 'Script') || null;
        patch.titleJa = pickField(jaMatch?.[1], 'Title') || null;
        patch.scriptJa = pickField(jaMatch?.[1], 'Script') || null;
      } else {
        // stage=script 응답은 이제 한국어 대본 + 선택적 [SOURCES]만 온다(영어/일본어는 stage=translate로 분리).
        const sourcesMatch = pasteText.match(/\[SOURCES\]([\s\S]*?)$/);
        patch.script = pasteText.replace(/\[SOURCES\][\s\S]*$/, '').trim();
        patch.sources = sourcesMatch
          ? sourcesMatch[1].split('\n').map((s) => s.replace(/^\s*[-*\d.)]+\s*/, '').trim()).filter(Boolean)
          : null;
        // 새 한국어 대본이 나오면 이전 번역/사실확인은 이제 그 대본 것이 아니므로 같이 비운다.
        // (JSON.stringify가 undefined 키는 그냥 통째로 빼먹어서 PATCH에 반영이 안 되니 null로 보내야 한다.)
        patch.titleEn = null;
        patch.scriptEn = null;
        patch.titleJa = null;
        patch.scriptJa = null;
        patch.factCheck = null;
      }
      const res = await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장 실패');
      setPasteOpen(null);
      setPasteText('');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function selectMaterial(m: string) {
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, selectedMaterial: m }),
    });
    onRefresh();
    onMaterialSelected?.();
  }

  // 소재(아이디어)를 AI 추천/붙여넣기 없이 직접 추가·수정·삭제 — 나중에 적용할 수 있게 미리 등록만 해두는 용도.
  async function addMaterial() {
    const text = newMaterialText.trim();
    if (!text) return;
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, materials: [...(draft.materials || []), text] }),
    });
    setNewMaterialText('');
    onRefresh();
  }

  async function saveEditedMaterial(idx: number) {
    const text = editingMaterialText.trim();
    if (!text) return;
    const next = [...(draft.materials || [])];
    const wasSelected = draft.selectedMaterial === next[idx];
    next[idx] = text;
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, materials: next, ...(wasSelected ? { selectedMaterial: text } : {}) }),
    });
    setEditingMaterialIdx(null);
    onRefresh();
  }

  async function deleteMaterial(idx: number) {
    const target = (draft.materials || [])[idx];
    const next = (draft.materials || []).filter((_, i) => i !== idx);
    const wasSelected = draft.selectedMaterial === target;
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, materials: next, ...(wasSelected ? { selectedMaterial: null } : {}) }),
    });
    onRefresh();
  }

  // 트리비아(가벼운 톤)와 대참사/사건(진지한 톤)은 완전히 다른 프롬프트를 쓰므로, 소재 추천 전에 먼저 골라야 한다.
  async function setCategory(category: UnitCategory) {
    if (!confirm(category === 'disaster' ? '"대참사/사건" 모드로 바꿀까요? 지금까지 만든 소재/제목/대본은 초기화돼요.' : '"트리비아" 모드로 바꿀까요? 지금까지 만든 소재/제목/대본은 초기화돼요.')) return;
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, category, materials: null, selectedMaterial: null, titles: null, selectedTitle: null, script: null, titleEn: null, scriptEn: null, titleJa: null, scriptJa: null, sources: null, factCheck: null }),
    });
    onRefresh();
  }

  async function setUnitTopic(id: string, topic: string) {
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === id ? { ...u, topic } : u)) }),
    });
    onRefresh();
  }

  // 6번 장면 프롬프트를 이 콘텐츠 유닛에 저장 — Claude가 채팅으로 만들어준 프롬프트 전문을 그대로 붙여넣는 용도.
  async function saveUnitScenePrompts(id: string, scenePrompts: string) {
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === id ? { ...u, scenePrompts } : u)) }),
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  // Gemini/Claude가 사실확인하면서 출처를 붙여주면(신문사명, 링크 등) 여기 한 줄씩 저장해서
  // 나중에 "그거 어디서 봤냐"는 지적에 근거로 내밀 수 있게 한다.
  async function saveSources(id: string, sourcesText: string) {
    const sources = sourcesText.split('\n').map((s) => s.trim()).filter(Boolean);
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === id ? { ...u, sources } : u)) }),
    });
    onRefresh();
  }

  async function selectTitle(t: string) {
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, selectedTitle: t }),
    });
    onRefresh();
  }

  function parseComparePaste(text: string): { factCheck: string; rewriteTitle?: string; rewriteScript?: string; sources?: string[] } {
    const factMatch = text.match(/\[FACT-CHECK\]([\s\S]*?)(?=\[REWRITE\]|\[SOURCES\]|$)/);
    const rewriteMatch = text.match(/\[REWRITE\]([\s\S]*?)(?=\[SOURCES\]|$)/);
    const sourcesMatch = text.match(/\[SOURCES\]([\s\S]*?)$/);
    const pickField = (block: string | undefined, field: 'Title' | 'Script') => {
      if (!block) return undefined;
      const m = block.match(new RegExp(`${field}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:Title|Script)\\s*:|$)`, 'i'));
      return m ? m[1].trim() : undefined;
    };
    return {
      factCheck: (factMatch ? factMatch[1] : '').trim(),
      rewriteTitle: pickField(rewriteMatch?.[1], 'Title'),
      rewriteScript: pickField(rewriteMatch?.[1], 'Script'),
      sources: sourcesMatch ? sourcesMatch[1].split('\n').map((s) => s.replace(/^\s*[-*\d.)]+\s*/, '').trim()).filter(Boolean) : undefined,
    };
  }

  // "제미나이와 비교" — 확정 전 제목/대본을 실제 검색 그라운딩으로 사실확인 + 제미나이 자체 버전을 받아온다.
  // 결과는 고르는 게 아니라 다음 단계(업그레이드)에서 원본과 합칠 재료라서 draft에 바로 저장하지 않는다.
  async function copyComparePrompt() {
    setCompareCopying(true);
    setError('');
    try {
      const q = new URLSearchParams({ siteId: site.id, action: 'compare', title: draft.selectedTitle || '', script: scriptDraftText, category: draft.category || 'trivia' });
      const res = await fetch(`/api/script-draft?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '프롬프트 생성 실패');
      await navigator.clipboard.writeText(data.prompt);
      setCompareCopied(true);
      setComparePasteOpen(true);
      setComparePasteText('');
      setTimeout(() => setCompareCopied(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCompareCopying(false);
    }
  }

  function saveComparePaste() {
    if (!comparePasteText.trim()) return;
    setCompareResult(parseComparePaste(comparePasteText));
    setComparePasteOpen(false);
  }

  async function runCompare() {
    setCompareRunning(true);
    setError('');
    try {
      const res = await fetch('/api/script-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, action: 'compare', title: draft.selectedTitle, script: scriptDraftText, category: draft.category || 'trivia' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '비교 실패');
      setCompareResult({ factCheck: data.factCheck || '', rewriteTitle: data.rewriteTitle, rewriteScript: data.rewriteScript, sources: data.sources });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCompareRunning(false);
    }
  }

  // 원본 유지 — 비교는 했지만 제미나이 버전을 반영할 필요가 없다고 판단했을 때. 그래도 사실확인/출처는 남겨둔다.
  async function keepOriginalAfterCompare() {
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, factCheck: compareResult?.factCheck || null, sources: compareResult?.sources || null }),
      });
      setCompareResult(null);
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  // "업그레이드" — 원본과 제미나이 버전 중 하나를 고르는 게 아니라, 둘의 장점을 합친 제3의 최종본을 만든다.
  // (사용자 지적: "교체가 아니라 두개를 보고 업그레이드를 해야지" — 2026-08-31)
  async function runUpgrade() {
    if (!compareResult) return;
    setUpgrading(true);
    setError('');
    try {
      const res = await fetch('/api/script-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: site.id,
          action: 'upgrade',
          title: draft.selectedTitle,
          script: scriptDraftText,
          rewriteTitle: compareResult.rewriteTitle,
          rewriteScript: compareResult.rewriteScript,
          factCheck: compareResult.factCheck,
          category: draft.category || 'trivia',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '업그레이드 실패');
      await applyUpgrade(data.title, data.script);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpgrading(false);
    }
  }

  async function copyUpgradePrompt() {
    if (!compareResult) return;
    setUpgradeCopying(true);
    setError('');
    try {
      const q = new URLSearchParams({
        siteId: site.id,
        action: 'upgrade',
        title: draft.selectedTitle || '',
        script: scriptDraftText,
        rewriteTitle: compareResult.rewriteTitle || '',
        rewriteScript: compareResult.rewriteScript || '',
        factCheck: compareResult.factCheck || '',
        category: draft.category || 'trivia',
      });
      const res = await fetch(`/api/script-draft?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '프롬프트 생성 실패');
      await navigator.clipboard.writeText(data.prompt);
      setUpgradeCopied(true);
      setUpgradePasteOpen(true);
      setUpgradePasteText('');
      setTimeout(() => setUpgradeCopied(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpgradeCopying(false);
    }
  }

  async function saveUpgradePaste() {
    if (!upgradePasteText.trim()) return;
    const pickField = (field: 'Title' | 'Script') => {
      const m = upgradePasteText.match(new RegExp(`${field}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:Title|Script)\\s*:|$)`, 'i'));
      return m ? m[1].trim() : undefined;
    };
    await applyUpgrade(pickField('Title'), pickField('Script'));
    setUpgradePasteOpen(false);
    setUpgradePasteText('');
  }

  async function applyUpgrade(title: string | undefined, script: string | undefined) {
    const nextTitle = title || draft.selectedTitle || '';
    const nextScript = script || scriptDraftText;
    setScriptDraftText(nextScript);
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: site.id,
          selectedTitle: nextTitle,
          script: nextScript,
          factCheck: compareResult?.factCheck || null,
          sources: compareResult?.sources || null,
        }),
      });
      setCompareResult(null);
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function saveScript() {
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, script: scriptDraftText }),
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function resetAll() {
    if (!confirm('소재/제목/대본 선택을 전부 초기화할까요? (완성해서 저장해둔 콘텐츠 목록은 안 지워져요)')) return;
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, materials: null, selectedMaterial: null, titles: null, selectedTitle: null, script: null, titleEn: null, scriptEn: null, titleJa: null, scriptJa: null, sources: null, factCheck: null }),
    });
    onRefresh();
  }

  // 소재 하나마다 별개 콘텐츠라서, 대본까지 완성되면 units 목록에 하나로 저장해두고
  // 위저드는 비워서 같은 소재 추천 목록에서 바로 다음 걸 이어서 진행할 수 있게 한다.
  async function finalizeUnit() {
    if (!draft.selectedMaterial || !draft.selectedTitle || !scriptDraftText.trim()) return;
    setSaving(true);
    try {
      const unit: ContentUnit = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        material: draft.selectedMaterial,
        title: draft.selectedTitle,
        script: scriptDraftText.trim(),
        category: draft.category || 'trivia',
        materialCandidates: draft.materials,
        titleCandidates: draft.titles,
        titleEn: draft.titleEn,
        scriptEn: draft.scriptEn,
        titleJa: draft.titleJa,
        scriptJa: draft.scriptJa,
        sources: draft.sources,
        factCheck: draft.factCheck,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: site.id,
          units: [...units, unit],
          selectedMaterial: null,
          titles: null,
          selectedTitle: null,
          script: null,
          titleEn: null,
          scriptEn: null,
          titleJa: null,
          scriptJa: null,
          sources: null,
          factCheck: null,
        }),
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function deleteUnit(id: string) {
    if (!confirm('이 완성 콘텐츠를 삭제할까요?')) return;
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, units: units.filter((u) => u.id !== id) }),
    });
    onRefresh();
  }

  // AI 자동 검토 — Gemini Pro로 제목/대본을 4번 분석 패턴 기준으로 채점·평가해서 unit.review에 저장.
  async function reviewUnit(unit: ContentUnit) {
    setReviewingId(unit.id);
    setError('');
    try {
      const res = await fetch('/api/script-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, action: 'review', unitId: unit.id, title: unit.title, script: unit.script }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '검토 실패');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewingId(null);
    }
  }

  // 유료 API 없이, 검토 프롬프트(평가 기준+출력 형식 전부 포함)를 클립보드로 복사만 해준다.
  // 사용자가 이걸 Gemini/Claude 구독 채팅에 붙여넣어 검토받고, 답변을 아래 붙여넣기 칸에 다시 넣으면 저장된다.
  async function copyReviewPrompt(unit: ContentUnit) {
    setReviewCopyingId(unit.id);
    setError('');
    try {
      const q = new URLSearchParams({ siteId: site.id, action: 'review', title: unit.title, script: unit.script, category: unit.category || 'trivia' });
      const res = await fetch(`/api/script-draft?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '검토 프롬프트 생성 실패');
      await navigator.clipboard.writeText(data.prompt);
      setReviewCopiedId(unit.id);
      setReviewPasteOpenId(unit.id);
      setReviewPasteText('');
      setTimeout(() => setReviewCopiedId((cur) => (cur === unit.id ? null : cur)), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewCopyingId(null);
    }
  }

  async function savePastedReview(unitId: string) {
    if (!reviewPasteText.trim()) return;
    setSaving(true);
    setError('');
    try {
      const scoreMatch = reviewPasteText.match(/SCORE:\s*(\d+)/i);
      const feedbackMatch = reviewPasteText.match(/FEEDBACK:\s*([\s\S]*)/i);
      const review = {
        score: scoreMatch ? parseInt(scoreMatch[1], 10) : undefined,
        feedback: feedbackMatch ? feedbackMatch[1].trim() : reviewPasteText.trim(),
        reviewedAt: new Date().toISOString(),
      };
      const res = await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === unitId ? { ...u, review } : u)) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장 실패');
      setReviewPasteOpenId(null);
      setReviewPasteText('');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // 검토 피드백을 실제로 반영해서 대본을 고쳐 쓴다 — 검토가 점수만 주고 끝나지 않게.
  async function reviseUnit(unit: ContentUnit) {
    if (!unit.review?.feedback) return;
    setRevisingId(unit.id);
    setError('');
    try {
      const res = await fetch('/api/script-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, action: 'revise', unitId: unit.id, title: unit.title, script: unit.script, feedback: unit.review.feedback, category: unit.category || 'trivia' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '수정 실패');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevisingId(null);
    }
  }

  async function copyRevisePrompt(unit: ContentUnit) {
    if (!unit.review?.feedback) return;
    setReviseCopyingId(unit.id);
    setError('');
    try {
      const q = new URLSearchParams({ siteId: site.id, action: 'revise', title: unit.title, script: unit.script, feedback: unit.review.feedback, category: unit.category || 'trivia' });
      const res = await fetch(`/api/script-draft?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '프롬프트 생성 실패');
      await navigator.clipboard.writeText(data.prompt);
      setReviseCopiedId(unit.id);
      setRevisePasteOpenId(unit.id);
      setRevisePasteText('');
      setTimeout(() => setReviseCopiedId((cur) => (cur === unit.id ? null : cur)), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviseCopyingId(null);
    }
  }

  async function savePastedRevise(unitId: string) {
    if (!revisePasteText.trim()) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === unitId ? { ...u, script: revisePasteText.trim(), review: undefined, status: 'pending' } : u)) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장 실패');
      setRevisePasteOpenId(null);
      setRevisePasteText('');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // 완성된 유닛용 "제미나이와 비교→업그레이드" — 위저드 단계 것과 똑같은 규칙이지만 draft가 아니라
  // units 배열의 특정 유닛에 바로 적용한다. AI 검토(review)만 받고 끝나던 걸 개선한 revise와 별개로,
  // "한쪽으로 교체가 아니라 둘을 합쳐서 업그레이드"해야 한다는 지시를 유닛에도 그대로 적용한다(2026-08-31).
  async function copyUnitComparePrompt(unit: ContentUnit) {
    setUnitCompareCopyingId(unit.id);
    setError('');
    try {
      const q = new URLSearchParams({ siteId: site.id, action: 'compare', title: unit.title, script: unit.script, category: unit.category || 'trivia' });
      const res = await fetch(`/api/script-draft?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '프롬프트 생성 실패');
      await navigator.clipboard.writeText(data.prompt);
      setUnitCompareCopiedId(unit.id);
      setUnitComparePasteOpenId(unit.id);
      setUnitComparePasteText('');
      setTimeout(() => setUnitCompareCopiedId((cur) => (cur === unit.id ? null : cur)), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnitCompareCopyingId(null);
    }
  }

  function saveUnitComparePaste(unitId: string) {
    if (!unitComparePasteText.trim()) return;
    setUnitCompareResult({ unitId, ...parseComparePaste(unitComparePasteText) });
    setUnitComparePasteOpenId(null);
  }

  async function runUnitCompare(unit: ContentUnit) {
    setUnitCompareRunningId(unit.id);
    setError('');
    try {
      const res = await fetch('/api/script-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, action: 'compare', title: unit.title, script: unit.script, category: unit.category || 'trivia' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '비교 실패');
      setUnitCompareResult({ unitId: unit.id, factCheck: data.factCheck || '', rewriteTitle: data.rewriteTitle, rewriteScript: data.rewriteScript, sources: data.sources });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnitCompareRunningId(null);
    }
  }

  async function keepOriginalAfterUnitCompare(unitId: string) {
    if (!unitCompareResult) return;
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === unitId ? { ...u, factCheck: unitCompareResult.factCheck, sources: unitCompareResult.sources } : u)) }),
      });
      setUnitCompareResult(null);
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function runUnitUpgrade(unit: ContentUnit) {
    if (!unitCompareResult || unitCompareResult.unitId !== unit.id) return;
    setUnitUpgradingId(unit.id);
    setError('');
    try {
      const res = await fetch('/api/script-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: site.id,
          action: 'upgrade',
          title: unit.title,
          script: unit.script,
          rewriteTitle: unitCompareResult.rewriteTitle,
          rewriteScript: unitCompareResult.rewriteScript,
          factCheck: unitCompareResult.factCheck,
          category: unit.category || 'trivia',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '업그레이드 실패');
      await applyUnitUpgrade(unit, data.title, data.script);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnitUpgradingId(null);
    }
  }

  async function copyUnitUpgradePrompt(unit: ContentUnit) {
    if (!unitCompareResult || unitCompareResult.unitId !== unit.id) return;
    setUnitUpgradeCopyingId(unit.id);
    setError('');
    try {
      const q = new URLSearchParams({
        siteId: site.id,
        action: 'upgrade',
        title: unit.title,
        script: unit.script,
        rewriteTitle: unitCompareResult.rewriteTitle || '',
        rewriteScript: unitCompareResult.rewriteScript || '',
        factCheck: unitCompareResult.factCheck || '',
        category: unit.category || 'trivia',
      });
      const res = await fetch(`/api/script-draft?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '프롬프트 생성 실패');
      await navigator.clipboard.writeText(data.prompt);
      setUnitUpgradeCopiedId(unit.id);
      setUnitUpgradePasteOpenId(unit.id);
      setUnitUpgradePasteText('');
      setTimeout(() => setUnitUpgradeCopiedId((cur) => (cur === unit.id ? null : cur)), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnitUpgradeCopyingId(null);
    }
  }

  async function saveUnitUpgradePaste(unit: ContentUnit) {
    if (!unitUpgradePasteText.trim()) return;
    const pickField = (field: 'Title' | 'Script') => {
      const m = unitUpgradePasteText.match(new RegExp(`${field}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:Title|Script)\\s*:|$)`, 'i'));
      return m ? m[1].trim() : undefined;
    };
    await applyUnitUpgrade(unit, pickField('Title'), pickField('Script'));
    setUnitUpgradePasteOpenId(null);
    setUnitUpgradePasteText('');
  }

  async function applyUnitUpgrade(unit: ContentUnit, title: string | undefined, script: string | undefined) {
    const nextTitle = title || unit.title;
    const nextScript = script || unit.script;
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: site.id,
          units: units.map((u) =>
            u.id === unit.id
              ? { ...u, title: nextTitle, script: nextScript, factCheck: unitCompareResult?.factCheck, sources: unitCompareResult?.sources, review: undefined, status: 'pending' }
              : u
          ),
        }),
      });
      setUnitCompareResult(null);
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function setUnitStatus(id: string, status: ContentUnit['status']) {
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === id ? { ...u, status } : u)) }),
    });
    onRefresh();
  }

  // 확정 당시 같이 추천받았던 다른 제목 후보로 바꿔치기 — 대본/번역/검토는 그 제목 기준으로 만든 거라 그대로 두고 제목만 교체.
  async function swapUnitTitle(id: string, newTitle: string) {
    await fetch('/api/script-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === id ? { ...u, title: newTitle } : u)) }),
    });
    onRefresh();
  }

  function GenerateButtons({ stage }: { stage: 'materials' | 'titles' | 'script' | 'translate' }) {
    return (
      <div className="flex gap-1.5 mb-2">
        <button
          onClick={() => copyPrompt(stage)}
          disabled={copying === stage}
          className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
        >
          {copying === stage ? '준비 중...' : copied === stage ? '✅ 복사됨!' : '💬 Gemini·Claude 구독으로 만들기'}
        </button>
        <button
          onClick={() => generate(stage)}
          disabled={generating === stage}
          className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white hover:bg-neutral-800 disabled:opacity-40"
        >
          {generating === stage ? '만드는 중... (1분 정도)' : '✨ Gemini Pro로 만들기'}
        </button>
      </div>
    );
  }

  function GenerateHint() {
    return (
      <p className="text-[10px] text-neutral-400 mb-2">
        "✨ Gemini Pro"는 유료 API를 직접 호출해서 바로 저장해요. "💬 Gemini·Claude 구독으로 만들기"는 비용 없이
        프롬프트만 클립보드에 복사해줘요 — Gemini 웹앱이든 Claude(claude.ai나 이 대화)든 아무 구독 채팅에 붙여넣어서
        물어보고, 답변을 아래 붙여넣기 칸에 넣으면 저장돼요. (Vercel에서 도는 앱이라 두 구독 계정을 여기서 자동으로
        대신 불러낼 순 없어요.)
      </p>
    );
  }

  function PasteBox({ stage }: { stage: 'materials' | 'titles' | 'script' | 'translate' }) {
    if (pasteOpen !== stage) return null;
    return (
      <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-2 mb-2">
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={stage === 'script' ? 6 : 4}
          placeholder="구독 채팅(Gemini/Claude) 답변을 여기에 붙여넣으세요"
          className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono leading-relaxed mb-1.5"
        />
        <div className="flex justify-end gap-1.5">
          <button onClick={() => setPasteOpen(null)} className="text-[11px] font-bold text-neutral-400 hover:text-black px-2">
            취소
          </button>
          <button
            onClick={() => savePasted(stage)}
            disabled={saving || !pasteText.trim()}
            className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
          >
            {saving ? '저장 중...' : '붙여넣기 저장'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-black/5 pt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-black text-neutral-500">
          ✍️ 대본 작성 — 소재 추천 → 제목 추천 → 대본
        </span>
        <button onClick={resetAll} className="text-[11px] font-bold text-neutral-400 hover:text-red-500 px-2">
          🔄 처음부터
        </button>
      </div>
      <GenerateHint />
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[10px] font-black text-neutral-400">카테고리:</span>
        <button
          onClick={() => setCategory('trivia')}
          disabled={(draft.category || 'trivia') === 'trivia'}
          className={`text-[11px] font-black px-3 py-1 rounded-full border ${
            (draft.category || 'trivia') === 'trivia' ? 'bg-black text-white border-black' : 'bg-white text-neutral-500 border-neutral-200 hover:border-neutral-400'
          }`}
        >
          🔧 트리비아
        </button>
        <button
          onClick={() => setCategory('disaster')}
          disabled={draft.category === 'disaster'}
          className={`text-[11px] font-black px-3 py-1 rounded-full border ${
            draft.category === 'disaster' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-neutral-500 border-neutral-200 hover:border-red-300'
          }`}
        >
          🚨 대참사·사건
        </button>
      </div>
      {draft.category === 'disaster' && (
        <p className="text-[10px] text-red-500 font-bold mb-2">
          진지한 톤 전용 모드예요 — "정신 나간/환장할 노릇" 같은 트리비아 유행어는 안 나오고, 사실→원인→교훈/개선 구조로 만들어져요.
        </p>
      )}
      {error && <p className="text-[11px] text-red-500 font-bold mb-2">{error}</p>}

      {units.length > 0 && (
        <div className="bg-emerald-50/40 border border-emerald-100 rounded-lg p-3 mb-2">
          <div className="text-[11px] font-black text-emerald-700 mb-2">✅ 완성된 콘텐츠 ({units.length}개)</div>
          <div className="space-y-1.5">
            {units.map((u) => {
              const statusTag =
                u.status === 'approved'
                  ? { label: '승인됨', cls: 'bg-emerald-100 text-emerald-700' }
                  : u.status === 'rejected'
                    ? { label: '반려됨', cls: 'bg-red-100 text-red-600' }
                    : { label: '검토대기', cls: 'bg-neutral-100 text-neutral-500' };
              return (
                <div key={u.id} className="bg-white border border-neutral-100 rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button onClick={() => setOpenUnitId((cur) => (cur === u.id ? null : u.id))} className="flex-1 min-w-0 text-left flex items-center gap-1.5">
                      <span className={`inline-block transition-transform text-neutral-300 ${openUnitId === u.id ? 'rotate-90' : ''}`}>▶</span>
                      {u.category === 'disaster' && <span className="shrink-0 text-[10px]">🚨</span>}
                      <span className="text-[11px] font-bold truncate">{u.title}</span>
                      {u.topic && <span className="shrink-0 text-[10px] font-bold text-neutral-400 bg-neutral-100 rounded-full px-2 py-0.5">{u.topic}</span>}
                      {u.factCheck && (
                        <span
                          className="shrink-0 text-[10px] font-bold text-blue-600 bg-blue-50 rounded-full px-2 py-0.5"
                          title={u.factCheck}
                        >
                          📎 자료조사 메모 있음
                        </span>
                      )}
                      {u.review?.score !== undefined && (
                        <span className="shrink-0 text-[10px] font-black text-neutral-400">({u.review.score}/10)</span>
                      )}
                    </button>
                    <span className={`shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full ${statusTag.cls}`}>{statusTag.label}</span>
                    <button onClick={() => deleteUnit(u.id)} className="shrink-0 text-[11px] text-red-400 font-bold hover:text-red-600 px-1" title="삭제">
                      ✕
                    </button>
                  </div>
                  {openUnitId === u.id && (
                    <div className="px-3 pb-3 pt-1 border-t border-neutral-100 space-y-2">
                      <p className="text-[10px] text-neutral-400">소재: {u.material}</p>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-black text-neutral-400">분야:</span>
                        {['건축', '토목', '무기', '항공', '자연재해', '기타'].map((t) => (
                          <button
                            key={t}
                            onClick={() => setUnitTopic(u.id, u.topic === t ? '' : t)}
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              u.topic === t ? 'bg-black text-white border-black' : 'bg-white text-neutral-400 border-neutral-200 hover:border-neutral-400'
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                      {u.titleCandidates && u.titleCandidates.filter((t) => t !== u.title).length > 0 && (
                        <div>
                          <p className="text-[10px] font-black text-neutral-400 mb-1">그때 같이 나온 다른 제목 후보 (클릭하면 교체)</p>
                          <div className="space-y-1">
                            {u.titleCandidates
                              .filter((t) => t !== u.title)
                              .map((t, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => swapUnitTitle(u.id, t)}
                                  className="block w-full text-left text-[11px] text-neutral-500 hover:text-black hover:bg-neutral-50 rounded px-1.5 py-1"
                                >
                                  {t}
                                </button>
                              ))}
                          </div>
                        </div>
                      )}
                      <div>
                        <p className="text-[10px] font-black text-neutral-400 mb-0.5">🇰🇷 한국어 ({u.script.length}자)</p>
                        <p className="text-xs text-neutral-600 leading-relaxed whitespace-pre-wrap">{u.script}</p>
                      </div>
                      {u.scriptEn && (
                        <div className="pt-2 border-t border-neutral-50">
                          <p className="text-[10px] font-black text-neutral-400 mb-0.5">🇺🇸 {u.titleEn}</p>
                          <p className="text-xs text-neutral-600 leading-relaxed whitespace-pre-wrap">{u.scriptEn}</p>
                        </div>
                      )}
                      {u.scriptJa && (
                        <div className="pt-2 border-t border-neutral-50">
                          <p className="text-[10px] font-black text-neutral-400 mb-0.5">🇯🇵 {u.titleJa}</p>
                          <p className="text-xs text-neutral-600 leading-relaxed whitespace-pre-wrap">{u.scriptJa}</p>
                        </div>
                      )}
                      <div className="pt-2 border-t border-neutral-50">
                        <p className="text-[10px] font-black text-neutral-400 mb-0.5">🎬 6번 이미지/영상 프롬프트 (이 콘텐츠 전용) — 장면별로 추가/수정</p>
                        <SceneEditorList scenePrompts={u.scenePrompts || ''} saving={saving} onSave={(text) => saveUnitScenePrompts(u.id, text)} />
                      </div>
                      {/* 자료조사(factCheck/sources) 편집 UI는 7번 자료조사 전용 ResearchPanel에만 둔다 — 여기 8번(대본작성)에 중복으로 있던 블록을 제거함(2026-09-03). */}

                      {/* 제미나이와 비교→업그레이드 — "교체"가 아니라 원본+제미나이 버전을 합쳐서 최종본을 만든다. */}
                      <div className="pt-2 border-t border-neutral-50 bg-neutral-50 rounded-lg p-2">
                        <p className="text-[10px] font-black text-neutral-500 mb-1.5">🔍 제미나이와 비교해서 사실확인 (선택)</p>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          <button
                            onClick={() => copyUnitComparePrompt(u)}
                            disabled={unitCompareCopyingId === u.id}
                            className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
                          >
                            {unitCompareCopyingId === u.id ? '준비 중...' : unitCompareCopiedId === u.id ? '✅ 복사됨!' : '💬 구독으로 비교하기'}
                          </button>
                          <button
                            onClick={() => runUnitCompare(u)}
                            disabled={unitCompareRunningId === u.id}
                            className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                          >
                            {unitCompareRunningId === u.id ? '비교 중...' : '✨ 자동으로 비교하기'}
                          </button>
                        </div>
                        {unitComparePasteOpenId === u.id && (
                          <div className="mb-2">
                            <textarea
                              value={unitComparePasteText}
                              onChange={(e) => setUnitComparePasteText(e.target.value)}
                              rows={6}
                              placeholder="구독 채팅 답변([FACT-CHECK]/[REWRITE]/[SOURCES])을 여기에 붙여넣으세요"
                              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono leading-relaxed mb-1.5"
                            />
                            <div className="flex justify-end gap-1.5">
                              <button onClick={() => setUnitComparePasteOpenId(null)} className="text-[11px] font-bold text-neutral-400 hover:text-black px-2">
                                취소
                              </button>
                              <button
                                onClick={() => saveUnitComparePaste(u.id)}
                                disabled={!unitComparePasteText.trim()}
                                className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                              >
                                결과 확인
                              </button>
                            </div>
                          </div>
                        )}
                        {unitCompareResult && unitCompareResult.unitId === u.id && (
                          <div className="space-y-2">
                            <div className="bg-white border border-neutral-200 rounded-lg p-2">
                              <p className="text-[10px] font-black text-neutral-400 mb-1">사실확인 결과</p>
                              <p className="text-xs text-neutral-600 whitespace-pre-wrap leading-relaxed">{unitCompareResult.factCheck || '(내용 없음)'}</p>
                            </div>
                            {(unitCompareResult.rewriteTitle || unitCompareResult.rewriteScript) && (
                              <div className="bg-white border border-neutral-200 rounded-lg p-2">
                                <p className="text-[10px] font-black text-neutral-400 mb-1">제미나이가 다시 쓴 버전</p>
                                {unitCompareResult.rewriteTitle && <p className="text-xs font-bold text-neutral-700 mb-1">{unitCompareResult.rewriteTitle}</p>}
                                {unitCompareResult.rewriteScript && <p className="text-xs text-neutral-600 whitespace-pre-wrap leading-relaxed">{unitCompareResult.rewriteScript}</p>}
                              </div>
                            )}
                            <p className="text-[10px] text-neutral-400">둘 중 하나를 고르는 게 아니라, 두 버전의 장점을 합쳐서 업그레이드해요.</p>
                            <div className="flex flex-wrap justify-end gap-1.5">
                              <button
                                onClick={() => keepOriginalAfterUnitCompare(u.id)}
                                disabled={saving}
                                className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
                              >
                                원본 유지
                              </button>
                              <button
                                onClick={() => copyUnitUpgradePrompt(u)}
                                disabled={unitUpgradeCopyingId === u.id}
                                className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
                              >
                                {unitUpgradeCopyingId === u.id ? '준비 중...' : unitUpgradeCopiedId === u.id ? '✅ 복사됨!' : '💬 구독으로 업그레이드'}
                              </button>
                              <button
                                onClick={() => runUnitUpgrade(u)}
                                disabled={unitUpgradingId === u.id}
                                className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-40"
                              >
                                {unitUpgradingId === u.id ? '업그레이드 중...' : '🔀 자동으로 업그레이드'}
                              </button>
                            </div>
                            {unitUpgradePasteOpenId === u.id && (
                              <div>
                                <textarea
                                  value={unitUpgradePasteText}
                                  onChange={(e) => setUnitUpgradePasteText(e.target.value)}
                                  rows={6}
                                  placeholder="구독 채팅 답변(Title:/Script:)을 여기에 붙여넣으세요"
                                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono leading-relaxed mb-1.5"
                                />
                                <div className="flex justify-end gap-1.5">
                                  <button onClick={() => setUnitUpgradePasteOpenId(null)} className="text-[11px] font-bold text-neutral-400 hover:text-black px-2">
                                    취소
                                  </button>
                                  <button
                                    onClick={() => saveUnitUpgradePaste(u)}
                                    disabled={saving || !unitUpgradePasteText.trim()}
                                    className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                                  >
                                    붙여넣기 적용
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {u.review && (
                        <div className="pt-2 border-t border-neutral-50 bg-neutral-50 rounded-lg p-2">
                          <p className="text-[10px] font-black text-neutral-500 mb-1">
                            🔍 AI 검토 {u.review.score !== undefined && `— ${u.review.score}/10점`}
                          </p>
                          <p className="text-[11px] text-neutral-600 leading-relaxed whitespace-pre-wrap mb-2">{u.review.feedback}</p>
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              onClick={() => copyRevisePrompt(u)}
                              disabled={reviseCopyingId === u.id}
                              className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
                            >
                              {reviseCopyingId === u.id ? '준비 중...' : reviseCopiedId === u.id ? '✅ 복사됨!' : '💬 구독으로 피드백 반영 수정'}
                            </button>
                            <button
                              onClick={() => reviseUnit(u)}
                              disabled={revisingId === u.id}
                              className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white hover:bg-neutral-800 disabled:opacity-40"
                            >
                              {revisingId === u.id ? '수정 중...' : '🔧 피드백 반영해서 수정'}
                            </button>
                          </div>
                          {revisePasteOpenId === u.id && (
                            <div className="bg-white border border-neutral-200 rounded-lg p-2 mt-1.5">
                              <textarea
                                value={revisePasteText}
                                onChange={(e) => setRevisePasteText(e.target.value)}
                                rows={5}
                                placeholder="구독 채팅이 다시 써준 대본 전문을 여기에 붙여넣으세요"
                                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono leading-relaxed mb-1.5"
                              />
                              <div className="flex justify-end gap-1.5">
                                <button onClick={() => setRevisePasteOpenId(null)} className="text-[11px] font-bold text-neutral-400 hover:text-black px-2">
                                  취소
                                </button>
                                <button
                                  onClick={() => savePastedRevise(u.id)}
                                  disabled={saving || !revisePasteText.trim()}
                                  className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                                >
                                  {saving ? '저장 중...' : '붙여넣기 저장'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {reviewPasteOpenId === u.id && (
                        <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-2">
                          <textarea
                            value={reviewPasteText}
                            onChange={(e) => setReviewPasteText(e.target.value)}
                            rows={4}
                            placeholder="구독 채팅(Gemini/Claude)의 검토 답변을 여기에 붙여넣으세요 (SCORE:/FEEDBACK: 포함)"
                            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono leading-relaxed mb-1.5"
                          />
                          <div className="flex justify-end gap-1.5">
                            <button onClick={() => setReviewPasteOpenId(null)} className="text-[11px] font-bold text-neutral-400 hover:text-black px-2">
                              취소
                            </button>
                            <button
                              onClick={() => savePastedReview(u.id)}
                              disabled={saving || !reviewPasteText.trim()}
                              className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                            >
                              {saving ? '저장 중...' : '붙여넣기 저장'}
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <button
                          onClick={() => copyReviewPrompt(u)}
                          disabled={reviewCopyingId === u.id}
                          className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
                        >
                          {reviewCopyingId === u.id ? '준비 중...' : reviewCopiedId === u.id ? '✅ 복사됨!' : '💬 구독으로 검토하기'}
                        </button>
                        <button
                          onClick={() => reviewUnit(u)}
                          disabled={reviewingId === u.id}
                          className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
                        >
                          {reviewingId === u.id ? '검토 중...' : u.review ? '🔍 다시 검토받기' : '🔍 AI 검토받기'}
                        </button>
                        <button
                          onClick={() => setUnitStatus(u.id, 'approved')}
                          className={`text-[11px] font-black px-3 py-1.5 rounded-lg border ${
                            u.status === 'approved' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-neutral-200 hover:border-emerald-400 text-emerald-600'
                          }`}
                        >
                          ✅ 승인
                        </button>
                        <button
                          onClick={() => setUnitStatus(u.id, 'rejected')}
                          className={`text-[11px] font-black px-3 py-1.5 rounded-lg border ${
                            u.status === 'rejected' ? 'bg-red-500 text-white border-red-500' : 'bg-white border-neutral-200 hover:border-red-400 text-red-500'
                          }`}
                        >
                          ❌ 반려
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 1단계: 소재 추천 — "7번 대본 작성" 탭(hideMaterials)에서는 숨김. 소재 선정은 "5번" 탭의 몫. */}
      {!hideMaterials && (
      <div className="bg-white border border-neutral-100 rounded-lg p-3 mb-2">
        <div className="text-[11px] font-black text-neutral-500 mb-2">1️⃣ 소재 추천</div>
        <GenerateButtons stage="materials" />
        <PasteBox stage="materials" />
        {draft.materials && draft.materials.length > 0 ? (
          <div className="space-y-1 mb-2">
            {draft.materials.map((m, idx) =>
              editingMaterialIdx === idx ? (
                <div key={idx} className="flex items-start gap-1.5 bg-white border border-blue-200 rounded-lg px-2.5 py-2">
                  <textarea
                    value={editingMaterialText}
                    onChange={(e) => setEditingMaterialText(e.target.value)}
                    rows={2}
                    className="flex-1 text-[11px] leading-relaxed border border-neutral-200 rounded-lg px-2 py-1"
                    autoFocus
                  />
                  <div className="flex flex-col gap-1 shrink-0">
                    <button onClick={() => saveEditedMaterial(idx)} className="text-[10px] font-black text-emerald-600 hover:underline">
                      저장
                    </button>
                    <button onClick={() => setEditingMaterialIdx(null)} className="text-[10px] font-bold text-neutral-400 hover:text-black">
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  key={idx}
                  className={`flex items-start gap-2 text-[11px] rounded-lg px-2.5 py-2 border ${
                    draft.selectedMaterial === m ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-neutral-100 hover:border-neutral-300'
                  }`}
                >
                  <label className="flex items-start gap-2 flex-1 min-w-0 cursor-pointer">
                    <input type="radio" checked={draft.selectedMaterial === m} onChange={() => selectMaterial(m)} className="mt-0.5 shrink-0" />
                    <span className="leading-relaxed">{m}</span>
                  </label>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => {
                        setEditingMaterialIdx(idx);
                        setEditingMaterialText(m);
                      }}
                      className="text-[10px] font-bold text-neutral-400 hover:text-black"
                    >
                      수정
                    </button>
                    <button onClick={() => deleteMaterial(idx)} className="text-[10px] font-black text-neutral-300 hover:text-red-500">
                      ✕
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        ) : (
          <p className="text-[11px] text-neutral-300 mb-2">아직 등록된 소재가 없어요.</p>
        )}
        <div className="flex gap-1.5">
          <input
            type="text"
            value={newMaterialText}
            onChange={(e) => setNewMaterialText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addMaterial();
            }}
            placeholder="아이디어 직접 추가 — 나중에 적용할 소재를 미리 등록해두세요"
            className="flex-1 text-[11px] border border-neutral-200 rounded-lg px-2.5 py-1.5"
          />
          <button
            onClick={addMaterial}
            disabled={!newMaterialText.trim()}
            className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
          >
            + 추가
          </button>
        </div>
      </div>
      )}
      {hideMaterials && draft.selectedMaterial && (
        <div className="bg-white border border-neutral-100 rounded-lg p-3 mb-2">
          <p className="text-[10px] font-black text-neutral-400 mb-1">선택된 소재 (5번 탭에서 선정됨)</p>
          <p className="text-[11px] text-neutral-600 leading-relaxed">{draft.selectedMaterial}</p>
        </div>
      )}
      {hideMaterials && !draft.selectedMaterial && (
        <p className="text-[11px] text-neutral-400 mb-2">아직 선택된 소재가 없어요 — 먼저 &quot;5번 소재 선정&quot; 탭에서 소재를 고르세요.</p>
      )}

      {/* 2단계: 제목 추천 — 소재를 고른 다음에만 진행 */}
      {draft.selectedMaterial && (
        <div className="bg-white border border-neutral-100 rounded-lg p-3 mb-2">
          <div className="text-[11px] font-black text-neutral-500 mb-1">2️⃣ 제목 추천</div>
          <p className="text-[10px] text-neutral-400 mb-2">선택한 소재: {draft.selectedMaterial}</p>
          <GenerateButtons stage="titles" />
          <PasteBox stage="titles" />
          {draft.titles && draft.titles.length > 0 ? (
            <div className="space-y-1">
              {draft.titles.map((t, idx) => (
                <label
                  key={idx}
                  className={`flex items-start gap-2 text-[11px] rounded-lg px-2.5 py-2 cursor-pointer border ${
                    draft.selectedTitle === t ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-neutral-100 hover:border-neutral-300'
                  }`}
                >
                  <input type="radio" checked={draft.selectedTitle === t} onChange={() => selectTitle(t)} className="mt-0.5" />
                  <span className="leading-relaxed font-bold">{t}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-neutral-300">아직 추천받은 제목이 없어요.</p>
          )}
        </div>
      )}

      {/* 3단계: 대본 — 제목을 고른 다음에만 진행 */}
      {draft.selectedTitle && (
        <div className="bg-white border border-neutral-100 rounded-lg p-3">
          <div className="text-[11px] font-black text-neutral-500 mb-1">3️⃣ 대본</div>
          <p className="text-[10px] text-neutral-400 mb-2">선택한 제목: {draft.selectedTitle}</p>
          <GenerateButtons stage="script" />
          <PasteBox stage="script" />
          <textarea
            value={scriptDraftText}
            onChange={(e) => setScriptDraftText(e.target.value)}
            rows={8}
            placeholder="위 버튼으로 대본을 만들거나 직접 작성하세요"
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono leading-relaxed mb-1.5"
          />
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-neutral-300">{scriptDraftText.length.toLocaleString()}자</span>
            <button
              onClick={saveScript}
              disabled={saving}
              className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
            >
              {saving ? '저장 중...' : '대본 저장'}
            </button>
          </div>

          {/* 3-1단계: 제미나이와 비교해서 사실확인 (제목도 대본만큼 엉망일 수 있어서 같이 확인) */}
          {scriptDraftText.trim() && (
            <div className="bg-neutral-50 border border-neutral-100 rounded-lg p-2 mb-1.5">
              <p className="text-[10px] font-black text-neutral-500 mb-1.5">🔍 제미나이와 비교해서 사실확인 (선택)</p>
              <div className="flex gap-1.5 mb-2">
                <button
                  onClick={copyComparePrompt}
                  disabled={compareCopying}
                  className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
                >
                  {compareCopying ? '준비 중...' : compareCopied ? '✅ 복사됨!' : '💬 구독으로 비교하기'}
                </button>
                <button
                  onClick={runCompare}
                  disabled={compareRunning}
                  className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                >
                  {compareRunning ? '비교 중...' : '✨ 자동으로 비교하기'}
                </button>
              </div>
              {comparePasteOpen && (
                <div className="mb-2">
                  <textarea
                    value={comparePasteText}
                    onChange={(e) => setComparePasteText(e.target.value)}
                    rows={6}
                    placeholder="구독 채팅 답변을 여기에 붙여넣으세요"
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono leading-relaxed mb-1.5"
                  />
                  <div className="flex justify-end gap-1.5">
                    <button onClick={() => setComparePasteOpen(false)} className="text-[11px] font-bold text-neutral-400 hover:text-black px-2">
                      취소
                    </button>
                    <button
                      onClick={saveComparePaste}
                      disabled={!comparePasteText.trim()}
                      className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                    >
                      결과 확인
                    </button>
                  </div>
                </div>
              )}
              {compareResult && (
                <div className="space-y-2">
                  <div className="bg-white border border-neutral-200 rounded-lg p-2">
                    <p className="text-[10px] font-black text-neutral-400 mb-1">사실확인 결과</p>
                    <p className="text-xs text-neutral-600 whitespace-pre-wrap leading-relaxed">{compareResult.factCheck || '(내용 없음)'}</p>
                  </div>
                  {(compareResult.rewriteTitle || compareResult.rewriteScript) && (
                    <div className="bg-white border border-neutral-200 rounded-lg p-2">
                      <p className="text-[10px] font-black text-neutral-400 mb-1">제미나이가 다시 쓴 버전</p>
                      {compareResult.rewriteTitle && <p className="text-xs font-bold text-neutral-700 mb-1">{compareResult.rewriteTitle}</p>}
                      {compareResult.rewriteScript && <p className="text-xs text-neutral-600 whitespace-pre-wrap leading-relaxed">{compareResult.rewriteScript}</p>}
                    </div>
                  )}
                  <p className="text-[10px] text-neutral-400">
                    둘 중 하나를 고르는 게 아니라, 두 버전의 장점을 합쳐서 업그레이드해요.
                  </p>
                  <div className="flex justify-end gap-1.5">
                    <button
                      onClick={keepOriginalAfterCompare}
                      disabled={saving}
                      className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
                    >
                      원본 유지
                    </button>
                    <button
                      onClick={copyUpgradePrompt}
                      disabled={upgradeCopying}
                      className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
                    >
                      {upgradeCopying ? '준비 중...' : upgradeCopied ? '✅ 복사됨!' : '💬 구독으로 업그레이드'}
                    </button>
                    <button
                      onClick={runUpgrade}
                      disabled={upgrading}
                      className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-40"
                    >
                      {upgrading ? '업그레이드 중...' : '🔀 자동으로 업그레이드'}
                    </button>
                  </div>
                  {upgradePasteOpen && (
                    <div>
                      <textarea
                        value={upgradePasteText}
                        onChange={(e) => setUpgradePasteText(e.target.value)}
                        rows={6}
                        placeholder="구독 채팅 답변(Title:/Script:)을 여기에 붙여넣으세요"
                        className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono leading-relaxed mb-1.5"
                      />
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => setUpgradePasteOpen(false)} className="text-[11px] font-bold text-neutral-400 hover:text-black px-2">
                          취소
                        </button>
                        <button
                          onClick={saveUpgradePaste}
                          disabled={saving || !upgradePasteText.trim()}
                          className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                        >
                          붙여넣기 적용
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 3-2단계: 한국어가 확정된 다음 영어/일본어 */}
          {scriptDraftText.trim() && (
            <div className="bg-neutral-50 border border-neutral-100 rounded-lg p-2 mb-1.5">
              <p className="text-[10px] font-black text-neutral-500 mb-1.5">🌐 영어/일본어 대본 생성</p>
              <div className="flex gap-1.5 mb-2">
                <button
                  onClick={() => copyPrompt('translate')}
                  disabled={copying === 'translate'}
                  className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
                >
                  {copying === 'translate' ? '준비 중...' : copied === 'translate' ? '✅ 복사됨!' : '💬 구독으로 번역하기'}
                </button>
                <button
                  onClick={() => generate('translate')}
                  disabled={generating === 'translate'}
                  className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                >
                  {generating === 'translate' ? '만드는 중...' : '✨ Gemini Pro로 번역하기'}
                </button>
              </div>
              <PasteBox stage="translate" />
              {(draft.scriptEn || draft.scriptJa) && (
                <div className="space-y-2">
                  <p className="text-[10px] text-neutral-400">
                    번역은 그대로 옮기지 않고 현지화 각색이에요 — 완성 콘텐츠로 저장하면 이 버전도 같이 저장돼요.
                  </p>
                  {draft.scriptEn && (
                    <div>
                      <p className="text-[10px] font-black text-neutral-400 mb-0.5">🇺🇸 {draft.titleEn}</p>
                      <p className="text-xs text-neutral-600 leading-relaxed whitespace-pre-wrap">{draft.scriptEn}</p>
                    </div>
                  )}
                  {draft.scriptJa && (
                    <div className="pt-2 border-t border-neutral-100">
                      <p className="text-[10px] font-black text-neutral-400 mb-0.5">🇯🇵 {draft.titleJa}</p>
                      <p className="text-xs text-neutral-600 leading-relaxed whitespace-pre-wrap">{draft.scriptJa}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={finalizeUnit}
              disabled={saving || !scriptDraftText.trim()}
              className="bg-black text-white text-[11px] font-black px-4 py-2 rounded-lg disabled:opacity-40"
              title="완성 목록에 저장하고 다음 소재로 넘어가기"
            >
              ✅ 완성 콘텐츠로 저장 → 다음 소재
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 6번(이미지/영상 생성) 단계 패널 — 완성된 콘텐츠 목록에서 이름을 클릭하면 펼쳐지면서
// 그 콘텐츠의 장면별 CLEAN/INFO/영상 프롬프트가 타임라인 순서로 나온다. 데이터 자체는
// 5번(대본 작성)의 콘텐츠 유닛(ContentUnit.scenePrompts)에 저장되지만, 실제로 이미지/영상을
// 만들 때 찾는 곳은 6번이라서 여기서도 똑같이 보여주고 편집도 여기서 끝낼 수 있게 한다.
function Step6Panel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const units = site.script_draft?.units || [];
  const [openUnitId, setOpenUnitId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(id: string, scenePrompts: string) {
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, units: units.map((u) => (u.id === id ? { ...u, scenePrompts } : u)) }),
      });
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  if (units.length === 0) {
    return (
      <div className="border-t border-black/5 pt-3">
        <p className="text-xs text-neutral-300">아직 5번(대본 작성)에서 완성된 콘텐츠가 없어요 — 먼저 대본을 완성해주세요.</p>
      </div>
    );
  }

  return (
    <div className="border-t border-black/5 pt-3">
      <div className="text-xs font-black text-neutral-500 mb-2">🎬 콘텐츠별 이미지/영상 프롬프트</div>
      <div className="space-y-1.5">
        {units.map((u) => {
          const scenes = u.scenePrompts ? parseSceneBlocks(u.scenePrompts) : [];
          return (
            <div key={u.id} className="bg-white border border-neutral-100 rounded-lg overflow-hidden">
              <button
                onClick={() => setOpenUnitId((cur) => (cur === u.id ? null : u.id))}
                className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer"
              >
                <span className={`shrink-0 transition-transform text-neutral-300 ${openUnitId === u.id ? 'rotate-90' : ''}`}>▶</span>
                {u.category === 'disaster' && <span className="shrink-0 text-[10px]">🚨</span>}
                <span className="flex-1 min-w-0 truncate text-[11px] font-bold">{u.title}</span>
                {u.scenePrompts ? (
                  <span className="shrink-0 text-[10px] font-black text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5">
                    {scenes.length > 0 ? `${scenes.length}개 장면` : '있음'}
                  </span>
                ) : (
                  <span className="shrink-0 text-[10px] font-black text-neutral-300 bg-neutral-50 rounded-full px-2 py-0.5">없음</span>
                )}
              </button>
              {openUnitId === u.id && (
                <div className="px-3 pb-3 pt-1 border-t border-neutral-50">
                  <p className="text-[10px] text-neutral-400 mb-1">소재: {u.material}</p>
                  <SceneEditorList scenePrompts={u.scenePrompts || ''} saving={saving} onSave={(text) => save(u.id, text)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type LabeledItem = { label: string; url: string };
type LabeledField = 'narrationUrls' | 'subtitleUrls';

// 2026-09-01 이전엔 narrationUrls가 문자열 배열이었다 — 이미 저장된 예전 데이터를 위해
// 문자열이 그대로 오면 라벨 없는 항목으로 취급한다.
function normalizeLabeledItems(raw: unknown): LabeledItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => (typeof item === 'string' ? { label: '', url: item } : (item as LabeledItem)));
}

// 8번(나레이션)·9번(자막) 공용 — 6번(Step6Panel)과 같은 콘텐츠별 리스트 구조를 쓰되, 씬 단위가
// 아니라 유닛 하나에 링크/파일을 통째로 붙인다. 링크 붙여넣기와 파일 업로드(uploadSceneMedia
// 재사용) 둘 다 지원, 라벨(예: "원본"/"1.3배속", "SRT"/"수정본")로 여러 후보를 구분한다.
function LabeledLinksPanel({
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

function NarrationPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
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

function SubtitlePanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
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

function statusTone(status: string): { bg: string; border: string; text: string; label: string } {
  const s = status || '';
  if (/⚠️|막힘|막히는/.test(s)) return { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-600', label: '막힘' };
  if (/미착수/.test(s)) return { bg: 'bg-neutral-50', border: 'border-neutral-200', text: 'text-neutral-400', label: '미착수' };
  if (/진행\s*중|상시/.test(s)) return { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-600', label: '진행 중' };
  if (/검증|완료|확인|가능|결정됨/.test(s)) return { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-600', label: '완료' };
  if (!s.trim()) return { bg: 'bg-neutral-50', border: 'border-neutral-200', text: 'text-neutral-300', label: '-' };
  return { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-600', label: status };
}

function FlowChart({
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
  if (steps.length === 0) return null;
  const active = steps[Math.min(selected, steps.length - 1)];
  const activeTone = statusTone(active.status);
  const link = stepLink(active);

  return (
    <div className="mb-6 bg-white border border-neutral-200 rounded-xl p-5">
      <div className="text-[11px] font-black text-neutral-400 mb-4">🔀 플로우차트 미리보기 — 단계를 클릭하면 오른쪽에 상세가 떠요</div>
      <div className="flex flex-col gap-5">
        <div className="w-full flex items-center overflow-x-auto pb-1">
          {steps.map((s, i) => {
            const tone = statusTone(s.status);
            const isSelected = i === selected;
            return (
              <div key={i} className="flex items-center shrink-0">
                <button
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
          {active.desc && <p className="text-sm text-neutral-600 leading-relaxed mb-3">{active.desc}</p>}
          {active.status && <p className="text-xs text-neutral-500 leading-relaxed border-t border-black/5 pt-3 mb-3">{active.status}</p>}
          {isChannelStep(active) && <ChannelPanel siteName={siteName} />}
          {isMaterialStep(active) && <MaterialPanel siteName={siteName} />}
          {isTranscriptStep(active) && <TranscriptPanel siteName={siteName} />}
          {isAnalysisStep(active) && <AnalysisPanel site={site} onRefresh={onRefreshSite} />}
          {isMaterialSelectionStep(active) && (
            <Step5Panel
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
          {isScriptStep(active) && <Step5Panel site={site} onRefresh={onRefreshSite} hideMaterials />}
          {isImageVideoStep(active) && <Step6Panel site={site} onRefresh={onRefreshSite} />}
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

export default function WorkflowPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-neutral-50 p-10 text-sm text-neutral-400">불러오는 중...</div>}>
      <WorkflowPageInner />
    </Suspense>
  );
}

function WorkflowPageInner() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [site, setSite] = useState<Site | null>(null);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  // 새로고침해도 보던 단계로 돌아오게 선택된 단계를 URL(?step=N, 1-based)에 저장해둔다.
  const stepParam = Number(searchParams.get('step'));
  const selectedStep = Number.isFinite(stepParam) && stepParam > 0 ? stepParam - 1 : 0;
  function selectStep(i: number) {
    router.replace(`/workflow/${id}?step=${i + 1}`, { scroll: false });
  }

  function loadSite() {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => {
        const found = (d.sites || []).find((s: Site) => s.id === id);
        setSite(found || null);
        setContent(found?.workflow_content || '');
      });
  }

  useEffect(() => {
    loadSite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const steps = useMemo(() => parseSteps(content), [content]);

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/sites/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow_content: content }),
      });
      setSavedAt(new Date().toLocaleTimeString('ko-KR'));
    } finally {
      setSaving(false);
    }
  }

  function insertTemplate() {
    if (content.trim() && !confirm('지금 내용을 템플릿으로 덮어쓸까요?')) return;
    setContent(TEMPLATE.replace('{{프로젝트명}}', site?.name || '').replace(/\{\{YYYY-MM-DD\}\}/g, new Date().toISOString().slice(0, 10)));
    setShowEditor(true);
  }

  if (!site) return <div className="min-h-screen bg-neutral-50 p-10 text-sm text-neutral-400">불러오는 중...</div>;

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <Link href="/pipelines" className="text-xs text-neutral-400 font-bold hover:text-black">
          ← 파이프라인
        </Link>
        <div className="flex items-center justify-between mt-1 mb-2">
          <h1 className="text-2xl font-black">🔧 {site.name} 워크플로우</h1>
          <div className="flex gap-2">
            <button onClick={insertTemplate} className="text-xs font-black px-4 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white">
              📐 템플릿 채우기
            </button>
            <button
              onClick={() => setShowEditor((v) => !v)}
              className="text-xs font-black px-4 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white"
            >
              {showEditor ? '✕ 편집 닫기' : '✏️ 표 편집하기'}
            </button>
            <button onClick={save} disabled={saving} className="bg-black text-white text-xs font-black px-5 py-2 rounded-lg hover:bg-neutral-800 disabled:opacity-40">
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
        <p className="text-xs text-neutral-400 mb-4">
          계획서와는 별개로, 이 파이프라인이 "어떤 순서로 어떤 도구를 쓰는지"만 적어두는 곳이에요. 표를 채우면 아래에 순서도로 자동 표시돼요.
          {savedAt && <span className="text-green-600 font-bold"> · {savedAt} 저장됨</span>}
        </p>

        <FlowChart steps={steps} site={site} selected={selectedStep} onSelect={selectStep} onRefreshSite={loadSite} />

        {(showEditor || steps.length === 0) && (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={28}
            className="w-full border border-neutral-200 rounded-lg p-4 text-xs font-mono leading-relaxed"
            placeholder="아직 워크플로우가 없어요 — [📐 템플릿 채우기]로 시작해보세요."
          />
        )}
      </div>
    </div>
  );
}