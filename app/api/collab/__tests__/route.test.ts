import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../route';

vi.mock('@/lib/auth/auth', () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from '@/lib/auth/auth';

function asSession(id: string | null) {
  (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(id ? { user: { id } } : null);
}

function upgradeRequest() {
  return new NextRequest('http://localhost:3000/api/collab', { headers: { upgrade: 'websocket' } });
}

describe('/api/collab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 for an unauthenticated websocket upgrade', async () => {
    asSession(null);
    const res = await GET(upgradeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 for an unauthenticated POST', async () => {
    asSession(null);
    const req = new NextRequest('http://localhost:3000/api/collab', {
      method: 'POST',
      body: JSON.stringify({ action: 'connect', docName: 'bounty-scope-x' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('lets an authenticated websocket upgrade through', async () => {
    asSession('user-1');
    const res = await GET(upgradeRequest());
    expect(res.status).toBe(200);
  });
});
