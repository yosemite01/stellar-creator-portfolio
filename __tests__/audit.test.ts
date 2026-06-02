/**
 * Tests for backend/services/audit.ts  (#508)
 *
 * Covers:
 *  - hashIp()               — one-way IP hashing
 *  - sanitisePayload()      — secret field redaction
 *  - parseTraceId()         — W3C traceparent parsing & fallback
 *  - extractTelemetryMeta() — header extraction
 *  - writeAuditLog()        — Prisma persistence (mocked)
 *  - withAuditLog()         — mutation wrapper (success + failure paths)
 *  - createAuditInterceptor() — route handler interceptor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  hashIp,
  sanitisePayload,
  parseTraceId,
  extractTelemetryMeta,
  writeAuditLog,
  withAuditLog,
  createAuditInterceptor,
} from '@/backend/services/audit';

// ── Mock Prisma ──────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => ({
  prisma: {
    auditLog: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';

const mockCreate = prisma.auditLog.create as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue({ id: 'audit_123' });
});

// ── hashIp ───────────────────────────────────────────────────────────────────

describe('hashIp()', () => {
  it('returns a 64-char hex string for a valid IPv4', () => {
    const hash = hashIp('192.168.1.1');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('returns null for null input', () => {
    expect(hashIp(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(hashIp('')).toBeNull();
  });

  it('normalises IPv6-mapped IPv4 before hashing', () => {
    const a = hashIp('::ffff:192.168.1.1');
    const b = hashIp('192.168.1.1');
    expect(a).toBe(b);
  });

  it('produces different hashes for different IPs', () => {
    const a = hashIp('10.0.0.1');
    const b = hashIp('10.0.0.2');
    expect(a).not.toBe(b);
  });

  it('is deterministic for the same IP', () => {
    const a = hashIp('8.8.8.8');
    const b = hashIp('8.8.8.8');
    expect(a).toBe(b);
  });
});

// ── sanitisePayload ──────────────────────────────────────────────────────────

describe('sanitisePayload()', () => {
  it('redacts known secret fields', () => {
    const result = sanitisePayload({ username: 'alice', password: 's3cr3t' });
    expect(result?.password).toBe('[REDACTED]');
    expect(result?.username).toBe('alice');
  });

  it('redacts nested secret fields', () => {
    const result = sanitisePayload({
      user: { email: 'a@b.com', token: 'abc123' },
    });
    expect((result?.user as any)?.token).toBe('[REDACTED]');
    expect((result?.user as any)?.email).toBe('a@b.com');
  });

  it('redacts privateKey and apiKey fields', () => {
    const result = sanitisePayload({ privateKey: 'SECRETKEY', apiKey: 'KEY123' });
    expect(result?.privateKey).toBe('[REDACTED]');
    expect(result?.apiKey).toBe('[REDACTED]');
  });

  it('returns null for null input', () => {
    expect(sanitisePayload(null)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(sanitisePayload('string')).toBeNull();
  });

  it('passes through normal fields unchanged', () => {
    const result = sanitisePayload({ title: 'My Bounty', budget: 500 });
    expect(result?.title).toBe('My Bounty');
    expect(result?.budget).toBe(500);
  });

  it('handles arrays inside payload', () => {
    const result = sanitisePayload({ tags: ['a', 'b'], skills: ['c'] });
    expect(result?.tags).toEqual(['a', 'b']);
  });
});

// ── parseTraceId ─────────────────────────────────────────────────────────────

describe('parseTraceId()', () => {
  it('extracts trace-id from a valid W3C traceparent header', () => {
    const header = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    expect(parseTraceId(header)).toBe('0af7651916cd43dd8448eb211c80319c');
  });

  it('returns a 32-char hex fallback for null input', () => {
    const id = parseTraceId(null);
    expect(id).toHaveLength(32);
    expect(id).toMatch(/^[0-9a-f]+$/);
  });

  it('returns a 32-char hex fallback for malformed input', () => {
    const id = parseTraceId('not-a-traceparent');
    expect(id).toHaveLength(32);
  });

  it('generates unique fallback IDs', () => {
    const a = parseTraceId(null);
    const b = parseTraceId(null);
    expect(a).not.toBe(b);
  });
});

// ── extractTelemetryMeta ─────────────────────────────────────────────────────

function makeRequest(headers: Record<string, string>, url = 'https://app.example.com/api/bounties', method = 'POST'): Request {
  return new Request(url, { method, headers });
}

describe('extractTelemetryMeta()', () => {
  it('extracts IP hash from x-forwarded-for', () => {
    const req = makeRequest({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' });
    const meta = extractTelemetryMeta(req);
    expect(meta.ipHash).toBe(hashIp('203.0.113.5'));
  });

  it('extracts user-agent', () => {
    const req = makeRequest({ 'user-agent': 'TestAgent/1.0' });
    const meta = extractTelemetryMeta(req);
    expect(meta.userAgent).toBe('TestAgent/1.0');
  });

  it('extracts trace-id from traceparent', () => {
    const req = makeRequest({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    });
    const meta = extractTelemetryMeta(req);
    expect(meta.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('extracts geo country from cf-ipcountry', () => {
    const req = makeRequest({ 'cf-ipcountry': 'US' });
    const meta = extractTelemetryMeta(req);
    expect(meta.geoCountry).toBe('US');
  });

  it('extracts request path and HTTP method', () => {
    const req = makeRequest({}, 'https://app.example.com/api/bounties', 'DELETE');
    const meta = extractTelemetryMeta(req);
    expect(meta.requestPath).toBe('/api/bounties');
    expect(meta.httpMethod).toBe('DELETE');
  });

  it('falls back gracefully with no headers', () => {
    const req = makeRequest({});
    const meta = extractTelemetryMeta(req);
    expect(meta.ipHash).toBeNull();
    expect(meta.userAgent).toBeNull();
    expect(meta.traceId).toHaveLength(32);
  });
});

// ── writeAuditLog ─────────────────────────────────────────────────────────────

describe('writeAuditLog()', () => {
  it('calls prisma.auditLog.create with correct data', async () => {
    const result = await writeAuditLog({
      userId: 'user_abc',
      resource: 'bounty',
      action: 'create',
      resourceId: 'bounty_1',
      payload: { title: 'Hello', password: 'secret' },
      status: 'SUCCESS',
      meta: {
        traceId: 'abc123',
        ipHash: 'hashval',
        userAgent: 'TestAgent',
        geoCountry: 'DE',
        httpMethod: 'POST',
        requestPath: '/api/bounties',
      },
    });

    expect(result).toEqual({ id: 'audit_123' });
    expect(mockCreate).toHaveBeenCalledOnce();

    const callArg = mockCreate.mock.calls[0][0].data;
    expect(callArg.userId).toBe('user_abc');
    expect(callArg.resource).toBe('bounty');
    expect(callArg.action).toBe('create');
    expect(callArg.status).toBe('SUCCESS');
    expect(callArg.traceId).toBe('abc123');
    // Secret field should be redacted
    expect(callArg.payload?.password).toBe('[REDACTED]');
  });

  it('returns null and does not throw when prisma fails', async () => {
    mockCreate.mockRejectedValueOnce(new Error('DB connection lost'));
    const result = await writeAuditLog({ resource: 'bounty', action: 'create' });
    expect(result).toBeNull();
  });

  it('uses SUCCESS as default status', async () => {
    await writeAuditLog({ resource: 'bounty', action: 'update' });
    const callArg = mockCreate.mock.calls[0][0].data;
    expect(callArg.status).toBe('SUCCESS');
  });
});

// ── withAuditLog ─────────────────────────────────────────────────────────────

describe('withAuditLog()', () => {
  it('returns the mutation result on success', async () => {
    const result = await withAuditLog(
      { userId: 'u1', resource: 'bounty', action: 'create' },
      async () => ({ id: 'b1' }),
    );
    expect(result).toEqual({ id: 'b1' });
  });

  it('writes a SUCCESS audit log on successful mutation', async () => {
    await withAuditLog(
      { userId: 'u1', resource: 'application', action: 'accept' },
      async () => 'ok',
    );
    // Allow the fire-and-forget void promise to settle in the microtask queue
    await new Promise((r) => setTimeout(r, 0));
    expect(mockCreate).toHaveBeenCalledOnce();
    const callArg = mockCreate.mock.calls[0][0].data;
    expect(callArg.status).toBe('SUCCESS');
  });

  it('re-throws the error from a failing mutation', async () => {
    await expect(
      withAuditLog(
        { userId: 'u2', resource: 'escrow', action: 'release' },
        async () => { throw new Error('escrow locked'); },
      ),
    ).rejects.toThrow('escrow locked');
  });

  it('writes a FAILURE audit log when mutation throws', async () => {
    try {
      await withAuditLog(
        { userId: 'u2', resource: 'escrow', action: 'release' },
        async () => { throw new Error('escrow locked'); },
      );
    } catch {
      // expected
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(mockCreate).toHaveBeenCalledOnce();
    const callArg = mockCreate.mock.calls[0][0].data;
    expect(callArg.status).toBe('FAILURE');
    expect(callArg.errorMessage).toBe('escrow locked');
  });

  it('extracts telemetry meta from the request when provided', async () => {
    const req = makeRequest(
      { 'x-forwarded-for': '1.2.3.4', 'user-agent': 'bot/1' },
      'https://app.example.com/api/bounties',
      'POST',
    );
    await withAuditLog(
      { userId: 'u3', resource: 'bounty', action: 'create', request: req },
      async () => 'done',
    );
    await new Promise((r) => setTimeout(r, 0));
    const callArg = mockCreate.mock.calls[0][0].data;
    expect(callArg.ipHash).toBe(hashIp('1.2.3.4'));
    expect(callArg.userAgent).toBe('bot/1');
    expect(callArg.httpMethod).toBe('POST');
    expect(callArg.requestPath).toBe('/api/bounties');
  });
});

// ── createAuditInterceptor ───────────────────────────────────────────────────

describe('createAuditInterceptor()', () => {
  it('calls the underlying handler and returns its response', async () => {
    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'b99', title: 'Test' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const wrapped = createAuditInterceptor('bounty', 'create', handler);
    const req = makeRequest({ 'x-user-id': 'user_42' });
    const res = await wrapped(req);

    expect(handler).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
  });

  it('logs SUCCESS and extracts resourceId from response JSON', async () => {
    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'b99' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const wrapped = createAuditInterceptor('bounty', 'create', handler);
    const req = makeRequest({
      'x-user-id': 'user_42',
      'x-forwarded-for': '5.5.5.5',
    });
    await wrapped(req);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArg = mockCreate.mock.calls[0][0].data;
    expect(callArg.status).toBe('SUCCESS');
    expect(callArg.userId).toBe('user_42');
    expect(callArg.resourceId).toBe('b99');
    expect(callArg.resource).toBe('bounty');
    expect(callArg.action).toBe('create');
  });

  it('logs FAILURE when handler returns a non-OK response', async () => {
    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const wrapped = createAuditInterceptor('bounty', 'update', handler);
    await wrapped(makeRequest({}));
    await new Promise((r) => setTimeout(r, 0));

    const callArg = mockCreate.mock.calls[0][0].data;
    expect(callArg.status).toBe('FAILURE');
  });

  it('logs FAILURE and re-throws when handler throws', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('DB crash'));
    const wrapped = createAuditInterceptor('bounty', 'delete', handler);

    await expect(wrapped(makeRequest({}))).rejects.toThrow('DB crash');
    await new Promise((r) => setTimeout(r, 0));

    const callArg = mockCreate.mock.calls[0][0].data;
    expect(callArg.status).toBe('FAILURE');
    expect(callArg.errorMessage).toBe('DB crash');
  });

  it('uses x-user-id header from the request', async () => {
    const handler = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const wrapped = createAuditInterceptor('profile', 'update', handler);
    await wrapped(makeRequest({ 'x-user-id': 'user_99' }));
    await new Promise((r) => setTimeout(r, 0));

    const callArg = mockCreate.mock.calls[0][0].data;
    expect(callArg.userId).toBe('user_99');
  });
});
