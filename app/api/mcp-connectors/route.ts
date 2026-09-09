import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';

function toTagArray(value: unknown): string[] | null {
  const arr = Array.isArray(value) ? value : value ? [value] : [];
  const cleaned = arr.map((v) => String(v).trim()).filter(Boolean);
  return cleaned.length ? cleaned : null;
}

export async function GET() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('hub_mcp_connectors').select('*').order('sort_order').order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connectors: data || [] });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.name?.trim()) return NextResponse.json({ error: 'name이 필요합니다.' }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('hub_mcp_connectors')
    .insert({
      name: body.name.trim(),
      url: body.url?.trim() || null,
      admin_email: body.admin_email || null,
      tags: toTagArray(body.tags),
      connected: body.connected !== false,
      site_id: body.site_id || null,
      notes: body.notes || null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connector: data });
}
