/**
 * POST /api/relay/fallback
 *
 * Secondary paymaster relay.  Used when the primary relay is unavailable.
 * Attempts submission via an alternate Horizon endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';

const FALLBACK_HORIZON_URL =
  process.env.STELLAR_FALLBACK_HORIZON_URL ??
  'https://horizon-testnet.stellar.org';

export async function POST(req: NextRequest) {
  try {
    const { xdr } = await req.json();
    if (!xdr || typeof xdr !== 'string') {
      return NextResponse.json({ error: 'Missing xdr' }, { status: 400 });
    }

    const horizonRes = await fetch(`${FALLBACK_HORIZON_URL}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ tx: xdr }),
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
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
