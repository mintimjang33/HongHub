import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('uc_jobs').select('status, transcript, title, lang, error').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: '작업을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json(data);
}
