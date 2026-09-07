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

type ScriptDraft = {
  units?: ContentUnit[];
};

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

  return (
    <div className="max-w-3xl mx-auto p-6 sm:p-10 space-y-8">
      <header className="border-b border-neutral-200 pb-4">
        <p className="text-[11px] font-black text-neutral-400 uppercase tracking-wide">HongHub · 읽기 전용 공유</p>
        <h1 className="text-2xl font-black text-neutral-900 mt-1">{site.name}</h1>
      </header>

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
