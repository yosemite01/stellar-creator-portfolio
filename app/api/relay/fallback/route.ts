/**
 * POST /api/relay/fallback
 *
 * Secondary paymaster relay.  Used when the primary relay is unavailable.
 * Attempts submission via an alternate Horizon endpoint.
 *
 * Follows the same rules as the primary relay (#1510): signed-in callers only,
 * and the transaction must pass the operation allowlist and daily budget.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { SponsorError, parseInnerTransaction } from '@/lib/payments/feeBump';
import { authorizeFallback } from '@/lib/payments/sponsorPolicy';

const FALLBACK_HORIZON_URL =
  process.env.STELLAR_FALLBACK_HORIZON_URL ??
  'https://horizon-testnet.stellar.org';

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    // Throws SponsorError(400) for a missing or malformed xdr, so the policy
    // check below always runs on a parsed transaction.
    const inner = parseInnerTransaction(body?.xdr);
    authorizeFallback(userId, inner);

    const horizonRes = await fetch(`${FALLBACK_HORIZON_URL}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ tx: inner.toXDR() }),
    });

    const horizonBody = await horizonRes.json();

    if (!horizonRes.ok) {
      return NextResponse.json(
        { error: horizonBody.title ?? 'Fallback submission failed' },
        { status: horizonRes.status },
      );
    }

    return NextResponse.json({ hash: horizonBody.hash, ledger: horizonBody.ledger });
  } catch (err) {
    if (err instanceof SponsorError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
