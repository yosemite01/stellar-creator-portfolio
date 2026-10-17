/**
 * Readiness probe — GET /api/ready  (#1599)
 *
 * Checks DB, Redis, and Horizon with per-dependency timeouts.
 * Returns 200 when all dependencies are healthy, 503 otherwise.
 *
 * Used by the Kubernetes readinessProbe so Kubernetes only routes
 * traffic to pods that can actually serve requests.
 *
 * Response shape:
 * ```json
 * {
 *   "ready": true | false,
 *   "db":      { "status": "ok"|"error", "latencyMs": 4, "error?": "..." },
 *   "redis":   { "status": "ok"|"error", "latencyMs": 1 },
 *   "horizon": { "status": "ok"|"error", "latencyMs": 80 },
 *   "timestamp": "<ISO-8601>"
 * }
 * ```
 */

import { NextResponse } from 'next/server';
import { runReadinessChecks } from '@/server/services/readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const result = await runReadinessChecks();

  return NextResponse.json(result, {
    status: result.ready ? 200 : 503,
    ...(result.ready ? {} : { headers: { 'Retry-After': '15' } }),
  });
}
