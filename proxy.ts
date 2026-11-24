import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

// ── Protected path prefixes ───────────────────────────────────────────────────

const PROTECTED_PREFIXES = ['/dashboard', '/profile', '/onboarding', '/admin'];
const ADMIN_PATH = '/admin';
const ONBOARDING_PATH = '/onboarding';

// ── CSP Configuration ────────────────────────────────────────────────────────

/**
 * Environment variable to enable full CSP enforcement.
 * When false (default), uses report-only mode to collect violations.
 * When true, blocks violations and enforces policy strictly.
 */
const CSP_ENFORCE = process.env.CSP_ENFORCE === 'true';

/**
 * Build Content Security Policy with per-request nonce.
 * Uses strict-dynamic for script-src to enable modern loader patterns.
 * 
 * Security improvements:
 * - Nonce-based script execution (prevents inline scripts)
 * - Trusted Types integration (prevents DOM XSS)
 * - Strict-dynamic for script-src (enables loader patterns)
 * - Report URI for violation monitoring
 */
function buildCsp(nonce: string): string {
  return [
    // Default: only same-origin resources
    "default-src 'self'",
    
    // Script: nonced and trusted types
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'trusted-types'`,
    
    // Style: unsafe-inline required for SSR hydration
    "style-src 'self' 'unsafe-inline'",
    
    // Images: self, data URIs, blob, and HTTPS external
    "img-src 'self' data: blob: https:",
    
    // Fonts: self and data URIs
    "font-src 'self' data:",
    
    // Connections: HTTPS, WebSockets, and specific APIs
    "connect-src 'self' https: wss: https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
    
    // Frames: only same-origin
    "frame-src 'self'",
    
    // Object: none (no plugins)
    "object-src 'none'",
    
    // Base URI: same-origin
    "base-uri 'self'",
    
    // Form actions: same-origin
    "form-action 'self'",
    
    // Frame ancestors: none (no framing)
    "frame-ancestors 'none'",
    
    // Report violations
    CSP_ENFORCE ? null : `report-uri /api/csp-report`,
  ].filter(Boolean).join('; ');
}

/**
 * Check if this is a Next.js prefetch request (should skip CSP).
 */
function isPrefetch(req: NextRequest): boolean {
  return (
    req.headers.has('next-router-prefetch') || 
    req.headers.get('purpose') === 'prefetch' ||
    req.headers.get('sec-purpose') === 'prefetch'
  );
}

/**
 * Process request with CSP nonce injection.
 * Attaches nonce to request headers for use in page templates.
 */
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
  
  // Set CSP header on response
  // Use report-only in development/reporting mode
  // Use enforce in production when CSP_ENFORCE=true
  response.headers.set(
    CSP_ENFORCE ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
    csp,
  );
  
  // Add other security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // HSTS - only in HTTPS production
  if (process.env.NODE_ENV === 'production' && req.url.startsWith('https://')) {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  
  return response;
}

/**
 * Main proxy middleware entry point.
 * Handles authentication redirects and routes to next() for CSP injection.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Get auth token
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

  // ── Authentication redirects ────────────────────────────────────────────────

  // Redirect unauthenticated users to login for protected routes
  if (!token && isProtected) {
    const login = new URL('/auth/login', req.url);
    login.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(login);
  }

  // ── Authorization redirects ────────────────────────────────────────────────

  // Admin-only access for /admin/* routes
  if (token && pathname.startsWith(ADMIN_PATH) && token.role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/', req.url));
  }

  // ── Onboarding flow ────────────────────────────────────────────────────────

  // Redirect uncompleted onboarding to onboarding step 1
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

  // ── Default: process with CSP ──────────────────────────────────────────────

  return next(req);
}

// ── Export config for Next.js middleware ─────────────────────────────────────

export const config = {
  matcher: [
    // Match all routes except static assets, images, and API routes
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
