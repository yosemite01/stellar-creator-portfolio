/**
 * lib/swap/cross-chain-service.ts
 *
 * Service layer for cross-chain swaps with:
 * - Quotes with expiry and min-out
 * - State machine for multi-leg swaps
 * - Crash recovery (persist/resume)
 * - Refund handling
 *
 * @see https://github.com/yosemite01/stellar-creator-portfolio/issues/1725
 */

import { type PrismaClient, type SwapPhase, type SwapSession, type SwapStatus } from '@prisma/client'

// Re-export types for convenience
export type {
  SwapSession,
  SwapStatus,
  SwapPhase,
} from '@prisma/client'

/**
 * Quote parameters for a cross-chain swap.
 */
export interface SwapQuoteParams {
  fromChain: string
  toChain: string
  fromAmount: string
  slippageBps?: number
}

/**
 * Create a new swap session with a quote.
 *
 * Generates an HTLC hash and sets the quote expiry.
 *
 * @param prisma - Prisma client instance
 * @param params - Quote parameters
 * @param userId - User ID
 * @param ttlSeconds - Quote expiry in seconds (default: 300)
 * @returns Created swap session
 */
export async function createSwapSession(
  prisma: PrismaClient,
  params: SwapQuoteParams,
  userId: string,
  ttlSeconds = 300, // 5 minutes default
): Promise<SwapSession> {
  const { fromChain, toChain, fromAmount, slippageBps = 50 } = params

  // Generate HTLC preimage and hash
  const secret = crypto.randomUUID()
  const hash = await sha256(secret)

  // Calculate minOut with slippage tolerance
  const fromAmountNum = parseFloat(fromAmount)
  const slippageFactor = 1 - (slippageBps / 10_000)
  const minOut = (fromAmountNum * slippageFactor).toFixed(4)

  // Calculate expiry timestamp
  const quoteExpiry = new Date(Date.now() + ttlSeconds * 1000)

  // Get route (simplified - in production use real routing logic)
  const route = {
    id: `${fromChain}-${toChain}-route`,
    hops: [
      { chain: fromChain, protocol: 'HTLC', feeBps: 10 },
      { chain: toChain, protocol: 'AMM', feeBps: 5 },
    ],
  }

  const session = await prisma.swapSession.create({
    data: {
      userId,
      fromChain,
      toChain,
      fromAmount,
      toAmount: fromAmount, // Will be updated when quote is confirmed
      minOut,
      quoteExpiry,
      routeId: route.id,
      hops: route.hops,
      htlcHash: hash,
      status: 'initiated',
      phase: 'initiated',
      htlcLocktime: Math.floor(ttlSeconds / 5), // Locktime is 1/5 of expiry
    },
    // The row includes htlcSecret; API routes must strip it before responding.
  })

  return session
}

/**
 * Validate a quote before execution.
 *
 * Checks expiry and ensures the quote hasn't changed significantly.
 *
 * @param prisma - Prisma client instance
 * @param sessionId - Swap session ID
 * @param currentToAmount - Current quoted amount
 * @returns Validated session
 */
export async function validateQuote(
  prisma: PrismaClient,
  sessionId: string,
  currentToAmount: string,
): Promise<SwapSession> {
  const session = await prisma.swapSession.findUnique({
    where: { id: sessionId },
  })

  if (!session) {
    throw new Error(`Swap session ${sessionId} not found`)
  }

  // Check expiry
  if (new Date() > session.quoteExpiry) {
    throw new Error('Quote has expired. Please request a new quote.')
  }

  // Check if quote changed significantly (> 1% difference)
  const currentAmountNum = parseFloat(currentToAmount)
  const originalAmountNum = parseFloat(session.toAmount)
  const diffPct = Math.abs(currentAmountNum - originalAmountNum) / originalAmountNum

  if (diffPct > 0.01) {
    throw new Error('Quote has changed significantly. Please review the new quote.')
  }

  return session
}

/**
 * Update session status and phase.
 *
 * @param prisma - Prisma client instance
 * @param sessionId - Session ID
 * @param status - New status
 * @param phase - New phase
 * @param metadata - Optional metadata
 * @returns Updated session
 */
export async function updateSwapSession(
  prisma: PrismaClient,
  sessionId: string,
  status: SwapStatus,
  phase?: SwapPhase,
  metadata?: { htlcSecret?: string; refundTxId?: string },
): Promise<SwapSession> {
  const update: any = {
    status,
    phase,
    completedAt: status === 'completed' || status === 'refunded' || status === 'failed' ? new Date() : undefined,
  }

  if (metadata?.htlcSecret) {
    update.htlcSecret = metadata.htlcSecret
  }
  if (metadata?.refundTxId) {
    update.refundTxId = metadata.refundTxId
  }
  if (status === 'refunded') {
    update.refundedAt = new Date()
  }

  return prisma.swapSession.update({
    where: { id: sessionId },
    data: update,
  })
}

/**
 * Resume a swap session by ID.
 *
 * Returns the session if not expired, allows resuming from current state.
 *
 * @param prisma - Prisma client instance
 * @param sessionId - Session ID
 * @returns Session if valid for resume
 */
export async function resumeSwapSession(
  prisma: PrismaClient,
  sessionId: string,
): Promise<SwapSession | null> {
  const session = await prisma.swapSession.findUnique({
    where: { id: sessionId },
  })

  if (!session) {
    return null
  }

  // Check expiry
  if (new Date() > session.quoteExpiry) {
    // Mark as expired
    await prisma.swapSession.update({
      where: { id: sessionId },
      data: {
        status: 'failed',
        phase: 'error',
        completedAt: new Date(),
      },
    })
    return null
  }

  return session
}

/**
 * Request a refund for a failed swap.
 *
 * @param prisma - Prisma client instance
 * @param sessionId - Session ID
 * @param refundTxId - Transaction ID of the refund
 * @returns Updated session
 */
export async function requestRefund(
  prisma: PrismaClient,
  sessionId: string,
  refundTxId: string,
): Promise<SwapSession> {
  return prisma.swapSession.update({
    where: { id: sessionId },
    data: {
      status: 'refund_requested',
      phase: 'refund_requested',
      refundTxId,
    },
  })
}

/**
 * Mark a session as refunded.
 *
 * @param prisma - Prisma client instance
 * @param sessionId - Session ID
 * @returns Updated session
 */
export async function confirmRefund(
  prisma: PrismaClient,
  sessionId: string,
): Promise<SwapSession> {
  return prisma.swapSession.update({
    where: { id: sessionId },
    data: {
      status: 'refunded',
      phase: 'refunded',
      refundedAt: new Date(),
    },
  })
}

/**
 * Cleanup expired swap sessions.
 *
 * Marks sessions as failed if quote has expired and swap hasn't started.
 *
 * @param prisma - Prisma client instance
 * @returns Count of cleaned up sessions
 */
export async function cleanupExpiredSessions(
  prisma: PrismaClient,
): Promise<number> {
  const result = await prisma.swapSession.updateMany({
    where: {
      AND: [
        { quoteExpiry: { lt: new Date() } },
        { status: { in: ['initiated', 'source_lock'] } },
      ],
    },
    data: {
      status: 'failed',
      phase: 'error',
      completedAt: new Date(),
    },
  })

  return result.count
}

/**
 * Calculate SHA-256 hash of a string.
 *
 * @param input - Input string
 * @returns Hex string of the hash
 */
async function sha256(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder()
    const data = encoder.encode(input)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  
  // Fallback for Node.js
  const { createHash } = await import('crypto')
  return createHash('sha256').update(input).digest('hex')
}

/**
 * Get all swap sessions for a user.
 *
 * @param prisma - Prisma client instance
 * @param userId - User ID
 * @param limit - Max results
 * @param offset - Pagination offset
 * @returns List of sessions
 */
export async function listUserSwapSessions(
  prisma: PrismaClient,
  userId: string,
  limit = 20,
  offset = 0,
): Promise<SwapSession[]> {
  return prisma.swapSession.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  })
}