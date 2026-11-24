/**
 * Readiness probe — GET /api/ready  (#1599, #1812)
 *
 * Checks DB, Redis, and Horizon with per-dependency timeouts.
 * Dependencies are classified as critical (DB) or optional (Redis, Horizon).
 * Returns 200 when all critical dependencies are healthy — even if optional
 * dependencies are down, in which case the response is flagged `degraded`.
 * Returns 503 only when a critical dependency is unhealthy.
 *
 * Used by the Kubernetes readinessProbe so Kubernetes only routes
 * traffic to pods that can actually serve requests. Optional dependency
 * outages keep the pod in rotation but marked degraded.
 *
 * Response shape:
 * ```json
 * {
 *   "ready": true | false,
 *   "degraded": true | false,
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
