export type AnalysisResult = {
  channel?: string;
  title?: string;
  script?: string;
  thumbnail?: string;
  comment?: string;
  duration?: string;
  pace?: string;
  updated_at?: string;
  // 2026-09-11 추가 — 13번 화풍 선택. IMAGE_STYLE_PRESETS(utils.ts)의 id 중 하나. 처음엔 콘텐츠
  // 유닛별(ContentUnit.imageStyle)로 만들었다가, 사용자 지적("컨텐츠가 100개면 그때마다 고르는
  // 화면을 넣는다는거야? 왜 그런 쓸데없는 짓을 하지??", "카테고리를 한번 선택하고 그 안의 상품을
  // 고르면 되는것을") — 콘텐츠마다 따로 고르는 게 아니라 파이프라인(채널) 전체에서 한 번만 고르면
  // 되는 구조로 되돌렸다. 비어있으면 기본값(1번, IMAGE_STYLE_PRESETS[0])을 쓴다.
  imageStyle?: string;
  // 2026-09-11 추가 — 13번 캐릭터 선택. CHARACTER_STYLE_PRESETS(utils.ts)의 id 중 하나. 화풍
  // (imageStyle)과 같은 저장 방식(파이프라인 전체 공유)이지만 별개 축이다 — 화풍은 "어떻게 그릴지",
  // 캐릭터는 "누구를 그릴지"(몸 비율/정체성)를 정한다. 사용자가 "13단계에 캐릭터 선택이 화면에
  // 안 보인다 — 스틱맨이 선택되어 있는 게 보여야 한다"고 명시적으로 요구해서 화풍과 동일한
  // 프리셋+선택 UI 구조로 만들었다(스틱맨/빈 마스코트/식빵맨 3종). 비어있으면 기본값
  // (CHARACTER_STYLE_PRESETS[0], 스틱맨)을 쓴다.
  characterStyle?: string;
};
// 5번은 소재 하나마다 별개의 완성 콘텐츠라서, 작업 중인 것 하나(소재→제목→대본 위저드)와
// 별개로 완성된 것들을 units 배열에 콘텐츠 단위로 저장한다. 나중에 6~9번(영상/TTS/자막/렌더링)도
// 여기 unit id를 기준으로 진행 상태를 붙일 수 있게 id를 갖고 있다.
export type UnitReview = { score?: number; feedback?: string; reviewedAt?: string };
export type UnitCategory = 'trivia' | 'disaster';
export type ContentUnit = {
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
  hookReason?: string;
  // 2026-09-04 추가 — 10번(기획서 작성) 단계. "기획"은 "계획"(일정/절차 문서)과 다르다 — 5(소재)+
  // 7(자료조사)+8(전략)+9(훅)을 근거로 "이 콘텐츠가 왜/어떻게 조회수가 더 잘 나올지"를 논증하는
  // 조회수 전략 문서다. 처음엔 5·7·8·9 필드를 화면에 그대로 나열하는 대시보드로 잘못 구현했다가
  // ("저게 기획서야? 그냥 필드 나열 아니야?" 지적), "10번의 핵심은 독립적으로 기획서(=조회수
  // 전략)를 새로 쓰는 것"이라는 지적을 받고 이 필드를 추가함(2026-09-04). 11번(대본)이 이미
  // 쓰여 있어도 그걸 보고 기획서를 짜맞추면 안 됨 — 9번과 같은 이유로, 오직 5·7·8·9만 근거로
  // 독립적으로 작성해야 한다.
  planningDoc?: string;
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
export type ScriptDraft = {
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
export type Site = {
  id: string;
  name: string;
  workflow_content: string | null;
  analysis_result: AnalysisResult | null;
  script_draft: ScriptDraft | null;
};
export type Step = { n: string; name: string; desc: string; status: string };
export type Channel = { id: string; name: string; url: string | null; subscriber_count: string | null; notes: string | null };
export type VideoComment = { author: string; text: string; likeCount: number };
export type SourceItem = {
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
export type ChannelVideoResult = {
  videoId: string;
  title: string;
  url: string;
  views: number;
  viewsLabel: string;
  thumbnail: string;
  durationSeconds: number;
  durationLabel: string;
};
export type ChannelMaterialGroup = { channelId: string; channelName: string; videos: ChannelVideoResult[]; error?: string };
export type DiscoverResult = {
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

// 13번(이미지/영상 생성) 스토리보드 한 행 — 열 구성은 사용자 지시(2026-09-07): 타임/장면이미지/
// 이미지 프롬프트/영상프롬프트 or 전환프롬프트. clean/info(구 A안 2장 방식)는 하위호환용으로 남기고
// 화면에선 "고급 옵션"처럼 접어둔다.
export type SceneBlock = {
  id: string;
  title: string;
  script: string;
  note: string;
  time: string;
  sceneImage: string;
  imagePrompt: string;
  clean: string;
  info: string;
  video: string; // = 영상프롬프트 or 전환프롬프트
  media: string[];
};

export type LabeledItem = { label: string; url: string };
export type LabeledField = 'narrationUrls' | 'subtitleUrls';

// 2026-09-11 추가 — 13번 화풍 선택 프리셋. 사용자가 같은 씬(약사 스틱맨+무너지는 PHARMACY 네온사인)을
// Flow에서 여러 화풍으로 직접 만들어 비교 확정한 뒤 추가됨. promptStyle은 4대 핵심 원칙 1번(비주얼
// 톤앤매너) 문장을 통째로 교체하는 용도 — 캐릭터 정체성(스틱맨 등)은 화풍과 무관하게 항상 고정이라
// 여기 포함하지 않는다. referenceImageUrl은 그 화풍으로 실제 생성해본 예시 이미지(Storage 영구 저장본).
// 목록의 첫 번째(인덱스 0)가 기본값 — AnalysisResult.imageStyle이 비어있을 때 이걸 쓴다.
export type ImageStylePreset = {
  id: string;
  label: string;
  promptStyle: string;
  referenceImageUrl: string;
};

// 2026-09-11 추가 — 13번 캐릭터 선택 프리셋(화풍과 별개 축, utils.ts CHARACTER_STYLE_PRESETS 참고).
// description은 프롬프트의 "캐릭터 롤플레이" 항목(젠틀맨 루즈/스틱맨 배우 정의)을 통째로 교체하는
// 용도. referenceImageUrl은 비어있을 수 있다(참고 이미지가 아직 없는 캐릭터).
export type CharacterStylePreset = {
  id: string;
  label: string;
  description: string;
  referenceImageUrl?: string;
  // 2026-09-12 추가 — 사용자 요청: "13단계에서도 탭별로(전체/루즈 등) 분류해서 일관성 유지가 잘
  // 되었는지 확인해볼 수 있게 해줘". 이 프리셋의 description 안에 실제로 등장하는 캐릭터
  // 이름/역할 태그(예: "Gentleman Rouge", "the stickman actor")를 그대로 매칭 키워드로 써서,
  // 13번 스토리보드 표(SceneEditorList)가 각 장면의 imagePrompt 텍스트를 보고 탭으로 나눠 보여줄
  // 수 있게 한다. description과 별개 필드로 둔 이유는 자유 서술문에서 정규식으로 이름을 뽑아내는
  // 것보다, 프리셋을 만들 때 실제 매칭 키워드를 명시적으로 같이 적어두는 쪽이 둘이 어긋날 여지가
  // 없기 때문(하드코딩 방지 — 화면과 실제 생성 프롬프트가 항상 같은 이 소스를 본다). 캐릭터가
  // 하나뿐인 프리셋(포동이/식빵맨 등)은 비워두면 되고, 그때는 탭 자체가 표시되지 않는다.
  tabs?: { label: string; keywords: string[] }[];
};
