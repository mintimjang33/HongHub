import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// MCP는 자체 ?key= 인증을 쓰므로 쿠키 게이트에서 제외한다.
// /share — 2026-09-07 신설, 비밀번호 없이 특정 사이트 하나를 읽기 전용으로 보여주는 공개 페이지
// (제미나이 등 외부 AI 도구에 링크로 콘텐츠를 바로 보여주기 위한 용도, 사용자 지시). URL 자체가
// 추측 불가능한 사이트 UUID라 "링크를 아는 사람만" 접근 가능 — 목록/검색엔 노출 안 됨.
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/mcp', '/share'];

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
