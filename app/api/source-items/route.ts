import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get('channel_id');

  const supabase = getSupabaseServerClient();
  let query = supabase.from('hub_source_items').select('*').order('created_at', { ascending: false });
  if (channelId) query = query.eq('channel_id', channelId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.title?.trim()) return NextResponse.json({ error: 'title이 필요합니다.' }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('hub_source_items')
    .insert({
      channel_id: body.channel_id || null,
      title: body.title.trim(),
      source_url: body.source_url?.trim() || null,
      views: body.views || null,
      content_type: body.content_type || null,
      platform_fit: Array.isArray(body.platform_fit) ? body.platform_fit : [],
      raw_notes: body.raw_notes || null,
      status: body.status || '미가공',
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}
