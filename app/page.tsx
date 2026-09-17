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
const CREDENTIAL_FIELDS: Record<string, { key: string; label: string; help: string }[]> = {
  youtube: [
    { key: 'client_id', label: 'OAuth Client ID', help: '구글 클라우드 콘솔(console.cloud.google.com) → API 및 서비스 → 사용자 인증 정보에서 발급' },
    { key: 'client_secret', label: 'OAuth Client Secret', help: '위 Client ID와 같은 화면에서 같이 발급됩니다' },
    { key: 'refresh_token', label: 'Refresh Token', help: '이 채널 계정으로 최초 1회 로그인·동의(OAuth 승인)를 거쳐야 발급됩니다 — 자동화가 대신 로그인할 수 없어 직접 하셔야 합니다' },
    { key: 'channel_id', label: '채널 ID', help: 'YouTube Studio → 설정 → 채널 → 고급 설정에서 확인. 예: UCxxxxxxxxxxxxxxxx' },
  ],
  instagram: [
    { key: 'app_id', label: 'Meta App ID', help: 'developers.facebook.com/apps 에서 앱 생성 후 발급 — 인스타·쓰레드·페이스북이 앱 하나를 같이 씁니다' },
    { key: 'app_secret', label: 'Meta App Secret', help: '위 App ID와 같은 앱 대시보드의 "설정 → 기본 설정"에서 확인' },
    { key: 'ig_business_id', label: 'Instagram 비즈니스 계정 ID', help: '인스타그램 계정을 비즈니스/크리에이터 계정으로 전환하고 페이스북 페이지와 연결해야 발급됩니다' },
    { key: 'access_token', label: 'Access Token', help: '이 계정 전용 장기 액세스 토큰 — 앱 대시보드에서 이 계정으로 로그인 승인 후 발급' },
  ],
  threads: [
    { key: 'app_id', label: 'Meta App ID', help: 'developers.facebook.com/apps 에서 앱 생성 후 발급 — 인스타·쓰레드·페이스북이 앱 하나를 같이 씁니다' },
    { key: 'app_secret', label: 'Meta App Secret', help: '위 App ID와 같은 앱 대시보드의 "설정 → 기본 설정"에서 확인' },
    { key: 'threads_user_id', label: 'Threads 사용자 ID', help: '이 계정으로 앱에 로그인 승인한 뒤 발급되는 사용자 ID' },
    { key: 'access_token', label: 'Access Token', help: '이 계정 전용 토큰 — threads_content_publish 등 필요한 권한(scope)을 승인받아야 함' },
  ],
  facebook: [
    { key: 'app_id', label: 'Meta App ID', help: 'developers.facebook.com/apps 에서 앱 생성 후 발급 — 인스타·쓰레드·페이스북이 앱 하나를 같이 씁니다' },
    { key: 'app_secret', label: 'Meta App Secret', help: '위 App ID와 같은 앱 대시보드의 "설정 → 기본 설정"에서 확인' },
    { key: 'page_id', label: '페이지 ID', help: '올릴 페이스북 페이지의 "페이지 정보 → 페이지 투명성"에서 확인' },
    { key: 'page_access_token', label: 'Page Access Token', help: '이 페이지 전용 액세스 토큰 — Graph API 탐색기 등에서 발급' },
  ],
  tiktok: [
    { key: 'client_key', label: 'Client Key', help: 'developers.tiktok.com에서 앱 등록 후 발급(Content Posting API는 별도 승인 필요)' },
    { key: 'client_secret', label: 'Client Secret', help: '위 Client Key와 같은 화면에서 같이 발급' },
    { key: 'access_token', label: 'Access Token', help: '이 계정으로 로그인 승인 후 발급되는 토큰' },
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
                    <div className="space-y-1.5">
                      {platformAccounts.map((a) => (
                        <div key={a.id} className="flex items-start justify-between gap-2 bg-neutral-50 rounded-lg px-2 py-1.5">
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold truncate">{a.account_name}</p>
                            {a.admin_email && <p className="text-[10px] text-neutral-400 truncate">✉️ {a.admin_email}</p>}
                            {a.admin_phone && <p className="text-[10px] text-neutral-400 truncate">📞 {a.admin_phone}</p>}
                            {a.setting_note && <p className="text-[10px] text-neutral-400 truncate">{a.setting_note}</p>}
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            <button onClick={() => startEditAccount(a)} className="text-[10px] font-bold text-blue-600 hover:underline">
                              수정
                            </button>
                            <button onClick={() => deleteAccount(a.id)} className="text-[10px] font-bold text-red-500 hover:underline">
                              삭제
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {isFormOpen && (
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
                      {/* 2026-09-17 신설 — 사용자 지적: "그걸 셋팅하려면 뭐가 필요한지를 만들어야
                          정보를 입력해두지". 플랫폼마다 실제 API 연동에 필요한 자격증명이 달라서
                          (/docs/API_SETUP_GUIDE.md 참고) CREDENTIAL_FIELDS로 플랫폼별 입력칸을
                          다르게 그린다. 네이버 블로그는 공식 포스팅 API가 없어서 안내만 띄운다. */}
                      {CREDENTIAL_FIELDS[l.platform].length > 0 ? (
                        <div className="space-y-1.5 border border-dashed border-neutral-200 rounded-lg p-2">
                          <p className="text-[10px] font-black text-neutral-400">🔑 API 연동 정보</p>
                          {CREDENTIAL_FIELDS[l.platform].map((field) => {
                            const helpKey = `${l.platform}:${field.key}`;
                            const isHelpOpen = openHelpKeys.has(helpKey);
                            const isCredVisible = visibleCredKeys.has(helpKey);
                            const credValue = accountForm.credentials[field.key] || '';
                            return (
                              <div key={field.key}>
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
                                  <div className="flex items-start justify-between gap-2 bg-blue-50 border border-blue-100 rounded-lg px-2 py-1.5 mt-1">
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
                          onClick={() => saveAccount(l.platform)}
                          disabled={savingAccount || !accountForm.account_name.trim()}
                          className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-black text-white disabled:opacity-40"
                        >
                          {savingAccount ? '저장 중...' : '저장'}
                        </button>
                      </div>
                    </div>
                  )}
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
