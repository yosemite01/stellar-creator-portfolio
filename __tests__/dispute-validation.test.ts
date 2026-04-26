import { describe, it, expect } from 'vitest';
import {
  fileDisputeInputSchema,
  evidenceMetadataSchema,
  parseFileDisputeInput,
  disputeFormInputSchema,
  toFileDisputeInput,
} from '@/lib/services/dispute-service';

describe('dispute validation', () => {
  it('accepts a valid filing payload', () => {
    const r = fileDisputeInputSchema.parse({
      title: 'Enough title length here',
      description: 'x'.repeat(40),
      category: 'payment',
      relatedOrderId: 'ord-1',
      counterpartyId: 'u2',
      escrowAmountCents: 1000,
    });
    expect(r.escrowAmountCents).toBe(1000);
  });

  it('rejects short description', () => {
    expect(() =>
      fileDisputeInputSchema.parse({
        title: 'Enough title length here',
        description: 'short',
        category: 'other',
        relatedOrderId: 'ord-1',
        counterpartyId: 'u2',
      })
    ).toThrow();
  });

  it('maps form dollars to cents', () => {
    const form = disputeFormInputSchema.parse({
      title: 'Enough title length here',
      description: 'x'.repeat(40),
      category: 'delivery',
      relatedOrderId: 'ord-1',
      counterpartyId: 'u2',
      escrowDollars: '12.34',
    });
    const input = toFileDisputeInput(form);
    expect(input.escrowAmountCents).toBe(1234);
  });

  it('parses evidence metadata with valid digest', () => {
    const meta = evidenceMetadataSchema.parse({
      fileName: 'proof.pdf',
      mimeType: 'application/pdf',
      byteSize: 1024,
      sha256: 'a'.repeat(64),
    });
    expect(meta.fileName).toBe('proof.pdf');
  });

  it('parseFileDisputeInput throws on bad input', () => {
    expect(() => parseFileDisputeInput({})).toThrow();
  });
});
