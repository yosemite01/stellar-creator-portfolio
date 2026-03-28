import { describe, it, expect, beforeEach } from 'vitest';
import {
  replaceDisputeSnapshotForTests,
  fileDispute,
  openCommunityVote,
  castCommunityVote,
  verifyEvidenceDigest,
  canViewDispute,
  hashEvidenceBytes,
} from '@/lib/services/dispute-service';

describe('dispute security', () => {
  beforeEach(() => {
    replaceDisputeSnapshotForTests({ disputes: [] });
  });

  it('verifies evidence integrity against SHA-256', async () => {
    const encoded = new TextEncoder().encode('hello-dispute');
    const buf = encoded.buffer.slice(
      encoded.byteOffset,
      encoded.byteOffset + encoded.byteLength
    );
    const sha256 = await hashEvidenceBytes(buf);
    const meta = {
      fileName: 'x.txt',
      mimeType: 'text/plain',
      byteLength: buf.byteLength,
      sha256,
    };
    const ok = await verifyEvidenceDigest(
      {
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        byteSize: meta.byteLength,
        sha256: meta.sha256,
      },
      buf
    );
    expect(ok).toBe(true);
  });

  it('blocks parties from casting community votes', () => {
    const d = fileDispute(
      {
        title: 'Title long enough for all dispute validation here',
        description: 'p'.repeat(40),
        category: 'other',
        relatedOrderId: 'ord-z',
        counterpartyId: 'party-b',
        escrowAmountCents: 0,
      },
      { userId: 'party-a', name: 'A' }
    );
    openCommunityVote(d.id);
    expect(() =>
      castCommunityVote(
        d.id,
        { userId: 'party-a', side: 'client' },
        'USER'
      )
    ).toThrow();
  });

  it('restricts dispute visibility to parties and admins', () => {
    const d = fileDispute(
      {
        title: 'Title long enough for all dispute validation here',
        description: 'q'.repeat(40),
        category: 'other',
        relatedOrderId: 'ord-w',
        counterpartyId: 'c2',
        escrowAmountCents: 0,
      },
      { userId: 'c1', name: 'One' }
    );
    expect(canViewDispute('c1', 'CLIENT', d)).toBe(true);
    expect(canViewDispute('c2', 'CREATOR', d)).toBe(true);
    expect(canViewDispute('outsider', 'USER', d)).toBe(false);
    expect(canViewDispute('outsider', 'ADMIN', d)).toBe(true);
  });
});
