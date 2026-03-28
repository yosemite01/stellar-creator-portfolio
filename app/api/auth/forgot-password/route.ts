import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { sendEmail } from '@/lib/email/mailer';
import { serverConfig } from '@/lib/config';

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    // Don't reveal if email exists or not (security best practice)
    if (!user) {
      return NextResponse.json(
        { message: 'If that email exists, we\'ve sent a reset link' },
        { status: 200 }
      );
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store reset token (we'll use verification token table for simplicity)
    await prisma.verificationToken.create({
      data: {
        identifier: `password-reset:${email}`,
        token: resetToken,
        expires: resetTokenExpiry,
        userId: user.id,
      },
    });

    const resetUrl = `${serverConfig.auth.nextAuthUrl}/auth/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

    await sendEmail({
      to: email,
      subject: 'Reset your password – Stellar Creators',
      template: 'reset-password',
      variables: {
        name: user.name ?? email,
        resetUrl,
      },
    });

    return NextResponse.json(
      { message: 'If that email exists, we\'ve sent a reset link' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
