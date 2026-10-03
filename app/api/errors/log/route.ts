import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRate, clientIp } from '@/server/api/rate-limit';

export const runtime = 'nodejs';

/** Reports per client IP per minute; a crash loop must not flood the logs. */
const REPORTS_PER_MINUTE = 30;
const MAX_BODY_BYTES = 32 * 1024;

const errorReportSchema = z.object({
  id: z.string().max(100),
  timestamp: z.string().max(40),
  level: z.enum(['error', 'warning', 'info']),
  message: z.string().max(2_000),
  stack: z.string().max(10_000).optional(),
  context: z
    .object({
      sessionId: z.string().max(100).optional(),
      component: z.string().max(200).optional(),
      action: z.string().max(200).optional(),
      metadata: z.record(z.unknown()).optional(),
    })
    .passthrough()
    .default({}),
  url: z.string().max(2_000).optional(),
  userAgent: z.string().max(500).optional(),
  environment: z.string().max(50).optional(),
});

/**
 * POST /api/errors/log
 *
 * Receives client-side error reports from lib/error-tracking.ts and writes
 * them to the server log as one JSON line each, where the hosting
 * platform's log drain picks them up. Reports are size-limited, rate-limited
 * per IP, and stripped of the user's email before logging.
 */
export async function POST(req: NextRequest) {
  const limit = checkRate(`error-report:${clientIp(req.headers)}`, REPORTS_PER_MINUTE, 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many error reports' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Report too large' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = errorReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid error report' }, { status: 400 });
  }

  // Drop contact details the client may have attached; the user id is
  // enough to correlate a report.
  const context: Record<string, unknown> = { ...parsed.data.context };
  delete context.userEmail;

  console.error(
    JSON.stringify({
      source: 'client-error-report',
      ...parsed.data,
      context,
      receivedAt: new Date().toISOString(),
    }),
  );

  return NextResponse.json({ received: true }, { status: 202 });
}
