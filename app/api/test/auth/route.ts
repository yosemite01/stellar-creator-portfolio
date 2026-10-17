import { NextRequest, NextResponse } from 'next/server';

/**
 * Test-only sign-in route guarded by NODE_ENV=test (Issue #1579).
 * Provides mock authentication sessions for Playwright end-to-end tests
 * without depending on live third-party wallets or OAuth providers.
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Endpoint only available in test environments' }, { status: 403 });
  }

  let body: { role?: 'client' | 'creator' | 'admin'; email?: string; name?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Body optional, default to client
  }

  const role = body.role ?? 'client';
  const isCreator = role === 'creator';

  const user = {
    id: isCreator ? 'test-creator-id' : 'test-client-id',
    name: body.name ?? (isCreator ? 'Test Creator' : 'Test Client'),
    email: body.email ?? (isCreator ? 'creator@tamgora.test' : 'client@tamgora.test'),
    role: isCreator ? 'CREATOR' : role === 'admin' ? 'ADMIN' : 'CLIENT',
    onboardingCompleted: true,
  };

  const response = NextResponse.json({
    success: true,
    user,
    session: {
      user,
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
  });

  // Set test session cookie
  response.cookies.set('next-auth.session-token', `test-session-token-${user.id}`, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 86400,
  });

  return response;
}

export async function GET() {
  if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Endpoint only available in test environments' }, { status: 403 });
  }

  return NextResponse.json({
    status: 'ok',
    accounts: {
      client: { email: 'client@tamgora.test', role: 'CLIENT', id: 'test-client-id' },
      creator: { email: 'creator@tamgora.test', role: 'CREATOR', id: 'test-creator-id' },
    },
  });
}
