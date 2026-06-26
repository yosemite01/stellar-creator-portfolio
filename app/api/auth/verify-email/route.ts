import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/auth/verify-email?token=...
 * Marks email as verified and redirects to onboarding.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.redirect(new URL('/auth/login?error=missing_token', req.url));
  }

  const record = await prisma.verificationToken.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!record || record.expires < new Date()) {
    return NextResponse.redirect(new URL('/auth/login?error=invalid_token', req.url));
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerified: new Date() },
    }),
    prisma.verificationToken.delete({ where: { id: record.id } }),
  ]);

  const onboardingUrl = new URL('/onboarding', req.url);
  onboardingUrl.searchParams.set('verified', '1');
  return NextResponse.redirect(onboardingUrl);
}
