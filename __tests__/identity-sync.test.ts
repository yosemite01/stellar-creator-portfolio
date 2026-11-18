import { describe, expect, it, vi } from 'vitest';
import {
  applyIdentityEvent,
  reconcileKycSubmissions,
  reconcileSubmission,
  type IdentitySyncDeps,
  type KycRow,
} from '@/server/services/identity-sync';
import { invokeIdempotent, parseKycAttestation } from '@/server/services/identity-contract';

vi.mock('@/server/services/kms', () => ({ getSecret: vi.fn() }));
vi.mock('@/server/stellar/contract', () => ({ contractService: { invokeContractMethod: vi.fn() } }));
vi.mock('@/server/stellar/client', () => ({ stellarClient: {} }));

const WALLET = 'GUSER';

function fakeDeps(rows: KycRow[], chain: Set<string>, overrides: Partial<IdentitySyncDeps> = {}) {
  const db = new Map(rows.map((r) => [r.id, { ...r }]));
  const deps: IdentitySyncDeps = {
    listSubmissions: vi.fn(async (cursor, take) => {
      const all = [...db.values()].sort((a, b) => a.id.localeCompare(b.id));
      const start = cursor ? all.findIndex((r) => r.id === cursor) + 1 : 0;
      return all.slice(start, start + take);
    }),
    findByWallet: vi.fn(async (w) => [...db.values()].find((r) => r.walletAddress === w) ?? null),
    markOnChain: vi.fn(async (id, v) => {
      db.get(id)!.verifiedOnChain = v;
    }),
    isAttested: vi.fn(async (w) => chain.has(w)),
    verify: vi.fn(async (w) => {
      chain.add(w);
      return 'tx-verify';
    }),
    revoke: vi.fn(async (w) => {
      chain.delete(w);
      return 'tx-revoke';
    }),
    ...overrides,
  };
  return { deps, db };
}

const approved = (over: Partial<KycRow> = {}): KycRow => ({
  id: 's1',
  status: 'APPROVED',
  verifiedOnChain: false,
  walletAddress: WALLET,
  ...over,
});

describe('identity sync (#1811)', () => {
  it('submits the missing attestation and marks verified only after the chain confirms', async () => {
    const { deps, db } = fakeDeps([approved()], new Set());
    expect(await reconcileSubmission(approved(), deps)).toBe('verified-on-chain');
    expect(deps.markOnChain).toHaveBeenCalledWith('s1', true, 'tx-verify');
    expect(db.get('s1')!.verifiedOnChain).toBe(true);
  });

  it('failed tx does not mark verified', async () => {
    const { deps, db } = fakeDeps([approved()], new Set(), {
      verify: vi.fn(async () => {
        throw new Error('tx failed');
      }),
    });
    expect(await reconcileSubmission(approved(), deps)).toBe('failed');
    expect(db.get('s1')!.verifiedOnChain).toBe(false);
    expect(deps.markOnChain).not.toHaveBeenCalledWith('s1', true, expect.anything());
  });

  it('a tx that "succeeds" without the chain reflecting it does not mark verified', async () => {
    const { deps, db } = fakeDeps([approved()], new Set(), { verify: vi.fn(async () => 'tx-lost') });
    expect(await reconcileSubmission(approved(), deps)).toBe('failed');
    expect(db.get('s1')!.verifiedOnChain).toBe(false);
  });

  it('clears a stale DB flag when the chain has no attestation and the retry fails', async () => {
    const row = approved({ verifiedOnChain: true });
    const { deps, db } = fakeDeps([row], new Set(), {
      verify: vi.fn(async () => {
        throw new Error('rpc down');
      }),
    });
    expect(await reconcileSubmission(row, deps)).toBe('failed');
    expect(db.get('s1')!.verifiedOnChain).toBe(false);
  });

  it('revokes an attestation the DB says should not exist', async () => {
    const row = approved({ status: 'REJECTED', verifiedOnChain: true });
    const chain = new Set([WALLET]);
    const { deps, db } = fakeDeps([row], chain);
    expect(await reconcileSubmission(row, deps)).toBe('revoked-on-chain');
    expect(chain.has(WALLET)).toBe(false);
    expect(db.get('s1')!.verifiedOnChain).toBe(false);
  });

  it('fixes the DB flag when the chain is already attested', async () => {
    const { deps, db } = fakeDeps([approved()], new Set([WALLET]));
    expect(await reconcileSubmission(approved(), deps)).toBe('db-marked-verified');
    expect(deps.verify).not.toHaveBeenCalled();
    expect(db.get('s1')!.verifiedOnChain).toBe(true);
  });

  it('reconciles every page', async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      approved({ id: `s${i}`, walletAddress: `G${i}`, verifiedOnChain: i % 2 === 0 }),
    );
    const { deps, db } = fakeDeps(rows, new Set(['G0', 'G2']));
    const counts = await reconcileKycSubmissions(deps, 2);
    expect(counts['in-sync']).toBe(2);
    expect(counts['verified-on-chain']).toBe(3);
    expect([...db.values()].every((r) => r.verifiedOnChain)).toBe(true);
  });

  it('applies verified/revoked events idempotently', async () => {
    const { deps, db } = fakeDeps([approved()], new Set());
    expect(await applyIdentityEvent({ action: 'verified', walletAddress: WALLET }, deps)).toBe(true);
    expect(await applyIdentityEvent({ action: 'verified', walletAddress: WALLET }, deps)).toBe(false);
    expect(db.get('s1')!.verifiedOnChain).toBe(true);
    expect(await applyIdentityEvent({ action: 'revoked', walletAddress: WALLET }, deps)).toBe(true);
    expect(db.get('s1')!.verifiedOnChain).toBe(false);
    expect(await applyIdentityEvent({ action: 'other', walletAddress: WALLET }, deps)).toBe(false);
    expect(await applyIdentityEvent({ action: 'verified', walletAddress: 'GNOPE' }, deps)).toBe(false);
  });
});

describe('invokeIdempotent (#1811)', () => {
  const sleep = vi.fn(async () => {});

  it('retries until success', async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce('tx1');
    expect(await invokeIdempotent(submit, async () => false, { sleep })).toBe('tx1');
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('does not resubmit when an earlier attempt landed', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('poll timeout'));
    const applied = vi.fn().mockResolvedValue(true);
    expect(await invokeIdempotent(submit, applied, { sleep })).toBeNull();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('throws when every attempt fails and the chain is unchanged', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('tx failed'));
    await expect(invokeIdempotent(submit, async () => false, { sleep, maxAttempts: 3 })).rejects.toThrow(
      'tx failed',
    );
    expect(submit).toHaveBeenCalledTimes(3);
  });

  it('treats an unreadable chain as not applied', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('tx failed'));
    const applied = vi.fn().mockRejectedValue(new Error('rpc down'));
    await expect(invokeIdempotent(submit, applied, { sleep, maxAttempts: 2 })).rejects.toThrow();
  });

  it('reads expired attestations as absent', () => {
    expect(parseKycAttestation(null, 100)).toBeNull();
    expect(parseKycAttestation({ level: 0, attested_at: 1n, expires_at: 50n }, 100)).toBeNull();
    expect(parseKycAttestation({ level: 0, attested_at: 1n, expires_at: 200n }, 100)).toEqual({
      level: 0,
      attestedAt: 1,
      expiresAt: 200,
    });
  });
});
