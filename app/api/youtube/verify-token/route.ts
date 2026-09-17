import { NextResponse } from 'next/server';

// 2026-09-17 신설 — 사용자 요청: "해당 리프레시 토큰이 해당 채널의 업로드에 맞는건지
// 알수가 있어? 확인이 되는거야?" — refresh_token만으로는 어느 채널에 연결된 건지 화면에서
// 알 방법이 없어서, 서버에서 대신 access_token으로 교환한 뒤 YouTube Data API로 실제 연결된
// 채널을 조회해서 돌려준다. client_secret이 필요한 토큰 교환이라 브라우저에서 구글에 직접
// 호출하지 않고(CORS 문제도 있음) 이 라우트를 거친다 — 값 자체는 저장하지 않고 그대로
// 통과시키기만 한다.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.client_id || !body?.client_secret || !body?.refresh_token) {
    return NextResponse.json({ error: 'client_id, client_secret, refresh_token이 모두 필요합니다.' }, { status: 400 });
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: body.client_id,
      client_secret: body.client_secret,
      refresh_token: body.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const tokenData = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok || !tokenData?.access_token) {
    return NextResponse.json({ error: tokenData?.error_description || tokenData?.error || '토큰 갱신 실패 — 값을 다시 확인해주세요.' }, { status: 400 });
  }

  const chRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true&maxResults=50', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const chData = await chRes.json().catch(() => null);
  if (!chRes.ok || !chData?.items?.length) {
    return NextResponse.json({ error: chData?.error?.message || '이 토큰에 연결된 채널을 찾을 수 없습니다.' }, { status: 400 });
  }

  // 2026-09-17(2차) 수정 — mine=true가 "활성 채널" 하나만 주는 게 아니라, 이 구글 계정이
  // 관리하는 채널 전부를 배열로 줄 수 있다(브랜드 계정 포함). items[0]만 보고 판단했더니
  // 실제로는 목록에 여러 채널이 있는데 항상 첫 번째(원래 계정 채널)만 보고 "다른 채널로
  // 인증됐다"고 잘못 판단한 사례가 있었다 — 전체 목록을 돌려주고 클라이언트에서 원하는
  // channel_id가 그 안에 있는지 찾게 한다.
  const channels = chData.items.map((c: { id: string; snippet?: { title?: string } }) => ({
    id: c.id,
    title: c.snippet?.title || null,
  }));
  return NextResponse.json({ channels });
}
