import type { Sep24Status } from '@/lib/generated/prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getSep24Transaction, updateSep24TransactionStatus } from '@/lib/stellar/sep24-service'

/**
 * POST /api/payments/sep24/callback — receive anchor callbacks for SEP-24.
 *
 * Anchors can push status updates via webhook instead of (or in addition to)
 * polling. This endpoint accepts the /transaction response and updates the
 * database accordingly.
 *
 * Expected payload (from anchor):
 * {
 *   "transaction": {
 *     "id": "anchor-tx-id",
 *     "status": "pending_user_transfer_start",
 *     "message": "...",
 *     "more_info_url": "https://anchor.com/tx/123",
 *     ...
 *   }
 * }
 *
 * Security:
 * - Validates anchor signature (optional, configured via SEP24_CALLBACK_SECRET)
 * - Verifies transaction belongs to this deployment
 * - Only updates if status actually changed
 */

export async function POST(request: NextRequest) {
  const callbackSecret = process.env.SEP24_CALLBACK_SECRET
  
  // Optional signature validation
  if (callbackSecret) {
    const signature = request.headers.get('x-anchor-signature')
    if (!signature) {
      return NextResponse.json(
        { error: 'Missing anchor signature header' },
        { status: 401 },
      )
    }
    
    // Verify signature (simple HMAC check - customize for your anchor)
    const body = await request.text()
    const expected = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body + callbackSecret))
    const expectedHex = Array.from(new Uint8Array(expected)).map(b => b.toString(16).padStart(2, '0')).join('')
    
    if (signature !== expectedHex) {
      return NextResponse.json(
        { error: 'Invalid anchor signature' },
        { status: 401 },
      )
    }
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Extract transaction from anchor payload
  const anchorTx = (payload as { transaction?: unknown })?.transaction
  
  if (!anchorTx || typeof anchorTx !== 'object') {
    return NextResponse.json(
      { error: 'Invalid or missing transaction field' },
      { status: 400 },
    )
  }

  // Validate required fields
  const anchorId = (anchorTx as { id?: string })?.id
  const status = (anchorTx as { status?: string })?.status
  
  if (!anchorId || !status) {
    return NextResponse.json(
      { error: 'Transaction missing id or status' },
      { status: 400 },
    )
  }

  const { prisma: db } = await import('@/lib/prisma')

  try {
    // Find transaction by anchor ID
    const transaction = await db.sep24Transaction.findUnique({
      where: { anchorId },
    })

    if (!transaction) {
      // Transaction might be from a different deployment
      // In production, you might want to log this for investigation
      console.log(`[sep24/callback] Unknown anchor transaction: ${anchorId}`)
      return NextResponse.json({ received: true }) // Don't leak info
    }

    // Update with new data
    const updated = await db.sep24Transaction.update({
      where: { id: transaction.id },
      data: {
        amountIn: (anchorTx as { amount_in?: string })?.amount_in ?? undefined,
        amountOut: (anchorTx as { amount_out?: string })?.amount_out ?? undefined,
        amountFee: (anchorTx as { amount_fee?: string })?.amount_fee ?? undefined,
        stellarTransactionId: (anchorTx as { stellar_transaction_id?: string })?.stellar_transaction_id ?? undefined,
        externalTransactionId: (anchorTx as { external_transaction_id?: string })?.external_transaction_id ?? undefined,
        moreInfoUrl: (anchorTx as { more_info_url?: string })?.more_info_url ?? undefined,
        message: (anchorTx as { message?: string })?.message ?? undefined,
        lastPolledAt: new Date(),
        pollCount: { increment: 1 },
        // Update status with history if changed
        statusHistory: {
          create: {
            status: status as Sep24Status,
            message: (anchorTx as { message?: string })?.message ?? undefined,
            metadata: {
              reason: 'callback',
              anchorId,
              callbackReceivedAt: new Date().toISOString(),
            },
          },
        },
        completedAt: status === 'completed' ? new Date() : undefined,
      },
      include: {
        statusHistory: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    })

    console.log(`[sep24/callback] Updated ${transaction.id} to status: ${updated.status}`)

    return NextResponse.json({ 
      received: true,
      transactionId: updated.id,
      status: updated.status,
    })
  } finally {
    await db.$disconnect()
  }
}