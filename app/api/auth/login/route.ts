import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const password = body?.password as string | undefined;

  if (!process.env.HUB_PASSWORD || !process.env.HUB_SESSION_SECRET) {
    return NextResponse.json({ error: '서버에 HUB_PASSWORD/HUB_SESSION_SECRET이 설정되지 않았습니다.' }, { status: 500 });
  }
  if (password !== process.env.HUB_PASSWORD) {
    return NextResponse.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('hub_session', process.env.HUB_SESSION_SECRET, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 180,
  });
  return res;
}
