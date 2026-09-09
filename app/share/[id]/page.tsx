import { getSupabaseServerClient } from '@/lib/supabase';

// 2026-09-07 신설 — 비밀번호 게이트 없이 특정 사이트 하나를 읽기 전용으로 보여주는 공개 페이지.
// 제미나이 등 외부 AI 도구에 홍허브 콘텐츠를 링크로 바로 보여주기 위한 용도(사용자 지시).
// URL이 사이트의 UUID를 그대로 쓰기 때문에 "링크를 아는 사람만" 접근 가능 — 목록/검색에는 노출 안 됨.
// middleware.ts의 PUBLIC_PATHS에 /share가 등록돼 있어야 로그인 없이 열린다.
// 수정 폼·버튼은 전혀 없다 — 읽기 전용. Supabase는 서버에서 service role로 직접 조회(별도 공개 API 안 만듦).

type ContentUnit = {
  id: string;
  title: string;
  material: string;
  script: string;
  status?: string;
  topic?: string;
};

type ChannelCharacter = {
  id: string;
  name: string;
  role: string;
  description: string;
  imageUrl?: string;
};

type ScriptDraft = {
  units?: ContentUnit[];
  characters?: ChannelCharacter[];
};

// hub_source_channels.notes에 붙는 "[파이프라인:{사이트명}]" 태그 — page.tsx의 CHANNEL_TAG_RE와 동일한 패턴.
const CHANNEL_TAG_RE = /^\[파이프라인:([^\]]+)\]\s*/;

// "109.5만" / "1.2억" 같은 한글 조회수 표기를 실제 숫자로 변환 — 100만 이상만 벤치마크로 걸러내기 위함
// (사용자 지시: "100만 이상 터진것만 전달해" — 40~90만대까지 다 보여주면 진짜 히트작 신호가 희석된다).
function parseViews(views: string | null): number {
  if (!views) return 0;
  const m = views.match(/^([\d.]+)\s*(억|만)?/);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  if (isNaN(num)) return 0;
  if (m[2] === '억') return num * 100000000;
  if (m[2] === '만') return num * 10000;
  return num;
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseServerClient();
  const { data: site, error } = await supabase
    .from('hub_sites')
    .select('id, name, plan_content, workflow_content, script_draft')
    .eq('id', id)
    .maybeSingle();

  if (error || !site) {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center text-neutral-500">
        <p className="text-sm font-bold">이 링크로 볼 수 있는 콘텐츠를 찾지 못했습니다.</p>
      </div>
    );
  }

  const units: ContentUnit[] = (site.script_draft as ScriptDraft)?.units || [];
  // 폐기된 대안 캐릭터 후보(role이 "Alternate..."로 시작)는 혼동을 막기 위해 제외 — 확정된 진행자만 보여준다.
  const characters: ChannelCharacter[] = ((site.script_draft as ScriptDraft)?.characters || []).filter(
    (c) => !c.role?.startsWith('Alternate')
  );

  // 2026-09-07 추가 — 이 채널이 벤치마킹하는 채널들(1번 단계 등록분)의 실제 고조회수 대본(3번 단계 수집분)도
  // 같이 보여준다. 대본 작성용 제미나이 프롬프트가 이 링크를 참고 자료로 걸기 때문에, 여기 없으면
  // "100만 대본 참고해서 써줘"라는 지시가 있어도 제미나이가 실제로 읽을 게 없다(사용자 지시로 신설).
  const { data: allChannels } = await supabase.from('hub_source_channels').select('id, name, notes, url');
  const myChannelIds = (allChannels || [])
    .filter((c) => c.notes?.match(CHANNEL_TAG_RE)?.[1] === site.name)
    .map((c) => c.id);
  const channelNameById = new Map((allChannels || []).map((c) => [c.id, c.name]));

  let benchmarkItems: { id: string; title: string; views: string | null; transcript: string | null; channel_id: string | null }[] = [];
  if (myChannelIds.length > 0) {
    const { data: items } = await supabase
      .from('hub_source_items')
      .select('id, title, views, transcript, channel_id')
      .in('channel_id', myChannelIds)
      .not('transcript', 'is', null);
    // 100만 조회수 미만은 제외 — "100만 이상 터진 것만" 벤치마크로 전달한다(사용자 지시).
    benchmarkItems = (items || []).filter((it) => parseViews(it.views) >= 1000000).sort((a, b) => parseViews(b.views) - parseViews(a.views));
  }

  return (
    <div className="max-w-3xl mx-auto p-6 sm:p-10 space-y-8">
      <header className="border-b border-neutral-200 pb-4">
        <p className="text-[11px] font-black text-neutral-400 uppercase tracking-wide">HongHub · 읽기 전용 공유</p>
        <h1 className="text-2xl font-black text-neutral-900 mt-1">{site.name}</h1>
      </header>

      {characters.length > 0 && (
        <section>
          <h2 className="text-lg font-black text-neutral-800 mb-3">채널 캐릭터</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {characters.map((c) => (
              <div key={c.id} className="border border-neutral-200 rounded-xl p-4">
                {c.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.imageUrl} alt={c.name} className="w-full rounded-lg border border-neutral-100 mb-3" />
                )}
                <h3 className="text-sm font-black text-neutral-900">{c.name}</h3>
                <p className="text-[11px] text-neutral-400 mb-1.5">{c.role}</p>
                {c.imageUrl && (
                  <a href={c.imageUrl} target="_blank" rel="noopener noreferrer" className="block text-[11px] text-blue-600 hover:underline break-all mb-1.5">
                    {c.imageUrl}
                  </a>
                )}
                <p className="text-[12px] text-neutral-600 leading-relaxed whitespace-pre-wrap">{c.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {benchmarkItems.length > 0 && (
        <section>
          <h2 className="text-lg font-black text-neutral-800 mb-3">벤치마크 대본 (조회수 100만 이상 영상 {benchmarkItems.length}개)</h2>
          <p className="text-xs text-neutral-500 mb-3">
            이 채널이 참고하는 채널들의 실제 대본입니다. 대본 작성 시 이 리듬·구조·훅 패턴을 참고하되, 문장을 그대로 베끼지 말고 완전히 새로 쓸 것.
          </p>
          <div className="space-y-4">
            {benchmarkItems.map((it) => (
              <details key={it.id} className="border border-neutral-200 rounded-xl p-4">
                <summary className="cursor-pointer text-sm font-black text-neutral-900">
                  {it.title || '(제목 없음)'} {it.views ? `· 조회수 ${it.views}` : ''}
                  {it.channel_id && channelNameById.get(it.channel_id) ? ` · ${channelNameById.get(it.channel_id)}` : ''}
                </summary>
                <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-neutral-700 font-sans mt-3">
                  {it.transcript}
                </pre>
              </details>
            ))}
          </div>
        </section>
      )}

      {units.length > 0 && (
        <section>
          <h2 className="text-lg font-black text-neutral-800 mb-3">콘텐츠 유닛</h2>
          <div className="space-y-6">
            {units.map((u) => (
              <article key={u.id} className="border border-neutral-200 rounded-xl p-4">
                <p className="text-[10px] font-black text-neutral-400 uppercase mb-1">
                  {u.topic || ''} {u.status ? `· ${u.status}` : ''}
                </p>
                <h3 className="text-base font-black text-neutral-900 mb-1">{u.title || '(제목 없음)'}</h3>
                {u.material && <p className="text-xs text-neutral-500 mb-3">{u.material}</p>}
                {u.script && (
                  <pre className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-neutral-800 font-sans">
                    {u.script}
                  </pre>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {site.workflow_content && (
        <section>
          <h2 className="text-lg font-black text-neutral-800 mb-3">워크플로우</h2>
          <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-neutral-700 font-sans bg-neutral-50 rounded-xl p-4 border border-neutral-200">
            {site.workflow_content}
          </pre>
        </section>
      )}

      {site.plan_content && (
        <section>
          <h2 className="text-lg font-black text-neutral-800 mb-3">계획서</h2>
          <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-neutral-700 font-sans bg-neutral-50 rounded-xl p-4 border border-neutral-200">
            {site.plan_content}
          </pre>
        </section>
      )}
    </div>
  );
}
