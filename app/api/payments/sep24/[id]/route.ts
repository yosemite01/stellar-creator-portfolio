import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getSep24Transaction } from '@/lib/stellar/sep24-service'
import { prisma } from '@/lib/prisma'
import type { Sep24Status } from '@/lib/generated/prisma/client'

/**
 * GET /api/payments/sep24/[id] — fetch a single SEP-24 transaction.
 *
 * Returns the transaction with full status history for timeline display.
 * The status history is ordered chronologically (oldest first) so the
 * frontend can render a timeline.
 *
 * Path params:
 * - id: Database ID of the transaction (not anchor ID)
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const transaction = await getSep24Transaction(prisma, id)

  if (!transaction) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  }

  // Authorization check: users can only access their own transactions
  if (transaction.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({
    id: transaction.id,
    anchorId: transaction.anchorId,
    transferServer: transaction.transferServer,
    kind: transaction.kind,
    assetCode: transaction.assetCode,
    amountIn: transaction.amountIn ?? undefined,
    amountOut: transaction.amountOut ?? undefined,
    amountFee: transaction.amountFee ?? undefined,
    status: transaction.status,
    message: transaction.message ?? undefined,
    moreInfoUrl: transaction.moreInfoUrl ?? undefined,
    stellarTransactionId: transaction.stellarTransactionId ?? undefined,
    externalTransactionId: transaction.externalTransactionId ?? undefined,
    startedAt: transaction.startedAt,
    completedAt: transaction.completedAt ?? undefined,
    lastPolledAt: transaction.lastPolledAt ?? undefined,
    pollCount: transaction.pollCount,
    statusHistory: transaction.statusHistory.map((entry) => ({
      id: entry.id,
      status: entry.status,
      message: entry.message ?? undefined,
      metadata: entry.metadata,
      createdAt: entry.createdAt,
    })),
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
  })
}

/**
 * POST /api/payments/sep24/[id]/poll — manually trigger a poll for a transaction.
 *
 * Used when the user wants to force-check status (e.g. after sending funds).
 * Respects rate limiting (min 5s between polls per transaction).
 */

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Shared client; never disconnect it per request.
  const db = prisma

  try {
    const transaction = await db.sep24Transaction.findUnique({
      where: { id: id },
    })

    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }

    // Authorization check
    if (transaction.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Rate limit: require at least 5 seconds between manual polls
    const lastPolled = transaction.lastPolledAt ?? transaction.createdAt
    const elapsed = Date.now() - lastPolled.getTime()
    if (elapsed < 5000) {
      const retryAfter = Math.ceil((5000 - elapsed) / 1000)
      return NextResponse.json(
        { error: `Poll too soon. Wait ${retryAfter} second(s).` },
        { status: 429 },
      )
    }

    const authToken = await getSep10Token(session.user.id)
    if (!authToken) {
      return NextResponse.json(
        { error: 'Could not authenticate with the anchor. Reconnect your wallet.' },
        { status: 502 },
      )
    }

    // Poll the anchor
    const transferServer = transaction.transferServer
    const anchorId = transaction.anchorId
    const url = `${transferServer}/transaction?id=${encodeURIComponent(anchorId)}`
    
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${authToken}` },
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: `Anchor returned ${response.status}` },
        { status: 502 },
      )
    }

    const payload = (await response.json()) as { transaction?: Sep24Transaction }
    const anchorTx = payload.transaction

    if (!anchorTx) {
      return NextResponse.json(
        { error: 'Anchor response is missing transaction field' },
        { status: 502 },
      )
    }

    // Update the transaction
    const updated = await db.sep24Transaction.update({
      where: { id: id },
      data: {
        amountIn: anchorTx.amount_in ?? undefined,
        amountOut: anchorTx.amount_out ?? undefined,
        amountFee: anchorTx.amount_fee ?? undefined,
        stellarTransactionId: anchorTx.stellar_transaction_id ?? undefined,
        externalTransactionId: anchorTx.external_transaction_id ?? undefined,
        moreInfoUrl: anchorTx.more_info_url ?? undefined,
        lastPolledAt: new Date(),
        pollCount: { increment: 1 },
        // Update status with history
        statusHistory: {
          create: {
            status: anchorTx.status as Sep24Status,
            message: anchorTx.message ?? undefined,
            metadata: { reason: 'manual_poll' },
          },
        },
        completedAt: anchorTx.status === 'completed' ? new Date() : undefined,
      },
      include: {
        statusHistory: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    })

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      message: updated.message ?? undefined,
      completedAt: updated.completedAt ?? undefined,
      statusHistory: updated.statusHistory.map((entry) => ({
        id: entry.id,
        status: entry.status,
        message: entry.message ?? undefined,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
      })),
    })
  } finally {
    // nothing to clean up
  }
}

/**
 * Obtains a SEP-10 JWT for the user's account.
 *
 * Wire this to the existing auth path before enabling SEP-24 in production.
 */
async function getSep10Token(_userId: string): Promise<string | null> {
  return process.env.SEP24_AUTH_TOKEN ?? null
}

// Import type for the anchor transaction response
interface Sep24Transaction {
  id: string
  kind: 'deposit' | 'withdrawal'
  status: string
  amount_in?: string
  amount_out?: string
  amount_fee?: string
  stellar_transaction_id?: string
  external_transaction_id?: string
  message?: string
  started_at?: string
  completed_at?: string
  refunded?: boolean
  more_info_url?: string
}