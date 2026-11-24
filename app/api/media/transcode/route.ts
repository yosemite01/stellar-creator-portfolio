import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/lib/auth/auth';
import { isVideoMimeType } from '@/lib/storage/upload-validation';
import {
  defaultMediaPipelineService,
  isOwnedObjectKey,
} from '@/server/services/media-pipeline';

export const runtime = 'nodejs';

const transcodeRequestSchema = z.object({
  sourceKey: z.string().min(3).max(512),
  contentType: z.string().min(3).max(100),
  sizeBytes: z.number().int().positive().max(2 * 1024 * 1024 * 1024),
  backend: z.enum(['ffmpeg', 'mediaconvert']).optional(),
});

/**
 * POST /api/media/transcode
 *
 * Authenticated endpoint to enqueue HLS transcoding for a previously uploaded
 * video object owned by the caller (Issue #1770).
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = transcodeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid transcode request', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { sourceKey, contentType, sizeBytes, backend } = parsed.data;

  if (!isVideoMimeType(contentType)) {
    return NextResponse.json(
      { error: `Unsupported video content type: ${contentType}` },
      { status: 415 },
    );
  }

  // Never trust client-supplied keys belonging to other users (anti-IDOR).
  if (!isOwnedObjectKey(sourceKey, session.user.id)) {
    return NextResponse.json(
      { error: 'Forbidden: source object does not belong to current user' },
      { status: 403 },
    );
  }

  try {
    const asset = await defaultMediaPipelineService.enqueueVideo({
      ownerId: session.user.id,
      sourceKey,
      contentType,
      sizeBytes,
      backend,
    });

    return NextResponse.json(
      {
        assetId: asset.id,
        status: asset.status,
        progress: asset.progress,
        backend: asset.backend,
        statusUrl: `/api/media/${asset.id}/status`,
        playbackUrl: `/api/media/${asset.id}/playback`,
      },
      { status: 202 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to enqueue transcode job' },
      { status: 500 },
    );
  }
}
