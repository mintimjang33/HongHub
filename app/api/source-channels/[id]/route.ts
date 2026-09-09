import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase';

const FIELDS = ['name', 'platform', 'url', 'subscriber_count', 'notes', 'status'];
const ARRAY_FIELDS = ['content_types', 'platform_fit'];

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: '요청 본문이 필요합니다.' }, { status: 400 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of FIELDS) if (f in body) update[f] = body[f] || null;
  for (const f of ARRAY_FIELDS) if (f in body) update[f] = Array.isArray(body[f]) ? body[f] : [];

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('hub_source_channels').update(update).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ channel: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from('hub_source_channels').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
