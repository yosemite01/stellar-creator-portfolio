import { describe, it, expect, beforeEach } from 'vitest';
import {
  replaceDisputeSnapshotForTests,
  fileDispute,
  getDisputeSnapshot,
} from '@/lib/services/dispute-service';

describe('dispute performance', () => {
  beforeEach(() => {
    replaceDisputeSnapshotForTests({ disputes: [] });
  });

  it('handles many concurrent dispute filings', async () => {
    const n = 40;
    const base = 'Title long enough for all dispute validation rules here ';
    await Promise.all(
      Array.from({ length: n }, (_, i) =>
        Promise.resolve(
          fileDispute(
            {
              title: `${base}${i}`,
              description: 'd'.repeat(40),
              category: 'other',
              relatedOrderId: `ord-${i}`,
              counterpartyId: `cp-${i}`,
              escrowAmountCents: i % 5 === 0 ? 100 : 0,
            },
            { userId: `u-${i}`, name: `User ${i}` }
          )
        )
      )
    );
    expect(getDisputeSnapshot().disputes.length).toBeGreaterThanOrEqual(n);
  });
});
