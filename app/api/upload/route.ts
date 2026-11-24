import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { uploadObject } from '@/lib/storage/s3';
import { isVideoMimeType, slugify, validateFile } from '@/lib/storage/upload-validation';
import { defaultMediaPipelineService } from '@/server/services/media-pipeline';

export const runtime = 'nodejs';

/**
 * POST /api/upload
 *
 * Multipart form fields:
 *   file – the file to store (required)
 *   path – logical folder, e.g. "uploads" or "portfolio" (default "uploads")
 *
 * Objects are stored under `<path>/<userId>/<uuid>-<filename>` so one user
 * can never overwrite another's files, and are only readable through the
 * signed URL returned here.
 *
 * Video uploads automatically enqueue an asynchronous HLS transcoding job
 * (adaptive renditions, poster frame, thumbnails, and signed CloudFront URLs;
 * Issue #1770).
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  const rejection = await validateFile(file);
  if (rejection) {
    return NextResponse.json({ error: rejection }, { status: 400 });
  }

  // Each path segment is slugified, which also drops any "..".
  const folder =
    String(form.get('path') ?? 'uploads')
      .split('/')
      .map((segment) => slugify(segment).replace(/\./g, ''))
      .filter(Boolean)
      .join('/') || 'uploads';
  const key = `${folder}/${session.user.id}/${randomUUID()}-${slugify(file.name) || 'file'}`;

  try {
    const { signedUrl } = await uploadObject({
      key,
      body: Buffer.from(await file.arrayBuffer()),
      contentType: file.type,
    });

    let media: {
      assetId: string;
      status: string;
      progress: number;
      statusUrl: string;
      playbackUrl: string;
    } | null = null;

    if (isVideoMimeType(file.type)) {
      try {
        const asset = await defaultMediaPipelineService.enqueueVideo({
          ownerId: session.user.id,
          sourceKey: key,
          contentType: file.type,
          sizeBytes: file.size,
        });
        media = {
          assetId: asset.id,
          status: asset.status,
          progress: asset.progress,
          statusUrl: `/api/media/${asset.id}/status`,
          playbackUrl: `/api/media/${asset.id}/playback`,
        };
      } catch (err) {
        console.error('[upload] failed to enqueue media transcoding:', err);
      }
    }

    return NextResponse.json({
      key,
      url: signedUrl,
      signedUrl,
      size: file.size,
      contentType: file.type,
      ...(media ? { media } : {}),
    });
  } catch (error) {
    console.error('[upload] storage error:', error);
    return NextResponse.json({ error: 'File storage is unavailable' }, { status: 503 });
  }
}
