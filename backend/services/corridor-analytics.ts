/**
 * Corridor Analytics Service
 *
 * Handles indexing of Stellar PathPayment operations and aggregation
 * into corridor_payments table for cross-border payment analytics.
 *
 * TODO: Integrate with Stellar Horizon API to fetch PathPaymentStrictSend
 * and PathPaymentStrictReceive operations from the network.
 */

import { prisma } from '@/lib/prisma';

interface PathPaymentEvent {
  sourceCurrency: string;
  destCurrency: string;
  amount: bigint;
  timestamp: Date;
}

/**
 * Placeholder for fetching PathPayment operations from Stellar Horizon API.
 * This should be implemented once Horizon API integration is set up.
 *
 * @param since Unix timestamp to fetch operations after
 * @returns Array of PathPayment events
 */
async function fetchPathPaymentOperations(_since: number): Promise<PathPaymentEvent[]> {
  // TODO: Implement Horizon API integration
  // Example structure:
  // const response = await fetch(
  //   `${HORIZON_URL}/operations?type=path_payment_strict_send,path_payment_strict_receive&order=asc`
  // );
  // Parse and extract source/dest currencies, amounts, timestamps
  return [];
}

/**
 * Truncate a date to the nearest 5-minute boundary.
 * Used for grouping corridor events into 5-minute periods.
 */
function truncateTo5Minutes(date: Date): Date {
  const ms = 1000 * 60 * 5; // 5 minutes in milliseconds
  return new Date(Math.floor(date.getTime() / ms) * ms);
}

/**
 * Aggregate raw corridor events into corridor_payments table.
 * Groups by source_currency, dest_currency, and 5-minute period bucket.
 * Should be called every 5 minutes by a background job/cron.
 */
export async function aggregateCorridorPayments(): Promise<void> {
  try {
    // Fetch recent PathPayment operations from Stellar Horizon API
    const since = Math.floor(Date.now() / 1000) - 5 * 60; // Last 5 minutes
    const events = await fetchPathPaymentOperations(since);

    if (events.length === 0) {
      console.log('No new PathPayment operations to aggregate');
      return;
    }

    // Group events by (source_currency, dest_currency, 5-minute period)
    const aggregates = new Map<
      string,
      { volume: bigint; count: number; periodBucket: Date }
    >();

    for (const event of events) {
      const key = `${event.sourceCurrency}:${event.destCurrency}`;
      const periodBucket = truncateTo5Minutes(event.timestamp);
      const aggregateKey = `${key}:${periodBucket.getTime()}`;

      const existing = aggregates.get(aggregateKey);
      if (existing) {
        existing.volume += event.amount;
        existing.count += 1;
      } else {
        aggregates.set(aggregateKey, {
          volume: event.amount,
          count: 1,
          periodBucket,
        });
      }
    }

    // Upsert aggregated data into database
    for (const [key, data] of aggregates.entries()) {
      const [sourceCurrency, destCurrency] = key.split(':');

      await prisma.corridorPayment.upsert({
        where: {
          sourceCurrency_destCurrency_periodBucket: {
            sourceCurrency,
            destCurrency,
            periodBucket: data.periodBucket,
          },
        },
        update: {
          volume: data.volume,
          transactionCount: data.count,
        },
        create: {
          sourceCurrency,
          destCurrency,
          volume: data.volume,
          transactionCount: data.count,
          periodBucket: data.periodBucket,
        },
      });
    }

    console.log(`Aggregated ${events.length} PathPayment operations into ${aggregates.size} corridors`);
  } catch (error) {
    console.error('Error aggregating corridor payments:', error);
    throw error;
  }
}

/**
 * Index a raw corridor payment event.
 * This is called by the Rust indexer or Stellar Horizon listener
 * when a PathPaymentStrictSend or PathPaymentStrictReceive operation is detected.
 */
export async function indexCorridorPayment(event: PathPaymentEvent): Promise<void> {
  const periodBucket = truncateTo5Minutes(event.timestamp);

  await prisma.corridorPayment.upsert({
    where: {
      sourceCurrency_destCurrency_periodBucket: {
        sourceCurrency: event.sourceCurrency,
        destCurrency: event.destCurrency,
        periodBucket,
      },
    },
    update: {
      volume: {
        increment: event.amount,
      },
      transactionCount: {
        increment: 1,
      },
    },
    create: {
      sourceCurrency: event.sourceCurrency,
      destCurrency: event.destCurrency,
      volume: event.amount,
      transactionCount: 1,
      periodBucket,
    },
  });
}
