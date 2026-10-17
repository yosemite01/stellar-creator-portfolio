import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';
import { createPayoutRecord } from '@/lib/payouts/payout-service';

vi.mock('@/lib/auth/auth', () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from '@/lib/auth/auth';

describe('GET /api/payouts/[id]/receipt', () => {
  let testPayoutId: string;

  beforeEach(() => {
    vi.clearAllMocks();
    const payout = createPayoutRecord({
      freelancerUserId: 'fl-receipt-user',
      freelancerName: 'Receipt Freelancer',
      clientUserId: 'cl-receipt-user',
      clientName: 'Receipt Client',
      bountyId: 'b-receipt',
      bountyTitle: 'Receipt Bounty Task',
      grossAmount: 2000,
      currency: 'USDC',
      stellarTxHash: 'beef00112233445566778899aabbccddeeff00112233445566778899aabbccdd',
    });
    testPayoutId = payout.id;

    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'fl-receipt-user', role: 'CREATOR' },
    });
  });

  it('401s when there is no authenticated session', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new NextRequest(`http://localhost:3000/api/payouts/${testPayoutId}/receipt`);
    const res = await GET(req, { params: Promise.resolve({ id: testPayoutId }) });
    expect(res.status).toBe(401);
  });

  it('404s when payout does not exist', async () => {
    const req = new NextRequest('http://localhost:3000/api/payouts/non-existent/receipt');
    const res = await GET(req, { params: Promise.resolve({ id: 'non-existent' }) });
    expect(res.status).toBe(404);
  });

  it('403s when user is neither the freelancer, client, nor admin', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'unrelated-user', role: 'CREATOR' },
    });
    const req = new NextRequest(`http://localhost:3000/api/payouts/${testPayoutId}/receipt`);
    const res = await GET(req, { params: Promise.resolve({ id: testPayoutId }) });
    expect(res.status).toBe(403);
  });

  it('returns JSON format when format=json is requested', async () => {
    const req = new NextRequest(`http://localhost:3000/api/payouts/${testPayoutId}/receipt?format=json`);
    const res = await GET(req, { params: Promise.resolve({ id: testPayoutId }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.receipt).toBeDefined();
    expect(data.receipt.payoutId).toBe(testPayoutId);
    expect(data.receipt.feeBreakdown.grossAmount).toBe(2000);
    expect(data.receipt.feeBreakdown.platformFeeAmount).toBe(200);
    expect(data.receipt.feeBreakdown.netPayoutAmount).toBe(1800);
    expect(data.receipt.stellarTxHash).toContain('beef0011');
  });

  it('returns valid PDF binary by default with proper headers', async () => {
    const req = new NextRequest(`http://localhost:3000/api/payouts/${testPayoutId}/receipt`);
    const res = await GET(req, { params: Promise.resolve({ id: testPayoutId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('attachment; filename=');

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const text = buffer.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trim().endsWith('%%EOF')).toBe(true);
    expect(text.includes('PAYMENT & PLATFORM FEE BREAKDOWN')).toBe(true);
  });
});
