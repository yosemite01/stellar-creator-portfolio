import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { POST } from '../route';

const TEST_SECRET = 'email_webhook_secret_for_tests_12345';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    emailDeliveryLog: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';

function createSignedRequest({
  body,
  secret = TEST_SECRET,
  timestamp = Math.floor(Date.now() / 1000).toString(),
  headerName = 'x-webhook-signature',
  timestampHeader = 'x-webhook-timestamp',
  tamper = false,
}: {
  body: any;
  secret?: string;
  timestamp?: string;
  headerName?: string;
  timestampHeader?: string;
  tamper?: boolean;
}) {
  const rawBody = JSON.stringify(body);
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${timestamp}.${rawBody}`);
  const signature = hmac.digest('hex');

  const headers: Record<string, string> = {
    [headerName]: signature,
  };
  if (timestampHeader) {
    headers[timestampHeader] = timestamp;
  }

  const sentBody = tamper ? JSON.stringify({ ...body, tampered: true }) : rawBody;

  return new NextRequest('http://localhost/api/webhooks/email/bounce', {
    method: 'POST',
    headers,
    body: sentBody,
  });
}

describe('Email bounce webhook signature verification (Issue #1522)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EMAIL_WEBHOOK_SECRET = TEST_SECRET;
  });

  it('rejects unsigned requests with 401 Unauthorized', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/email/bounce', {
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com', type: 'bounce' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toEqual({ error: 'Unauthorized' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects requests with an invalid HMAC signature with 401', async () => {
    const req = createSignedRequest({
      body: { email: 'user@example.com', type: 'bounce' },
      secret: 'wrong_secret',
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toEqual({ error: 'Unauthorized' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects expired timestamps outside the 5-minute clock skew window with 401', async () => {
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
    const req = createSignedRequest({
      body: { email: 'user@example.com', type: 'bounce' },
      timestamp: tenMinutesAgo.toString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toEqual({ error: 'Unauthorized' });
  });

  it('rejects requests when payload is tampered after signature generation with 401', async () => {
    const req = createSignedRequest({
      body: { email: 'user@example.com', type: 'bounce' },
      tamper: true,
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toEqual({ error: 'Unauthorized' });
  });

  it('rejects requests if EMAIL_WEBHOOK_SECRET is not configured (fail-closed)', async () => {
    delete process.env.EMAIL_WEBHOOK_SECRET;
    const req = createSignedRequest({
      body: { email: 'user@example.com', type: 'bounce' },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toEqual({ error: 'Unauthorized' });
  });

  it('processes valid signed permanent bounce event and marks email as bounced', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 'user_123',
      email: 'bounced@example.com',
    } as any);

    const payload = {
      email: 'bounced@example.com',
      type: 'bounce',
      bounce_type: 'permanent',
      message_id: 'msg_999',
      diagnostic_code: '550 User unknown',
    };

    const req = createSignedRequest({ body: payload });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ success: true });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user_123' },
      data: { emailBounced: true },
    });
    expect(prisma.emailDeliveryLog.create).toHaveBeenCalled();
  });

  it('processes valid signed spam complaint using alternative resend headers', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 'user_456',
      email: 'complaint@example.com',
    } as any);

    const payload = {
      email: 'complaint@example.com',
      type: 'complaint',
      message_id: 'msg_888',
    };

    const req = createSignedRequest({
      body: payload,
      headerName: 'resend-signature',
      timestampHeader: 'x-timestamp',
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user_456' },
      data: { emailBounced: true },
    });
  });
});
