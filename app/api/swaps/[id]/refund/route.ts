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
 * POST /api/swaps/[id]/refund — request a refund.
 *
 * Used when the destination leg of the swap fails.
 * Requires the HTLC secret or proves the locktime has expired.
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

  const prisma = (await import('@prisma/client')).PrismaClient
  const db = new prisma()

  try {
    const swapSession = await db.swapSession.findUnique({
      where: { id: id },
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
    const updated = await requestRefund(db, id, refundTxId ?? '')

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
