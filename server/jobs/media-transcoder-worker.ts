import { defaultMediaPipelineService } from '@/server/services/media-pipeline';
import { getTranscoderBackend } from '@/lib/media/transcoder';
import { logger } from '@/lib/logger';

/**
 * Standalone HLS transcoding worker job (#1770).
 *
 * Claims queued `MediaAsset` rows and executes transcoding via ffmpeg or
 * submits them to AWS Elemental MediaConvert.
 */
export async function runTranscodeWorkerBatch(batchSize = 5): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const queued = await defaultMediaPipelineService.listQueued(batchSize);
  const backend = getTranscoderBackend();

  let succeeded = 0;
  let failed = 0;

  for (const asset of queued) {
    logger.info('[media-worker] Processing media asset', {
      assetId: asset.id,
      backend: backend.name,
      sourceKey: asset.sourceKey,
    });

    const updated = await defaultMediaPipelineService.processAsset(asset.id, backend);
    if (updated.status === 'FAILED') {
      failed += 1;
      logger.error('[media-worker] Transcoding failed', {
        assetId: asset.id,
        error: updated.errorMessage ?? 'unknown error',
      });
    } else {
      succeeded += 1;
      logger.info('[media-worker] Asset transitioned', {
        assetId: asset.id,
        status: updated.status,
        progress: updated.progress,
      });
    }
  }

  return { processed: queued.length, succeeded, failed };
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('media-transcoder-worker.ts')) {
  runTranscodeWorkerBatch().catch((err) => {
    logger.error('[media-worker] Unhandled worker error', { err: String(err) });
    process.exit(1);
  });
}
