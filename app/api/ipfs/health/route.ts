import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/lib/auth/auth';
import { PrismaPinHealthStore } from '@/lib/ipfs/health-monitor';
import { defaultGatewayHealthTracker, isValidCid } from '@/lib/ipfs/gateways';
import { getPinners } from '@/lib/ipfs/pinner';

export const runtime = 'nodejs';

const querySchema = z.object({
  cid: z.string().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

/**
 * GET /api/ipfs/health?cid=<optional>&limit=<1..200>
 *
 * Returns multi-provider pin replica health and gateway health telemetry
 * for authenticated users (#1769).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = querySchema.safeParse({
    cid: req.nextUrl.searchParams.get('cid') ?? undefined,
    limit: req.nextUrl.searchParams.get('limit') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query parameters', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { cid, limit } = parsed.data;
  if (cid && !isValidCid(cid)) {
    return NextResponse.json({ error: 'Invalid CID format' }, { status: 400 });
  }

  const store = new PrismaPinHealthStore();
  let replicas: Awaited<ReturnType<PrismaPinHealthStore['listReplicas']>> = [];
  try {
    replicas = await store.listReplicas(cid, limit);
  } catch {
    replicas = [];
  }

  const configuredProviders = getPinners().map((p) => p.name);
  const gateways = defaultGatewayHealthTracker.getSnapshot();

  return NextResponse.json({
    configuredProviders,
    redundancyReady: configuredProviders.length >= 2,
    gateways,
    replicas,
  });
}
