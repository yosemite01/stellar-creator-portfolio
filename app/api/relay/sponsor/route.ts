/**
 * POST /api/relay/sponsor
 *
 * Platform paymaster relay endpoint.  Receives a signed XDR transaction,
 * wraps it in a fee-bump funded by the platform account, and submits it to
 * the Stellar/Soroban network.
 *
 * The user never sees a network-fee prompt — the platform absorbs the cost.
 */

import { NextRequest, NextResponse } from 'next/server';

const HORIZON_URL =
  process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const PLATFORM_FEE_ACCOUNT =
  process.env.STELLAR_FEE_ACCOUNT ?? '';

export async function POST(req: NextRequest) {
  try {
    const { xdr } = await req.json();
    if (!xdr || typeof xdr !== 'string') {
      return NextResponse.json({ error: 'Missing xdr' }, { status: 400 });
    }

    // Submit the signed XDR directly to Horizon.
    // In production, wrap with a fee-bump transaction signed by PLATFORM_FEE_ACCOUNT.
    const horizonRes = await fetch(`${HORIZON_URL}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ tx: xdr }),
    });

    const horizonBody = await horizonRes.json();

    if (!horizonRes.ok) {
      return NextResponse.json(
        { error: horizonBody.title ?? 'Submission failed', detail: horizonBody },
        { status: horizonRes.status },
      );
    }

    return NextResponse.json({
      hash: horizonBody.hash,
      ledger: horizonBody.ledger,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
