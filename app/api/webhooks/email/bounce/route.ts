import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import crypto from 'crypto';

async function verifyWebhookSignature(request: NextRequest): Promise<boolean> {
  const signature = request.headers.get('x-webhook-signature');
  const timestamp = request.headers.get('x-webhook-timestamp');
  const secret = process.env.EMAIL_WEBHOOK_SECRET;

  if (!signature || !timestamp || !secret) {
    return false;
  }

  const body = await request.text();
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${timestamp}.${body}`);
  const expectedSignature = hmac.digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

export async function POST(request: NextRequest) {
  try {
    const isValid = await verifyWebhookSignature(request);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const events = Array.isArray(body) ? body : [body];

    for (const event of events) {
      const email = event.email || event.recipient;
      if (!email) continue;

      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) continue;

      if (event.type === 'bounce') {
        if (event.bounce_type === 'permanent' || event.bounce_type === 'hard') {
          await prisma.user.update({
            where: { id: user.id },
            data: { emailBounced: true },
          });
          await prisma.emailDeliveryLog.create({
            data: {
              userId: user.id,
              toEmail: email,
              templateKey: 'bounce',
              subject: 'Bounce',
              category: 'system',
              status: 'SKIPPED',
              provider: 'webhook',
              providerMessageId: event.message_id,
              errorMessage: `Hard bounce: ${event.diagnostic_code || 'unknown'}`,
              payload: event,
            },
          });
        } else if (event.bounce_type === 'temporary' || event.bounce_type === 'soft') {
          const log = await prisma.emailDeliveryLog.findFirst({
            where: { toEmail: email },
            orderBy: { createdAt: 'desc' },
          });

          if (log && log.payload && typeof log.payload === 'object' && 'softBounceCount' in log.payload) {
            const count = (log.payload as any).softBounceCount + 1;
            if (count >= 3) {
              await prisma.user.update({
                where: { id: user.id },
                data: { emailBounced: true },
              });
            }
          }

          await prisma.emailDeliveryLog.create({
            data: {
              userId: user.id,
              toEmail: email,
              templateKey: 'bounce',
              subject: 'Bounce',
              category: 'system',
              status: 'SKIPPED',
              provider: 'webhook',
              providerMessageId: event.message_id,
              errorMessage: `Soft bounce: ${event.diagnostic_code || 'unknown'}`,
              payload: { ...event, softBounceCount: 1 },
            },
          });
        }
      } else if (event.type === 'complaint' || event.type === 'spam') {
        await prisma.user.update({
          where: { id: user.id },
          data: { emailBounced: true },
        });
        await prisma.emailDeliveryLog.create({
          data: {
            userId: user.id,
            toEmail: email,
            templateKey: 'complaint',
            subject: 'Complaint',
            category: 'system',
            status: 'SKIPPED',
            provider: 'webhook',
            providerMessageId: event.message_id,
            errorMessage: 'Spam complaint received',
            payload: event,
          },
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
