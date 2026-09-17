import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase';

// 2026-09-17 신설 — 사용자 요청: "업데이트 버튼을 하나 만들어줘~ 업데이트 버튼 클릭하면
// 채널이름과 핸들 로고 가져와서 저장해". 유튜브에서 채널명/핸들을 바꿔도 HongHub에 저장해둔
// account_name은 등록 당시 직접 입력한 이름표라 자동으로 안 바뀌는 문제(실제로 Down_Tools를
// 반전경제학으로 바꾼 뒤 겪음)를 해결한다. 저장된 자격증명으로 실제 유튜브 채널 정보를 다시
// 조회해서 account_name(핸들)과 프로필 사진을 최신 상태로 동기화한다.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseServerClient();

  const { data: account, error: fetchError } = await supabase.from('hub_social_accounts').select('*').eq('id', id).maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!account) return NextResponse.json({ error: '계정을 찾을 수 없습니다.' }, { status: 404 });
  if (account.platform !== 'youtube') return NextResponse.json({ error: '아직 유튜브 계정만 지원합니다.' }, { status: 400 });

  const { client_id, client_secret, refresh_token } = account.credentials || {};
  if (!client_id || !client_secret || !refresh_token) {
    return NextResponse.json({ error: 'Client ID / Client Secret / Refresh Token이 먼저 등록돼있어야 합니다.' }, { status: 400 });
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id, client_secret, refresh_token, grant_type: 'refresh_token' }),
  });
  const tokenData = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok || !tokenData?.access_token) {
    return NextResponse.json({ error: tokenData?.error_description || tokenData?.error || '토큰 갱신 실패' }, { status: 400 });
  }

  const chRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const chData = await chRes.json().catch(() => null);
  if (!chRes.ok || !chData?.items?.length) {
    return NextResponse.json({ error: chData?.error?.message || '채널 정보를 가져오지 못했습니다.' }, { status: 400 });
  }

  const snippet = chData.items[0].snippet;
  const handle: string = snippet.customUrl?.startsWith('@') ? snippet.customUrl : `@${snippet.customUrl || snippet.title}`;
  const thumbnailUrl: string | undefined = snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url;

  // 프로필 사진은 구글 CDN URL을 그대로 저장(다운로드·재업로드 안 함 — 값이 자주 바뀌지 않고,
  // 이 URL 자체가 안정적으로 계속 서빙됨). 계정 목록에서 바로 <img>로 쓸 수 있다.
  const nextCredentials = {
    ...account.credentials,
    _channel_title: snippet.title,
    _avatar_url: thumbnailUrl || null,
    _synced_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('hub_social_accounts')
    .update({ account_name: handle, credentials: nextCredentials, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ account: data });
}
