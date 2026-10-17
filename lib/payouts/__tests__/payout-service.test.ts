import { describe, it, expect } from 'vitest';
import {
  computeFeeBreakdown,
  createPayoutRecord,
  getPayoutById,
  listPayoutsForFreelancer,
  generateReceiptFromPayout,
  generateReceiptPdf,
} from '../payout-service';

describe('Payout Service & Receipts', () => {
  it('correctly computes platform fee breakdown (10% default)', () => {
    const fee = computeFeeBreakdown(1000, 'USDC');
    expect(fee.grossAmount).toBe(1000);
    expect(fee.platformFeeRate).toBe(0.10);
    expect(fee.platformFeeAmount).toBe(100);
    expect(fee.netPayoutAmount).toBe(900);
    expect(fee.currency).toBe('USDC');
  });

  it('correctly computes custom fee rate breakdown', () => {
    const fee = computeFeeBreakdown(500, 'USD', 0.05);
    expect(fee.grossAmount).toBe(500);
    expect(fee.platformFeeRate).toBe(0.05);
    expect(fee.platformFeeAmount).toBe(25);
    expect(fee.netPayoutAmount).toBe(475);
  });

  it('creates a payout record and formats Stellar explorer link', () => {
    const txHash = 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0';
    const record = createPayoutRecord({
      freelancerUserId: 'fl-test-1',
      freelancerName: 'Jane Dev',
      clientUserId: 'cl-test-1',
      clientName: 'Acme Corp',
      bountyId: 'bounty-99',
      bountyTitle: 'Fix smart contract vulnerabilities',
      grossAmount: 2500,
      currency: 'USDC',
      type: 'on-chain',
      stellarTxHash: txHash,
    });

    expect(record.id).toBeDefined();
    expect(record.feeBreakdown.grossAmount).toBe(2500);
    expect(record.feeBreakdown.platformFeeAmount).toBe(250);
    expect(record.feeBreakdown.netPayoutAmount).toBe(2250);
    expect(record.stellarExplorerUrl).toBe(`https://stellar.expert/explorer/testnet/tx/${txHash}`);

    const retrieved = getPayoutById(record.id);
    expect(retrieved?.id).toBe(record.id);
  });

  it('lists payouts filtered by freelancer, type and status', () => {
    createPayoutRecord({
      freelancerUserId: 'fl-filter-user',
      freelancerName: 'Filter Test',
      clientUserId: 'cl-1',
      clientName: 'Client',
      bountyId: 'b-1',
      bountyTitle: 'On-chain task',
      grossAmount: 1000,
      type: 'on-chain',
      status: 'completed',
    });

    createPayoutRecord({
      freelancerUserId: 'fl-filter-user',
      freelancerName: 'Filter Test',
      clientUserId: 'cl-1',
      clientName: 'Client',
      bountyId: 'b-2',
      bountyTitle: 'Fiat task',
      grossAmount: 500,
      type: 'fiat',
      status: 'completed',
    });

    const onChainList = listPayoutsForFreelancer('fl-filter-user', { type: 'on-chain' });
    expect(onChainList.length).toBeGreaterThanOrEqual(1);
    expect(onChainList.every((p) => p.type === 'on-chain')).toBe(true);

    const fiatList = listPayoutsForFreelancer('fl-filter-user', { type: 'fiat' });
    expect(fiatList.length).toBeGreaterThanOrEqual(1);
    expect(fiatList.every((p) => p.type === 'fiat')).toBe(true);
  });

  it('generates a payout receipt that matches the payment record', () => {
    const payout = createPayoutRecord({
      freelancerUserId: 'fl-match',
      freelancerName: 'Match Freelancer',
      clientUserId: 'cl-match',
      clientName: 'Match Client',
      bountyId: 'b-match',
      bountyTitle: 'Fullstack dApp build',
      grossAmount: 4000,
      currency: 'USD',
      type: 'fiat',
      status: 'completed',
    });

    const receipt = generateReceiptFromPayout(payout);

    expect(receipt.payoutId).toBe(payout.id);
    expect(receipt.receiptNumber).toBe(`RCP-${payout.id.toUpperCase()}`);
    expect(receipt.freelancer.userId).toBe(payout.freelancerUserId);
    expect(receipt.client.userId).toBe(payout.clientUserId);
    expect(receipt.feeBreakdown.grossAmount).toBe(payout.grossAmount);
    expect(receipt.feeBreakdown.netPayoutAmount).toBe(payout.feeBreakdown.netPayoutAmount);
    expect(receipt.feeBreakdown.platformFeeAmount).toBe(payout.feeBreakdown.platformFeeAmount);
  });

  it('generates a valid standard PDF-1.4 binary matching receipt content', () => {
    const payout = createPayoutRecord({
      freelancerUserId: 'fl-pdf',
      freelancerName: 'PDF Tester',
      clientUserId: 'cl-pdf',
      clientName: 'Acme DAO',
      bountyId: 'b-pdf',
      bountyTitle: 'Soroban Escrow Audit',
      grossAmount: 5000,
      currency: 'USDC',
      type: 'on-chain',
      stellarTxHash: '3f6c891a2b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e',
    });

    const receipt = generateReceiptFromPayout(payout);
    const pdfBytes = generateReceiptPdf(receipt);

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(500);

    const text = Buffer.from(pdfBytes).toString('latin1');
    // Valid PDF-1.4 header
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    // Standard PDF trailer and EOF
    expect(text.includes('trailer')).toBe(true);
    expect(text.includes('startxref')).toBe(true);
    expect(text.trim().endsWith('%%EOF')).toBe(true);
    // Contains receipt details
    expect(text.includes(receipt.receiptNumber)).toBe(true);
    expect(text.includes('TAMGORA - OFFICIAL PAYOUT RECEIPT')).toBe(true);
    expect(text.includes('PAYMENT & PLATFORM FEE BREAKDOWN')).toBe(true);
  });
});
