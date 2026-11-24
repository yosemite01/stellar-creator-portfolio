import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  validateQuote,
  updateSwapSession,
  resumeSwapSession,
  requestRefund,
  confirmRefund,
} from '@/lib/swap/cross-chain-service'

/**
 * GET /api/swaps/[id] — fetch a swap session by ID.
 *
 * Returns the session with all details except the HTLC secret.
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

  const { prisma: db } = await import('@/lib/prisma')

  try {
    const swapSession = await db.swapSession.findUnique({
      where: { id: id },
    })

    if (!swapSession) {
      return NextResponse.json({ error: 'Swap session not found' }, { status: 404 })
    }

    // Authorization check
    if (swapSession.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check expiry
    if (new Date() > swapSession.quoteExpiry) {
      // Mark as expired
      await db.swapSession.update({
        where: { id: id },
        data: {
          status: 'failed',
          phase: 'error',
          completedAt: new Date(),
        },
      })
      return NextResponse.json(
        { error: 'Quote has expired' },
        { status: 410 },
      )
    }

    // Return session (without htlcSecret)
    return NextResponse.json({
      id: swapSession.id,
      userId: swapSession.userId,
      fromChain: swapSession.fromChain,
      toChain: swapSession.toChain,
      fromAmount: swapSession.fromAmount,
      toAmount: swapSession.toAmount,
      minOut: swapSession.minOut,
      quoteExpiry: swapSession.quoteExpiry,
      routeId: swapSession.routeId,
      hops: swapSession.hops,
      htlcHash: swapSession.htlcHash,
      status: swapSession.status,
      phase: swapSession.phase,
      refundTxId: swapSession.refundTxId,
      startedAt: swapSession.startedAt,
      completedAt: swapSession.completedAt,
      createdAt: swapSession.createdAt,
    })
  } finally {
    await db.$disconnect()
  }
}

/**
 * POST /api/swaps/[id]/confirm — confirm a swap quote.
 *
 * Validates the quote and updates the session to 'source_lock' phase.
 *
 * Request body:
 * {
 *   "toAmount": "97.5",
 *   "minOut": "97.0"
 * }
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

  const { prisma: db } = await import('@/lib/prisma')

  try {
    // Check session exists and belongs to user
    const swapSession = await db.swapSession.findUnique({
      where: { id: id },
    })

    if (!swapSession) {
      return NextResponse.json({ error: 'Swap session not found' }, { status: 404 })
    }

    if (swapSession.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check expiry
    if (new Date() > swapSession.quoteExpiry) {
      return NextResponse.json(
        { error: 'Quote has expired' },
        { status: 410 },
      )
    }

    // Validate payload
    let payload: unknown
    try {
      payload = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = z.object({
      toAmount: z.string(),
      minOut: z.string(),
    }).safeParse(payload)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }

    const { toAmount, minOut } = parsed.data

    // Validate minOut is not worse than quote
    const minOutNum = parseFloat(minOut)
    const sessionMinOutNum = parseFloat(swapSession.minOut)
    if (minOutNum < sessionMinOutNum) {
      return NextResponse.json(
        { error: 'minOut cannot be worse than quoted' },
        { status: 400 },
      )
    }

    // Validate toAmount matches quote (within 1%)
    const toAmountNum = parseFloat(toAmount)
    const sessionToAmountNum = parseFloat(swapSession.toAmount)
    const diffPct = Math.abs(toAmountNum - sessionToAmountNum) / sessionToAmountNum
    if (diffPct > 0.01) {
      return NextResponse.json(
        { error: 'toAmount has changed significantly' },
        { status: 400 },
      )
    }

    // Update session to source_lock
    const updated = await updateSwapSession(
      db,
      id,
      'source_lock',
      'source_lock',
    )

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      phase: updated.phase,
      htlcHash: updated.htlcHash,
      htlcLocktime: updated.htlcLocktime,
    })
  } finally {
    await db.$disconnect()
  }
}
