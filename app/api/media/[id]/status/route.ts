import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/lib/auth/auth';
import { defaultMediaPipelineService } from '@/server/services/media-pipeline';
import { getMediaDeliveryUrl } from '@/lib/media/cloudfront-signer';

export const runtime = 'nodejs';

const paramsSchema = z.object({
  id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
});

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/media/[id]/status
 *
 * Returns real-time transcoding stage, progress (0..100), renditions metadata,
 * and signed poster/thumbnail URLs once available (Issue #1770).
 */
export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid media asset id' }, { status: 400 });
  }

  const asset = await defaultMediaPipelineService.getStatus(parsed.data.id);
  if (!asset) {
    return NextResponse.json({ error: 'Media asset not found' }, { status: 404 });
  }

  const isOwner = asset.ownerId === session.user.id;
  if (!isOwner && asset.status !== 'READY') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let posterUrl: string | null = null;
  if (asset.posterKey) {
    try {
      const signed = await getMediaDeliveryUrl(asset.posterKey);
      posterUrl = signed.url;
    } catch {
      posterUrl = null;
    }
  }

  return NextResponse.json({
    assetId: asset.id,
    status: asset.status,
    progress: asset.progress,
    backend: asset.backend,
    durationSeconds: asset.durationSeconds,
    width: asset.width,
    height: asset.height,
    renditions: asset.renditions ?? [],
    posterUrl,
    errorMessage: isOwner ? asset.errorMessage : null,
    playbackUrl: asset.status === 'READY' ? `/api/media/${asset.id}/playback` : null,
    updatedAt: asset.updatedAt.toISOString(),
    completedAt: asset.completedAt?.toISOString() ?? null,
  });
}
