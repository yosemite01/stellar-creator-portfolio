import { describe, it, expect, beforeEach } from 'vitest';
import {
  replaceDisputeSnapshotForTests,
  fileDispute,
  addEvidence,
  startMediation,
  openCommunityVote,
  resolveDisputeWithTemplate,
  submitAppeal,
  getDisputeSnapshot,
  DISPUTE_RESOLUTION_TEMPLATES,
} from '@/lib/services/dispute-service';

describe('dispute workflow + escrow integration', () => {
  beforeEach(() => {
    replaceDisputeSnapshotForTests({ disputes: [] });
  });

  it('files a dispute, holds escrow, and records evidence', async () => {
    const d = fileDispute(
      {
        title: 'Title long enough for schema validation rules',
        description: 'y'.repeat(40),
        category: 'quality',
        relatedOrderId: 'ord-x',
        counterpartyId: 'cp-1',
        counterpartyName: 'Creator',
        escrowAmountCents: 50000,
      },
      { userId: 'client-1', name: 'Client' }
    );
    expect(d.escrow.held).toBe(true);
    expect(d.escrow.amountCents).toBe(50000);

    addEvidence(
      d.id,
      {
        fileName: 'screenshot.png',
        mimeType: 'image/png',
        byteSize: 2048,
        sha256: 'b'.repeat(64),
      },
      { userId: 'client-1', label: 'Client' }
    );
    const snap = getDisputeSnapshot();
    const updated = snap.disputes.find((x) => x.id === d.id);
    expect(updated?.evidence).toHaveLength(1);
    expect(updated?.evidence[0]?.sha256).toMatch(/^[b]{64}$/);
  });

  it('runs mediation, community vote, resolution, and appeal', () => {
    const d = fileDispute(
      {
        title: 'Another title that satisfies minimum length',
        description: 'z'.repeat(40),
        category: 'communication',
        relatedOrderId: 'ord-y',
        counterpartyId: 'cp-2',
        escrowAmountCents: 100,
      },
      { userId: 'a1', name: 'Alice' }
    );
    startMediation(d.id, 'admin-1', 'Please share timelines');
    openCommunityVote(d.id);
    const tpl = DISPUTE_RESOLUTION_TEMPLATES[0];
    if (!tpl) throw new Error('no template');
    resolveDisputeWithTemplate(d.id, tpl.id, 'Admin');
    const mid = getDisputeSnapshot().disputes.find((x) => x.id === d.id);
    expect(mid?.status).toBe('resolved');
    expect(mid?.escrow.releasedAt).toBeDefined();

    submitAppeal(d.id, { reason: 'New evidence surfaced after resolution.' }, 'cp-2');
    const after = getDisputeSnapshot().disputes.find((x) => x.id === d.id);
    expect(after?.status).toBe('appealed');
    expect(after?.appeal?.status).toBe('pending');
  });
});
