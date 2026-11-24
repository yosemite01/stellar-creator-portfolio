/**
 * Corridor Analytics Service
 *
 * Handles indexing of Stellar PathPayment operations and aggregation
 * into corridor_payments table for cross-border payment analytics.
 *
 * Integrates with Stellar Horizon API to fetch PathPaymentStrictSend
 * and PathPaymentStrictReceive operations from the network.
 */

import { prisma } from '@/lib/prisma';

export interface PathPaymentEvent {
  sourceCurrency: string;
  destCurrency: string;
  amount: bigint;
  timestamp: Date;
}

export interface HorizonOperationRecord {
  id?: string;
  paging_token?: string;
  type: string;
  type_i?: number;
  created_at: string;
  transaction_successful?: boolean;
  source_asset_type?: string;
  source_asset_code?: string;
  source_asset_issuer?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  destination_asset_type?: string;
  destination_asset_code?: string;
  destination_asset_issuer?: string;
  amount?: string;
  source_amount?: string;
  dest_amount?: string;
  destination_amount?: string;
  [key: string]: unknown;
}

export interface HorizonOperationsResponse {
  _embedded?: {
    records: HorizonOperationRecord[];
  };
  records?: HorizonOperationRecord[];
}

/**
 * Parse a decimal string (e.g. "100.5000000") into stroops (bigint) with 7 decimal places.
 */
export function parseStroops(amountStr: string | number): bigint {
  if (typeof amountStr === 'number') {
    return BigInt(Math.round(amountStr * 10_000_000));
  }
  const str = (amountStr || '0').trim();
  const [whole, fraction = ''] = str.split('.');
  const paddedFraction = fraction.padEnd(7, '0').slice(0, 7);
  return BigInt(whole || '0') * 10_000_000n + BigInt(paddedFraction);
}

/**
 * Resolve an asset code from Horizon asset type and code.
 * "native" -> "XLM", credit_alphanum -> code.
 */
function resolveAssetCurrency(type?: string, code?: string): string {
  if (!type || type === 'native') {
    return 'XLM';
  }
  return code || 'UNKNOWN';
}

/**
 * Parse a raw Horizon operation record into a PathPaymentEvent.
 * Returns null if the operation is not a successful path payment.
 */
export function parsePathPaymentOperation(
  op: HorizonOperationRecord
): PathPaymentEvent | null {
  if (op.transaction_successful === false) {
    return null;
  }

  if (
    op.type !== 'path_payment_strict_send' &&
    op.type !== 'path_payment_strict_receive'
  ) {
    return null;
  }

  const sourceCurrency = resolveAssetCurrency(
    op.source_asset_type,
    op.source_asset_code
  );

  const destType = op.asset_type || op.destination_asset_type;
  const destCode = op.asset_code || op.destination_asset_code;
  const destCurrency = resolveAssetCurrency(destType, destCode);

  const rawAmount =
    op.amount ||
    op.destination_amount ||
    op.dest_amount ||
    op.source_amount ||
    '0';
  const amount = parseStroops(rawAmount);
  const timestamp = op.created_at ? new Date(op.created_at) : new Date();

  return {
    sourceCurrency,
    destCurrency,
    amount,
    timestamp,
  };
}

/**
 * Fetch PathPayment operations from Stellar Horizon API.
 *
 * @param since Unix timestamp (in seconds) to fetch operations after. If omitted, defaults to 0.
 * @param customHorizonUrl Optional Horizon base URL override (used for testing or custom endpoints).
 * @returns Array of PathPayment events
 */
export async function fetchPathPaymentOperations(
  since?: number,
  customHorizonUrl?: string
): Promise<PathPaymentEvent[]> {
  const baseUrl = (
    customHorizonUrl ||
    process.env.STELLAR_HORIZON_URL ||
    process.env.HORIZON_URL ||
    'https://horizon-testnet.stellar.org'
  ).replace(/\/$/, '');

  const url = `${baseUrl}/payments?order=desc&limit=200`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.error(
        `Stellar Horizon API responded with status ${response.status}: ${response.statusText}`
      );
      return [];
    }

    const data = (await response.json()) as HorizonOperationsResponse;
    const records = data._embedded?.records || data.records || [];

    const sinceMs = since !== undefined ? since * 1000 : 0;
    const events: PathPaymentEvent[] = [];

    for (const record of records) {
      const event = parsePathPaymentOperation(record);
      if (!event) continue;

      if (sinceMs > 0 && event.timestamp.getTime() < sinceMs) {
        continue;
      }

      events.push(event);
    }

    return events;
  } catch (error) {
    console.error('Failed to fetch PathPayment operations from Horizon API:', error);
    return [];
  }
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
 * Price lookup used for currency conversion.
 *
 * Returns the price of `currency` in the reference unit at the given
 * transaction time. Implementations MUST be time-aware: the returned
 * price must reflect the historical price at `at`, not the latest price.
 */
export type PriceAtTimeFn = (
  currency: string,
  at: Date
) => Promise<number | null>;

/**
 * Default price lookup. Resolves the historical price from the
 * `priceHistory` table (one row per currency per timestamp).
 * Returns null when no price is available at or before `at`.
 */
export const defaultPriceAtTime: PriceAtTimeFn = async (currency, at) => {
  const row = await prisma.priceHistory.findFirst({
    where: { currency, timestamp: { lte: at } },
    orderBy: { timestamp: 'desc' },
  });
  return row ? Number(row.price) : null;
};

/**
 * Convert an amount (in stroops) to the reference unit using the price
 * at the transaction time. Returns null when no historical price exists
 * so callers can skip rather than fall back to today's price.
 */
export async function convertAtTransactionTime(
  amount: bigint,
  currency: string,
  at: Date,
  priceAtTime: PriceAtTimeFn = defaultPriceAtTime
): Promise<bigint | null> {
  const price = await priceAtTime(currency, at);
  if (price === null || !Number.isFinite(price)) {
    return null;
  }
  // amount is in stroops (1e7); price is per whole unit.
  return BigInt(Math.round((Number(amount) / 10_000_000) * price * 10_000_000));
}

/**
 * In-memory cache of computed aggregates keyed by corridor + period bucket.
 * Keeps historical totals stable and avoids recomputation on repeated reads.
 */
const aggregateCache = new Map<string, { volume: bigint; count: number }>();

/**
 * Clear the aggregate cache. Exposed for tests and for invalidation when
 * the underlying data is re-indexed.
 */
export function clearAggregateCache(): void {
  aggregateCache.clear();
}

/**
 * Aggregate raw corridor events into corridor_payments table.
 * Groups by source_currency, dest_currency, and 5-minute period bucket.
 * Should be called every 5 minutes by a background job/cron.
 *
 * Converted amounts are computed with the price at each event's
 * transaction time and stored alongside the raw volume so historical
 * totals do not drift with current prices.
 */
export async function aggregateCorridorPayments(
  priceAtTime: PriceAtTimeFn = defaultPriceAtTime
): Promise<void> {
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
      { volume: bigint; convertedVolume: bigint; count: number; periodBucket: Date }
    >();

    for (const event of events) {
      const key = `${event.sourceCurrency}:${event.destCurrency}`;
      const periodBucket = truncateTo5Minutes(event.timestamp);
      const aggregateKey = `${key}:${periodBucket.getTime()}`;

      const converted = await convertAtTransactionTime(
        event.amount,
        event.sourceCurrency,
        event.timestamp,
        priceAtTime
      );
      if (converted === null) {
        console.warn(
          `No historical price for ${event.sourceCurrency} at ${event.timestamp.toISOString()}; skipping conversion`
        );
        continue;
      }

      const existing = aggregates.get(aggregateKey);
      if (existing) {
        existing.volume += event.amount;
        existing.convertedVolume += converted;
        existing.count += 1;
      } else {
        aggregates.set(aggregateKey, {
          volume: event.amount,
          convertedVolume: converted,
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
          convertedVolume: data.convertedVolume,
          transactionCount: data.count,
        },
        create: {
          sourceCurrency,
          destCurrency,
          volume: data.volume,
          convertedVolume: data.convertedVolume,
          transactionCount: data.count,
          periodBucket: data.periodBucket,
        },
      });

      aggregateCache.set(key, {
        volume: data.volume,
        count: data.count,
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
 *
 * The converted amount is computed with the price at the event's
 * transaction time and stored so historical totals stay stable.
 */
export async function indexCorridorPayment(
  event: PathPaymentEvent,
  priceAtTime: PriceAtTimeFn = defaultPriceAtTime
): Promise<void> {
  const periodBucket = truncateTo5Minutes(event.timestamp);

  const converted = await convertAtTransactionTime(
    event.amount,
    event.sourceCurrency,
    event.timestamp,
    priceAtTime
  );
  if (converted === null) {
    console.warn(
      `No historical price for ${event.sourceCurrency} at ${event.timestamp.toISOString()}; skipping conversion`
    );
    return;
  }

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
      convertedVolume: {
        increment: converted,
      },
      transactionCount: {
        increment: 1,
      },
    },
    create: {
      sourceCurrency: event.sourceCurrency,
      destCurrency: event.destCurrency,
      volume: event.amount,
      convertedVolume: converted,
      transactionCount: 1,
      periodBucket,
    },
  });

  // Invalidate cached aggregate for this corridor so the next read
  // recomputes from the stored (time-correct) converted amounts.
  aggregateCache.delete(`${event.sourceCurrency}:${event.destCurrency}`);
}
