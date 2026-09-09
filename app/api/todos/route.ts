import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';

export async function GET() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('hub_todos').select('*').order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ todos: data || [] });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.content?.trim()) return NextResponse.json({ error: 'content가 필요합니다.' }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('hub_todos')
    .insert({
      content: body.content.trim(),
      attachments: Array.isArray(body.attachments) ? body.attachments : [],
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ todo: data });
}
