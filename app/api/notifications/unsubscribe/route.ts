import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const category = searchParams.get('category');
  const token = searchParams.get('token');

  if (!userId || !category || !token) {
    return new NextResponse('Invalid unsubscribe link', { status: 400 });
  }

  // Verify token
  const secret = process.env.NOTIFICATION_SECRET || 'default_secret';
  const expectedToken = crypto
    .createHmac('sha256', secret)
    .update(`${userId}:${category}`)
    .digest('hex');

  if (token !== expectedToken) {
    return new NextResponse('Invalid or expired token', { status: 403 });
  }

  try {
    // Update preferences (disable email for this category)
    await prisma.notificationPreference.upsert({
      where: {
        userId_category: { userId, category },
      },
      update: {
        emailEnabled: false,
      },
      create: {
        userId,
        category,
        emailEnabled: false,
        inAppEnabled: true,
      },
    });

    return new NextResponse(
      `
      <html>
        <head>
          <title>Unsubscribed</title>
          <style>
            body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f4f4f5; }
            .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
            h1 { color: #111827; font-size: 1.5rem; margin-bottom: 1rem; }
            p { color: #4b5563; line-height: 1.5; }
            .btn { display: inline-block; margin-top: 1.5rem; padding: 0.5rem 1rem; background: #6366f1; color: white; text-decoration: none; border-radius: 6px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Unsubscribed</h1>
            <p>You have been successfully unsubscribed from <strong>${category}</strong> notifications.</p>
            <p>You can manage all your notification settings in your dashboard.</p>
            <a href="/dashboard/settings/notifications" class="btn">Go to Settings</a>
          </div>
        </body>
      </html>
      `,
      {
        headers: { 'Content-Type': 'text/html' },
      }
    );
  } catch (error) {
    console.error('[unsubscribe] Error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
