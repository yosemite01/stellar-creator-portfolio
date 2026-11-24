import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { paymentFlowSchema } from '@/lib/payments/payment-flow'
import {
  discoverTransferServer,
  Sep24Error,
  startInteractiveFlow,
} from '@/lib/stellar/sep24'
import { createSep24Transaction } from '@/lib/stellar/sep24-service'

/**
 * POST /api/payments/sep24 — start a SEP-24 interactive transfer (Issue #1548).
 *
 * Creates a database record for the transaction, then initiates the anchor
 * interactive flow. The transaction ID is persisted so the status can be
 * tracked via polling and the timeline API.
 */

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Re-validated server-side with the same schema the form uses. Client
  // validation is a convenience; it is not a control.
  const parsed = paymentFlowSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const anchorDomain = process.env.SEP24_ANCHOR_DOMAIN
  if (!anchorDomain) {
    // Reported as a 503 rather than a 500: the request was fine, the service is
    // not configured, and those need different responses from an operator.
    return NextResponse.json(
      { error: 'No SEP-24 anchor is configured for this deployment.' },
      { status: 503 },
    )
  }

  const authToken = await getSep10Token(session.user.id)
  if (!authToken) {
    return NextResponse.json(
      { error: 'Could not authenticate with the anchor. Reconnect your wallet.' },
      { status: 502 },
    )
  }

  try {
    const transferServer = await discoverTransferServer(anchorDomain)

    const interactive = await startInteractiveFlow({
      transferServer,
      kind: 'deposit',
      assetCode: process.env.SEP24_ASSET_CODE ?? 'USDC',
      account: parsed.data.recipientAddress,
      authToken,
      amount: String(parsed.data.amount),
    })

    // Persist the transaction for status tracking (Issue #1548)
    const { prisma: db } = await import('@/lib/prisma')
    
    try {
      await db.sep24Transaction.create({
        data: {
          userId: session.user.id,
          anchorId: interactive.id,
          transferServer,
          kind: 'deposit',
          assetCode: process.env.SEP24_ASSET_CODE ?? 'USDC',
          amountIn: String(parsed.data.amount),
          status: 'pending_user_transfer_start',
          message: 'User needs to send funds to anchor',
          moreInfoUrl: interactive.url,
        },
      })
    } finally {
      await db.$disconnect()
    }

    return NextResponse.json({ id: interactive.id, url: interactive.url })
  } catch (err) {
    if (err instanceof Sep24Error) {
      // Pass the anchor's own status through where it is a client-side problem
      // (a 4xx from the anchor usually means the request was wrong); otherwise
      // report a bad gateway, because the failure is upstream of us.
      const status = err.status && err.status >= 400 && err.status < 500 ? 400 : 502
      return NextResponse.json({ error: err.message }, { status })
    }

    console.error('[sep24] unexpected failure starting interactive flow:', err)
    return NextResponse.json({ error: 'Could not start the transfer.' }, { status: 500 })
  }
}

/**
 * GET /api/payments/sep24/[id] — fetch a SEP-24 transaction by ID.
 *
 * Returns the transaction with full status history for timeline display.
 *
 * Path: /api/payments/sep24/[id]/route.ts
 */

/**
 * GET /api/payments/sep24 — fetch user's SEP-24 transactions.
 *
 * Query params:
 * - limit: max results (default: 20)
 * - offset: pagination offset (default: 0)
 */

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') ?? '20', 10)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)

  const { prisma: db } = await import('@/lib/prisma')

  try {
    const transactions = await db.sep24Transaction.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        statusHistory: {
          orderBy: { createdAt: 'desc' },
          take: 1, // Latest status only
        },
      },
      take: limit,
      skip: offset,
    })

    return NextResponse.json({
      transactions,
      meta: {
        limit,
        offset,
        count: transactions.length,
      },
    })
  } finally {
    await db.$disconnect()
  }
}

/**
 * Obtains a SEP-10 JWT for the user's account.
 *
 * Not implemented here on purpose. SEP-10 is a challenge/response the *user's*
 * key must sign, so the token has to come from wherever this deployment holds
 * that authority — a wallet round-trip, a delegated signer, or a custodial
 * service. Returning null makes the route answer 502 with a clear message
 * rather than sending an unauthenticated request the anchor will reject with
 * something less legible.
 *
 * Wire this to the existing auth path before enabling SEP-24 in production.
 */
async function getSep10Token(_userId: string): Promise<string | null> {
  return process.env.SEP24_AUTH_TOKEN ?? null
}