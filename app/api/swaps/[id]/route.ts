import { NextRequest, NextResponse } from 'next/server'
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
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const prisma = (await import('@prisma/client')).PrismaClient
  const db = new prisma()

  try {
    const swapSession = await db.swapSession.findUnique({
      where: { id: params.id },
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
        where: { id: params.id },
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
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const prisma = (await import('@prisma/client')).PrismaClient
  const db = new prisma()

  try {
    // Check session exists and belongs to user
    const swapSession = await db.swapSession.findUnique({
      where: { id: params.id },
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
      params.id,
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

/**
 * POST /api/swaps/[id]/refund — request a refund.
 *
 * Used when the destination leg of the swap fails.
 * Requires the HTLC secret or proves the locktime has expired.
 */

export async function POST_REFUND(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const prisma = (await import('@prisma/client')).PrismaClient
  const db = new prisma()

  try {
    const swapSession = await db.swapSession.findUnique({
      where: { id: params.id },
    })

    if (!swapSession) {
      return NextResponse.json({ error: 'Swap session not found' }, { status: 404 })
    }

    if (swapSession.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Can only refund if not already completed/refunded
    if (swapSession.status === 'completed') {
      return NextResponse.json(
        { error: 'Swap already completed' },
        { status: 400 },
      )
    }

    if (swapSession.status === 'refunded') {
      return NextResponse.json(
        { error: 'Already refunded' },
        { status: 400 },
      )
    }

    // Check if locktime expired or secret provided
    let canRefund = false
    let refundTxId: string | undefined

    const payload = await request.json()
    if (payload.htlcSecret) {
      // Verify secret matches hash
      const hash = await sha256(payload.htlcSecret)
      if (hash === swapSession.htlcHash) {
        canRefund = true
        refundTxId = payload.refundTxId
      } else {
        return NextResponse.json(
          { error: 'Invalid HTLC secret' },
          { status: 400 },
        )
      }
    } else if (payload.locktimeExpired) {
      // Locktime has expired (user walked away)
      canRefund = true
      refundTxId = payload.refundTxId
    } else {
      return NextResponse.json(
        { error: 'Provide htlcSecret or locktimeExpired' },
        { status: 400 },
      )
    }

    // Update session
    const updated = await requestRefund(db, params.id, refundTxId ?? '')

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      phase: updated.phase,
      refundTxId: updated.refundTxId,
    })
  } finally {
    await db.$disconnect()
  }
}

/**
 * Confirm a refund has been processed.
 */

export async function POST_CONFIRM_REFUND(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const prisma = (await import('@prisma/client')).PrismaClient
  const db = new prisma()

  try {
    const swapSession = await db.swapSession.findUnique({
      where: { id: params.id },
    })

    if (!swapSession) {
      return NextResponse.json({ error: 'Swap session not found' }, { status: 404 })
    }

    if (swapSession.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (swapSession.status !== 'refund_requested') {
      return NextResponse.json(
        { error: 'No refund requested' },
        { status: 400 },
      )
    }

    const updated = await confirmRefund(db, params.id)

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      phase: updated.phase,
      refundedAt: updated.refundedAt,
    })
  } finally {
    await db.$disconnect()
  }
}

// Helper function
async function sha256(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder()
    const data = encoder.encode(input)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  
  const { createHash } = await import('crypto')
  return createHash('sha256').update(input).digest('hex')
}

// Zod import
import { z } from 'zod'