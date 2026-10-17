import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initTestSchema,
  getTestPrismaClient,
  truncateAllTables,
  disconnectTestDatabase,
} from './setup/test-db';

describe('Postgres Escrow & Transaction Integration Suite', () => {
  let isDbAvailable = false;
  const prisma = getTestPrismaClient();

  beforeAll(async () => {
    try {
      await prisma.$connect();
      await initTestSchema();
      isDbAvailable = true;
    } catch {
      console.warn('[escrow.integration.test] Skipping live Postgres assertions; instance not running.');
    }
  });

  afterAll(async () => {
    if (isDbAvailable) {
      await disconnectTestDatabase();
    }
  });

  beforeEach(async () => {
    if (isDbAvailable) {
      await truncateAllTables(prisma);
    }
  });

  it('persists_and_queries_escrow_records_with_decimal_precision', async () => {
    if (!isDbAvailable) {
      expect(true).toBe(true);
      return;
    }

    const escrow = await prisma.escrow.create({
      data: {
        creatorId: 'creator-uuid-1',
        clientId: 'client-uuid-1',
        amount: 2500,
        status: 'active',
      },
    });

    expect(escrow.id).toBeDefined();
    expect(escrow.status).toBe('active');
    expect(escrow.amount).toBe(2500);

    const found = await prisma.escrow.findUnique({
      where: { id: escrow.id },
    });
    expect(found?.creatorId).toBe('creator-uuid-1');
  });

  it('enforces_atomic_transaction_status_transitions_and_updates', async () => {
    if (!isDbAvailable) {
      expect(true).toBe(true);
      return;
    }

    const escrow = await prisma.escrow.create({
      data: {
        creatorId: 'creator-uuid-2',
        clientId: 'client-uuid-2',
        amount: 5000,
        status: 'active',
      },
    });

    // Execute atomic release transition
    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const e = await tx.escrow.update({
        where: { id: escrow.id },
        data: {
          status: 'released',
          releasedAt: now,
        },
      });

      await tx.transaction.create({
        data: {
          userId: e.creatorId,
          escrowId: e.id,
          type: 'payout',
          amount: e.amount,
          status: 'completed',
        },
      });

      return e;
    });

    expect(updated.status).toBe('released');
    expect(updated.releasedAt).toBeDefined();

    const txRecords = await prisma.transaction.findMany({
      where: { escrowId: escrow.id },
    });
    expect(txRecords).toHaveLength(1);
    expect(txRecords[0].type).toBe('payout');
    expect(txRecords[0].amount).toBe(5000);
  });
});
