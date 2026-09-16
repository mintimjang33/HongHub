import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase';

const ARRAY_FIELDS = new Set(['github_url', 'vercel_url', 'live_url', 'supabase_url', 'benchmark_url', 'learning_url']);

function toUrlArray(value: unknown): string[] | null {
  const arr = Array.isArray(value) ? value : value ? [value] : [];
  const cleaned = arr.map((v) => String(v).trim()).filter(Boolean);
  return cleaned.length ? cleaned : null;
}

// 2026-09-17 추가 — 사용자 지적: "최종결정 누르고 반응이 엄청 느리네". 원인 확인 결과, 워크플로우
// 페이지 안 깊숙한 곳(렌더링 파일 선택/자막 선택 등 작은 저장 하나)에서 저장 후 호출하는
// onRefresh()가 지금까지 GET /api/sites(테이블 전체, 이 프로젝트 기준 23개 사이트 전부, ~400KB)를
// 다시 통째로 불러와서 그중 이 사이트 하나만 골라 쓰고 있었다 — 정작 필요한 건 이 사이트 하나뿐인데
// 관계없는 22개 사이트 데이터까지 매번 같이 받아온 것. 이 GET을 추가해서 workflow 페이지의
// loadSite()가 이 사이트 하나만 불러오도록 바꾼다(사이트가 늘어날수록 이 문제는 더 심해지므로
// 지금 고쳐두는 게 맞다).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('hub_sites').select('*').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: '사이트를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ site: data });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: '요청 본문이 필요합니다.' }, { status: 400 });

  const fields = [
    'name',
    'admin_email',
    'github_url',
    'vercel_url',
    'live_url',
    'supabase_url',
    'benchmark_url',
    'learning_url',
    'notes',
    'start_date',
    'plan_file_url',
    'plan_file_name',
    'plan_content',
    'workflow_content',
    'sort_order',
  ];
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of fields) if (f in body) update[f] = ARRAY_FIELDS.has(f) ? toUrlArray(body[f]) : body[f] || null;
  if ('analysis_result' in body) update.analysis_result = body.analysis_result || null;

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('hub_sites').update(update).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ site: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from('hub_sites').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
