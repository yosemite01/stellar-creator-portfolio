// @vitest-environment node
/**
 * Tests for the paymaster abuse controls (lib/payments/sponsorPolicy.ts, #1510).
 *
 * The attack: anyone could POST arbitrary transactions to the relay and have the
 * platform fee account pay for them.  These cover the allowlist, the per-user
 * budget and the low-balance breaker, and check that a rejected request never
 * reaches the platform signing key.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Account,
  Address,
  Asset,
  Contract,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

const { getSecret, loggerError } = vi.hoisted(() => ({ getSecret: vi.fn(), loggerError: vi.fn() }));
vi.mock('@/server/services/kms', () => ({ getSecret }));
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: loggerError },
}));

import { buildFeeBump, parseInnerTransaction, sponsorTransaction } from '@/lib/payments/feeBump';
import {
  assertAllowedOperations,
  authorizeFallback,
  authorizeSponsorship,
  reserveSponsorBudget,
  resetSponsorPolicy,
} from '@/lib/payments/sponsorPolicy';

const feeKp = Keypair.random();
const sender = Keypair.random();
const OUR_CONTRACT = Address.contract(Buffer.alloc(32, 1)).toString();
const OTHER_CONTRACT = Address.contract(Buffer.alloc(32, 2)).toString();

let sequence = 1;

/** A signed single-transaction envelope wrapping the given operations. */
function innerXdr(...ops: xdr.Operation[]): string {
  const account = new Account(sender.publicKey(), String(sequence++));
  const builder = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET });
  ops.forEach((op) => builder.addOperation(op));
  const tx = builder.setTimeout(0).build();
  tx.sign(sender);
  return tx.toXDR();
}

const payment = () =>
  Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '10' });
const call = (contractId: string) => new Contract(contractId).call('deposit');
const parse = (...ops: xdr.Operation[]) => parseInnerTransaction(innerXdr(...ops));

function horizonMock(balance = '100.0000000') {
  return vi.fn(async (url: string) => {
    if (url.includes('/accounts/')) {
      return { ok: true, json: async () => ({ balances: [{ asset_type: 'native', balance }] }) };
    }
    return { ok: true, json: async () => ({ hash: 'outer', ledger: 9, fee_charged: '200' }) };
  });
}

beforeEach(() => {
  getSecret.mockReset();
  getSecret.mockResolvedValue(feeKp.secret());
  loggerError.mockReset();
  resetSponsorPolicy();
  vi.stubEnv('STELLAR_FEE_ACCOUNT', feeKp.publicKey());
  vi.stubEnv('STELLAR_NETWORK_PASSPHRASE', Networks.TESTNET);
  vi.stubEnv('NEXT_PUBLIC_ESCROW_CONTRACT_ID', OUR_CONTRACT);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('assertAllowedOperations', () => {
  it('rejects a classic payment by default', () => {
    expect(() => assertAllowedOperations(parse(payment()))).toThrowError(
      expect.objectContaining({ name: 'SponsorError', status: 403 }),
    );
  });

  it('rejects a call into a contract that is not ours', () => {
    expect(() => assertAllowedOperations(parse(call(OTHER_CONTRACT)))).toThrowError(
      expect.objectContaining({ status: 403 }),
    );
  });

  it('rejects wasm uploads', () => {
    const upload = Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeUploadContractWasm(Buffer.from([0, 1, 2])),
      auth: [],
    });
    expect(() => assertAllowedOperations(parse(upload))).toThrowError(
      expect.objectContaining({ status: 403 }),
    );
  });

  it('rejects a batch that mixes an allowed and a disallowed operation', () => {
    expect(() => assertAllowedOperations(parse(call(OUR_CONTRACT), payment()))).toThrowError(
      expect.objectContaining({ status: 403 }),
    );
  });

  it('accepts a call into one of our contracts', () => {
    expect(() => assertAllowedOperations(parse(call(OUR_CONTRACT)))).not.toThrow();
  });

  it('accepts a classic operation that is explicitly allowed', () => {
    vi.stubEnv('STELLAR_SPONSOR_ALLOWED_OPS', 'payment, changeTrust');
    expect(() => assertAllowedOperations(parse(payment()))).not.toThrow();
  });

  it('does not let the classic allowlist widen contract calls', () => {
    vi.stubEnv('STELLAR_SPONSOR_ALLOWED_OPS', 'invokeHostFunction');
    expect(() => assertAllowedOperations(parse(call(OTHER_CONTRACT)))).toThrowError(
      expect.objectContaining({ status: 403 }),
    );
  });
});

describe('reserveSponsorBudget', () => {
  beforeEach(() => {
    vi.stubEnv('STELLAR_SPONSOR_DAILY_BUDGET', '1000');
  });

  it('returns 429 once the daily budget would be exceeded', () => {
    reserveSponsorBudget('u1', 'a', 600n);
    expect(() => reserveSponsorBudget('u1', 'b', 600n)).toThrowError(
      expect.objectContaining({ status: 429 }),
    );
  });

  it('keeps budgets separate per user', () => {
    reserveSponsorBudget('u1', 'a', 900n);
    expect(() => reserveSponsorBudget('u2', 'b', 900n)).not.toThrow();
  });

  it('does not charge a replayed inner transaction twice', () => {
    reserveSponsorBudget('u1', 'same', 900n);
    expect(() => reserveSponsorBudget('u1', 'same', 900n)).not.toThrow();
    // Only the first 900 was charged, so 100 still fits and 101 does not.
    expect(() => reserveSponsorBudget('u1', 'x', 100n)).not.toThrow();
    expect(() => reserveSponsorBudget('u1', 'y', 1n)).toThrowError(
      expect.objectContaining({ status: 429 }),
    );
  });

  it('starts a fresh budget on the next UTC day', () => {
    const day1 = Date.UTC(2026, 9, 21, 12);
    reserveSponsorBudget('u1', 'a', 1000n, day1);
    expect(() => reserveSponsorBudget('u1', 'b', 1n, day1)).toThrow();
    expect(() => reserveSponsorBudget('u1', 'b', 1000n, day1 + 24 * 60 * 60 * 1000)).not.toThrow();
  });
});

describe('sponsorTransaction with the policy applied', () => {
  it('sponsors an allowed contract call and charges the budget', async () => {
    const fetchMock = horizonMock();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('STELLAR_SPONSOR_DAILY_BUDGET', '300');

    const result = await sponsorTransaction(innerXdr(call(OUR_CONTRACT)), (fb) =>
      authorizeSponsorship('u1', fb),
    );

    expect(result.hash).toBe('outer');
    expect(getSecret).toHaveBeenCalledTimes(1);
    // The outer fee for one inner op is 200 stroops, so a second one overruns 300.
    await expect(
      sponsorTransaction(innerXdr(call(OUR_CONTRACT)), (fb) => authorizeSponsorship('u1', fb)),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('rejects a disallowed operation before the platform key is read or anything is submitted', async () => {
    const fetchMock = horizonMock();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sponsorTransaction(innerXdr(payment()), (fb) => authorizeSponsorship('u1', fb)),
    ).rejects.toMatchObject({ status: 403 });

    expect(getSecret).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 429 for an over-budget user without signing', async () => {
    vi.stubGlobal('fetch', horizonMock());
    vi.stubEnv('STELLAR_SPONSOR_DAILY_BUDGET', '100');

    await expect(
      buildFeeBump(innerXdr(call(OUR_CONTRACT)), (fb) => authorizeSponsorship('u1', fb)),
    ).rejects.toMatchObject({ status: 429 });
    expect(getSecret).not.toHaveBeenCalled();
  });

  it('trips the breaker when the fee account balance is low, and alerts', async () => {
    vi.stubGlobal('fetch', horizonMock('1.0000000')); // 10_000_000 stroops < default 50_000_000

    await expect(
      buildFeeBump(innerXdr(call(OUR_CONTRACT)), (fb) => authorizeSponsorship('u1', fb)),
    ).rejects.toMatchObject({ status: 503 });

    expect(getSecret).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('below the minimum'),
      expect.objectContaining({ balanceStroops: '10000000' }),
    );
  });

  it('fails closed when the fee account balance cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    await expect(
      buildFeeBump(innerXdr(call(OUR_CONTRACT)), (fb) => authorizeSponsorship('u1', fb)),
    ).rejects.toMatchObject({ status: 503 });
    expect(getSecret).not.toHaveBeenCalled();
  });

  it('produces a signed fee-bump for the happy path', async () => {
    vi.stubGlobal('fetch', horizonMock());

    const bump = await buildFeeBump(innerXdr(call(OUR_CONTRACT)), (fb) =>
      authorizeSponsorship('u1', fb),
    );

    expect(bump).toBeInstanceOf(FeeBumpTransaction);
    expect(bump.feeSource).toBe(feeKp.publicKey());
  });
});

describe('authorizeFallback', () => {
  it('applies the same allowlist and budget as the primary relay', () => {
    vi.stubEnv('STELLAR_SPONSOR_DAILY_BUDGET', '100');

    expect(() => authorizeFallback('u1', parse(payment()))).toThrowError(
      expect.objectContaining({ status: 403 }),
    );
    expect(() => authorizeFallback('u1', parse(call(OUR_CONTRACT)))).not.toThrow();
    expect(() => authorizeFallback('u1', parse(call(OUR_CONTRACT)))).toThrowError(
      expect.objectContaining({ status: 429 }),
    );
  });
});
