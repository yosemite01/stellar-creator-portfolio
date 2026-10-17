/**
 * Liveness probe — GET /api/health  (#1599)
 *
 * Reports whether the process is alive and its internal circuit-breaker state.
 * Intentionally makes NO external calls so Kubernetes never kills a healthy
 * pod because a transient dependency outage tripped the liveness check.
 *
 * For full dependency health see GET /api/ready (readiness probe).
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
 *   200 — process healthy (circuit CLOSED or HALF_OPEN)
 *   503 — circuit OPEN (Stellar RPC unavailable), includes `Retry-After: 30`
 */

import { NextResponse } from 'next/server';
import { stellarCircuitBreaker } from '@/server/services/stellar-circuit-breaker';

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
