import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/config/network', () => ({
  getNetworkConfig: () => ({ rpcUrl: 'http://localhost', passphrase: 'test' }),
}));

import { needsReattest, reattestExpiringKyc } from '@/server/services/kyc-reattest';

const DAY = 24 * 60 * 60;
const NOW = new Date('2026-01-01T00:00:00Z');
const nowSecs = NOW.getTime() / 1000;

describe('needsReattest', () => {
  it('re-attests when missing or invalid', () => {
    expect(needsReattest(null, nowSecs, 30)).toBe(true);
    expect(needsReattest({ expiresAt: nowSecs + 300 * DAY, valid: false }, nowSecs, 30)).toBe(true);
  });

  it('re-attests inside the window, not outside it', () => {
    expect(needsReattest({ expiresAt: nowSecs + 10 * DAY, valid: true }, nowSecs, 30)).toBe(true);
    expect(needsReattest({ expiresAt: nowSecs + 31 * DAY, valid: true }, nowSecs, 30)).toBe(false);
  });
});

describe('reattestExpiringKyc', () => {
  it('re-attests only expiring/invalid users and isolates failures', async () => {
    const reattest = vi.fn(async (wallet: string) => {
      if (wallet === 'GFAIL') throw new Error('rpc down');
      return 'tx';
    });
    const attestations: Record<string, { expiresAt: number; valid: boolean } | null> = {
      GFRESH: { expiresAt: nowSecs + 200 * DAY, valid: true },
      GSOON: { expiresAt: nowSecs + 5 * DAY, valid: true },
      GROTATED: { expiresAt: nowSecs + 200 * DAY, valid: false },
      GFAIL: null,
    };
    const result = await reattestExpiringKyc(
      {
        listCandidates: async () =>
          Object.keys(attestations).map((w, i) => ({ id: `kyc_${i}`, walletAddress: w })),
        readAttestation: async (w) => attestations[w],
        reattest,
        now: () => NOW,
      },
      30,
    );
    expect(result).toEqual({ checked: 4, reattested: 2, failed: 1, skipped: 1 });
    const wallets = reattest.mock.calls.map((c) => c[0]);
    expect(wallets).toEqual(['GSOON', 'GROTATED', 'GFAIL']);
    expect(reattest.mock.calls[0][1]).toHaveLength(32);
  });
});
