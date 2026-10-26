import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/server/services/audit', () => ({ writeAuditLog: vi.fn(async () => null) }));

import { POST } from '@/app/api/ipfs/pin/route';
import { getServerSession } from 'next-auth';
import { checkPinRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/server/services/audit';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

// jsdom's Blob/File round-trips corrupt binary data (and a Request body can
// only be read once), so we hand the handler a minimal multipart double that
// yields the exact bytes. The handler only uses headers + formData().
function pinRequest(bytes: Uint8Array, contentLength?: number) {
  const file = { arrayBuffer: async () => bytes.buffer, type: 'application/octet-stream' };
  return {
    headers: new Headers(contentLength ? { 'content-length': String(contentLength) } : {}),
    formData: async () => ({ get: (key: string) => (key === 'file' ? file : null) }),
  } as unknown as NextRequest;
}

async function signedInAs(userId: string) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: userId } } as never);
}

describe('POST /api/ipfs/pin (#1508 auth + limits)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MAX_UPLOAD_MB;
  });
  afterEach(() => {
    delete process.env.MAX_UPLOAD_MB;
  });

  it('401s anonymous requests', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    const res = await POST(pinRequest(PNG));
    expect(res.status).toBe(401);
  });

  it('415s when the sniffed content type is not allowed', async () => {
    await signedInAs('user-415');
    // Plain-text bytes that sniff to nothing → rejected regardless of declared type.
    const res = await POST(pinRequest(new TextEncoder().encode('MZ executable-ish payload')));
    expect(res.status).toBe(415);
  });

  it('413s when a (possibly lying) Content-Length exceeds the size limit', async () => {
    process.env.MAX_UPLOAD_MB = '1';
    await signedInAs('user-413-cl');
    const res = await POST(pinRequest(PNG, 2 * 1024 * 1024));
    expect(res.status).toBe(413);
  });

  it('413s when the actual bytes exceed the limit even with no Content-Length', async () => {
    process.env.MAX_UPLOAD_MB = '1';
    await signedInAs('user-413-bytes');
    const big = new Uint8Array(2 * 1024 * 1024);
    big.set(PNG); // valid PNG magic so the only problem is size
    const res = await POST(pinRequest(big));
    expect(res.status).toBe(413);
  });

  it('429s once the per-user daily quota is exhausted', async () => {
    const userId = 'user-quota';
    // Burn the quota directly, then the route should reject.
    for (let i = 0; i < 500 && checkPinRateLimit(userId); i += 1) {
      /* exhaust */
    }
    await signedInAs(userId);
    const res = await POST(pinRequest(PNG));
    expect(res.status).toBe(429);
  });

  it('200s and logs to the audit service for a valid, in-limit upload', async () => {
    await signedInAs('user-ok');
    const res = await POST(pinRequest(PNG));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cid).toMatch(/^bafy/);
    expect(data.size).toBe(PNG.byteLength);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-ok', resource: 'ipfs', action: 'pin' }),
    );
  });
});
