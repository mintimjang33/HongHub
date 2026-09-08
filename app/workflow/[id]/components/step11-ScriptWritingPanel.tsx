'use client';

import { useScriptWizard } from '../scriptWizard/useScriptWizard';
import type { Site } from '../types';
import { extractTtsLines } from '../utils';
import { CopyButton } from './shared';

// 11번(대본 작성) 단계 패널 — 6번(콘텐츠 등록)에서 만든 유닛마다 대본을 작성한다. 완성된 콘텐츠
// 목록(검토·승인·PD 게이트)도 여기서 관리한다. useScriptWizard 훅으로 site.script_draft 상태를
// 5번(step05-MaterialSelectionPanel)과 공유한다(2026-09-08, 번호별로 파일을 찾기 쉽게 분리).
// 2026-09-08 삭제 — 예전엔 draft.selectedMaterial이 세팅돼 있으면 "선택된 소재"+"2️⃣ 제목 추천"+
// "3️⃣ 대본"이라는 옛날 위저드(소재→제목 생성→대본 생성→finalizeUnit)를 여기서 그렸다. 그런데
// 실제로 쓰는 흐름은 6번(ContentRegisterPanel)에서 제목을 직접 입력해 유닛을 바로 만드는
// 방식으로 바뀌었고, 6번의 addUnit()이 selectedMaterial을 안 지워서 이미 등록 끝난 소재가 이
// 죽은 위저드를 계속 되살리는 버그가 있었다(사용자 지적: "컨텐츠 안에 들어가 있어야 하는 내용이
// 왜 나와있어???"). 원인(6번의 상태 누수)은 step06-ContentRegisterPanel.tsx에서 고쳤고, 이
// 파일에서는 아무도 안 쓰는 옛날 위저드 UI 자체를 들어냈다 — 실제 작업은 전부 아래 "완성된
// 콘텐츠" 목록의 유닛 카드에서 한다.
export function ScriptWritingPanel({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const w = useScriptWizard(site, onRefresh);
  const { draft, units } = w;

  return (
    <div className="border-t border-black/5 pt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-black text-neutral-500">✍️ 대본 작성</span>
        <button onClick={w.resetAll} className="text-[11px] font-bold text-neutral-400 hover:text-red-500 px-2">
          🔄 처음부터
        </button>
      </div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[10px] font-black text-neutral-400">카테고리:</span>
        <button
          onClick={() => w.setCategory('trivia')}
          disabled={(draft.category || 'trivia') === 'trivia'}
          className={`text-[11px] font-black px-3 py-1 rounded-full border ${
            (draft.category || 'trivia') === 'trivia' ? 'bg-black text-white border-black' : 'bg-white text-neutral-500 border-neutral-200 hover:border-neutral-400'
          }`}
        >
          🔧 트리비아
        </button>
        <button
          onClick={() => w.setCategory('disaster')}
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
      {w.error && <p className="text-[11px] text-red-500 font-bold mb-2">{w.error}</p>}

      {units.length === 0 && (
        <p className="text-[11px] text-neutral-400 mb-2">아직 등록된 콘텐츠가 없어요 — 먼저 "6번 콘텐츠 등록"에서 콘텐츠를 등록하세요.</p>
      )}
      {units.length > 0 && (
        <div className="bg-emerald-50/40 border border-emerald-100 rounded-lg p-3 mb-2">
          <div className="text-[11px] font-black text-emerald-700 mb-2">✅ 완성된 콘텐츠 ({units.length}개)</div>
          <div className="space-y-1.5">
            {units.map((u) => {
              const pdTag =
                u.status === 'approved'
                  ? { label: 'PD 승인', cls: 'bg-emerald-100 text-emerald-700' }
                  : u.status === 'rejected'
                    ? { label: 'PD 반려', cls: 'bg-red-100 text-red-600' }
                    : { label: 'PD 확인 대기', cls: 'bg-neutral-100 text-neutral-500' };
              // 2026-09-04 추가 — "검토대기" 배지 하나로는 대본/사실확인/검수/PD확인 중 어디서
              // 막혀있는지 알 수 없다는 지적을 받고, 단계별로 끝났는지를 각각 보여주게 분리함.
              const stages = [
                { label: '대본', done: !!u.script },
                { label: '사실확인', done: !!u.factCheck },
                { label: '검수', done: u.review?.score !== undefined },
              ];
              return (
                <div key={u.id} className="bg-white border border-neutral-100 rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button onClick={() => w.setOpenUnitId((cur) => (cur === u.id ? null : u.id))} className="flex-1 min-w-0 text-left flex items-center gap-1.5">
                      <span className={`inline-block transition-transform text-neutral-300 ${w.openUnitId === u.id ? 'rotate-90' : ''}`}>▶</span>
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
                    <div className="shrink-0 flex items-center gap-1">
                      {stages.map((s) => (
                        <span
                          key={s.label}
                          title={s.done ? `${s.label} 완료` : `${s.label} 대기`}
                          className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${
                            s.done ? 'bg-blue-50 text-blue-600' : 'bg-neutral-100 text-neutral-300'
                          }`}
                        >
                          {s.done ? '✓' : '○'} {s.label}
                        </span>
                      ))}
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${pdTag.cls}`}>{pdTag.label}</span>
                    </div>
                    <button onClick={() => w.clearScript(u.id)} className="shrink-0 text-[11px] text-red-400 font-bold hover:text-red-600 px-1" title="대본만 삭제 (소재·자료조사·전략·훅·기획서는 유지)">
                      ✕
                    </button>
                  </div>
                  {w.openUnitId === u.id && (
                    <div className="px-3 pb-3 pt-1 border-t border-neutral-100 space-y-2">
                      {/* 2026-09-08 이동 — 이 카드에서 실제로 제일 먼저 눌러야 하는 버튼(대본 자체를
                          만드는 프롬프트)인데 예전엔 검토/승인 줄과 같이 맨 아래에 있어서 순서상
                          헷갈렸다(사용자 지적: "이 복사 버튼이 각 컨텐츠 가장 위에 있어야 하는데").
                          카드를 펼치자마자 바로 보이게 맨 위로 옮김. */}
                      <div className="inline-flex items-center gap-1.5 text-[11px] font-black px-2 py-1 rounded-lg border border-amber-200 bg-amber-50">
                        <span className="text-amber-700">🎬 제미나이 대본 프롬프트</span>
                        <CopyButton
                          text={`[역할] 너는 우리 채널(거시서사형 경제사)의 전속 대본 작가이자, 화면에 등장하는 진행자 캐릭터 "젠틀맨 루즈"(검은 톱햇, 금테 외알렌즈, 검은 연미복+금색 안감 망토, 능글맞고 자신감 있는 쇼맨) 본인이 되어 쓴다. 지식의 뒷골목을 산책하는 냉소적이고 연극적인 진행자로, 시청자에게 예의 바르지만 뼈를 때리는 질문을 던지고, 극적인 반전을 즐기는 도발적인 말투를 끝까지 유지한다. 정보를 나열하는 해설자가 아니라 위트 있고 능청스러운 이야기꾼이다 — 표준 다큐 내레이터 톤이면 실패다. 존댓말(합니다체)로 쓴다.

[톤앤매너]
1. 질문을 던지고 스스로 즉시 답하는 핑퐁 리듬은 양념이다 — 전체 영상 통틀어 2~3회 이내로 아껴 쓴다.
2. 문장 길이를 의도적으로 섞는다 — 비슷한 길이 문장이 3개 이상 연달아 오면 안 된다.
3. 같은 "사실 던지기" 상투구를 두 번 이상 쓰지 않는다.
4. 위트·아이러니·짧은 태도 표현을 적극 섞는다. 감정 없는 사실 나열 금지.
5. 문체는 담백한 구어체보다 밀도 있는 문어체 쪽 — 정제된 문학적 어휘를 활용해 완성도 있는 영상 에세이처럼 쓴다.

[핵심 스토리텔링 법칙]
1. 당사자 시점 몰입 — 3인칭 연표 나열 금지. 그 순간 인물이 뭘 몰랐는지, 무슨 선택 앞에 있었는지를 그 순간 안에서 그린다.
2. 결말의 구체적 전개는 도입부에서 미리 요약하지 않는다. 도착점의 규모(숫자)는 훅으로 던지되 "어떻게"는 답하지 않는다.
3. 오프닝은 추상적 통계보다 구체적 인물 시점 장면으로 연다.
4. 추상적 숫자는 반드시 일상적 비유로 번역한다.
5. 매 챕터 끝엔 다음 이야기로 넘어가는 떡밥을 남긴다.
6. 반전이 드러나는 순간마다 한 박자 쉬고, 그 직후 문장은 짧고 단호하게 끊는다.

[영화 연출 지침]
1. 역할은 "작가"가 아니라 "영화 연출가" — 카메라 구도·인물 동선·조명까지 지정한다.
2. 시각/청각 디테일: 시대적 질감, 조명의 변화, 흑백과 컬러의 교차 편집, 효과음(SFX)·배경음악(BGM)의 전환점을 아주 구체적이고 영화적으로 묘사한다.
3. 문장은 짧고 타격감 있게 끊는다. "상상해 보십시오", "놀랍게도 아닙니다" 같은 대화체·극적 침묵을 리듬 장치로 사용한다.
4. 대비(contrast)를 반복 배치해 반전을 극대화한다.

[영상 제작 방식 — 장면을 쓸 때부터 반드시 감안할 것]
비용 절감을 위해 전체 장면을 다 영상으로 만들지 않는다. 시청자의 시선을 붙잡아야 하는 맨 앞 [콜드오픈] 구간 몇 장면만 실제로 움직이는 영상 클립으로 만들고, 그 이후([인트로]부터 [아웃트로]까지) 나머지 장면은 전부 정지 이미지 한 장에 줌인/줌아웃·클로즈업·화면 이동(패닝) 같은 단순한 카메라 효과만 얹어서 쓴다. 그러니:
- [콜드오픈] 구간만 인물/사물이 실제로 움직이거나 반응하는 동작을 묘사해도 된다.
- 그 이후 모든 장면의 [화면/음향 연출]은 반드시 "정지된 한 장의 그림"만으로 완성되는 구도만 묘사해라 — 인물이 걷거나, 물체가 떨어지거나, 표정이 실시간으로 바뀌는 등 실제 움직임이 있어야만 성립하는 장면은 쓰지 마라. 대신 줌·클로즈업·패닝만으로도 강렬해 보이는 정적 구도(예: 극적인 조명 아래 놓인 사물, 인물의 결정적 표정을 한 컷으로 포착한 순간)로 묘사해라.

[출력 형식 — 라벨을 반드시 정확히 이 형태로 써라, 절대 바꾸지 마라]
이 라벨로 앱이 자동으로 나레이션만 뽑아내니(TTS 제작용) 형식을 반드시 지켜라.
- 장면이 바뀔 때마다 아래 두 줄을 한 세트로 번갈아 써라. 한 세트 안에 여러 문장이 있어도 된다.
[화면/음향 연출] 화면 연출·SFX·BGM 지시문을 한 줄에 다 적어라(예: 시대/장소, 카메라 구도, 조명, 효과음, 배경음악).
[TTS] 실제 나레이션 문장(시청자에게 들리는 대사만, 연출 지시 없이).
- 큰 구조 전환마다 반드시 아래 한글 라벨을 그 줄 단독으로 넣어라(영어 라벨 금지, "[COLD OPEN]" 같은 표기 쓰지 마라):
[콜드오픈]
[인트로]
[챕터 1: 소제목]
[챕터 2: 소제목]
(챕터는 내용에 맞게 필요한 만큼 번호를 늘려서 반복)
[아웃트로]
- 대본 본문만 답해라. 제목 후보는 요청하지 않는다(10번 기획서에서 이미 정해짐), 출처 목록도 요청하지 않는다(7번 자료조사에서 이미 확보됨) — 이 두 가지는 다시 만들지 마라. 대본 앞뒤에 부연설명·안내 문구도 붙이지 말고, 위 라벨로만 구성된 완성된 대본 그대로만 줘.

[루즈의 시그니처]
- 콜드오픈: 3초 만에 시선을 빼앗을 것 — 완전한 무음보다, 짧더라도 강렬한 첫 대사나 시각적 은유로 시작한다.
- 본편: 속도감 있는 스토리텔링.
- 아웃트로: 망토를 펄럭이며 시청자의 안목을 조롱하듯 묻는 떡밥 + 다음 에피소드 예고 + 구독 유도 한 줄.

[사실 검증] 사실관계가 불확실한 부분은 구글 검색으로 확인해서 반영해도 좋다. 원본 출처 문장을 그대로 베끼지 않는다 — 사실만 가져와 새 문장으로 재구성한다.

[분량] 전체 나레이션 기준 약 15분 분량으로 작성한다.

[참고 자료 — 반드시 먼저 읽고 시작할 것] 아래 링크를 열어보면 (1) 이 채널이 벤치마킹하는 실제 100만 조회수 이상 영상들의 대본 원문, (2) 우리 채널 계획서·워크플로우, (3) 캐릭터(젠틀맨 루즈) 설정과 레퍼런스 이미지, (4) 우리가 이전에 만든 대본들이 있습니다. 링크: https://honghub.vercel.app/share/${site.id}
벤치마크 대본들의 리듬·구조·훅 패턴(오프닝 방식, 챕터 전환, 클로징)을 참고하되, 문장을 그대로 베끼지 말고 완전히 새로 써라 — 참고는 구조와 페이스이지 문장이 아니다.

[젠틀맨 루즈 레퍼런스 이미지] https://iwxpjnwktxpscoktfpyl.supabase.co/storage/v1/object/public/honghub-files/character-refs/economics-gentleman-rouge.jpg

[이번 소재]
${u.material}

[자료조사 — 이미 확인된 사실, 있으면 반드시 이 사실들을 근거로 써라]
${u.factCheck || '(아직 없음 — 구글 검색으로 직접 조사해서 반영해도 좋음)'}

[선택된 전략 — 이 방향으로 써라]
${u.selectedStrategy || '(미확정)'}
${u.strategyReason ? `(이 전략을 고른 이유: ${u.strategyReason})` : ''}

[선택된 훅 — 콜드오픈/오프닝은 이 훅을 실제로 풀어서 써라]
${u.selectedHook || '(미확정)'}
${u.hookReason ? `(이 훅을 고른 이유: ${u.hookReason})` : ''}

[기획서 — 오프닝 초단위 구성·본문 리듬·댓글유도 위치·길이·위험요소, 이 지침대로 써라]
${u.planningDoc || '(미확정)'}`}
                        />
                      </div>
                      <p className="text-[10px] text-neutral-400">소재: {u.material}</p>
                      {u.category === 'disaster' && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-black text-neutral-400">분야:</span>
                          {['건축', '토목', '무기', '항공', '자연재해', '기타'].map((t) => (
                            <button
                              key={t}
                              onClick={() => w.setUnitTopic(u.id, u.topic === t ? '' : t)}
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                u.topic === t ? 'bg-black text-white border-black' : 'bg-white text-neutral-400 border-neutral-200 hover:border-neutral-400'
                              }`}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      )}
                      {u.titleCandidates && u.titleCandidates.filter((t) => t !== u.title).length > 0 && (
                        <div>
                          <p className="text-[10px] font-black text-neutral-400 mb-1">그때 같이 나온 다른 제목 후보 (클릭하면 교체)</p>
                          <div className="space-y-1">
                            {u.titleCandidates
                              .filter((t) => t !== u.title)
                              .map((t, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => w.swapUnitTitle(u.id, t)}
                                  className="block w-full text-left text-[11px] text-neutral-500 hover:text-black hover:bg-neutral-50 rounded px-1.5 py-1"
                                >
                                  {t}
                                </button>
                              ))}
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <p className="text-[10px] font-black text-neutral-400">🇰🇷 한국어 ({u.script.length}자)</p>
                          <div className="flex items-center gap-2">
                            {u.script && (
                              <>
                                <CopyButton text={u.script} label="전체 복사" />
                                {/* 2026-09-08 추가 — 13번(나레이션 TTS) 제작 시 화면 연출·SFX·BGM
                                    지시문 없이 실제 나레이션만 필요하다는 지적("tts 만들때 우린
                                    tts만 추출해야하지 않아?" / "tts만 복사하기도 필요한거 같은데").
                                    위 프롬프트가 [TTS] 라벨을 못박아뒀으니 그 줄만 뽑아서 복사한다. */}
                                <CopyButton text={extractTtsLines(u.script)} label="TTS만 복사" />
                              </>
                            )}
                            {w.editScriptId !== u.id && (
                              <button
                                onClick={() => {
                                  w.setEditScriptId(u.id);
                                  w.setEditScriptText(u.script);
                                }}
                                className="text-[10px] font-black text-neutral-400 hover:text-black"
                              >
                                ✏️ 직접 수정
                              </button>
                            )}
                          </div>
                        </div>
                        {w.editScriptId === u.id ? (
                          <div>
                            <textarea
                              value={w.editScriptText}
                              onChange={(e) => w.setEditScriptText(e.target.value)}
                              rows={16}
                              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs leading-relaxed font-mono mb-1.5"
                            />
                            <div className="flex justify-end gap-1.5">
                              <button onClick={() => w.setEditScriptId(null)} className="text-[11px] font-bold text-neutral-400 hover:text-black px-2">
                                취소
                              </button>
                              <button
                                onClick={() => w.saveScriptEdit(u.id)}
                                disabled={w.savingScriptEdit || !w.editScriptText.trim()}
                                className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                              >
                                {w.savingScriptEdit ? '저장 중...' : '저장'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-neutral-600 leading-relaxed whitespace-pre-wrap">{u.script}</p>
                        )}
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
                      {/* 씬/이미지·영상 프롬프트 편집 UI는 16-17번 전용 ImageVideoPanel에만 둔다 — 여기 중복으로 있던 블록을 제거함(2026-09-04, 사용자 지적). */}
                      {/* 자료조사(factCheck/sources) 편집 UI는 7번 자료조사 전용 ResearchPanel에만 둔다 — 여기 중복으로 있던 블록을 제거함(2026-09-03). */}

                      {/* 제미나이와 비교→업그레이드 — "교체"가 아니라 원본+제미나이 버전을 합쳐서 최종본을 만든다. */}
                      <div className="pt-2 border-t border-neutral-50 bg-neutral-50 rounded-lg p-2">
                        <p className="text-[10px] font-black text-neutral-500 mb-1.5">🔍 제미나이와 비교해서 사실확인 (선택)</p>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          <button
                            onClick={() => w.copyUnitComparePrompt(u)}
                            disabled={w.unitCompareCopyingId === u.id}
                            className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
                          >
                            {w.unitCompareCopyingId === u.id ? '준비 중...' : w.unitCompareCopiedId === u.id ? '✅ 복사됨!' : '💬 구독으로 비교하기'}
                          </button>
                          <button
                            onClick={() => w.runUnitCompare(u)}
                            disabled={w.unitCompareRunningId === u.id}
                            className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                          >
                            {w.unitCompareRunningId === u.id ? '비교 중...' : '✨ 자동으로 비교하기'}
                          </button>
                        </div>
                        {w.unitComparePasteOpenId === u.id && (
                          <div className="mb-2">
                            <textarea
                              value={w.unitComparePasteText}
                              onChange={(e) => w.setUnitComparePasteText(e.target.value)}
                              rows={6}
                              placeholder="구독 채팅 답변([FACT-CHECK]/[REWRITE]/[SOURCES])을 여기에 붙여넣으세요"
                              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono leading-relaxed mb-1.5"
                            />
                            <div className="flex justify-end gap-1.5">
                              <button onClick={() => w.saveUnitComparePaste(u.id)} disabled={!w.unitComparePasteText.trim()} className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40">
                                결과 확인
                              </button>
                            </div>
                          </div>
                        )}
                        {w.unitCompareResult && w.unitCompareResult.unitId === u.id && (
                          <div className="space-y-2">
                            <div className="bg-white border border-neutral-200 rounded-lg p-2">
                              <p className="text-[10px] font-black text-neutral-400 mb-1">사실확인 결과</p>
                              <p className="text-xs text-neutral-600 whitespace-pre-wrap leading-relaxed">{w.unitCompareResult.factCheck || '(내용 없음)'}</p>
                            </div>
                            {(w.unitCompareResult.rewriteTitle || w.unitCompareResult.rewriteScript) && (
                              <div className="bg-white border border-neutral-200 rounded-lg p-2">
                                <p className="text-[10px] font-black text-neutral-400 mb-1">제미나이가 다시 쓴 버전</p>
                                {w.unitCompareResult.rewriteTitle && <p className="text-xs font-bold text-neutral-700 mb-1">{w.unitCompareResult.rewriteTitle}</p>}
                                {w.unitCompareResult.rewriteScript && <p className="text-xs text-neutral-600 whitespace-pre-wrap leading-relaxed">{w.unitCompareResult.rewriteScript}</p>}
                              </div>
                            )}
                            <p className="text-[10px] text-neutral-400">둘 중 하나를 고르는 게 아니라, 두 버전의 장점을 합쳐서 업그레이드해요.</p>
                            <div className="flex flex-wrap justify-end gap-1.5">
                              <button
                                onClick={() => w.keepOriginalAfterUnitCompare(u.id)}
                                disabled={w.saving}
                                className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
                              >
                                원본 유지
                              </button>
                              <button
                                onClick={() => w.copyUnitUpgradePrompt(u)}
                                disabled={w.unitUpgradeCopyingId === u.id}
                                className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
                              >
                                {w.unitUpgradeCopyingId === u.id ? '준비 중...' : w.unitUpgradeCopiedId === u.id ? '✅ 복사됨!' : '💬 구독으로 업그레이드'}
                              </button>
                              <button
                                onClick={() => w.runUnitUpgrade(u)}
                                disabled={w.unitUpgradingId === u.id}
                                className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-40"
                              >
                                {w.unitUpgradingId === u.id ? '업그레이드 중...' : '🔀 자동으로 업그레이드'}
                              </button>
                            </div>
                            {w.unitUpgradePasteOpenId === u.id && (
                              <div>
                                <textarea
                                  value={w.unitUpgradePasteText}
                                  onChange={(e) => w.setUnitUpgradePasteText(e.target.value)}
                                  rows={6}
                                  placeholder="구독 채팅 답변(Title:/Script:)을 여기에 붙여넣으세요"
                                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono leading-relaxed mb-1.5"
                                />
                                <div className="flex justify-end gap-1.5">
                                  <button
                                    onClick={() => w.saveUnitUpgradePaste(u)}
                                    disabled={w.saving || !w.unitUpgradePasteText.trim()}
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
                              onClick={() => w.copyRevisePrompt(u)}
                              disabled={w.reviseCopyingId === u.id}
                              className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
                            >
                              {w.reviseCopyingId === u.id ? '준비 중...' : w.reviseCopiedId === u.id ? '✅ 복사됨!' : '💬 구독으로 피드백 반영 수정'}
                            </button>
                            <button
                              onClick={() => w.reviseUnit(u)}
                              disabled={w.revisingId === u.id}
                              className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white hover:bg-neutral-800 disabled:opacity-40"
                            >
                              {w.revisingId === u.id ? '수정 중...' : '🔧 피드백 반영해서 수정'}
                            </button>
                          </div>
                          {w.revisePasteOpenId === u.id && (
                            <div className="bg-white border border-neutral-200 rounded-lg p-2 mt-1.5">
                              <textarea
                                value={w.revisePasteText}
                                onChange={(e) => w.setRevisePasteText(e.target.value)}
                                rows={5}
                                placeholder="구독 채팅이 다시 써준 대본 전문을 여기에 붙여넣으세요"
                                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono leading-relaxed mb-1.5"
                              />
                              <div className="flex justify-end gap-1.5">
                                <button
                                  onClick={() => w.savePastedRevise(u.id)}
                                  disabled={w.saving || !w.revisePasteText.trim()}
                                  className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                                >
                                  {w.saving ? '저장 중...' : '붙여넣기 저장'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {w.reviewPasteOpenId === u.id && (
                        <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-2">
                          <textarea
                            value={w.reviewPasteText}
                            onChange={(e) => w.setReviewPasteText(e.target.value)}
                            rows={4}
                            placeholder="구독 채팅(Gemini/Claude)의 검토 답변을 여기에 붙여넣으세요 (SCORE:/FEEDBACK: 포함)"
                            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono leading-relaxed mb-1.5"
                          />
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => w.savePastedReview(u.id)}
                              disabled={w.saving || !w.reviewPasteText.trim()}
                              className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                            >
                              {w.saving ? '저장 중...' : '붙여넣기 저장'}
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <button
                          onClick={() => w.copyReviewPrompt(u)}
                          disabled={w.reviewCopyingId === u.id}
                          className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
                        >
                          {w.reviewCopyingId === u.id ? '준비 중...' : w.reviewCopiedId === u.id ? '✅ 복사됨!' : '💬 구독으로 검토하기'}
                        </button>
                        <button
                          onClick={() => w.reviewUnit(u)}
                          disabled={w.reviewingId === u.id}
                          className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white disabled:opacity-40"
                        >
                          {w.reviewingId === u.id ? '검토 중...' : u.review ? '🔍 다시 검토받기' : '🔍 AI 검토받기'}
                        </button>
                        <button
                          onClick={() => w.setUnitStatus(u.id, 'approved')}
                          className={`text-[11px] font-black px-3 py-1.5 rounded-lg border ${
                            u.status === 'approved' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-neutral-200 hover:border-emerald-400 text-emerald-600'
                          }`}
                        >
                          ✅ 승인
                        </button>
                        <button
                          onClick={() => w.setUnitStatus(u.id, 'rejected')}
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
    </div>
  );
}
