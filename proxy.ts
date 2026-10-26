import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const ONBOARDING_PATH = '/onboarding';
const ADMIN_PATH = '/admin';
const PROTECTED_PREFIXES = ['/dashboard', '/profile', '/onboarding', ADMIN_PATH];

/**
 * Content-Security-Policy with per-request nonces (issue #1537).
 *
 * Threat closed: a missed sanitisation sink or a vulnerable dependency lets an
 * attacker inject a <script> into the page. With `script-src 'self'
 * 'nonce-…' 'strict-dynamic'` only scripts carrying the per-request nonce (or
 * scripts they load) execute, so injected inline scripts are blocked.
 *
 * Rollout: start in Report-Only so violations are collected at
 * /api/csp-report without breaking the app, then flip CSP_ENFORCE=true once the
 * report stream is clean.
 *
 * This used to live in middleware.ts, but Next.js 16 only accepts one of
 * middleware.ts / proxy.ts and refuses to build when both exist.
 */

const CSP_ENFORCE = process.env.CSP_ENFORCE === 'true';

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Next.js injects inline styles; keep style-src permissive for now.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // Wallet extensions, Stripe and Sentry need explicit connect/frame entries.
    "connect-src 'self' https: wss:",
    "frame-src 'self' https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'report-uri /api/csp-report',
  ].join('; ');
}

function isPrefetch(req: NextRequest): boolean {
  return (
    req.headers.has('next-router-prefetch') || req.headers.get('purpose') === 'prefetch'
  );
}

/** Pass the request through, attaching a fresh CSP nonce unless it is a prefetch. */
function next(req: NextRequest): NextResponse {
  if (isPrefetch(req)) {
    return NextResponse.next();
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(
    CSP_ENFORCE ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
    csp,
  );
  return response;
}

export async function proxy(req: NextRequest) {
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

  // The admin API routes check the role themselves; this keeps the admin UI
  // shell from rendering for signed-in users who are not admins.
  if (token && pathname.startsWith(ADMIN_PATH) && token.role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/', req.url));
  }

  if (token && pathname.startsWith('/onboarding')) {
    return next(req);
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

  return next(req);
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
