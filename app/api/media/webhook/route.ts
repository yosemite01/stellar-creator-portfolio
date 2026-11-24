import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { defaultMediaPipelineService } from '@/server/services/media-pipeline';

export const runtime = 'nodejs';

const webhookSchema = z.object({
  assetId: z.string().min(1).max(128).optional(),
  jobId: z.string().min(1).max(128).optional(),
  status: z.enum(['SUBMITTED', 'PROGRESSING', 'COMPLETE', 'ERROR']),
  progressPercent: z.number().min(0).max(100).optional(),
  errorMessage: z.string().max(2000).optional(),
  durationSeconds: z.number().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
}).refine((data) => Boolean(data.assetId || data.jobId), {
  message: 'Either assetId or jobId is required',
});

function verifyWebhookSecret(req: NextRequest): boolean {
  const expected = process.env.MEDIA_WEBHOOK_SECRET;
  const provided = req.headers.get('x-media-webhook-secret');
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * POST /api/media/webhook
 *
 * Receives progress and completion callbacks from AWS Elemental MediaConvert
 * (via EventBridge / Lambda relay) or external ffmpeg workers (Issue #1770).
 */
export async function POST(req: NextRequest) {
  if (!verifyWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid webhook payload', details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const updated = await defaultMediaPipelineService.handleWebhook(parsed.data);
    if (!updated) {
      return NextResponse.json({ error: 'Media asset not found' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      assetId: updated.id,
      status: updated.status,
      progress: updated.progress,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to process media webhook' },
      { status: 409 },
    );
  }
}
