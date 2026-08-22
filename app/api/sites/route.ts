import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';

export async function GET() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('hub_sites').select('*').order('sort_order').order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sites: data || [] });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.name?.trim()) return NextResponse.json({ error: 'name이 필요합니다.' }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('hub_sites')
    .insert({
      name: body.name.trim(),
      admin_email: body.admin_email || null,
      github_url: body.github_url || null,
      vercel_url: body.vercel_url || null,
      live_url: body.live_url || null,
      supabase_url: body.supabase_url || null,
      benchmark_url: body.benchmark_url || null,
      notes: body.notes || null,
      start_date: body.start_date || null,
      plan_file_url: body.plan_file_url || null,
      plan_file_name: body.plan_file_name || null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ site: data });
}
