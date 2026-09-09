import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase';

const FIELDS = ['platform', 'account_name', 'post_url', 'content', 'engagement', 'analysis', 'sort_order'];

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: '요청 본문이 필요합니다.' }, { status: 400 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of FIELDS) if (f in body) update[f] = body[f] || null;

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('hub_viral_posts').update(update).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ post: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from('hub_viral_posts').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
