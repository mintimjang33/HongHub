'use client';

import { useState } from 'react';
import type { Site } from '../types';
import { parseSceneBlocks, normalizeLabeledItems } from '../utils';
import { CopyButton, SceneEditorList } from './shared';

// 14번(구 16-17번, 씬별 이미지 프롬프트 작성·생성) 단계 패널 — 완성된 콘텐츠 목록에서 이름을
// 클릭하면 펼쳐지면서 그 콘텐츠의 장면별 CLEAN/INFO/영상 프롬프트가 타임라인 순서로 나온다.
// 데이터 자체는 11번(대본 작성)의 콘텐츠 유닛(ContentUnit.scenePrompts)에 저장되지만, 실제로
// 이미지/영상을 만들 때 찾는 곳은 여기라서 이 패널에서도 똑같이 보여주고 편집도 여기서 끝낼 수 있게 한다.
// (코드상 이름은 구버전 "Step6Panel" — 파이프라인이 5~20번 구조로 재편되며 16·17번, 이후 14번으로 옮겨졌다.)
//
// 2026-09-09 구간 분할 방식 전면 수정(2차):
// 6) 11번과의 대칭성을 다시 점검하니(사용자 지적: "앞단계에서 한 방식을 그대로 따라 한거
//    맞아???"), 11번은 진짜 마지막 응답에서만 [글자수: 전체 TTS 합계 N자]를 적어 "정말 끝까지
//    다 됐는지" 검증 가능하게 하는데, 14번엔 그 완료 검증 표시가 빠져 있었다. 마지막 구간
//    응답에 [최종: 총 장면 N개, 마지막 endSec X초 — SRT 끝까지 도달함]을 적게 하는 문장을
//    추가해서 11번과 동일하게 "완료 여부를 스스로 보고"하도록 맞췄다.
// 5) 1차로는 "구간(시작~끝) 직접 입력" UI를 만들어서, 사용자가 시분초를 직접 계산해 넣어야
//    새 프롬프트를 복사할 수 있게 했다. 그런데 이건 11번(대본 작성)이 이미 검증해둔 훨씬 간단한
//    방식 — 프롬프트 안에 "한 번에 다 쓰지 말고 일정 분량만 쓰고 멈춘 뒤, 사용자가 '계속'이라고
//    답하면 이어서 쓰라"는 자기 분할 지시를 넣고, 제미나이 채팅 안에서 그냥 "계속"만 치면 되는
//    방식 — 을 두고 굳이 사람이 시간을 계산해 입력하게 만든 불필요하게 번거로운 구현이었다
//    (사용자 지적: "앞에 어떻게 이어서 받았는지 안나와있었어?? 이렇게 병신같이 하래?" — 11번의
//    "계속" 패턴을 이미 알고 있는데 왜 14번만 수동 시간 입력을 시키냐는 지적). 구간 입력 UI를
//    걷어내고, 11번과 동일한 "한 구간 쓰고 멈춤 → '계속' → 이어서" 자기분할 지시로 교체했다.
// 4) 코카콜라 유닛(13분19초 SRT)으로 실기 테스트했더니, 전체 구간을 한 번에 요청하자 제미나이가
//    스토리 전체를 6개 장면·42초로 요약해버렸다(SRT 타임코드를 실제로 따라가지 않고 자기가 아는
//    줄거리를 압축한 것) — 그래서 애초에 구간 분할이 필요하다는 게 확인됐다.
//
// 2026-09-09 수정 이력:
// 1) 예전 프롬프트는 "13번에서 뽑은 나레이션을 들으며 챕터별/문단별 시작~끝 초를 직접 채워
//    넣으세요"처럼 사람이 귀로 듣고 타임코드를 수기로 채우는 걸 전제했다. 지금은 13번에서
//    faster-whisper(또는 ElevenLabs with-timestamps)로 실측 타임코드가 담긴 자막(SRT) 파일이
//    이미 만들어져 있으므로 그 링크를 전달하는 방식으로 바꿨다(사용자 지적: "홍허브 14단계
//    복사버튼에 지침이 안 들어가 있어?" — 코카콜라 한 유닛에만 쓸 프롬프트를 채팅으로 즉석에서
//    만들어줬다가, 66개 유닛 전부가 재사용할 앱 코드 자체를 안 고쳤다는 지적).
// 2) <a download> 버튼으로 자막 파일을 따로 받게 했으나, Supabase Storage 공개 URL이
//    Content-Disposition 헤더 없이 text/plain으로만 응답해서(cross-origin이라 download 속성이
//    브라우저에서 무시됨) 클릭하면 다운로드 대신 새 탭에 텍스트가 그냥 열려버렸다. 별도 다운로드
//    버튼 대신 자막 URL을 프롬프트 텍스트 안에 직접 적어 넣는 것으로 전환.
// 3) 대본 전문(u.script)을 프롬프트에 통째로 박아넣고 있었는데, 사용자가 "대본 링크와 tts 링크를
//    전달하면 제미나이가 못보나?"라고 지적 — 12번(캐릭터) 프롬프트가 이미 `/share/[id]` 공개
//    페이지 링크를 제미나이가 직접 열어 대본을 읽게 하는 방식으로 검증돼 있었다. 대본도 같은
//    패턴으로 통일해서, 프롬프트엔 텍스트 대신 공유 링크+자막 링크만 넣는다(12번 패턴 재사용).
export function ImageVideoPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const units = site.script_draft?.units || [];
  const [openUnitId, setOpenUnitId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(id: string, scenePrompts: string) {
    setSaving(true);
    try {
      await fetch('/api/script-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, unitPatch: { id, fields: { scenePrompts } } }),
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
          const subtitleItems = normalizeLabeledItems(u.subtitleUrls);
          const subtitleUrl = subtitleItems[0]?.url || '';
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

                  {subtitleItems.length === 0 && (
                    <p className="text-[10px] text-red-500 font-bold mb-2">아직 13번에 자막이 없습니다 — 먼저 13번에서 자막을 등록해주세요. (자막 링크가 아래 프롬프트에 자동으로 포함됩니다)</p>
                  )}

                  <p className="text-[10px] text-neutral-400 mb-2">
                    대본이 길면(10분 이상) 제미나이가 한 응답에 다 끝내려다 스토리를 요약해버릴 수 있습니다 — 아래 프롬프트는 한 구간만 만들고 멈추도록 지시해뒀습니다. 응답 끝에 "계속"이라고 답하면 이어서 다음 구간을 만듭니다(11번 대본 작성과 동일한 방식). 여러 응답으로 나눠 받은 JSON 배열들은 순서대로 이어붙여서 등록하세요.
                  </p>

                  <div className="inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-full border border-amber-200 bg-amber-50 mb-2">
                    <span className="text-amber-700">🔍 제미나이 프롬프트 (대본 공유링크 + 13번 자막 링크 포함됨)</span>
                    <CopyButton
                      text={`[역할] 너는 우리 채널 영상의 편집 감독(edit director)이다. 아래 두 링크(대본, 자막 타임코드)를 열어 내용을 확인하고, 이를 기반으로 초 단위 스토리보드와 각 장면의 이미지/전환 프롬프트를 설계한다.

[대본 링크] https://honghub.vercel.app/share/${site.id}
이 링크를 열어 "콘텐츠 유닛" 섹션에서 제목이 정확히 "${u.title}"인 항목을 찾고, 그 대본(화면/음향 연출 지시 포함)을 읽어라.

[자막(SRT) 링크] ${subtitleUrl || '(아직 13번에 자막이 등록되지 않았습니다 — 먼저 13번에서 자막을 등록하세요)'}
이 링크를 열어서 내용을 확인하고, 거기 담긴 타임코드를 아래 작업 지시의 기준으로 삼아라.

[중요 — 타임코드 처리 원칙] 위 SRT는 실제 나레이션 음성을 정밀 전사한 것으로, 각 줄의 시작~끝 초는 이미 확정된 실측값이다. 이 시간 값을 새로 추측하거나 반올림하지 말고, 반드시 SRT의 타임코드를 그대로 기준 삼아 장면 경계를 정한다 — 여러 줄을 하나의 장면으로 묶을 땐 그 줄들의 시작 초~마지막 줄의 끝 초를 그대로 장면의 startSec/endSec으로 쓴다. 스토리 전체를 몇 개의 요약 장면으로 압축하지 않는다 — 처리 대상 구간에 포함된 모든 문장을 실제 길이 그대로 촘촘히(6~7초 단위로) 장면화한다.

[분량 처리 방식 — 한 번에 전체를 다 만들지 말고 반드시 아래처럼 나눠서 진행할 것]
SRT 전체 분량을 한 응답에 다 처리하려 하지 마라 — 대본이 길면 스토리를 요약해서 압축해버리는 실패가 자주 발생한다. 대신 SRT 맨 처음부터 시작해서, 장면 25~35개 안팎(대략 3~4분 분량)을 만들었으면 그 지점에서 멈추고, 그때까지 만든 장면들만 아래 [출력 형식]의 JSON 배열로 출력한 뒤, 그 JSON 배열 바로 다음 줄에 정확히 이렇게만 적어라: (다음 구간 준비됨 — "계속"이라고 답하면 이어서 만듭니다)
사용자가 "계속"이라고 답하면, 방금 만든 마지막 장면의 endSec 바로 다음 시점부터 이어서 — 앞서 만든 장면들을 요약하거나 다시 만들지 말고 — 다음 3~4분 분량만 새로 만들어 같은 형식(JSON 배열 + 안내문)으로 출력해라. 이 과정을 SRT의 마지막 줄(자막 끝)까지 반복한다.
SRT 마지막 줄까지 실제로 다 만든 진짜 마지막 응답에서는, 이어가기 안내문 대신 JSON 배열 바로 다음 줄에 정확히 이렇게 완료 표시를 적어라(N·X는 지금까지 만든 전체 누적 기준 실제 값으로): [최종: 총 장면 N개, 마지막 장면 endSec X초 — SRT 마지막 줄(자막 끝)까지 도달함]

[작업 지시]
1. SRT의 타임코드 줄들을 순서대로 묶어서, 하나의 장면이 대략 6~7초가 되도록 나눈다. 문장이 끊기는 자연스러운 호흡 지점(SRT 줄 경계)에서만 나누고, 문장 중간을 억지로 자르지 않는다.
2. 씬 대부분은 정지 이미지 + 줌/패닝/컷 전환으로 처리한다(이미지는 0크레딧). 대본에 [영상화] 표시가 붙은 지점(콜드오픈, 챕터 전환부 등 후킹이 강한 순간)만 실제 짧은 영상 클립이 필요한 장면으로 표시한다(needsVideoClip: true) — 전체 장면의 15~20% 이내로 제한한다.
3. transitionPrompt에는 카메라 움직임(줌인/줌아웃/패닝/틸트), 정지 이미지 간 전환 방식, needsVideoClip이 true인 경우엔 그 장면에서 실제로 어떤 동작이 일어나는지(짧은 모션)까지 영어로 구체적으로 쓴다.

[이미지 프롬프트(imagePrompt) 작성 규칙 — 반드시 지킬 것, 전부 영어로]
- 진행자가 등장하는 장면은 항상 "젠틀맨 루즈"(검은 톱햇, 금테 외알렌즈, 검은 연미복+금색 안감 망토, 능글맞고 자신감 있는 쇼맨, 반전 순간 망토를 젖히는 제스처)로 묘사한다. 레퍼런스 이미지: https://iwxpjnwktxpscoktfpyl.supabase.co/storage/v1/object/public/honghub-files/character-refs/economics-gentleman-rouge.jpg
- 실존 인물의 동작이 필요한 장면은 얼굴을 그리지 않고 손 클로즈업으로만 표현한다.
- 이 소재의 상징 사물을 의인화한 배역이 등장할 수 있다 — 팔다리·눈·표정을 붙이되 사람 얼굴 캐릭터로 그리지 않는다.
- 이미지 안에 텍스트·캡션·라벨·제목을 절대 넣지 않는다 — 프롬프트 끝에 "IMPORTANT: absolutely NO text, no captions, no title, no labels anywhere in the image"를 반드시 포함한다.
- 재질/질감 지시는 반드시 "캐릭터 표면 자체의 재질"이라고 명시한다 — 배경은 별도로 "plain solid grey background" 등으로 명확히 지정한다.
- Korean webtoon vector illustration style, flat colors, clean line art로 통일한다.

[출력 형식 — 이번 구간에서 새로 만든 장면들만 담은 JSON 배열 하나. 앞뒤 설명·마크다운 코드펜스 없이 순수 JSON 배열만, 위 [분량 처리 방식]에서 지시한 이어가기 안내문/완료 표시는 배열 바깥 다음 줄에만.]
[
  {
    "id": "S01",
    "startSec": 0.0,
    "endSec": 9.0,
    "screenDescription": "한국어로 이 장면에서 무슨 일이 일어나는지 요약",
    "imagePrompt": "영어, Flow AI 이미지 생성용 완성된 프롬프트",
    "transitionPrompt": "영어, 카메라 움직임/전환 또는(needsVideoClip이 true일 때) 실제 동작 묘사",
    "needsVideoClip": false
  }
]

SRT에 없는 구간을 임의로 지어내지 마.`}
                    />
                  </div>
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
