import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

// Reject requests whose timestamp is further than this from "now" in either
// direction. Without this bound, a signature captured once (e.g. from a
// retried delivery or a network observer) stays valid forever and can be
// replayed at will, since the signature covers the timestamp but nothing
// ever checks it against the clock.
const MAX_WEBHOOK_CLOCK_SKEW_MS = 5 * 60 * 1000;

export async function verifyWebhookSignature(rawBody: string, request: NextRequest): Promise<boolean> {
  const secret = process.env.EMAIL_WEBHOOK_SECRET;
  if (!secret) {
    // Fail-safe: deny if secret is not configured
    return false;
  }

  const signature =
    request.headers.get('x-webhook-signature') ||
    request.headers.get('resend-signature') ||
    request.headers.get('x-postmark-signature');
  const timestamp =
    request.headers.get('x-webhook-timestamp') ||
    request.headers.get('x-timestamp');

  if (!signature) {
    return false;
  }

  if (timestamp) {
    const timestampMs = Number(timestamp) * 1000;
    if (!Number.isFinite(timestampMs)) {
      return false;
    }
    if (Math.abs(Date.now() - timestampMs) > MAX_WEBHOOK_CLOCK_SKEW_MS) {
      return false;
    }

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(`${timestamp}.${rawBody}`);
    const expectedSignature = hmac.digest('hex');

    const signatureBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expectedSignature, 'hex');
    if (signatureBuf.length !== expectedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuf, expectedBuf);
  } else {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(rawBody);
    const expectedSignature = hmac.digest('hex');

    const signatureBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expectedSignature, 'hex');
    if (signatureBuf.length !== expectedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuf, expectedBuf);
  }
}


export async function POST(request: NextRequest) {
  try {
    // Read the body once and reuse the string for both signature verification and JSON parsing
    const rawBody = await request.text();
    const isValid = await verifyWebhookSignature(rawBody, request);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = JSON.parse(rawBody);
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
            where: {
              toEmail: email,
              templateKey: 'bounce',
            },
            orderBy: { createdAt: 'desc' },
          });

          let count = 1;
          if (
            log &&
            log.payload &&
            typeof log.payload === 'object' &&
            'softBounceCount' in log.payload &&
            typeof (log.payload as { softBounceCount: unknown }).softBounceCount === 'number'
          ) {
            count = (log.payload as { softBounceCount: number }).softBounceCount + 1;
          }

          if (count >= 3) {
            await prisma.user.update({
              where: { id: user.id },
              data: { emailBounced: true },
            });
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
              payload: { ...event, softBounceCount: count },
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
