import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '../route';

vi.mock('@/server/services/stellar-circuit-breaker', () => ({
  stellarCircuitBreaker: {
    getState: vi.fn(),
  },
}));

import { stellarCircuitBreaker } from '@/server/services/stellar-circuit-breaker';

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 and ok status when circuit is CLOSED', async () => {
    (stellarCircuitBreaker.getState as ReturnType<typeof vi.fn>).mockReturnValue('CLOSED');
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.stellar_rpc.healthy).toBe(true);
  });

  it('returns 503 and degraded status when circuit is OPEN', async () => {
    (stellarCircuitBreaker.getState as ReturnType<typeof vi.fn>).mockReturnValue('OPEN');
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
    const data = await res.json();
    expect(data.status).toBe('degraded');
    expect(data.stellar_rpc.healthy).toBe(false);
  });
});
