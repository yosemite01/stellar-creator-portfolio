import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { getPayoutById, generateReceiptFromPayout, generateReceiptPdf } from '@/lib/payouts/payout-service';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }> | { id: string };
}

/**
 * GET /api/payouts/[id]/receipt
 * Generates and downloads an official payout receipt.
 * Supports PDF format (default) and JSON metadata (?format=json).
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = await context.params;
  const payoutId = params?.id;
  if (!payoutId) {
    return NextResponse.json({ error: 'Missing payout id' }, { status: 400 });
  }

  const payout = getPayoutById(payoutId);
  if (!payout) {
    return NextResponse.json({ error: 'Payout not found' }, { status: 404 });
  }

  // Authorization check: only recipient freelancer, payer client, or admin can access receipt
  const userRole = (session.user as any).role;
  const isFreelancer = session.user.id === payout.freelancerUserId;
  const isClient = session.user.id === payout.clientUserId;
  const isAdmin = userRole === 'ADMIN';

  if (!isFreelancer && !isClient && !isAdmin) {
    return NextResponse.json(
      { error: 'Forbidden: You do not have permission to view this receipt' },
      { status: 403 }
    );
  }

  const receipt = generateReceiptFromPayout(payout);

  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') || 'pdf';

  if (format === 'json') {
    return NextResponse.json({ receipt });
  }

  // Generate binary PDF
  const pdfBytes = generateReceiptPdf(receipt);
  const fileName = `receipt-${receipt.receiptNumber.toLowerCase()}.pdf`;

  return new NextResponse(pdfBytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
