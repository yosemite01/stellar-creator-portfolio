/**
 * tRPC API Route Handler
 *
 * Handles all tRPC requests with proper authentication,
 * error handling, and OpenTelemetry tracing.
 *
 * Stellar client initialisation:
 *   `initStellarClient()` is awaited once via a module-level promise so the
 *   KMS secret fetch happens before the first request is served, and is
 *   never repeated on subsequent invocations (singleton pattern).
 */

import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/backend/src/router';
import { createContext } from '@/backend/src/trpc-setup';
import { initStellarClient } from '@/services/api/stellar/client';
import { NextRequest } from 'next/server';

// Initialise the Stellar client (and therefore the circuit breaker) once at
// module load time.  Next.js module caching means this runs exactly once per
// serverless instance lifetime.
const stellarReady: Promise<void> = initStellarClient().then(() => {
  console.log('[StellarClient] Initialised — circuit breaker active');
}).catch((err) => {
  // Non-fatal: the circuit breaker will open on the first failed call anyway.
  console.error('[StellarClient] Initialisation failed:', err);
});

const handler = async (req: NextRequest) => {
  // Ensure Stellar client had a chance to initialise (resolves immediately on
  // subsequent calls since the promise is already settled).
  await stellarReady;

  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => createContext(req),
    onError:
      process.env.NODE_ENV === 'development'
        ? ({ path, error }) => {
            console.error(
              `❌ tRPC failed on ${path ?? '<no-path>'}: ${error.message}`,
            );
          }
        : undefined,
  });
};

export { handler as GET, handler as POST };
