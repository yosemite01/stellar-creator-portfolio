/**
 * server/jobs/sep24-poller.ts
 *
 * Next.js background job to poll SEP-24 transactions for status updates.
 *
 * This job runs periodically to check transactions in non-terminal states.
 * It's designed to be triggered by a cron scheduler (e.g., cron job, Heroku
 * Scheduler, or AWS CloudWatch Events).
 *
 * Usage:
 *   node server/jobs/sep24-poller.js
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string
 *   SEP24_AUTH_TOKEN - SEP-10 JWT for anchor authentication
 *   SEP24_POLL_INTERVAL - polling interval in milliseconds (default: 60000)
 *   SEP24_BATCH_SIZE - max transactions to poll per run (default: 100)
 */

const { createPrismaClient } = require('@/lib/prisma')
const { startSep24Poller } = require('@lib/stellar/sep24-poller')

async function main() {
  const prisma = createPrismaClient()
  
  // Clean up any transactions that are stuck (pollCount > 100)
  try {
    const stuck = await prisma.sep24Transaction.updateMany({
      where: {
        pollCount: { gte: 100 },
        status: { notIn: ['completed', 'refunded', 'expired', 'error'] },
      },
      data: {
        status: 'error',
        message: 'Polling abandoned after 100 attempts',
        statusHistory: {
          create: {
            status: 'error',
            message: 'Polling abandoned after 100 attempts',
            metadata: { reason: 'max_polls' },
          },
        },
      },
    })

    if (stuck.count > 0) {
      console.log(`Marked ${stuck.count} transactions as stuck`)
    }
  } catch (err) {
    console.error('Error marking stuck transactions:', err)
  }

  // Start the poller
  const stopPoller = await startSep24Poller(prisma, process.env.SEP24_AUTH_TOKEN ?? '', {
    pollIntervalMs: parseInt(process.env.SEP24_POLL_INTERVAL ?? '60000', 10),
    batchSize: parseInt(process.env.SEP24_BATCH_SIZE ?? '100', 10),
  })

  console.log('[sep24-poller] Started. Press Ctrl+C to stop.')

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[sep24-poller] SIGTERM received, shutting down...')
    stopPoller()
    prisma.$disconnect()
    process.exit(0)
  })

  process.on('SIGINT', () => {
    console.log('[sep24-poller] SIGINT received, shutting down...')
    stopPoller()
    prisma.$disconnect()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('[sep24-poller] Fatal error:', err)
  process.exit(1)
})