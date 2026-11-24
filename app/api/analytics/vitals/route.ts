import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const VitalSchema = z.object({
  name: z.enum(['LCP', 'INP', 'CLS', 'FCP', 'TTFB']),
  value: z.number().finite().nonnegative(),
  rating: z.enum(['good', 'needs-improvement', 'poor']).optional(),
  id: z.string().max(128),
  route: z.string().startsWith('/').max(256),
});

/**
 * POST /api/analytics/vitals
 *
 * Receives real-user Core Web Vitals from WebVitalsReporter. Payloads are
 * validated and emitted as structured logs for the log pipeline to aggregate
 * per route (p75) against the Lighthouse budgets.
 */
export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = VitalSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid metric' }, { status: 400 });
  }

  const route = parsed.data.route.split('?')[0];
  console.info(JSON.stringify({ type: 'web-vital', ...parsed.data, route }));
  return new NextResponse(null, { status: 204 });
}
