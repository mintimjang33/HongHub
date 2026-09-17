'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Site = {
  id: string;
  name: string;
  admin_email: string | null;
  github_url: string[] | null;
  vercel_url: string[] | null;
  live_url: string[] | null;
  supabase_url: string[] | null;
  benchmark_url: string[] | null;
  notes: string | null;
  start_date: string | null;
  plan_file_url: string | null;
  plan_file_name: string | null;
  plan_content: string | null;
};

// 콘텐츠 파이프라인(코드 프로젝트가 아닌 채널/워크플로) 항목은
// notes에 이 마커가 들어있는 hub_sites 레코드로 식별한다.
// 이런 항목은 /pipelines 전용이므로 홈(도구/사이트) 목록에서는 제외한다.
const PIPELINE_MARKER = '코드 프로젝트 아님';

const KNOWN_EMAILS = [
  'mintimjang33@gmail.com',
  'minsiljang0@gmail.com',
  'minssajang@gmail.com',
  'minsiljjang@gmail.com',
  'jiphj0307@gmail.com',
  'afterschool.rollbook@gmail.com',
  'ssajuboyz@gmail.com',
  'poohssam79@gmail.com',
  'helpfulfood365@gmail.com',
];

// 2026-09-17 수정 — 사용자 지적: "이 탭들에 링크만 있는데 수정해서 계정 채널 셋팅들을
// 하게 해두자". 기존 6개 버튼(외부 사이트로 바로 이동)은 그대로 두고, platform 키를 붙여서
// 아래 "🔐 플랫폼 계정 관리" 섹션(hub_social_accounts)에서 같은 목록을 그대로 재사용한다 —
// 라벨을 두 군데서 따로 관리하면 어긋날 수 있어서 하나의 배열로 통일.
const QUICK_LINKS = [
  { label: '유튜브', icon: '▶️', url: 'https://studio.youtube.com', platform: 'youtube' },
  { label: '인스타그램', icon: '📸', url: 'https://www.instagram.com', platform: 'instagram' },
  { label: '쓰레드', icon: '🧵', url: 'https://www.threads.com', platform: 'threads' },
  { label: '페이스북', icon: '📘', url: 'https://www.facebook.com', platform: 'facebook' },
  { label: '틱톡', icon: '🎵', url: 'https://www.tiktok.com/upload', platform: 'tiktok' },
  { label: '네이버 블로그', icon: 'N', url: 'https://blog.naver.com', platform: 'naver_blog' },
];

// 위 QUICK_LINKS와 같은 순서/플랫폼 키를 쓰는 계정 레코드 — hub_social_accounts 테이블과
// 1:1 대응(_migration_16_social_accounts.sql, app/api/social-accounts 참고).
type SocialAccount = {
  id: string;
  platform: string;
  account_name: string;
  setting_note: string | null;
  admin_email: string | null;
  admin_phone: string | null;
  site_id: string | null;
  credentials: Record<string, string> | null;
};

// 2026-09-17(6차) 추가 — 사용자 지적: "관리메일 아래로 추가 등록되는게 아니잖아". 같은
// 관리 이메일로 채널을 여러 개 등록해도 화면엔 그냥 낱개 카드로 평평하게 나열돼서, "이메일
// 아래에 채널들이 묶인다"는 말과 실제 화면이 안 맞았다. admin_email 기준으로 묶어서 이메일을
// 소제목처럼 보여주고 그 밑에 채널들을 들여쓰기해서 실제로 그룹처럼 보이게 한다. 이메일이
// 없는 계정들은 그룹 헤더 없이 원래대로 낱개 표시(email: '').
function groupAccountsByEmail(accounts: SocialAccount[]): { email: string; accounts: SocialAccount[] }[] {
  const order: string[] = [];
  const map = new Map<string, SocialAccount[]>();
  for (const a of accounts) {
    const key = a.admin_email || '';
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(a);
  }
  return order.map((email) => ({ email, accounts: map.get(email)! }));
}

// 2026-09-17(11차) 추가 — 사용자 요청: "등록된것들을 상단으로 모아줘". 계정/채널명만
// "1"로 임시 등록해두고 자격증명은 하나도 안 채운 그룹(poohssam79 등)이 실제로 다 채워
// 연결까지 확인된 그룹(mintimjang33, minsiljjang 등) 사이에 생성 순서 그대로 끼어있어서
// 눈에 잘 안 띄었다. 그룹 안에 credentials.refresh_token이 하나라도 있는 계정이 있으면
// "등록 진행됨" 그룹으로 보고 앞으로, 하나도 없으면(완전 빈 자리표시자) 뒤로 보낸다 —
// Array.sort는 안정 정렬이라 같은 등급 안에서는 원래(생성) 순서가 유지된다.
function sortGroupsByProgress(groups: { email: string; accounts: SocialAccount[] }[]): { email: string; accounts: SocialAccount[] }[] {
  const score = (g: { accounts: SocialAccount[] }) => (g.accounts.some((a) => a.credentials?.refresh_token) ? 0 : 1);
  return [...groups].sort((a, b) => score(a) - score(b));
}

// 2026-09-17 신설 — 사용자 지적: "계정 채널명 이런걸 니가 다 셋팅을 해줘야해" /
// "그걸 셋팅하려면 뭐가 필요한지를 만들어야 정보를 입력해두지". 플랫폼마다 실제 API 연동에
// 필요한 자격증명 종류가 다르다(/docs/API_SETUP_GUIDE.md 실전 기록 기반) — 유튜브는 구글
// 클라우드 콘솔 OAuth Client ID/Secret+채널별 Refresh Token, 인스타/쓰레드/페이스북은 전부
// 메타(Meta for Developers) 앱 하나를 공유하므로 App ID/Secret은 여러 계정이 같이 쓰고
// 계정별로는 Access Token+계정 고유 ID(IG 비즈니스ID/쓰레드 유저ID/페이지ID)만 다르다,
// 틱톡은 Client Key/Secret+Access Token. 네이버 블로그는 공식 포스팅 API가 없어서(검색·
// 쇼핑 API만 있음, 위 가이드 문서 참고) 자격증명 칸 자체를 안 보여주고 안내 문구만 띄운다.
// key는 credentials jsonb에 그대로 저장되는 필드명이다. help는 입력칸 placeholder가 아니라
// 그 아래 항상 보이는 고정 설명 문구로 렌더링한다(2026-09-17(2차) 수정 — 사용자 지적: "각
// 입력 설명 적어놨어?" — placeholder 안에 설명을 욱여넣었더니 칸이 좁아 잘리고, 클릭해서
// 타이핑을 시작하면 아예 사라져서 설명 역할을 못 했다. label은 짧게 placeholder로 쓰고,
// 자세한 설명(어디서 발급받는지 등)은 입력칸 밑에 별도 문구로 항상 보이게 한다).
// 2026-09-17(5차) 수정 — 사용자 지적: "설명서가 족같은데 어떻게 발급해?" / "링크도 없고".
// 발급 "이유"만 적혀있고 정작 어느 화면에서 어떤 버튼을 눌러야 하는지가 없어 실제로 못 따라
// 했다. 실제로 화면을 같이 보며 진행해본 순서(유튜브는 이 세션에서 실증 완료)를 그대로
// 단계별로 적고, 그 발급 사이트로 바로 이동하는 link를 추가해서 help 박스 안에 "바로가기"
// 버튼이 뜨게 한다.
const CREDENTIAL_FIELDS: Record<string, { key: string; label: string; help: string; link?: string; extraLink?: { url: string; label: string } }[]> = {
  youtube: [
    {
      key: 'client_id',
      label: 'OAuth Client ID',
      help: '⚠️ 0단계(빠뜨리기 쉬움, 꼭 먼저 할 것): "YouTube Data API v3" 사용 설정(Enable) — 아래 "0단계" 링크로 바로가기. 이거 안 하면 나중에 채널 확인·업로드가 전부 403 에러(SERVICE_DISABLED)로 실패합니다. 그다음: Google Cloud Console → 좌측 "클라이언트" → "+ 클라이언트 만들기" → 유형 "웹 애플리케이션" → "승인된 리디렉션 URI"에 https://developers.google.com/oauthplayground 추가 → 만들기. 뜨는 즉시 복사(나중에 다시 못 봅니다). ⚠️ 이 프로젝트에 다른 앱용 클라이언트가 이미 있어도 재사용하지 말고 새로 만들 것 — 그 클라이언트를 건드리면 다른 앱 로그인이 깨질 수 있고, secret은 클라이언트당 최대 2개까지만 만들 수 있어 막힐 수도 있음',
      link: 'https://console.cloud.google.com/auth/clients',
      extraLink: { url: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com', label: '0단계: YouTube Data API v3 활성화 바로가기' },
    },
    {
      key: 'client_secret',
      label: 'OAuth Client Secret',
      help: '위 Client ID와 같은 화면에서 동시에 발급됩니다 — 그 자리에서 바로 복사(재조회 불가, 잊어버리면 그 클라이언트 화면에서 "+ Add secret"으로 새로 발급 가능, 최대 2개)',
      link: 'https://console.cloud.google.com/auth/clients',
    },
    {
      key: 'refresh_token',
      label: 'Refresh Token',
      help: 'OAuth Playground → ⚙ → "Use your own OAuth credentials" 체크 + 위 Client ID/Secret 입력 → 왼쪽에서 "YouTube Data API v3" 펼쳐서 youtube, youtube.upload, youtube.force-ssl 3개만 체크(youtubepartner류는 방송사/MCN용이라 불필요) → "Authorize APIs" → 이 채널 계정으로 로그인·동의(구글이 미검증 앱 경고를 띄우면 "계속" 클릭) → "Exchange authorization code for tokens" 클릭 → 나온 refresh_token 복사. ⚠️ Exchange 누르기 전 Request 본문의 client_id가 위 본인 Client ID로 시작하는지 꼭 확인(체크가 중간에 풀려서 구글 공용 클라이언트 407408718192...로 잘못 발급되는 경우가 있음, 그 값은 못 씀). 인증 코드는 1회용이라 재사용하면 invalid_grant 에러 남 — 그럼 Authorize APIs부터 다시. 테스트 중 상태면 이 토큰이 7일 후 만료되니 그때 이 과정만 다시 반복하면 됨',
      link: 'https://developers.google.com/oauthplayground',
    },
    {
      key: 'channel_id',
      label: '채널 ID',
      help: 'YouTube Studio → 설정 → 채널 → 고급 설정에 안 보일 수 있음(UI 개편). 제일 확실한 방법: 위에서 받은 access token으로 새 탭에서 다음 주소를 그대로 열기 → https://www.googleapis.com/youtube/v3/channels?part=id&mine=true&access_token=발급받은access토큰 → 응답 JSON의 items[0].id 값이 채널 ID(UC로 시작)',
      link: 'https://studio.youtube.com',
    },
  ],
  instagram: [
    {
      key: 'app_id',
      label: 'Meta App ID',
      help: 'Meta for Developers → "앱 만들기" → 유형 선택해 생성 → 대시보드 상단에 표시됨 (인스타·쓰레드·페이스북이 앱 하나를 같이 씁니다)',
      link: 'https://developers.facebook.com/apps',
    },
    {
      key: 'app_secret',
      label: 'Meta App Secret',
      help: '같은 앱 대시보드 → 좌측 "설정" → "기본 설정" → "앱 시크릿 코드" 옆 "표시" 클릭',
      link: 'https://developers.facebook.com/apps',
    },
    {
      key: 'ig_business_id',
      label: 'Instagram 비즈니스 계정 ID',
      help: '먼저 인스타 계정을 프로페셔널(비즈니스/크리에이터) 전환 + 페이스북 페이지 연결 → Graph API 탐색기에서 앱 선택 후 "GET /me/accounts" 호출하면 연결된 인스타 계정 ID가 응답에 포함됨',
      link: 'https://developers.facebook.com/tools/explorer',
    },
    {
      key: 'access_token',
      label: 'Access Token',
      help: 'Graph API 탐색기 → 이 앱 선택 → 권한(instagram_basic, instagram_content_publish 등) 추가 → "Access Token 생성" → 이 계정으로 로그인·동의 → 발급된 토큰을 "액세스 토큰 디버거"에서 장기 토큰으로 교환',
      link: 'https://developers.facebook.com/tools/explorer',
    },
  ],
  threads: [
    {
      key: 'app_id',
      label: 'Meta App ID',
      help: 'Meta for Developers → "앱 만들기" → 유형 선택해 생성 → 대시보드 상단에 표시됨 (인스타·쓰레드·페이스북이 앱 하나를 같이 씁니다)',
      link: 'https://developers.facebook.com/apps',
    },
    {
      key: 'app_secret',
      label: 'Meta App Secret',
      help: '같은 앱 대시보드 → 좌측 "설정" → "기본 설정" → "앱 시크릿 코드" 옆 "표시" 클릭',
      link: 'https://developers.facebook.com/apps',
    },
    {
      key: 'threads_user_id',
      label: 'Threads 사용자 ID',
      help: '앱 대시보드에 "Threads API 액세스" 사용 사례 추가 → 이 계정으로 OAuth 인가 진행 → 발급된 액세스 토큰으로 "GET https://graph.threads.net/v1.0/me" 호출하면 응답에 사용자 ID 포함',
      link: 'https://developers.facebook.com/apps',
    },
    {
      key: 'access_token',
      label: 'Access Token',
      help: '앱 대시보드 → "Threads API 액세스" 사용 사례 → 필요 권한(threads_content_publish 등) 포함해 이 계정으로 OAuth 인가 → 콜백으로 받은 코드를 액세스 토큰으로 교환',
      link: 'https://developers.facebook.com/apps',
    },
  ],
  facebook: [
    {
      key: 'app_id',
      label: 'Meta App ID',
      help: 'Meta for Developers → "앱 만들기" → 유형 선택해 생성 → 대시보드 상단에 표시됨 (인스타·쓰레드·페이스북이 앱 하나를 같이 씁니다)',
      link: 'https://developers.facebook.com/apps',
    },
    {
      key: 'app_secret',
      label: 'Meta App Secret',
      help: '같은 앱 대시보드 → 좌측 "설정" → "기본 설정" → "앱 시크릿 코드" 옆 "표시" 클릭',
      link: 'https://developers.facebook.com/apps',
    },
    {
      key: 'page_id',
      label: '페이지 ID',
      help: '관리 중인 페이스북 페이지 → "페이지 정보"(또는 "정보") 탭에서 페이지 ID 확인',
      link: 'https://www.facebook.com/pages/?category=your_pages',
    },
    {
      key: 'page_access_token',
      label: 'Page Access Token',
      help: 'Graph API 탐색기 → 이 앱 선택 → "Access Token 생성"(사용자 토큰, 로그인) → "GET /me/accounts" 호출 → 응답에서 이 페이지 줄의 access_token 값이 페이지 전용 토큰',
      link: 'https://developers.facebook.com/tools/explorer',
    },
  ],
  tiktok: [
    {
      key: 'client_key',
      label: 'Client Key',
      help: 'TikTok for Developers → "Manage apps" → "Create an app" → 앱 생성 후 대시보드에 표시됨 (실제 업로드용 Content Posting API는 별도 심사·승인 필요)',
      link: 'https://developers.tiktok.com/apps',
    },
    {
      key: 'client_secret',
      label: 'Client Secret',
      help: '위 Client Key와 같은 앱 대시보드에서 같이 발급',
      link: 'https://developers.tiktok.com/apps',
    },
    {
      key: 'access_token',
      label: 'Access Token',
      help: '등록한 앱의 Login Kit으로 이 계정 OAuth 인가 진행 → 콜백으로 받은 code를 access_token으로 교환 (TikTok Login Kit 문서 절차)',
      link: 'https://developers.tiktok.com/apps',
    },
  ],
  naver_blog: [], // 공식 포스팅 API 없음 — 아래 UI에서 안내 문구만 표시
};

const GUIDE_DOCS = [
  { label: '클론 진행 프로세스', desc: '사이트를 클론할 때 거치는 표준 절차', icon: '🧭', url: '/docs/CLONE_PROCESS.md' },
  { label: 'MCP 만드는 법', desc: '새 프로젝트에 MCP 서버 붙이는 방법', icon: '🔌', url: '/docs/MCP_GUIDE.md' },
  { label: '크론/예약작업 가이드', desc: '반복 실행 기능 붙일 때 필수 절차', icon: '⏰', url: '/docs/CRON_GUIDE.md' },
  { label: '네이버/Threads API 가이드', desc: '실제 발급·연동 실전 기록', icon: '🔑', url: '/docs/API_SETUP_GUIDE.md' },
  { label: '이메일 발송 서비스 가이드', desc: '어떤 서비스를 쓸지 추천(미검증)', icon: '✉️', url: '/docs/EMAIL_GUIDE.md' },
  { label: '계획서 작성 템플릿', desc: '사이트 등록 시 계획서 표준 양식', icon: '📄', url: '/PLAN_TEMPLATE.md' },
];

const LINK_FIELDS: { key: keyof Site; label: string; icon: string }[] = [
  { key: 'live_url', label: '접속', icon: '🌐' },
  { key: 'github_url', label: '깃허브', icon: '🐙' },
  { key: 'vercel_url', label: '배포', icon: '▲' },
  { key: 'supabase_url', label: '슈퍼베이스', icon: '🗄️' },
  { key: 'benchmark_url', label: '벤치마킹', icon: '🔍' },
];

const EMPTY_FORM = {
  name: '',
  admin_email: '',
  github_url: [] as string[],
  vercel_url: [] as string[],
  live_url: [] as string[],
  supabase_url: [] as string[],
  benchmark_url: [] as string[],
  notes: '',
  start_date: '',
  plan_file_url: '',
  plan_file_name: '',
};

type ArrayField = 'github_url' | 'vercel_url' | 'live_url' | 'supabase_url' | 'benchmark_url';

function toDisplayArray(v: string[] | null | undefined): string[] {
  return v && v.length > 0 ? v : [''];
}

export default function Home() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // 2026-09-17 신설 — 플랫폼 계정 관리 섹션 상태. addingPlatform은 지금 계정 추가/수정 폼이
  // 열려있는 플랫폼 키(예: 'youtube') — null이면 아무 폼도 안 열려있음. editingAccountId가
  // 있으면 수정 모드, 없으면 새 계정 추가 모드로 같은 폼을 재사용한다.
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [addingPlatform, setAddingPlatform] = useState<string | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState<{ account_name: string; setting_note: string; admin_email: string; admin_phone: string; credentials: Record<string, string> }>({
    account_name: '',
    setting_note: '',
    admin_email: '',
    admin_phone: '',
    credentials: {},
  });
  const [savingAccount, setSavingAccount] = useState(false);
  // 2026-09-17(3차) 추가 — 사용자 요청: "클릭해서 띄어놓고 볼수있게 해줘" + "x 박스로 닫게끔".
  // 처음엔 각 자격증명 입력칸 밑에 설명을 항상 띄우려 했는데(2차), 그러면 폼이 길어지고
  // 안 궁금한 설명까지 계속 차지하고 있으니 — 필드마다 "ⓘ" 버튼을 눌러야만 설명 박스가
  // 열리고, ✕를 눌러야 닫히게(호버 아님, 클릭 토글) 바꿨다. 키는 "platform:fieldKey"로 —
  // 폼이 플랫폼별로 각자 열리므로 겹칠 일은 없지만 명확하게 구분해둔다.
  const [openHelpKeys, setOpenHelpKeys] = useState<Set<string>>(new Set());
  function toggleHelp(key: string) {
    setOpenHelpKeys((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  // 2026-09-17(4차) 추가 — 사용자 요청: "눈 표시 하고 복사버튼 추가해줘". API 자격증명
  // 칸이 기본으로 평문 노출돼있어서 어깨너머로 보이기 쉬웠던 것을 password 타입으로
  // 가려두고, 👁 버튼으로 필요할 때만 토글해서 보게 했다. 값을 직접 드래그해서 복사하기
  // 불편하니 📋 버튼으로 클립보드 복사도 같이 추가.
  const [visibleCredKeys, setVisibleCredKeys] = useState<Set<string>>(new Set());
  function toggleCredVisible(key: string) {
    setVisibleCredKeys((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const [copiedCredKey, setCopiedCredKey] = useState<string | null>(null);
  async function copyCredValue(key: string, value: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedCredKey(key);
      setTimeout(() => setCopiedCredKey((cur) => (cur === key ? null : cur)), 1500);
    } catch {
      // 클립보드 권한 없는 환경(예: http)에서는 조용히 무시 — 수동 드래그 복사는 여전히 가능
    }
  }

  function safeParseChannels(json: string | undefined): { id: string; title: string | null }[] {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  // 2026-09-17(10차) 추가 — 사용자 요청: "연결이 완료 된것은 다르게 표시를 해줘". 폼을 열어야만
  // 보이던 "채널 확인" 결과를 계정 목록 카드 자체에도 뱃지로 보여준다 — Down_Tools/KARAMAVERSE
  // 사태처럼 리프레시 토큰이 실제로는 다른 채널을 가리키는 채로 저장돼있는 경우를 목록만 보고도
  // 바로 알아챌 수 있게 하기 위함.
  function getYoutubeConnectionBadge(a: SocialAccount): { label: string; className: string } | null {
    if (a.platform !== 'youtube') return null;
    const creds = a.credentials || {};
    if (!creds.refresh_token) return null;
    const verifiedChannels = safeParseChannels(creds._verified_channels);
    if (verifiedChannels.length === 0) return { label: '❔ 확인 안 됨', className: 'bg-neutral-100 text-neutral-400' };
    const isMatch = !!creds.channel_id && verifiedChannels.some((c) => c.id === creds.channel_id);
    return isMatch
      ? { label: '✅ 연결 확인됨', className: 'bg-green-100 text-green-700' }
      : { label: '⚠️ 채널 불일치', className: 'bg-amber-100 text-amber-700' };
  }

  // 2026-09-17(8차) 추가 — 사용자 지적: "해당 리프레시 토큰이 해당 채널의 업로드에 맞는건지
  // 알수가 있어?" — 지금까지는 새 탭 열어서 access_token을 URL에 직접 붙여 수동으로
  // 확인했는데, 이걸 화면 안에서 버튼 하나로 할 수 있게 한다. client_secret이 필요해서
  // 브라우저에서 구글 토큰 엔드포인트로 직접 호출하지 않고(CORS·보안), 서버 라우트
  // (/api/youtube/verify-token)를 거쳐 refresh_token → access_token 교환 → channels.list
  // 조회까지 한 번에 하고, 결과 채널 ID를 이미 입력해둔 channel_id와 비교해서 일치 여부까지
  // 보여준다.
  const [verifyingToken, setVerifyingToken] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ channels: { id: string; title: string | null }[]; verifiedAt: string } | { error: string } | null>(null);
  async function verifyYoutubeRefreshToken() {
    const { client_id, client_secret, refresh_token } = accountForm.credentials;
    if (!client_id || !client_secret || !refresh_token) {
      setVerifyResult({ error: 'Client ID / Client Secret / Refresh Token을 먼저 다 입력해주세요.' });
      return;
    }
    setVerifyingToken(true);
    setVerifyResult(null);
    try {
      const res = await fetch('/api/youtube/verify-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, client_secret, refresh_token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVerifyResult({ error: data.error || '확인 실패' });
        return;
      }
      const verifiedAt = new Date().toISOString();
      setVerifyResult({ channels: data.channels, verifiedAt });
      // 2026-09-17(9차) 추가 — 사용자 요청: "현재날짜 시간까지해서 저장해줘". 확인 결과를
      // 화면에만 잠깐 띄우던 걸, credentials jsonb에 _verified_* 키로 같이 저장한다(새
      // 마이그레이션 없이 기존 컬럼 재사용). 이미 저장된 계정(editingAccountId 있음)이면
      // "저장" 버튼을 안 눌러도 확인 즉시 DB에 반영 — 그래야 "확인은 했는데 저장을 안 눌러서
      // 날짜가 날아갔다"는 일이 안 생긴다. credentials는 Record<string,string>이라 배열을
      // 그대로 못 넣어서 JSON 문자열로 저장한다(2차 수정 — mine=true가 여러 채널을 배열로
      // 줄 수 있다는 걸 알게 된 뒤로 단일 채널이 아니라 목록 전체를 저장해야 함).
      const nextCredentials = {
        ...accountForm.credentials,
        _verified_at: verifiedAt,
        _verified_channels: JSON.stringify(data.channels),
      };
      setAccountForm((f) => ({ ...f, credentials: nextCredentials }));
      if (editingAccountId) {
        await fetch(`/api/social-accounts/${editingAccountId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credentials: nextCredentials }),
        });
        loadAccounts();
      }
    } catch {
      setVerifyResult({ error: '요청 중 오류가 발생했습니다.' });
    } finally {
      setVerifyingToken(false);
    }
  }

  // 2026-09-17(7차) 추출 — 사용자 지적: "수정을 클릭하면 가장 아래에 표시가 되는데~ 해당
  // 계정 정보 바로 아래에 표시 되었으면 좋겠어". 원래는 폼 하나를 플랫폼 카드 맨 밑에 고정
  // 렌더링해서, 계정이 여러 개 쌓인 카드에서 "수정"을 누르면 화면 밑까지 스크롤해야 폼이
  // 보였다. 폼 JSX를 함수로 뽑아서 "수정 중인 계정 바로 밑"과 "새 계정 추가용(카드 맨 밑)"
  // 두 군데에서 재사용한다 — 상태(accountForm 등)는 그대로 하나뿐이라 여러 폼이 동시에
  // 열리는 게 아니라 위치만 editingAccountId 유무에 따라 달라진다.
  function renderAccountForm(platform: string) {
    return (
      <div className="mt-2 space-y-1.5 border-t border-neutral-100 pt-2">
        <input
          value={accountForm.admin_email}
          onChange={(e) => setAccountForm((f) => ({ ...f, admin_email: e.target.value }))}
          placeholder="관리 이메일 (선택 — 같은 이메일로 채널을 여러 개 등록할 수 있습니다)"
          className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px]"
        />
        <input
          value={accountForm.account_name}
          onChange={(e) => setAccountForm((f) => ({ ...f, account_name: e.target.value }))}
          placeholder="계정/채널명 (채널 하나당 여기서 한 건씩 등록)"
          className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px]"
        />
        <input
          value={accountForm.admin_phone}
          onChange={(e) => setAccountForm((f) => ({ ...f, admin_phone: e.target.value }))}
          placeholder="관리 전화번호 (선택 — 이 채널 담당자 연락처)"
          className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px]"
        />
        {CREDENTIAL_FIELDS[platform].length > 0 ? (
          <div className="space-y-1.5 border border-dashed border-neutral-200 rounded-lg p-2">
            <p className="text-[10px] font-black text-neutral-400">🔑 API 연동 정보</p>
            {CREDENTIAL_FIELDS[platform].map((field) => {
              const helpKey = `${platform}:${field.key}`;
              const isHelpOpen = openHelpKeys.has(helpKey);
              const isCredVisible = visibleCredKeys.has(helpKey);
              const credValue = accountForm.credentials[field.key] || '';
              return (
                <div key={field.key}>
                  <p className="text-[9px] font-black text-neutral-400 px-0.5 mb-0.5">{field.label}</p>
                  <div className="flex items-center gap-1">
                    <input
                      type={isCredVisible ? 'text' : 'password'}
                      value={credValue}
                      onChange={(e) => setCredentialField(field.key, e.target.value)}
                      placeholder={field.label}
                      className="flex-1 min-w-0 border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px] font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => toggleCredVisible(helpKey)}
                      title={isCredVisible ? '값 가리기' : '값 보기'}
                      className="shrink-0 w-6 h-6 rounded-full text-[11px] flex items-center justify-center bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                    >
                      {isCredVisible ? '🙈' : '👁'}
                    </button>
                    <button
                      type="button"
                      onClick={() => copyCredValue(helpKey, credValue)}
                      title="값 복사"
                      className={`shrink-0 w-6 h-6 rounded-full text-[11px] flex items-center justify-center ${
                        copiedCredKey === helpKey ? 'bg-green-100 text-green-600' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
                      }`}
                    >
                      {copiedCredKey === helpKey ? '✓' : '📋'}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleHelp(helpKey)}
                      title="이 항목 설명 보기"
                      className={`shrink-0 w-6 h-6 rounded-full text-[11px] font-black flex items-center justify-center ${
                        isHelpOpen ? 'bg-black text-white' : 'bg-neutral-100 text-neutral-400 hover:bg-neutral-200'
                      }`}
                    >
                      ⓘ
                    </button>
                  </div>
                  {isHelpOpen && (
                    <div className="bg-blue-50 border border-blue-100 rounded-lg px-2 py-1.5 mt-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[10px] text-blue-700 leading-relaxed">
                          <span className="font-black">{field.label}</span> — {field.help}
                        </p>
                        <button
                          type="button"
                          onClick={() => toggleHelp(helpKey)}
                          className="shrink-0 text-[11px] font-black text-blue-400 hover:text-blue-700"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-x-3 mt-1.5">
                        {field.extraLink && (
                          <a
                            href={field.extraLink.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block text-[10px] font-black text-amber-600 hover:underline"
                          >
                            ⚡ {field.extraLink.label} ↗
                          </a>
                        )}
                        {field.link && (
                          <a
                            href={field.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block text-[10px] font-black text-blue-600 hover:underline"
                          >
                            🔗 발급 사이트 바로가기 ↗
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                  {platform === 'youtube' && field.key === 'refresh_token' && (
                    <div className="mt-1">
                      <button
                        type="button"
                        onClick={verifyYoutubeRefreshToken}
                        disabled={verifyingToken}
                        className="text-[10px] font-bold text-blue-600 hover:underline disabled:opacity-40"
                      >
                        {verifyingToken ? '확인 중...' : '🔍 이 토큰으로 연결되는 채널 확인'}
                      </button>
                      {verifyResult && (
                        'error' in verifyResult ? (
                          <p className="text-[10px] text-red-600 mt-1">❌ {verifyResult.error}</p>
                        ) : (
                          <div className="mt-1 bg-neutral-50 border border-neutral-200 rounded-lg p-1.5">
                            <p className="text-[10px] font-bold text-neutral-500 mb-1">
                              이 토큰으로 접근 가능한 채널 {verifyResult.channels.length}개 (🕐 {new Date(verifyResult.verifiedAt).toLocaleString('ko-KR')} 확인·저장됨)
                            </p>
                            <div className="space-y-1">
                              {verifyResult.channels.map((ch) => {
                                const isMatch = ch.id === accountForm.credentials.channel_id;
                                return (
                                  <div key={ch.id} className="flex items-center justify-between gap-2">
                                    <p className={`text-[10px] truncate ${isMatch ? 'text-green-700 font-bold' : 'text-neutral-600'}`}>
                                      {isMatch ? '✅' : '⚪'} {ch.title || '(이름 없음)'}{' '}
                                      <span className="text-neutral-400 font-mono">({ch.id})</span>
                                    </p>
                                    {!isMatch && (
                                      <button
                                        type="button"
                                        onClick={() => setCredentialField('channel_id', ch.id)}
                                        className="shrink-0 text-[9px] font-bold text-blue-600 hover:underline"
                                      >
                                        이 ID 쓰기
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            {accountForm.credentials.channel_id && !verifyResult.channels.some((c) => c.id === accountForm.credentials.channel_id) && (
                              <p className="text-[10px] text-amber-600 mt-1">⚠️ 입력해둔 채널 ID가 위 목록에 없습니다 — 위에서 원하는 채널의 "이 ID 쓰기"를 눌러주세요.</p>
                            )}
                          </div>
                        )
                      )}
                      {!verifyResult && accountForm.credentials._verified_channels && (
                        <div className="mt-1 bg-neutral-50 border border-neutral-200 rounded-lg p-1.5">
                          <p className="text-[10px] font-bold text-neutral-400 mb-1">
                            🕐 마지막 확인: {accountForm.credentials._verified_at ? new Date(accountForm.credentials._verified_at).toLocaleString('ko-KR') : '-'}
                          </p>
                          <div className="space-y-1">
                            {safeParseChannels(accountForm.credentials._verified_channels).map((ch) => {
                              const isMatch = ch.id === accountForm.credentials.channel_id;
                              return (
                                <p key={ch.id} className={`text-[10px] truncate ${isMatch ? 'text-green-700 font-bold' : 'text-neutral-500'}`}>
                                  {isMatch ? '✅' : '⚪'} {ch.title || '(이름 없음)'} <span className="text-neutral-400 font-mono">({ch.id})</span>
                                </p>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
            ⚠️ 네이버 블로그는 공식 포스팅 API가 없습니다 — 수동 업로드 또는 브라우저 자동화로만 가능합니다.
          </p>
        )}
        <input
          value={accountForm.setting_note}
          onChange={(e) => setAccountForm((f) => ({ ...f, setting_note: e.target.value }))}
          placeholder="그 외 메모 (선택)"
          className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-[11px]"
        />
        <div className="flex justify-end gap-1.5">
          <button onClick={cancelAccountForm} className="text-[11px] font-bold text-neutral-400 hover:text-black px-2">
            취소
          </button>
          <button
            onClick={() => saveAccount(platform)}
            disabled={savingAccount || !accountForm.account_name.trim()}
            className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
          >
            {savingAccount ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    );
  }

  function load() {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => {
        const all: Site[] = d.sites || [];
        setSites(all.filter((s) => !(s.notes || '').includes(PIPELINE_MARKER)));
      })
      .finally(() => setLoading(false));
  }

  function loadAccounts() {
    fetch('/api/social-accounts')
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts || []));
  }

  useEffect(() => {
    load();
    loadAccounts();
  }, []);

  function startAddAccount(platform: string) {
    setAddingPlatform(platform);
    setEditingAccountId(null);
    setAccountForm({ account_name: '', setting_note: '', admin_email: '', admin_phone: '', credentials: {} });
    setVerifyResult(null);
  }

  function startEditAccount(a: SocialAccount) {
    setAddingPlatform(a.platform);
    setEditingAccountId(a.id);
    setAccountForm({
      account_name: a.account_name,
      setting_note: a.setting_note || '',
      admin_email: a.admin_email || '',
      admin_phone: a.admin_phone || '',
      credentials: a.credentials || {},
    });
    setVerifyResult(null);
  }

  function cancelAccountForm() {
    setAddingPlatform(null);
    setEditingAccountId(null);
  }

  function setCredentialField(key: string, value: string) {
    setAccountForm((f) => ({ ...f, credentials: { ...f.credentials, [key]: value } }));
  }

  async function saveAccount(platform: string) {
    if (!accountForm.account_name.trim()) return;
    setSavingAccount(true);
    try {
      if (editingAccountId) {
        await fetch(`/api/social-accounts/${editingAccountId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(accountForm),
        });
      } else {
        await fetch('/api/social-accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform, ...accountForm }),
        });
      }
      cancelAccountForm();
      loadAccounts();
    } finally {
      setSavingAccount(false);
    }
  }

  async function deleteAccount(id: string) {
    if (!confirm('이 계정을 삭제할까요?')) return;
    await fetch(`/api/social-accounts/${id}`, { method: 'DELETE' });
    loadAccounts();
  }

  // 2026-09-17(11차) 추가 — 사용자 요청: "업데이트 버튼을 하나 만들어줘~ 업데이트 버튼
  // 클릭하면 채널이름과 핸들 로고 가져와서 저장해". 유튜브에서 채널명/핸들을 바꿔도
  // account_name(등록 당시 직접 입력한 이름표)은 자동으로 안 바뀌는 걸 겪어서(Down_Tools→
  // 반전경제학 개명 후 목록엔 여전히 @Down_Tools로 남아있었음), 저장된 자격증명으로 실제
  // 채널 정보를 다시 조회해 동기화하는 버튼.
  const [syncingId, setSyncingId] = useState<string | null>(null);
  async function syncFromYoutube(id: string) {
    setSyncingId(id);
    try {
      const res = await fetch(`/api/social-accounts/${id}/sync`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || '업데이트 실패');
        return;
      }
      loadAccounts();
    } finally {
      setSyncingId(null);
    }
  }

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(s: Site) {
    setEditingId(s.id);
    setForm({
      name: s.name || '',
      admin_email: s.admin_email || '',
      github_url: s.github_url || [],
      vercel_url: s.vercel_url || [],
      live_url: s.live_url || [],
      supabase_url: s.supabase_url || [],
      benchmark_url: s.benchmark_url || [],
      notes: s.notes || '',
      start_date: s.start_date || '',
      plan_file_url: s.plan_file_url || '',
      plan_file_name: s.plan_file_name || '',
    });
    setShowForm(true);
  }

  function setArrayValue(field: ArrayField, index: number, value: string) {
    setForm((f) => {
      const arr = f[field].length > 0 ? [...f[field]] : [''];
      arr[index] = value;
      return { ...f, [field]: arr };
    });
  }

  function addArrayRow(field: ArrayField) {
    setForm((f) => ({ ...f, [field]: [...(f[field].length > 0 ? f[field] : ['']), ''] }));
  }

  function removeArrayRow(field: ArrayField, index: number) {
    setForm((f) => {
      const arr = f[field].filter((_, i) => i !== index);
      return { ...f, [field]: arr.length > 0 ? arr : [''] };
    });
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        github_url: form.github_url.map((v) => v.trim()).filter(Boolean),
        vercel_url: form.vercel_url.map((v) => v.trim()).filter(Boolean),
        live_url: form.live_url.map((v) => v.trim()).filter(Boolean),
        supabase_url: form.supabase_url.map((v) => v.trim()).filter(Boolean),
        benchmark_url: form.benchmark_url.map((v) => v.trim()).filter(Boolean),
      };
      if (editingId) {
        await fetch(`/api/sites/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch('/api/sites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      setShowForm(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function handleFileUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '업로드 실패');
      setForm((f) => ({ ...f, plan_file_url: data.url, plan_file_name: data.name }));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('이 도구(사이트)를 목록에서 삭제할까요?')) return;
    await fetch(`/api/sites/${id}`, { method: 'DELETE' });
    load();
  }

  const groups: { email: string; sites: Site[] }[] = [];
  for (const email of KNOWN_EMAILS) {
    const matched = sites.filter((s) => s.admin_email === email);
    if (matched.length > 0) groups.push({ email, sites: matched });
  }
  for (const s of sites) {
    const email = s.admin_email || '';
    if ((!email || !KNOWN_EMAILS.includes(email)) && !groups.some((g) => g.email === (email || '__unassigned__'))) {
      const key = email || '__unassigned__';
      groups.push({ email: key, sites: sites.filter((x) => (x.admin_email || '__unassigned__') === key) });
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-black">🏠 HongHub</h1>
            <p className="text-xs text-neutral-400 mt-1">내 도구(사이트) 계정을 한눈에 모아보는 관리 허브</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/todos"
              className="text-xs font-black px-5 py-3 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white"
            >
              ✅ 오늘의 할일
            </Link>
            <Link
              href="/pipelines"
              className="text-xs font-black px-5 py-3 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white"
            >
              🧪 파이프라인
            </Link>
            <Link
              href="/sources"
              className="text-xs font-black px-5 py-3 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white"
            >
              🎯 소스 발굴
            </Link>
            <Link
              href="/benchmarks"
              className="text-xs font-black px-5 py-3 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white"
            >
              🔍 벤치마킹 아이템
            </Link>
            <Link
              href="/connectors"
              className="text-xs font-black px-5 py-3 rounded-lg border border-neutral-200 hover:border-neutral-400 bg-white"
            >
              🔌 MCP 커넥터
            </Link>
            <button onClick={openAdd} className="bg-black text-white text-xs font-black px-5 py-3 rounded-lg hover:bg-neutral-800">
              + 도구(사이트) 추가
            </button>
            <button
              onClick={() => fetch('/api/auth/logout', { method: 'POST' }).then(() => (window.location.href = '/login'))}
              className="text-xs text-neutral-400 font-bold px-3 py-3 hover:text-black"
            >
              로그아웃
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-8">
          {QUICK_LINKS.map((l) => (
            <a
              key={l.label}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-bold bg-white border border-neutral-200 hover:border-neutral-400 px-4 py-2.5 rounded-full shadow-sm"
            >
              <span>{l.icon}</span> {l.label}
            </a>
          ))}
        </div>

        {/* 2026-09-17 신설 — 사용자 요청: "이 탭들에 링크만 있는데 수정해서 계정 채널
            셋팅들을 하게 해두자". 위 버튼들은 그대로 외부 링크로 두고, 그 아래에 플랫폼별
            계정(채널명/API·설정 메모)을 등록·관리하는 섹션을 별도로 추가한다. */}
        <div className="mb-8">
          <h2 className="text-xs font-black text-neutral-400 mb-3">🔐 플랫폼 계정 관리</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {QUICK_LINKS.map((l) => {
              const platformAccounts = accounts.filter((a) => a.platform === l.platform);
              const isFormOpen = addingPlatform === l.platform;
              return (
                <div key={l.platform} className="bg-white border border-neutral-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-black flex items-center gap-1.5">
                      <span>{l.icon}</span>
                      {l.label}
                    </span>
                    {!isFormOpen && (
                      <span className="flex items-center gap-2 shrink-0">
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] font-bold text-neutral-400 hover:text-black hover:underline"
                        >
                          바로가기 ↗
                        </a>
                        <button onClick={() => startAddAccount(l.platform)} className="text-[11px] font-bold text-blue-600 hover:underline">
                          + 계정 추가
                        </button>
                      </span>
                    )}
                  </div>
                  {platformAccounts.length === 0 && !isFormOpen && <p className="text-[11px] text-neutral-300">등록된 계정 없음</p>}
                  {platformAccounts.length > 0 && (
                    <div className="space-y-2">
                      {sortGroupsByProgress(groupAccountsByEmail(platformAccounts)).map((group) => (
                        <div key={group.email || '__none__'} className={group.email ? 'border border-neutral-200 rounded-lg p-1.5' : ''}>
                          {group.email && (
                            <p className="inline-block text-[11px] font-black text-neutral-700 bg-neutral-100 rounded px-1.5 py-0.5 mb-1.5">
                              ✉️ {group.email}
                            </p>
                          )}
                          <div className="space-y-1.5">
                            {group.accounts.map((a) => {
                              const badge = getYoutubeConnectionBadge(a);
                              const avatarUrl = a.credentials?._avatar_url;
                              const canSync = a.platform === 'youtube' && !!a.credentials?.refresh_token;
                              return (
                              <div key={a.id}>
                                <div className="flex items-start justify-between gap-2 bg-neutral-50 rounded-lg px-2 py-1.5">
                                  <div className="flex items-start gap-2 min-w-0">
                                    {avatarUrl && (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={avatarUrl} alt="" className="w-6 h-6 rounded-full shrink-0 mt-0.5" />
                                    )}
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <p className="text-[11px] font-bold truncate">{a.account_name}</p>
                                        {badge && (
                                          <span className={`shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-full ${badge.className}`}>{badge.label}</span>
                                        )}
                                      </div>
                                      {!group.email && a.admin_email && (
                                        <p className="text-[10px] text-neutral-400 truncate">✉️ {a.admin_email}</p>
                                      )}
                                      {a.admin_phone && <p className="text-[10px] text-neutral-400 truncate">📞 {a.admin_phone}</p>}
                                      {a.setting_note && <p className="text-[10px] text-neutral-400 truncate">{a.setting_note}</p>}
                                    </div>
                                  </div>
                                  <div className="flex gap-1.5 shrink-0">
                                    {canSync && (
                                      <button
                                        onClick={() => syncFromYoutube(a.id)}
                                        disabled={syncingId === a.id}
                                        title="유튜브에서 채널명·핸들·프로필 사진 다시 가져오기"
                                        className="text-[10px] font-bold text-neutral-500 hover:underline disabled:opacity-40"
                                      >
                                        {syncingId === a.id ? '업데이트 중...' : '🔄 업데이트'}
                                      </button>
                                    )}
                                    <button onClick={() => startEditAccount(a)} className="text-[10px] font-bold text-blue-600 hover:underline">
                                      수정
                                    </button>
                                    <button onClick={() => deleteAccount(a.id)} className="text-[10px] font-bold text-red-500 hover:underline">
                                      삭제
                                    </button>
                                  </div>
                                </div>
                                {editingAccountId === a.id && renderAccountForm(l.platform)}
                              </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {isFormOpen && !editingAccountId && renderAccountForm(l.platform)}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mb-8">
          <h2 className="text-xs font-black text-neutral-400 mb-3">📚 가이드 문서</h2>
          <div className="grid md:grid-cols-3 gap-3">
            {GUIDE_DOCS.map((d) => (
              <a
                key={d.url}
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-white border border-neutral-200 hover:border-neutral-400 rounded-xl p-4 shadow-sm"
              >
                <div className="text-xl mb-1">{d.icon}</div>
                <div className="text-xs font-black mb-1">{d.label}</div>
                <div className="text-[11px] text-neutral-400">{d.desc}</div>
              </a>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-neutral-400 text-center py-20">불러오는 중...</div>
        ) : sites.length === 0 ? (
          <div className="border border-dashed border-neutral-300 rounded-xl p-16 text-center text-sm text-neutral-400">
            아직 등록된 도구(사이트)가 없어요. &quot;+ 도구(사이트) 추가&quot;로 시작해보세요.
          </div>
        ) : (
          <div className="space-y-8">
            {groups.map((g) => (
              <div key={g.email}>
                <h2 className="text-xs font-black text-neutral-400 mb-3 flex items-center gap-2">
                  {g.email === '__unassigned__' ? '📭 미분류' : `✉️ ${g.email}`}
                  <span className="font-normal">({g.sites.length})</span>
                </h2>
                <div className="grid md:grid-cols-2 gap-4">
                  {g.sites.map((s) => (
                    <div key={s.id} className="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="font-black text-base">{s.name}</h3>
                        <div className="flex gap-2 flex-shrink-0">
                          <button onClick={() => openEdit(s)} className="text-[11px] text-neutral-400 font-bold hover:text-black">
                            수정
                          </button>
                          <button onClick={() => handleDelete(s.id)} className="text-[11px] text-red-400 font-bold hover:text-red-600">
                            삭제
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-3 text-[11px] text-neutral-400 mb-3">
                        {s.start_date && <span>📅 {s.start_date} 시작</span>}
                        <Link href={`/plan/${s.id}`} className="text-blue-500 font-bold hover:underline">
                          📋 {s.plan_content ? '계획서 보기' : '계획서 작성'}
                        </Link>
                        {s.plan_file_url && (
                          <a href={s.plan_file_url} target="_blank" rel="noopener noreferrer" className="text-neutral-400 font-bold hover:underline">
                            📎 {s.plan_file_name || '이전 업로드 파일'}
                          </a>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {LINK_FIELDS.map((f) => {
                          const urls = (s[f.key] as string[] | null) || [];
                          return urls.map((url, i) => (
                            <a
                              key={`${f.key}-${i}`}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] font-bold bg-neutral-100 hover:bg-neutral-200 px-3 py-1.5 rounded-full"
                            >
                              {f.icon} {f.label}
                              {urls.length > 1 ? ` ${i + 1}` : ''}
                            </a>
                          ));
                        })}
                      </div>
                      {s.notes && (
                        <p className="text-xs text-neutral-500 whitespace-pre-wrap border-t border-neutral-100 pt-3">{s.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white p-6 max-w-md w-full rounded-xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-black mb-4">{editingId ? '도구(사이트) 수정' : '+ 도구(사이트) 추가'}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">도구(사이트) 이름 *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="도구(사이트) 이름"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">관리 이메일</label>
                <input
                  value={form.admin_email}
                  onChange={(e) => setForm((f) => ({ ...f, admin_email: e.target.value }))}
                  placeholder="관리 이메일"
                  list="known-emails"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <datalist id="known-emails">
                {KNOWN_EMAILS.map((e) => (
                  <option key={e} value={e} />
                ))}
              </datalist>

              {LINK_FIELDS.map((lf) => (
                <div key={lf.key}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] text-neutral-400 font-bold">
                      {lf.icon} {lf.label}
                    </label>
                    <button
                      type="button"
                      onClick={() => addArrayRow(lf.key as ArrayField)}
                      className="text-[11px] text-blue-500 font-bold hover:underline"
                    >
                      + 추가
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {toDisplayArray(form[lf.key as ArrayField]).map((v, i) => (
                      <div key={i} className="flex gap-1.5">
                        <input
                          value={v}
                          onChange={(e) => setArrayValue(lf.key as ArrayField, i, e.target.value)}
                          placeholder={`${lf.label} URL`}
                          className="flex-1 min-w-0 border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                        />
                        {toDisplayArray(form[lf.key as ArrayField]).length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeArrayRow(lf.key as ArrayField, i)}
                            className="text-red-400 font-bold px-2 flex-shrink-0"
                          >
                            제거
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">시작 날짜</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] text-neutral-400 font-bold mb-1 block">메모</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="메모"
                  rows={3}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"
                />
              </div>
              <div className="border-t border-neutral-100 pt-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] text-neutral-400 font-bold">계획서 파일</label>
                  <a href="/PLAN_TEMPLATE.md" target="_blank" className="text-[11px] text-blue-500 font-bold hover:underline">
                    📄 표준 템플릿 보기
                  </a>
                </div>
                {form.plan_file_url ? (
                  <div className="flex items-center justify-between bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-xs">
                    <a href={form.plan_file_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 font-bold truncate">
                      📎 {form.plan_file_name}
                    </a>
                    <button
                      onClick={() => setForm((f) => ({ ...f, plan_file_url: '', plan_file_name: '' }))}
                      className="text-red-400 font-bold ml-2 flex-shrink-0"
                    >
                      제거
                    </button>
                  </div>
                ) : (
                  <input
                    type="file"
                    onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                    disabled={uploading}
                    className="w-full text-xs"
                  />
                )}
                {uploading && <div className="text-[11px] text-neutral-400 mt-1">업로드 중...</div>}
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowForm(false)} className="flex-1 border border-neutral-200 text-xs font-black py-3 rounded-lg">
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                className="flex-1 bg-black text-white text-xs font-black py-3 rounded-lg disabled:opacity-40"
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
