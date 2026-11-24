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
 * POST /api/swaps/[id]/refund/confirm — confirm a refund has been processed.
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
    const swapSession = await db.swapSession.findUnique({
      where: { id: id },
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

    const updated = await confirmRefund(db, id)

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
