/**
 * End-to-end style flow (Vitest). Included in `pnpm test`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  replaceDisputeSnapshotForTests,
  fileDispute,
  addEvidence,
  startMediation,
  openCommunityVote,
  castCommunityVote,
  resolveDisputeWithTemplate,
  closeDispute,
  getDisputeSnapshot,
  DISPUTE_RESOLUTION_TEMPLATES,
} from '@/lib/services/dispute-service';

describe('E2E dispute resolution (simulated)', () => {
  beforeEach(() => {
    replaceDisputeSnapshotForTests({ disputes: [] });
  });

  it('runs filing → evidence → mediation → community vote → resolution → close', () => {
    const d = fileDispute(
      {
        title: 'End-to-end title with enough characters present',
        description: 'e'.repeat(40),
        category: 'delivery',
        relatedOrderId: 'ord-e2e',
        counterpartyId: 'cp-e2e',
        escrowAmountCents: 25000,
      },
      { userId: 'client-e2e', name: 'Client' }
    );

    addEvidence(
      d.id,
      {
        fileName: 'deliverables.zip',
        mimeType: 'application/zip',
        byteSize: 4096,
        sha256: 'c'.repeat(64),
      },
      { userId: 'client-e2e', label: 'Client' }
    );

    startMediation(d.id, 'admin-e2e', 'Schedule joint session');
    openCommunityVote(d.id);
    castCommunityVote(
      d.id,
      { userId: 'community-member-1', side: 'creator' },
      'USER'
    );

    const tpl = DISPUTE_RESOLUTION_TEMPLATES.find((t) => t.id === 'tpl_split');
    if (!tpl) throw new Error('missing template');
    resolveDisputeWithTemplate(d.id, tpl.id, 'Admin', 'Split 60/40 per review.');
    closeDispute(d.id);

    const row = getDisputeSnapshot().disputes.find((x) => x.id === d.id);
    expect(row?.status).toBe('closed');
    expect(row?.communityVotes).toHaveLength(1);
    expect(row?.evidence).toHaveLength(1);
  });
});
