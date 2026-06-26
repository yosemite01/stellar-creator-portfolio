import { NextRequest, NextResponse } from 'next/server';
import { aggregateCorridorPayments } from '@/backend/services/corridor-analytics';

/**
 * POST /api/admin/cron/corridor-aggregation
 *
 * Background cron job for aggregating Stellar corridor payments.
 * Should be triggered every 5 minutes by an external cron service (e.g., Vercel Crons, EasyCron).
 *
 * Authorization: Requires valid cron secret in X-Cron-Secret header
 */
export async function POST(req: NextRequest) {
  // Verify cron secret
  const cronSecret = req.headers.get('x-cron-secret');
  const validSecret = process.env.CRON_SECRET;

  if (!validSecret || cronSecret !== validSecret) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing cron secret' },
      { status: 401 }
    );
  }

  try {
    console.log('Starting corridor payment aggregation');
    await aggregateCorridorPayments();
    return NextResponse.json(
      { success: true, message: 'Corridor payments aggregated successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Cron job failed:', error);
    return NextResponse.json(
      { error: 'Failed to aggregate corridor payments', details: String(error) },
      { status: 500 }
    );
  }
}
