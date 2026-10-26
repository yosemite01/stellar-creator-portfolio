// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Account, Address, Asset, Contract, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

const { getServerSession } = vi.hoisted(() => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth/auth', () => ({ getServerSession }));
vi.mock('@/server/services/kms', () => ({ getSecret: vi.fn() }));

import { POST } from '../route';
import { resetSponsorPolicy } from '@/lib/payments/sponsorPolicy';

const OUR_CONTRACT = Address.contract(Buffer.alloc(32, 1)).toString();
const sender = Keypair.random();
let sequence = 1;

function signedXdr(kind: 'contract' | 'payment'): string {
  const operation =
    kind === 'contract'
      ? new Contract(OUR_CONTRACT).call('deposit')
      : Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' });
  const tx = new TransactionBuilder(new Account(sender.publicKey(), String(sequence++)), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(operation)
    .setTimeout(0)
    .build();
  tx.sign(sender);
  return tx.toXDR();
}

function request(body: unknown) {
  return new NextRequest('http://localhost/api/relay/fallback', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetSponsorPolicy();
  getServerSession.mockReset();
  getServerSession.mockResolvedValue({ user: { id: 'user-1' } });
  vi.stubEnv('STELLAR_NETWORK_PASSPHRASE', Networks.TESTNET);
  vi.stubEnv('NEXT_PUBLIC_ESCROW_CONTRACT_ID', OUR_CONTRACT);
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hash: 'h', ledger: 5 }) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('POST /api/relay/fallback', () => {
  it('returns 401 without a session and submits nothing', async () => {
    getServerSession.mockResolvedValue(null);
    const res = await POST(request({ xdr: signedXdr('contract') }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['is missing', {}],
    ['is not a string', { xdr: 42 }],
    ['is empty', { xdr: '' }],
  ])('returns 400 "Missing xdr" when xdr %s', async (_name, body) => {
    const res = await POST(request(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Missing xdr' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is not JSON', async () => {
    const res = await POST(request('not json'));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 for XDR that does not decode', async () => {
    const res = await POST(request({ xdr: 'not-valid-xdr' }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 403 for a disallowed operation and submits nothing', async () => {
    const res = await POST(request({ xdr: signedXdr('payment') }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 429 once the daily budget is used up', async () => {
    vi.stubEnv('STELLAR_SPONSOR_DAILY_BUDGET', '100');
    expect((await POST(request({ xdr: signedXdr('contract') }))).status).toBe(200);
    expect((await POST(request({ xdr: signedXdr('contract') }))).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('forwards an allowed transaction to the fallback Horizon unchanged', async () => {
    const xdr = signedXdr('contract');
    const res = await POST(request({ xdr }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hash: 'h', ledger: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = fetchMock.mock.calls[0][1] as { body: URLSearchParams };
    expect(sent.body.get('tx')).toBe(xdr);
  });
});
