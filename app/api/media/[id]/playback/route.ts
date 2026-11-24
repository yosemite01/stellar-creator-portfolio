import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { defaultMediaPipelineService } from '@/server/services/media-pipeline';

export const runtime = 'nodejs';

const paramsSchema = z.object({
  id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
});

const querySchema = z.object({
  format: z.enum(['json', 'm3u8']).optional().default('json'),
  ttl: z.coerce.number().int().min(60).max(3600).optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/media/[id]/playback?format=json|m3u8&ttl=<60..3600>
 *
 * Returns short-lived signed CloudFront (or private S3 fallback) adaptive HLS
 * playback URLs, rendition bitrates, poster frame, and preview thumbnails, or
 * a signed master `.m3u8` playlist when `format=m3u8` (Issue #1770).
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid media asset id' }, { status: 400 });
  }

  const parsedQuery = querySchema.safeParse({
    format: req.nextUrl.searchParams.get('format') ?? undefined,
    ttl: req.nextUrl.searchParams.get('ttl') ?? undefined,
  });
  if (!parsedQuery.success) {
    return NextResponse.json(
      { error: 'Invalid query parameters', details: parsedQuery.error.issues },
      { status: 400 },
    );
  }

  const asset = await defaultMediaPipelineService.getStatus(parsedParams.data.id);
  if (!asset) {
    return NextResponse.json({ error: 'Media asset not found' }, { status: 404 });
  }

  if (asset.status !== 'READY') {
    return NextResponse.json(
      {
        error: 'Media asset is still processing',
        status: asset.status,
        progress: asset.progress,
      },
      { status: 409 },
    );
  }

  try {
    const payload = await defaultMediaPipelineService.getSignedPlayback(asset.id, {
      ttlSeconds: parsedQuery.data.ttl,
    });

    if (!payload) {
      return NextResponse.json({ error: 'Media asset not found' }, { status: 404 });
    }

    if (parsedQuery.data.format === 'm3u8') {
      return new NextResponse(payload.masterPlaylistM3u8, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'private, no-store, max-age=0',
        },
      });
    }

    return NextResponse.json(payload, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to generate signed playback URLs' },
      { status: 503 },
    );
  }
}
