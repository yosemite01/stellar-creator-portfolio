/**
 * Health-check endpoint
 *
 * GET /api/health
 *
 * Returns the current circuit breaker state for the Stellar RPC service so
 * load balancers, Kubernetes liveness probes, and dashboards can react
 * appropriately.
 *
 * Response shape:
 * ```json
 * {
 *   "status": "ok" | "degraded",
 *   "stellar_rpc": {
 *     "circuit_state": "CLOSED" | "OPEN" | "HALF_OPEN",
 *     "healthy": true | false
 *   },
 *   "timestamp": "<ISO-8601>"
 * }
 * ```
 *
 * HTTP status:
 *   200 — circuit CLOSED or HALF_OPEN (service available / probing)
 *   503 — circuit OPEN (Stellar RPC unavailable), includes `Retry-After: 30`
 */

import { NextResponse } from 'next/server';
import { stellarCircuitBreaker } from '@/backend/services/stellar-circuit-breaker';

export const runtime = 'nodejs';
// Disable response caching so probes always see the live circuit state
export const dynamic = 'force-dynamic';

export async function GET() {
  const circuitState = stellarCircuitBreaker.getState();
  const isOpen = circuitState === 'OPEN';

  const body = {
    status: isOpen ? 'degraded' : 'ok',
    stellar_rpc: {
      circuit_state: circuitState,
      healthy: !isOpen,
    },
    timestamp: new Date().toISOString(),
  };

  if (isOpen) {
    return NextResponse.json(body, {
      status: 503,
      headers: { 'Retry-After': '30' },
    });
  }

  return NextResponse.json(body, { status: 200 });
}
