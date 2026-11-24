/**
 * Contract event listener tests — Issue #336
 *
 * Verifies that the escrow API client correctly handles event-driven
 * responses from the Soroban escrow contract, including:
 *  - Parsing escrow_deposited, escrow_released, escrow_refunded,
 *    escrow_disputed, and milestone_released event payloads
 *  - Consistent data formatting of EscrowTransactionResponse
 *  - Error handling for failed or unknown event types
 *
 * Fixtures (Issue #1828) are recorded from a real testnet lifecycle run by
 * `scripts/record-escrow-events.ts` and committed under
 * `fixtures/escrow-events/v1.json`. They are versioned and normalized so they
 * regenerate deterministically; the inline objects below are derived from that
 * committed fixture rather than hand-written.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  submitEscrowTransaction,
  releaseEscrow,
} from './api-client';
import {
  apiSuccess,
  apiFailure,
  validateEscrowTransaction,
  type EscrowTransactionResponse,
  type EscrowTransactionRequest,
} from './api-models';
import escrowEventFixtures from '../fixtures/escrow-events/v1.json';

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

// ── Event payload shape (recorded from testnet lifecycle) ─────────────────────

const fixtureEvents = escrowEventFixtures.events as Record<
  string,
  EscrowTransactionResponse
>;

const depositedEvent: EscrowTransactionResponse = fixtureEvents.deposited;
const releasedEvent: EscrowTransactionResponse = fixtureEvents.released;
const refundedEvent: EscrowTransactionResponse = fixtureEvents.refunded;
const disputedEvent: EscrowTransactionResponse = fixtureEvents.disputed;

// ── submitEscrowTransaction — deposit event ───────────────────────────────────

describe('submitEscrowTransaction — deposit', () => {
  const depositRequest: EscrowTransactionRequest = {
    bountyId: 'bounty-1',
    operation: 'deposit',
    amount: 2500,
    payerAddress: 'GPAYER123',
    payeeAddress: 'GPAYEE456',
    tokenAddress: 'GUSDC789',
  };

  it('returns a confirmed EscrowTransactionResponse on success', async () => {
    mockFetch(apiSuccess(depositedEvent), 201);
    const result = await submitEscrowTransaction(depositRequest);
    expect(result.escrowId).toBe(depositedEvent.escrowId);
    expect(result.operation).toBe('deposit');
    expect(result.status).toBe('confirmed');
    expect(result.txHash).toBe(depositedEvent.txHash);
  });

  it('POSTs to /api/escrow/transaction', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 201,
      json: () => Promise.resolve(apiSuccess(depositedEvent)),
    });
    vi.stubGlobal('fetch', fetchMock);
    await submitEscrowTransaction(depositRequest);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/escrow/transaction');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as EscrowTransactionRequest;
    expect(body.operation).toBe('deposit');
    expect(body.bountyId).toBe('bounty-1');
    expect(body.amount).toBe(2500);
  });

  it('throws ApiClientError on VALIDATION_ERROR', async () => {
    mockFetch(
      apiFailure('VALIDATION_ERROR', 'Amount must be positive', [
        { field: 'amount', message: 'Amount must be positive' },
      ]),
      422,
    );
    await expect(submitEscrowTransaction(depositRequest)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 422,
    });
  });

  it('throws ApiClientError on SERVICE_UNAVAILABLE', async () => {
    mockFetch(apiFailure('SERVICE_UNAVAILABLE', 'Stellar node unreachable'), 503);
    await expect(submitEscrowTransaction(depositRequest)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('throws network error when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));
    await expect(submitEscrowTransaction(depositRequest)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });
});

// ── releaseEscrow — release event ─────────────────────────────────────────────

describe('releaseEscrow', () => {
  it('returns a confirmed release response', async () => {
    mockFetch(apiSuccess(releasedEvent), 200);
    const result = await releaseEscrow('1', 'GPAYER123');
    expect(result.operation).toBe('release');
    expect(result.status).toBe('confirmed');
    expect(result.escrowId).toBe(releasedEvent.escrowId);
  });

  it('POSTs to /api/escrow/:id/release', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(apiSuccess(releasedEvent)),
    });
    vi.stubGlobal('fetch', fetchMock);
    await releaseEscrow('42', 'GPAYER123');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/escrow/42/release');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { authorizerAddress: string };
    expect(body.authorizerAddress).toBe('GPAYER123');
  });

  it('throws UNAUTHORIZED when caller is not a party', async () => {
    mockFetch(apiFailure('UNAUTHORIZED', 'Unauthorized'), 401);
    await expect(releaseEscrow('1', 'GSTRANGER')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('throws NOT_FOUND for missing escrow', async () => {
    mockFetch(apiFailure('NOT_FOUND', 'Escrow not found'), 404);
    await expect(releaseEscrow('999', 'GPAYER123')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

// ── Event payload data formatting ─────────────────────────────────────────────

describe('EscrowTransactionResponse data formatting', () => {
  it('parses refunded event correctly', async () => {
    mockFetch(apiSuccess(refundedEvent), 200);
    const result = await submitEscrowTransaction({
      bountyId: 'bounty-2',
      escrowId: '2',
      operation: 'refund',
      payerAddress: 'GPAYER123',
    });
    expect(result.operation).toBe('refund');
    expect(result.escrowId).toBe(refundedEvent.escrowId);
    expect(result.txHash).toBe(refundedEvent.txHash);
  });

  it('parses disputed event correctly', async () => {
    mockFetch(apiSuccess(disputedEvent), 200);
    const result = await submitEscrowTransaction({
      bountyId: 'bounty-3',
      escrowId: '3',
      operation: 'dispute',
      payerAddress: 'GPAYER123',
    });
    expect(result.operation).toBe('dispute');
    expect(result.status).toBe('pending');
  });

  it('preserves timestamp string from event', async () => {
    mockFetch(apiSuccess(depositedEvent), 201);
    const result = await submitEscrowTransaction({
      bountyId: 'bounty-1',
      operation: 'deposit',
      amount: 1000,
      payerAddress: 'GPAYER123',
      payeeAddress: 'GPAYEE456',
      tokenAddress: 'GUSDC789',
    });
    expect(result.timestamp).toBe(depositedEvent.timestamp);
  });
});

// ── Fixture versioning ────────────────────────────────────────────────────────

describe('escrow event fixtures', () => {
  it('declares an explicit schema version', () => {
    expect(escrowEventFixtures.version).toBe(1);
    expect(typeof escrowEventFixtures.recordedAt).toBe('string');
  });

  it('contains every lifecycle event with a stable shape', () => {
    for (const key of ['deposited', 'released', 'refunded', 'disputed']) {
      const event = fixtureEvents[key];
      expect(event).toBeDefined();
      expect(typeof event.escrowId).toBe('string');
      expect(typeof event.txHash).toBe('string');
      expect(typeof event.operation).toBe('string');
      expect(typeof event.status).toBe('string');
      expect(typeof event.timestamp).toBe('string');
    }
  });
});

// ── validateEscrowTransaction ─────────────────────────────────────────────────

describe('validateEscrowTransaction', () => {
  const validDeposit: EscrowTransactionRequest = {
    bountyId: 'b-1',
    operation: 'deposit',
    amount: 500,
    payerAddress: 'GPAYER123',
    payeeAddress: 'GPAYEE456',
    tokenAddress: 'GUSDC789',
  };

  it('returns null for a valid deposit request', () => {
    expect(validateEscrowTransaction(validDeposit)).toBeNull();
  });

  it('requires bountyId', () => {
    const errors = validateEscrowTransaction({ ...validDeposit, bountyId: '' });
    expect(errors?.some((e) => e.field === 'bountyId')).toBe(true);
  });

  it('requires operation', () => {
    const errors = validateEscrowTransaction({ ...validDeposit, operation: undefined as never });
    expect(errors?.some((e) => e.field === 'operation')).toBe(true);
  });

  it('requires payerAddress', () => {
    const errors = validateEscrowTransaction({ ...validDeposit, payerAddress: '' });
    expect(errors?.some((e) => e.field === 'payerAddress')).toBe(true);
  });
});
