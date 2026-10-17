import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { listPayoutsForFreelancer, createPayoutRecord } from '@/lib/payouts/payout-service';
import { PayoutType, PayoutStatus, PayoutCurrency } from '@/lib/payouts/types';

export const runtime = 'nodejs';

/**
 * GET /api/payouts
 * Returns the payout history for the currently authenticated freelancer.
 * Supports filtering by `type` ('fiat' | 'on-chain'), `status`, and `limit`.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') as PayoutType | null;
  const status = searchParams.get('status') as PayoutStatus | null;
  const limitParam = searchParams.get('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;

  const payouts = listPayoutsForFreelancer(session.user.id, {
    type: type || undefined,
    status: status || undefined,
    limit: !isNaN(Number(limit)) ? limit : undefined,
  });

  return NextResponse.json({
    payouts,
    total: payouts.length,
  });
}

/**
 * POST /api/payouts
 * Record a new payout (Admin or internal systems).
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.bountyId || !body.bountyTitle || !body.grossAmount || !body.clientUserId) {
    return NextResponse.json(
      { error: 'Missing required payout fields (bountyId, bountyTitle, grossAmount, clientUserId)' },
      { status: 400 }
    );
  }

  const record = createPayoutRecord({
    freelancerUserId: body.freelancerUserId || session.user.id,
    freelancerName: body.freelancerName || (session.user as any).name || 'Freelancer',
    clientUserId: body.clientUserId,
    clientName: body.clientName || 'Client',
    bountyId: body.bountyId,
    bountyTitle: body.bountyTitle,
    grossAmount: Number(body.grossAmount),
    currency: (body.currency as PayoutCurrency) || 'USDC',
    feeRate: body.feeRate !== undefined ? Number(body.feeRate) : undefined,
    type: (body.type as PayoutType) || 'on-chain',
    status: (body.status as PayoutStatus) || 'completed',
    stellarTxHash: body.stellarTxHash,
    fiatPaymentRef: body.fiatPaymentRef,
  });

  return NextResponse.json({ ok: true, payout: record }, { status: 201 });
}
