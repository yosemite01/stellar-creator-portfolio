// @vitest-environment node
/**
 * Tests for the paymaster fee-bump logic (lib/payments/feeBump.ts).
 *
 * Issue #1509: /api/relay/sponsor previously forwarded the raw XDR to Horizon
 * despite claiming to fee-bump. These tests reproduce that (a real
 * FeeBumpTransaction must now be produced) and cover the rejection paths.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Account,
  Asset,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

// The fee seed must come from KMS, never a raw env secret on the hot path.
const { getSecret } = vi.hoisted(() => ({ getSecret: vi.fn() }));
vi.mock('@/server/services/kms', () => ({ getSecret }));

import { buildFeeBump, sponsorTransaction, SponsorError } from '@/lib/payments/feeBump';

const feeKp = Keypair.random();
const sender = Keypair.random();

/** Build a signed, single-operation payment envelope for the given fee. */
function signedInnerXdr(fee = '100'): string {
  const account = new Account(sender.publicKey(), '1');
  const tx = new TransactionBuilder(account, { fee, networkPassphrase: Networks.TESTNET })
    .addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: '10',
      }),
    )
    .setTimeout(0)
    .build();
  tx.sign(sender);
  return tx.toXDR();
}

beforeEach(() => {
  getSecret.mockReset();
  getSecret.mockResolvedValue(feeKp.secret());
  vi.stubEnv('STELLAR_FEE_ACCOUNT', feeKp.publicKey());
  vi.stubEnv('STELLAR_NETWORK_PASSPHRASE', Networks.TESTNET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildFeeBump', () => {
  // Acceptance criterion: the produced envelope is a fee-bump funded by the platform.
  it('wraps a user transaction in a FeeBumpTransaction funded by the platform', async () => {
    const bump = await buildFeeBump(signedInnerXdr());

    expect(bump).toBeInstanceOf(FeeBumpTransaction);
    expect(bump.feeSource).toBe(feeKp.publicKey());
    // The platform signature must be present on the outer envelope.
    const hash = bump.hash();
    const verified = bump.signatures.some((sig) => feeKp.verify(hash, sig.signature()));
    expect(verified).toBe(true);
  });

  it('rejects an envelope that is already fee-bumped', async () => {
    const already = TransactionBuilder.buildFeeBumpTransaction(
      feeKp.publicKey(),
      '100',
      TransactionBuilder.fromXDR(signedInnerXdr(), Networks.TESTNET) as never,
      Networks.TESTNET,
    );
    already.sign(feeKp);

    await expect(buildFeeBump(already.toXDR())).rejects.toMatchObject({
      name: 'SponsorError',
      status: 400,
    });
  });

  it('rejects a transaction whose fee exceeds the sponsored maximum', async () => {
    // MAX_SPONSORED_FEE defaults to 100_000 stroops.
    await expect(buildFeeBump(signedInnerXdr('200000'))).rejects.toBeInstanceOf(SponsorError);
    await expect(buildFeeBump(signedInnerXdr('200000'))).rejects.toMatchObject({ status: 402 });
  });

  it('rejects garbage XDR with a 400', async () => {
    await expect(buildFeeBump('not-valid-xdr')).rejects.toMatchObject({ status: 400 });
  });

  it('returns 503 when the platform fee account is not configured', async () => {
    vi.stubEnv('STELLAR_FEE_ACCOUNT', '');
    await expect(buildFeeBump(signedInnerXdr())).rejects.toMatchObject({ status: 503 });
  });
});

describe('sponsorTransaction', () => {
  it('submits the fee-bump envelope (not the raw input) to Horizon', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hash: 'outerhash', ledger: 42, fee_charged: '200' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const input = signedInnerXdr();
    const result = await sponsorTransaction(input);

    expect(result).toEqual({
      hash: 'outerhash',
      innerHash: expect.any(String),
      ledger: 42,
      feeCharged: '200',
    });

    // The submitted body must itself decode to a platform-funded fee-bump —
    // this is the regression the issue reported (raw XDR was forwarded instead).
    const sent = fetchMock.mock.calls[0][1] as { body: URLSearchParams };
    const submittedXdr = sent.body.get('tx')!;
    const decoded = TransactionBuilder.fromXDR(submittedXdr, Networks.TESTNET);
    expect(decoded).toBeInstanceOf(FeeBumpTransaction);
    expect((decoded as FeeBumpTransaction).feeSource).toBe(feeKp.publicKey());
  });
});
