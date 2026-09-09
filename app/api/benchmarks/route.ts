import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';

export async function GET() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('hub_benchmarks').select('*').order('sort_order').order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ benchmarks: data || [] });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.name?.trim()) return NextResponse.json({ error: 'name이 필요합니다.' }, { status: 400 });
  if (!body?.url?.trim()) return NextResponse.json({ error: 'url이 필요합니다.' }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('hub_benchmarks')
    .insert({
      name: body.name.trim(),
      url: body.url.trim(),
      type: body.type || 'site',
      status: body.status || '후보',
      notes: body.notes || null,
      site_id: body.site_id || null,
      source_name: body.source_name?.trim() || null,
      source_urls: Array.isArray(body.source_urls) ? body.source_urls.map((u: string) => u.trim()).filter(Boolean) : null,
      kind: body.kind === 'account_collection' ? 'account_collection' : 'item',
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ benchmark: data });
}
