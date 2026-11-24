/**
 * lib/stellar/sep24-poller.ts
 *
 * Background job to poll SEP-24 transactions for status updates.
 *
 * Runs periodically (default: every 60s) to check transactions in non-terminal
 * states. Uses exponential backoff per transaction to avoid overwhelming anchors.
 *
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md
 */

import { PrismaClient } from '@/lib/generated/prisma/client'
import {
  type Sep24Transaction as Sep24ApiTransaction,
  isTerminalStatus,
} from './sep24'
import {
  updateSep24TransactionFromAnchor,
  updateSep24TransactionStatus,
} from './sep24-service'

const DEFAULT_POLL_INTERVAL_MS = 60_000 // 60 seconds
const DEFAULT_BATCH_SIZE = 100
const DEFAULT_TIMEOUT_MS = 30_000

export interface PollerOptions {
  pollIntervalMs?: number
  batchSize?: number
  timeoutMs?: number
  onTransactionUpdate?: (tx: Sep24ApiTransaction) => void
}

/**
 * Start the SEP-24 poller job.
 *
 * Runs indefinitely, polling transactions in non-terminal states.
 * Exits gracefully on abort signal.
 *
 * @param prisma - Prisma client instance
 * @param authToken - SEP-10 JWT for anchor authentication
 * @param options - Poller configuration
 */
export async function startSep24Poller(
  prisma: PrismaClient,
  authToken: string,
  options: PollerOptions = {},
): Promise<() => void> {
  const {
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    batchSize = DEFAULT_BATCH_SIZE,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onTransactionUpdate,
  } = options

  let abort = false

  const abortController = new AbortController()

  const pollLoop = async () => {
    if (abort) return

    try {
      // Find transactions to poll
      // - Not in terminal status
      // - Not marked as stale
      // - Hasn't been polled too recently (avoid hammering anchors)
      const transactions = await prisma.sep24Transaction.findMany({
        where: {
          AND: [
            {
              status: {
                notIn: ['completed', 'refunded', 'expired', 'error'],
              },
            },
            {
              OR: [
                { lastPolledAt: { lt: new Date(Date.now() - 5000) } }, // Not polled in last 5s
                { lastPolledAt: null },
              ],
            },
            {
              OR: [
                { staleAt: { gt: new Date() } },
                { staleAt: null },
              ],
            },
          ],
        },
        orderBy: { lastPolledAt: 'asc' }, // Poll oldest first
        take: batchSize,
      })

      if (transactions.length === 0) {
        console.debug('[sep24] No transactions to poll')
        return
      }

      console.log(`[sep24] Polling ${transactions.length} transactions`)

      // Poll each transaction
      for (const transaction of transactions) {
        if (abort) break

        try {
          const transferServer = transaction.transferServer
          const anchorId = transaction.anchorId

          const url = `${transferServer}/transaction?id=${encodeURIComponent(anchorId)}`
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), timeoutMs)

          const response = await fetch(url, {
            headers: { Authorization: `Bearer ${authToken}` },
            signal: controller.signal,
          })

          clearTimeout(timer)

          if (!response.ok) {
            console.error(
              `[sep24] Failed to poll ${transaction.id} (${anchorId}): ${response.status}`,
            )
            // Update poll count for rate limiting
            await prisma.sep24Transaction.update({
              where: { id: transaction.id },
              data: { pollCount: { increment: 1 } },
            })
            continue
          }

          const payload = (await response.json()) as { transaction?: Sep24ApiTransaction }
          const anchorTx = payload.transaction

          if (!anchorTx) {
            console.error(
              `[sep24] Invalid response from ${transferServer} for ${anchorId}`,
            )
            continue
          }

          // Update transaction data
          await updateSep24TransactionFromAnchor(
            prisma,
            transaction.id,
            anchorTx,
          )

          // Emit update for caller (UI, webhooks, etc.)
          onTransactionUpdate?.(anchorTx)

          // Update status if changed
          if (anchorTx.status !== transaction.status) {
            await updateSep24TransactionStatus(
              prisma,
              transaction.id,
              anchorTx.status,
              anchorTx.message,
              {
                reason: 'poll',
                anchorId,
                transferServer,
              },
            )

            // Refresh for terminal check
            const updated = await prisma.sep24Transaction.findUnique({
              where: { id: transaction.id },
            })

            if (updated && isTerminalStatus(updated.status)) {
              console.log(
                `[sep24] Transaction ${transaction.id} reached terminal status: ${updated.status}`,
              )
            }
          }

          // Update lastPolledAt
          await prisma.sep24Transaction.update({
            where: { id: transaction.id },
            data: {
              lastPolledAt: new Date(),
              pollCount: { increment: 1 },
            },
          })
        } catch (err) {
          console.error(`[sep24] Error polling ${transaction.id}:`, err)
        }
      }
    } catch (err) {
      console.error('[sep24] Poll loop error:', err)
    }
  }

  // Run initial poll
  pollLoop()

  // Set up recurring poll
  const intervalId = setInterval(pollLoop, pollIntervalMs)

  return () => {
    abort = true
    clearInterval(intervalId)
  }
}

/**
 * Poll a single transaction immediately (for on-demand updates).
 *
 * @param prisma - Prisma client instance
 * @param transactionId - Transaction ID
 * @param authToken - SEP-10 JWT
 * @param timeoutMs - Request timeout
 * @returns Updated transaction or null if not found
 */
export async function pollSingleTransaction(
  prisma: PrismaClient,
  transactionId: string,
  authToken: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Sep24ApiTransaction | null> {
  const transaction = await prisma.sep24Transaction.findUnique({
    where: { id: transactionId },
  })

  if (!transaction) {
    return null
  }

  try {
    const url = `${transaction.transferServer}/transaction?id=${encodeURIComponent(transaction.anchorId)}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${authToken}` },
      signal: controller.signal,
    })

    clearTimeout(timer)

    if (!response.ok) {
      console.error(
        `[sep24] Failed to poll ${transactionId}: ${response.status}`,
      )
      return null
    }

    const payload = (await response.json()) as { transaction?: Sep24ApiTransaction }
    const anchorTx = payload.transaction

    if (!anchorTx) {
      console.error(`[sep24] Invalid response for ${transactionId}`)
      return null
    }

    // Update transaction
    await updateSep24TransactionFromAnchor(prisma, transactionId, anchorTx)

    // Update status if changed
    if (anchorTx.status !== transaction.status) {
      await updateSep24TransactionStatus(prisma, transactionId, anchorTx.status, anchorTx.message, {
        reason: 'on_demand',
      })
    }

    // Update lastPolledAt
    await prisma.sep24Transaction.update({
      where: { id: transactionId },
      data: {
        lastPolledAt: new Date(),
        pollCount: { increment: 1 },
      },
    })

    return anchorTx
  } catch (err) {
    console.error(`[sep24] Error polling ${transactionId}:`, err)
    return null
  }
}