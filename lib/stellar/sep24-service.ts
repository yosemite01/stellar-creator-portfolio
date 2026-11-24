/**
 * lib/stellar/sep24-service.ts
 *
 * Service layer for SEP-24 transaction tracking with:
 * - Database persistence
 * - Status history for timeline
 * - Polling with backoff
 * - Anchor callback support
 *
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md
 */

import { type Prisma, type PrismaClient, type Sep24Status, type Sep24Transaction } from '@/lib/generated/prisma/client'

/** A transaction with its status history, as returned by the getters below. */
export type Sep24TransactionWithHistory = Prisma.Sep24TransactionGetPayload<{
  include: { statusHistory: true }
}>
import {
  type Sep24Transaction as Sep24ApiTransaction,
  isTerminalStatus,
  type PollOptions,
  type InteractiveResponse,
} from './sep24'

// Re-export types for convenience
export type {
  Sep24Transaction,
  Sep24StatusEntry,
} from '@/lib/generated/prisma/client'

/**
 * Create a new SEP-24 transaction record in the database.
 *
 * @param prisma - Prisma client instance
 * @param params - Transaction details
 * @returns The created transaction
 */
export async function createSep24Transaction(
  prisma: PrismaClient,
  params: {
    userId: string
    anchorId: string
    transferServer: string
    kind: 'deposit' | 'withdrawal'
    assetCode: string
    amountIn?: string
    amountOut?: string
    amountFee?: string
    status?: Sep24Status
    message?: string
    moreInfoUrl?: string
    stellarTransactionId?: string
    externalTransactionId?: string
  },
): Promise<Sep24Transaction> {
  const { userId, anchorId, transferServer, kind, assetCode, ...rest } = params

  const transaction = await prisma.sep24Transaction.create({
    data: {
      userId,
      anchorId,
      transferServer,
      kind,
      assetCode,
      ...rest,
      // Initial status entry
      statusHistory: {
        create: {
          status: rest.status ?? 'pending_user_transfer_start',
          message: rest.message ?? undefined,
        },
      },
    },
    include: {
      statusHistory: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })

  return transaction
}

/**
 * Update a SEP-24 transaction's status with history tracking.
 *
 * Every state change creates a status entry for the timeline.
 *
 * @param prisma - Prisma client instance
 * @param transactionId - Database ID of the transaction
 * @param status - New status from anchor
 * @param message - Optional human-readable message
 * @param metadata - Optional JSON metadata for debugging
 * @returns Updated transaction
 */
export async function updateSep24TransactionStatus(
  prisma: PrismaClient,
  transactionId: string,
  status: Sep24Status,
  message?: string,
  metadata?: unknown,
): Promise<Sep24Transaction> {
  const transaction = await prisma.sep24Transaction.update({
    where: { id: transactionId },
    data: {
      status,
      message,
      completedAt: isTerminalStatus(status) ? new Date() : undefined,
      statusHistory: {
        create: {
          status,
          message: message ?? undefined,
          metadata: metadata ?? undefined,
        },
      },
    },
    include: {
      statusHistory: {
        orderBy: { createdAt: 'desc' },
        take: 10, // Last 10 entries for timeline
      },
    },
  })

  return transaction
}

/**
 * Update transaction with data from anchor's /transaction response.
 *
 * @param prisma - Prisma client instance
 * @param transactionId - Database ID
 * @param anchorTx - Transaction data from anchor
 * @returns Updated transaction
 */
export async function updateSep24TransactionFromAnchor(
  prisma: PrismaClient,
  transactionId: string,
  anchorTx: Sep24ApiTransaction,
): Promise<Sep24Transaction> {
  return prisma.sep24Transaction.update({
    where: { id: transactionId },
    data: {
      amountIn: anchorTx.amount_in ?? undefined,
      amountOut: anchorTx.amount_out ?? undefined,
      amountFee: anchorTx.amount_fee ?? undefined,
      stellarTransactionId: anchorTx.stellar_transaction_id ?? undefined,
      externalTransactionId: anchorTx.external_transaction_id ?? undefined,
      moreInfoUrl: anchorTx.more_info_url ?? undefined,
      // Don't overwrite status with poll - let updateSep24TransactionStatus handle that
      // to ensure status history is recorded
    },
  })
}

/**
 * Fetch a SEP-24 transaction by its database ID.
 *
 * @param prisma - Prisma client instance
 * @param id - Transaction ID
 * @returns Transaction with status history
 */
export async function getSep24Transaction(
  prisma: PrismaClient,
  id: string,
): Promise<Sep24TransactionWithHistory | null> {
  return prisma.sep24Transaction.findUnique({
    where: { id },
    include: {
      statusHistory: {
        orderBy: { createdAt: 'asc' }, // Oldest first for timeline
      },
    },
  })
}

/**
 * Fetch a SEP-24 transaction by its anchor ID.
 *
 * @param prisma - Prisma client instance
 * @param anchorId - Transaction ID from anchor
 * @returns Transaction with status history
 */
export async function getSep24TransactionByAnchorId(
  prisma: PrismaClient,
  anchorId: string,
): Promise<Sep24TransactionWithHistory | null> {
  return prisma.sep24Transaction.findUnique({
    where: { anchorId },
    include: {
      statusHistory: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })
}

/**
 * Get all transactions for a user, ordered by newest first.
 *
 * @param prisma - Prisma client instance
 * @param userId - User ID
 * @param limit - Max results
 * @param offset - Pagination offset
 * @returns List of transactions
 */
export async function listUserSep24Transactions(
  prisma: PrismaClient,
  userId: string,
  limit = 20,
  offset = 0,
): Promise<Sep24Transaction[]> {
  return prisma.sep24Transaction.findMany({
    where: { userId },
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
}

/**
 * Mark transactions as stale that haven't been polled in 72 hours.
 *
 * Used by cleanup job to stop polling abandoned transactions.
 *
 * @param prisma - Prisma client instance
 * @returns Count of updated transactions
 */
export async function markStaleTransactions(
  prisma: PrismaClient,
): Promise<number> {
  // updateMany can't create nested history rows, so update each stale row.
  const stale = await prisma.sep24Transaction.findMany({
    where: {
      AND: [
        { staleAt: { lt: new Date() } },
        { status: { notIn: ['completed', 'refunded', 'expired', 'error'] } },
      ],
    },
    select: { id: true },
  })

  for (const { id } of stale) {
    await prisma.sep24Transaction.update({
      where: { id },
      data: {
        status: 'error',
        message: 'Polling abandoned - transaction marked stale',
        statusHistory: {
          create: {
            status: 'error',
            message: 'Polling abandoned - transaction marked stale',
            metadata: { reason: 'stale' },
          },
        },
      },
    })
  }

  return stale.length
}

/**
 * Poll a transaction from anchor with exponential backoff.
 *
 * Implements the polling loop with backoff/retry logic.
 *
 * @param prisma - Prisma client instance
 * @param transaction - Transaction to poll
 * @param options - Polling options
 * @returns Final transaction state
 */
export async function pollSep24Transaction(
  prisma: PrismaClient,
  initial: Sep24Transaction,
  options: PollOptions,
): Promise<Sep24Transaction> {
  const { transferServer, id: anchorId, authToken, onUpdate, intervalMs = 3_000, signal } = options

  let attempts = 0
  const maxAttempts = 7 // 3s, 6s, 12s, 24s, 48s, 96s, 192s
  const baseInterval = 3_000

  for (;;) {
    if (signal?.aborted) {
      await updateSep24TransactionStatus(
        prisma,
        initial.id,
        'error',
        'Polling aborted',
        { reason: 'aborted' },
      )
      throw new Error('Polling aborted')
    }

    const transaction = await prisma.sep24Transaction.findUnique({
      where: { id: initial.id },
    })

    if (!transaction) {
      throw new Error(`Transaction ${initial.id} not found`)
    }

    if (transaction.staleAt && transaction.staleAt < new Date()) {
      throw new Error('Transaction marked as stale')
    }

    try {
      // Fetch from anchor
      const anchorUrl = `${transaction.transferServer}/transaction?id=${encodeURIComponent(anchorId)}`
      const response = await fetch(anchorUrl, {
        headers: { Authorization: `Bearer ${authToken}` },
      })

      if (!response.ok) {
        throw new Error(`Anchor returned ${response.status}`)
      }

      const payload = (await response.json()) as { transaction?: Sep24ApiTransaction }
      const anchorTx = payload.transaction

      if (!anchorTx) {
        throw new Error('Anchor response missing transaction field')
      }

      // Update transaction data (without status - let the service layer handle that)
      await updateSep24TransactionFromAnchor(prisma, transaction.id, anchorTx)

      // Emit update for caller
      onUpdate?.(anchorTx)

      // Update status and history if changed
      if (anchorTx.status !== transaction.status) {
        await updateSep24TransactionStatus(prisma, transaction.id, anchorTx.status, anchorTx.message, {
          reason: 'status_changed',
          from: transaction.status,
          to: anchorTx.status,
        })
      }

      // Refresh transaction with updated status
      const updated = await prisma.sep24Transaction.findUnique({
        where: { id: transaction.id },
      })

      if (!updated) {
        throw new Error(`Transaction ${transaction.id} not found after update`)
      }

      // Stop polling if terminal
      if (isTerminalStatus(updated.status)) {
        return updated
      }

      // Check for stale condition
      const lastPolled = updated.lastPolledAt ?? updated.createdAt
      const hoursSincePoll = (new Date().getTime() - lastPolled.getTime()) / (1000 * 60 * 60)
      if (hoursSincePoll > 72) {
        await updateSep24TransactionStatus(
          prisma,
          transaction.id,
          'error',
          'Polling abandoned after 72 hours',
          { reason: 'timeout', hoursSincePoll },
        )
        throw new Error('Transaction polling abandoned after 72 hours')
      }

      // Update lastPolledAt
      await prisma.sep24Transaction.update({
        where: { id: transaction.id },
        data: {
          lastPolledAt: new Date(),
          pollCount: { increment: 1 },
        },
      })

      // Exponential backoff
      attempts++
      if (attempts >= maxAttempts) {
        // Max backoff reached - continue with 192s
        await new Promise((resolve) => setTimeout(resolve, 192_000))
      } else {
        const delay = baseInterval * Math.pow(2, attempts - 1)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    } catch (err) {
      console.error(`[sep24] Poll failed for ${transaction.id}:`, err)
      
      // Increment poll count even on failure
      await prisma.sep24Transaction.update({
        where: { id: transaction.id },
        data: { pollCount: { increment: 1 } },
      })

      // Give up after max attempts
      if (attempts >= maxAttempts) {
        await updateSep24TransactionStatus(
          prisma,
          transaction.id,
          'error',
          `Polling failed after ${maxAttempts} attempts`,
          { reason: 'max_attempts', attempts },
        )
        throw err
      }

      // Backoff on error
      attempts++
      const delay = baseInterval * Math.pow(2, attempts - 1)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}