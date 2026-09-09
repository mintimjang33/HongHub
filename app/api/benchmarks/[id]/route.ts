import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase';

const FIELDS = ['name', 'url', 'type', 'status', 'notes', 'site_id', 'sort_order', 'source_name', 'kind'];

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: '요청 본문이 필요합니다.' }, { status: 400 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of FIELDS) if (f in body) update[f] = body[f] || null;
  if ('source_urls' in body) {
    update.source_urls = Array.isArray(body.source_urls)
      ? body.source_urls.map((u: string) => String(u).trim()).filter(Boolean)
      : null;
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('hub_benchmarks').update(update).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ benchmark: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from('hub_benchmarks').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
