import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { sendEmail } from '@/lib/email/mailer';

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { error: 'Verification token is required' },
        { status: 400 }
      );
    }

    // Find verification token
    const verificationToken = await prisma.verificationToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!verificationToken) {
      return NextResponse.json(
        { error: 'Invalid verification token' },
        { status: 404 }
      );
    }

    // Check if token is expired
    if (verificationToken.expires < new Date()) {
      return NextResponse.json(
        { error: 'Verification token has expired' },
        { status: 400 }
      );
    }

    // Update user email verification status
    await prisma.user.update({
      where: { id: verificationToken.userId },
      data: { emailVerified: new Date() },
    });

    // Delete the verification token
    await prisma.verificationToken.delete({
      where: { id: verificationToken.id },
    });

    const { user } = verificationToken;
    const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';

    // Send welcome email (fire-and-forget — don't block the response)
    sendEmail({
      to: user.email!,
      subject: 'Welcome to Stellar Creators',
      template: 'welcome',
      variables: {
        name: user.name ?? user.email!,
        dashboardUrl: `${appUrl}/dashboard`,
        isCreator: user.role === 'CREATOR',
      },
    }).catch((err) => console.error('[mailer] Failed to send welcome email:', err));

    return NextResponse.json(
      { message: 'Email verified successfully. You can now log in.' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Email verification error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
