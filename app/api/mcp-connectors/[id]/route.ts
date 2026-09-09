import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase';

const FIELDS = ['name', 'url', 'admin_email', 'tags', 'connected', 'site_id', 'notes', 'sort_order'];

function toTagArray(value: unknown): string[] | null {
  const arr = Array.isArray(value) ? value : value ? [value] : [];
  const cleaned = arr.map((v) => String(v).trim()).filter(Boolean);
  return cleaned.length ? cleaned : null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: '요청 본문이 필요합니다.' }, { status: 400 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of FIELDS) {
    if (!(f in body)) continue;
    if (f === 'tags') update.tags = toTagArray(body.tags);
    else if (f === 'connected') update.connected = !!body.connected;
    else update[f] = body[f] || null;
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('hub_mcp_connectors').update(update).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connector: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from('hub_mcp_connectors').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
