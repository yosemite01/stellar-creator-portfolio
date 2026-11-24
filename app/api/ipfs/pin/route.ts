import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { checkPinRateLimit } from '@/lib/rate-limit';
import { maxUploadBytes, validatePinnedBytes } from '@/lib/storage/upload-validation';
import { writeAuditLog } from '@/server/services/audit';
import {
  getPinners,
  MultiProviderPinner,
  PinUnavailableError,
  type ProviderPinOutcome,
} from '@/lib/ipfs/pinner';
import { buildGatewayUrl } from '@/lib/ipfs/gateways';
import { prisma } from '@/lib/prisma';
import { revalidateIpfsFiles } from '@/lib/cache/revalidate';

// nodejs runtime: session auth, in-memory quota and Prisma-backed audit log
// are unavailable on the edge runtime.
export const runtime = 'nodejs';

function sha256ToCid(sha256: string): string {
  return `bafy${sha256.slice(0, 52)}`;
}

async function persistPinReplicas(
  cid: string,
  sha256: string,
  size: number,
  ownerId: string,
  outcomes: ProviderPinOutcome[],
): Promise<void> {
  try {
    await prisma.pinnedFile.upsert({
      where: { cid },
      update: {},
      create: { cid, sha256, size, ownerId },
    });

    const now = new Date();
    await Promise.allSettled(
      outcomes.map((outcome) =>
        prisma.ipfsPinReplica.upsert({
          where: { cid_provider: { cid, provider: outcome.provider } },
          update: {
            providerPinId: outcome.providerPinId ?? undefined,
            status: outcome.ok ? 'PINNED' : 'FAILED',
            lastCheckedAt: now,
            lastHealthyAt: outcome.ok ? now : undefined,
            consecutiveFailures: outcome.ok ? 0 : { increment: 1 },
            lastLatencyMs: outcome.latencyMs,
            lastError: outcome.ok ? null : (outcome.error ?? 'Pin failed'),
          },
          create: {
            cid,
            provider: outcome.provider,
            providerPinId: outcome.providerPinId ?? null,
            status: outcome.ok ? 'PINNED' : 'FAILED',
            lastCheckedAt: now,
            lastHealthyAt: outcome.ok ? now : null,
            consecutiveFailures: outcome.ok ? 0 : 1,
            lastLatencyMs: outcome.latencyMs,
            lastError: outcome.ok ? null : (outcome.error ?? 'Pin failed'),
          },
        }),
      ),
    );
  } catch {
    // Best-effort persistence when DB is unavailable in isolated tests.
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!checkPinRateLimit(session.user.id)) {
    return NextResponse.json({ error: 'Daily pin quota exceeded' }, { status: 429 });
  }

  // Reject early when a trustworthy Content-Length already exceeds the limit,
  // before buffering the whole body.
  const declaredLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxUploadBytes()) {
    return NextResponse.json({ error: 'File too large' }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 });
  }
  const file = form.get('file') as (Blob & { name?: string }) | null;
  // Duck-type on arrayBuffer(): a Blob in the runtime realm, but jsdom/undici
  // hand back a File from a different realm, so `instanceof Blob` is unreliable.
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'file required' }, { status: 400 });
  }

  // Wrap in Uint8Array so the digest and sniffing see a same-realm buffer, and
  // validate the actual bytes rather than trusting declared size or Content-Type.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const rejection = validatePinnedBytes(bytes);
  if (rejection) {
    return NextResponse.json({ error: rejection.error }, { status: rejection.status });
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const expectedSha256 = String(form.get('sha256') ?? '');
  if (expectedSha256 && sha256 !== expectedSha256.toLowerCase()) {
    return NextResponse.json({ error: 'Hash mismatch' }, { status: 422 });
  }

  const configuredProviders = getPinners();
  let cid: string;
  let size = bytes.byteLength;
  let providers: ProviderPinOutcome[] | undefined;
  let redundancy: { target: number; achieved: number; met: boolean; degraded: boolean } | undefined;

  if (configuredProviders.length > 0) {
    const minProviders = Number(process.env.IPFS_MIN_PIN_PROVIDERS);
    const targetRedundancy =
      Number.isFinite(minProviders) && minProviders > 0 ? minProviders : 2;
    const requireQuorum = process.env.IPFS_REQUIRE_QUORUM === 'true';

    const multi = new MultiProviderPinner(configuredProviders, {
      targetRedundancy,
      requireQuorum,
    });

    try {
      const fileName = typeof file.name === 'string' && file.name ? file.name : `upload-${sha256.slice(0, 12)}`;
      const result = await multi.pin(new Blob([bytes]), fileName);
      cid = result.cid;
      size = result.size > 0 ? result.size : bytes.byteLength;
      providers = result.outcomes;
      redundancy = {
        target: targetRedundancy,
        achieved: result.succeededProviders.length,
        met: result.redundancyMet,
        degraded: result.degraded,
      };
      await persistPinReplicas(cid, sha256, size, session.user.id, result.outcomes);
    } catch (err) {
      const message =
        err instanceof PinUnavailableError
          ? err.message
          : 'IPFS pinning service is currently unavailable';
      return NextResponse.json({ error: message }, { status: 503 });
    }
  } else if (process.env.IPFS_REQUIRE_PROVIDERS === 'true') {
    return NextResponse.json(
      { error: 'No IPFS pinning providers configured' },
      { status: 503 },
    );
  } else {
    cid = sha256ToCid(sha256);
  }

  const gatewayUrl = buildGatewayUrl(cid, 0);

  // Best-effort, non-blocking audit trail & RSC cache revalidation.
  writeAuditLog({
    userId: session.user.id,
    resource: 'ipfs',
    action: 'pin',
    resourceId: cid,
    payload: {
      cid,
      size,
      ...(redundancy ? { redundancy } : {}),
    },
  }).catch(() => {});

  void revalidateIpfsFiles();

  return NextResponse.json({
    cid,
    sha256,
    size,
    gatewayUrl,
    ...(providers ? { providers } : {}),
    ...(redundancy ? { redundancy } : {}),
  });
}
