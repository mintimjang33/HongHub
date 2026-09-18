import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase';

// honghub-files 버킷에는 있지만 어떤 사이트의 plan_content(계획서 본문)에서도
// 마크다운 이미지로 참조되지 않는 "고아 파일"을 찾아서 목록으로 돌려준다.
// 삭제는 하지 않음(읽기 전용 진단) — 실제 삭제는 클라이언트가 이 목록을 보고
// 기존 DELETE /api/upload를 파일별로 호출한다.
export async function GET() {
  const supabase = getSupabaseServerClient();

  const { data: files, error: listError } = await supabase.storage.from('honghub-files').list('', {
    limit: 1000,
    sortBy: { column: 'created_at', order: 'desc' },
  });
  if (listError) return NextResponse.json({ error: listError.message }, { status: 500 });

  const { data: sites, error: sitesError } = await supabase.from('hub_sites').select('plan_content');
  if (sitesError) return NextResponse.json({ error: sitesError.message }, { status: 500 });

  const allPlanText = (sites || []).map((s) => s.plan_content || '').join('\n');

  const orphans = (files || [])
    .filter((f) => f.name && f.id) // 폴더(placeholder) 항목 제외
    .map((f) => {
      const { data } = supabase.storage.from('honghub-files').getPublicUrl(f.name);
      return {
        name: f.name,
        url: data.publicUrl,
        size: f.metadata?.size ?? null,
        createdAt: f.created_at,
      };
    })
    .filter((f) => !allPlanText.includes(f.url));

  return NextResponse.json({ orphans, totalFiles: files?.length ?? 0 });
}
