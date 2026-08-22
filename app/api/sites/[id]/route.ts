import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase';

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
    'notes',
    'start_date',
    'plan_file_url',
    'plan_file_name',
    'sort_order',
  ];
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of fields) if (f in body) update[f] = body[f] || null;

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
