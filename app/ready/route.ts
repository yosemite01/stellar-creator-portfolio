/**
 * Legacy readiness alias — GET /ready
 *
 * Delegates to the canonical /api/ready endpoint.
 * Kept for backwards-compatibility with existing Helm charts that point
 * readinessProbe at /ready.  New deployments should use /api/ready.
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
