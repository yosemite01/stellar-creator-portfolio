import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { SwapSession } from '@prisma/client'
import { createSwapSession, cleanupExpiredSessions } from '@/lib/swap/cross-chain-service'

/**
 * POST /api/swaps — initiate a cross-chain swap.
 *
 * Creates a new swap session with a quote, HTLC hash, and expiry.
 * Returns the session ID and HTLC hash (not the secret).
 *
 * Request body:
 * {
 *   "fromChain": "stellar",
 *   "toChain": "polygon",
 *   "fromAmount": "100",
 *   "slippageBps": 50
 * }
 */

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

  // Validate payload
  const parsed = SwapQuoteSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { fromChain, toChain, fromAmount, slippageBps = 50 } = parsed.data

  // Validate chains
  const validChains = ['stellar', 'ethereum', 'polygon', 'arbitrum']
  if (!validChains.includes(fromChain) || !validChains.includes(toChain)) {
    return NextResponse.json(
      { error: 'Invalid chain. Supported: stellar, ethereum, polygon, arbitrum' },
      { status: 400 },
    )
  }

  // Validate amounts
  const amountNum = parseFloat(fromAmount)
  if (isNaN(amountNum) || amountNum <= 0) {
    return NextResponse.json(
      { error: 'Amount must be a positive number' },
      { status: 400 },
    )
  }

  // Check for existing unexpired session with same parameters
  const prisma = (await import('@prisma/client')).PrismaClient
  const db = new prisma()

  try {
    // Clean up expired sessions first
    await cleanupExpiredSessions(db)

    // Check for existing session
    const existing = await db.swapSession.findFirst({
      where: {
        userId: session.user.id,
        fromChain,
        toChain,
        fromAmount,
        status: { in: ['initiated', 'source_lock'] },
        quoteExpiry: { gt: new Date() },
      },
    })

    if (existing) {
      // Return existing session
      return NextResponse.json({
        sessionId: existing.id,
        fromChain: existing.fromChain,
        toChain: existing.toChain,
        fromAmount: existing.fromAmount,
        toAmount: existing.toAmount,
        minOut: existing.minOut,
        quoteExpiry: existing.quoteExpiry,
        htlcHash: existing.htlcHash,
        status: existing.status,
      })
    }

    // Create new session
    const swapSession = await createSwapSession(
      db,
      { fromChain, toChain, fromAmount, slippageBps },
      session.user.id,
      300, // 5 minute expiry
    )

    return NextResponse.json({
      sessionId: swapSession.id,
      fromChain: swapSession.fromChain,
      toChain: swapSession.toChain,
      fromAmount: swapSession.fromAmount,
      toAmount: swapSession.toAmount,
      minOut: swapSession.minOut,
      quoteExpiry: swapSession.quoteExpiry,
      htlcHash: swapSession.htlcHash,
      status: swapSession.status,
    })
  } finally {
    await db.$disconnect()
  }
}

/**
 * GET /api/swaps — list user's swap sessions.
 *
 * Query params:
 * - limit: max results (default: 20)
 * - offset: pagination offset (default: 0)
 * - status: filter by status
 */

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') ?? '20', 10)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)
  const status = searchParams.get('status')

  const prisma = (await import('@prisma/client')).PrismaClient
  const db = new prisma()

  try {
    const where: any = { userId: session.user.id }
    if (status) {
      where.status = status
    }

    const sessions = await db.swapSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    })

    return NextResponse.json({
      sessions,
      meta: {
        limit,
        offset,
        count: sessions.length,
      },
    })
  } finally {
    await db.$disconnect()
  }
}

// Zod schema for validation
import { z } from 'zod'

const SwapQuoteSchema = z.object({
  fromChain: z.string().min(1),
  toChain: z.string().min(1),
  fromAmount: z.string().min(1),
  slippageBps: z.number().int().min(0).max(10_000).optional(),
})