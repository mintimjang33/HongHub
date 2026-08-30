import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';

// U-Caption과 같은 Supabase 프로젝트를 쓰므로 uc_jobs 테이블에 직접 큐를 등록할 수 있다
// (U-Caption의 REST API는 UC_SHARED_SECRET으로 막혀있지만, 이건 그 API를 거치지 않고
// 같은 DB 테이블에 바로 쓰는 것이라 별도 인증이 필요 없다).
// 이 PC에서 U-Caption 크롬 확장이 켜져 있어야 로컬 워커가 큐를 폴링해서 실제로 처리한다.
function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (u.hostname.endsWith('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const shortsMatch = u.pathname.match(/^\/shorts\/([^/?]+)/);
      if (shortsMatch) return shortsMatch[1];
    }
  } catch {
    // not a valid URL
  }
  return null;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const url = body?.url?.trim();
  if (!url) return NextResponse.json({ error: 'url이 필요합니다.' }, { status: 400 });

  const videoId = extractVideoId(url);
  if (!videoId) return NextResponse.json({ error: '유효한 유튜브 링크가 아닙니다.' }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('uc_jobs')
    .insert({ video_id: videoId, url, status: 'queued' })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ jobId: data.id });
}
