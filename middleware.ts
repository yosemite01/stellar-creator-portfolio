import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const ONBOARDING_PATH = '/onboarding';
const PROTECTED_PREFIXES = ['/dashboard', '/profile', '/onboarding'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

  if (!token && isProtected) {
    const login = new URL('/auth/login', req.url);
    login.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(login);
  }

  if (token && pathname.startsWith('/onboarding')) {
    return NextResponse.next();
  }

  if (
    token &&
    token.emailVerified &&
    !token.onboardingCompleted &&
    !pathname.startsWith(ONBOARDING_PATH) &&
    !pathname.startsWith('/api') &&
    isProtected
  ) {
    return NextResponse.redirect(new URL(ONBOARDING_PATH, req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
