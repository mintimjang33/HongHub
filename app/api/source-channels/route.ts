import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';

export async function GET() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('hub_source_channels')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ channels: data || [] });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.name?.trim()) return NextResponse.json({ error: 'name이 필요합니다.' }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('hub_source_channels')
    .insert({
      name: body.name.trim(),
      platform: body.platform || 'youtube',
      url: body.url?.trim() || null,
      subscriber_count: body.subscriber_count || null,
      content_types: Array.isArray(body.content_types) ? body.content_types : [],
      platform_fit: Array.isArray(body.platform_fit) ? body.platform_fit : [],
      notes: body.notes || null,
      status: body.status || '후보',
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ channel: data });
}
