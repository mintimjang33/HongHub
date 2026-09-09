import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';

// ut_personas / ut_system_personas는 유쓰레드가 만든 테이블이지만
// HongHub와 같은 Supabase 프로젝트를 쓰고 있어서 그대로 조회 가능하다.
export async function GET() {
  const supabase = getSupabaseServerClient();

  const [{ data: personas, error: e1 }, { data: systemPersonas, error: e2 }] = await Promise.all([
    supabase.from('ut_personas').select('id, name, tone_prompt, target_prompt').order('created_at', { ascending: false }),
    supabase.from('ut_system_personas').select('id, name, prompt').order('sort_order'),
  ]);

  if (e1 || e2) return NextResponse.json({ error: (e1 || e2)?.message }, { status: 500 });

  const normalizedSystem = (systemPersonas || []).map((p) => ({
    id: p.id,
    name: `${p.name} (기본)`,
    tone_prompt: p.prompt,
    target_prompt: '',
    is_system: true,
  }));

  return NextResponse.json({ personas: [...(personas || []).map((p) => ({ ...p, is_system: false })), ...normalizedSystem] });
}
