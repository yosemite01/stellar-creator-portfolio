import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/errors/log/route';
import { resetRate } from '@/server/api/rate-limit';

function makeRequest(body: unknown, ip = '203.0.113.7') {
  return new NextRequest('http://localhost/api/errors/log', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const report = {
  id: 'err_1',
  timestamp: '2026-10-03T10:00:00.000Z',
  level: 'error',
  message: 'Something broke',
  context: { component: 'Header', userEmail: 'person@example.com' },
};

afterEach(() => {
  vi.restoreAllMocks();
  resetRate('error-report:203.0.113.7');
  resetRate('error-report:198.51.100.1');
});

describe('POST /api/errors/log', () => {
  it('accepts a valid report and logs it without the email address', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(makeRequest(report));

    expect(res.status).toBe(202);
    expect(log).toHaveBeenCalledOnce();
    const line = log.mock.calls[0][0] as string;
    expect(line).toContain('Something broke');
    expect(line).not.toContain('person@example.com');
  });

  it('rejects malformed JSON', async () => {
    const res = await POST(makeRequest('{not json'));
    expect(res.status).toBe(400);
  });

  it('rejects a report missing required fields', async () => {
    const res = await POST(makeRequest({ message: 'no id or level' }));
    expect(res.status).toBe(400);
  });

  it('rejects oversized reports', async () => {
    const res = await POST(makeRequest({ ...report, stack: 'x'.repeat(40_000) }));
    expect(res.status).toBe(413);
  });

  it('rate-limits a single client', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      statuses.push((await POST(makeRequest(report, '198.51.100.1'))).status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 202)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
