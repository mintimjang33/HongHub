import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// MCP는 자체 ?key= 인증을 쓰므로 쿠키 게이트에서 제외한다.
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/mcp'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const session = request.cookies.get('hub_session')?.value;
  const expected = process.env.HUB_SESSION_SECRET;
  if (expected && session === expected) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return new NextResponse(JSON.stringify({ error: '로그인이 필요합니다.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
