import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const { getServerSession, updateMany } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('@/lib/auth/auth', () => ({ getServerSession }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    notification: { updateMany },
    user: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

import { POST, PATCH } from '@/server/services/notifications/push-route';

function sendRequest(headers: Record<string, string> = {}, body: unknown = {}) {
  return new NextRequest('http://localhost/api/notifications/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('PUSH_SERVICE_TOKEN', 'service-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/notifications/push authorisation', () => {
  it('rejects non-JSON requests', async () => {
    const res = await POST(sendRequest({ 'content-type': 'text/plain' }));
    expect(res.status).toBe(415);
  });

  it('rejects anonymous callers', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await POST(sendRequest())).status).toBe(401);
  });

  it('rejects any bearer token other than the service token', async () => {
    const res = await POST(sendRequest({ authorization: 'Bearer anything' }));
    expect(res.status).toBe(401);
    expect(getServerSession).not.toHaveBeenCalled();
  });

  it('rejects signed-in users who are not admins', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1', role: 'USER' } });
    expect((await POST(sendRequest())).status).toBe(403);
  });

  it('lets an admin through to payload validation', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'admin1', role: 'ADMIN' } });
    expect((await POST(sendRequest({}, { title: 'missing user' }))).status).toBe(400);
  });

  it('lets the service token through to payload validation', async () => {
    const res = await POST(sendRequest({ authorization: 'Bearer service-secret' }, {}));
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/notifications/push/:id', () => {
  function patchRequest(status: string) {
    return new NextRequest('http://localhost/api/notifications/push/n1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
  }
  const params = { params: Promise.resolve({ id: 'n1' }) };

  it('requires a session', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await PATCH(patchRequest('READ'), params)).status).toBe(401);
  });

  it('only updates the caller’s own notification', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1', role: 'USER' } });
    updateMany.mockResolvedValue({ count: 0 });

    const res = await PATCH(patchRequest('READ'), params);

    expect(res.status).toBe(404);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'n1', userId: 'u1' } }),
    );
  });

  it('updates the status for the owner', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1', role: 'USER' } });
    updateMany.mockResolvedValue({ count: 1 });
    expect((await PATCH(patchRequest('READ'), params)).status).toBe(200);
  });
});
