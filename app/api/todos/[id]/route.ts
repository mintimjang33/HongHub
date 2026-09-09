import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: '요청 본문이 필요합니다.' }, { status: 400 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.content === 'string') update.content = body.content.trim();
  if (Array.isArray(body.attachments)) update.attachments = body.attachments;

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('hub_todos').update(update).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ todo: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from('hub_todos').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
