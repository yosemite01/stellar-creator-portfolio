import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => {
  const mockOutbox = {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
  };
  return {
    prisma: {
      outboxEvent: mockOutbox,
      $transaction: vi.fn(async (cb) => cb({ outboxEvent: mockOutbox })),
    },
  };
});

import {
  relayOutboxEvents,
  getOutboxStats,
  claimEvent,
  isEventProcessed,
  _resetProcessedEvents,
  onEvent,
} from '../events';
import {
  executeTransactionWithOutbox,
  recordOutboxEvent,
} from '@/lib/db/transaction-manager';
import { prisma } from '@/lib/prisma';

describe('Transactional Outbox Pattern (#1759)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetProcessedEvents();
  });

  it('records outbox event within transaction', async () => {
    const tx = {
      outboxEvent: {
        create: vi.fn().mockResolvedValue({ id: 'outbox-1' }),
      },
    };

    const result = await recordOutboxEvent(tx, 'BountyCreated', {
      bountyId: 'b-1',
      creatorId: 'c-1',
      title: 'Build UI',
      budget: 1000,
    });

    expect(result.eventId).toBeDefined();
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'BountyCreated',
          status: 'PENDING',
        }),
      }),
    );
  });

  it('executes transaction with outbox helper', async () => {
    let capturedTx: any;
    let eventLogged = false;

    await executeTransactionWithOutbox(async (tx, enqueueEvent) => {
      capturedTx = tx;
      await enqueueEvent('EscrowCreated', {
        escrowId: 'esc-1',
        bountyId: 'b-1',
        payerAddress: 'GAAA',
        payeeAddress: 'GBBB',
        amount: 500,
      });
      eventLogged = true;
    });

    expect(capturedTx).toBeDefined();
    expect(eventLogged).toBe(true);
    expect((prisma as any).outboxEvent.create).toHaveBeenCalled();
  });

  it('relays pending outbox events to bus and marks PUBLISHED', async () => {
    const listener = vi.fn();
    onEvent('BountyCreated', listener);

    (prisma as any).outboxEvent.findMany.mockResolvedValueOnce([
      {
        id: 'outbox-1',
        eventId: 'evt-1',
        eventType: 'BountyCreated',
        payload: { bountyId: 'b-99', creatorId: 'c-99', title: 'Test', budget: 200 },
        retryCount: 0,
        maxRetries: 5,
        status: 'PENDING',
      },
    ]);

    const res = await relayOutboxEvents(10);
    expect(res.processed).toBe(1);
    expect(res.published).toBe(1);
    expect((prisma as any).outboxEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({ status: 'PUBLISHED' }),
      }),
    );
  });

  it('ensures consumer idempotency with claimEvent and isEventProcessed', () => {
    const eventId = 'evt-unique-123';
    const listenerKey = 'EmailNotifier';

    expect(isEventProcessed(listenerKey, eventId)).toBe(false);
    expect(claimEvent(listenerKey, eventId)).toBe(true);
    expect(isEventProcessed(listenerKey, eventId)).toBe(true);
    expect(claimEvent(listenerKey, eventId)).toBe(false); // replay returns false
  });

  it('returns monitoring statistics for outbox queue', async () => {
    (prisma as any).outboxEvent.count
      .mockResolvedValueOnce(5) // pending
      .mockResolvedValueOnce(100) // published
      .mockResolvedValueOnce(2); // failed
    (prisma as any).outboxEvent.findFirst.mockResolvedValueOnce({
      createdAt: new Date('2026-11-20T10:00:00Z'),
    });

    const stats = await getOutboxStats();
    expect(stats.pending).toBe(5);
    expect(stats.published).toBe(100);
    expect(stats.failed).toBe(2);
    expect(stats.oldestPendingCreatedAt).toEqual(new Date('2026-11-20T10:00:00Z'));
  });
});
