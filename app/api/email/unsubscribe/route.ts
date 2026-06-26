import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { error: 'Missing unsubscribe token' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { emailUnsubscribeToken: token },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid or expired unsubscribe token' },
        { status: 404 }
      );
    }

    await prisma.notificationPreference.upsert({
      where: { userId: user.id },
      update: { emailBountyAlerts: false, emailApplicationUpdates: false, emailMessages: false, emailMarketing: false },
      create: {
        userId: user.id,
        emailBountyAlerts: false,
        emailApplicationUpdates: false,
        emailMessages: false,
        emailMarketing: false,
      },
    });

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Unsubscribed</title>
          <style>
            body { font-family: sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; }
            h1 { color: #333; }
            p { color: #666; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✓ Successfully Unsubscribed</h1>
            <p>You have been unsubscribed from all email notifications.</p>
            <p>You can re-enable notifications anytime from your notification preferences.</p>
          </div>
        </body>
      </html>
    `;

    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error) {
    console.error('Unsubscribe error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
