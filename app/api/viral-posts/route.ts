import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';

export async function GET() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('hub_viral_posts').select('*').order('sort_order').order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ posts: data || [] });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.platform?.trim()) return NextResponse.json({ error: 'platform이 필요합니다.' }, { status: 400 });
  if (!body?.account_name?.trim()) return NextResponse.json({ error: 'account_name이 필요합니다.' }, { status: 400 });
  if (!body?.content?.trim()) return NextResponse.json({ error: 'content가 필요합니다.' }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('hub_viral_posts')
    .insert({
      platform: body.platform.trim(),
      account_name: body.account_name.trim(),
      post_url: body.post_url || null,
      content: body.content.trim(),
      engagement: body.engagement || null,
      analysis: body.analysis || null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ post: data });
}
