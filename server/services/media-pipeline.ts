import crypto from 'node:crypto';
import type { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { getMediaDeliveryUrl } from '@/lib/media/cloudfront-signer';
import {
  buildMasterPlaylist,
  rewriteManifestWithSignedUrls,
  type HlsRenditionOutput,
} from '@/lib/media/hls';
import {
  getTranscoderBackend,
  type TranscoderBackend,
} from '@/lib/media/transcoder';
import type { ThumbnailFramePlan } from '@/lib/media/thumbnails';

/**
 * Media transcoding pipeline service & progress tracking state machine (#1770).
 */

export type MediaAssetStatus =
  | 'QUEUED'
  | 'PROBING'
  | 'TRANSCODING'
  | 'THUMBNAILS'
  | 'UPLOADING'
  | 'READY'
  | 'FAILED';

export interface MediaAssetRecord {
  id: string;
  ownerId: string;
  sourceKey: string;
  contentType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  status: MediaAssetStatus;
  progress: number;
  backend: 'ffmpeg' | 'mediaconvert';
  externalJobId: string | null;
  masterPlaylistKey: string | null;
  renditions: HlsRenditionOutput[] | null;
  posterKey: string | null;
  thumbnailKeys: ThumbnailFramePlan[] | null;
  thumbnailsVttKey: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

const VALID_TRANSITIONS: Record<MediaAssetStatus, readonly MediaAssetStatus[]> = {
  QUEUED: ['QUEUED', 'PROBING', 'TRANSCODING', 'FAILED'],
  PROBING: ['PROBING', 'TRANSCODING', 'FAILED'],
  TRANSCODING: ['TRANSCODING', 'THUMBNAILS', 'UPLOADING', 'READY', 'FAILED'],
  THUMBNAILS: ['THUMBNAILS', 'UPLOADING', 'FAILED'],
  UPLOADING: ['UPLOADING', 'READY', 'FAILED'],
  READY: ['READY'],
  FAILED: ['QUEUED', 'FAILED'],
};

export function canTransitionMediaStatus(
  from: MediaAssetStatus,
  to: MediaAssetStatus,
): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

const STAGE_RANGES: Record<'PROBING' | 'TRANSCODING' | 'THUMBNAILS' | 'UPLOADING', [number, number]> = {
  PROBING: [0, 5],
  TRANSCODING: [5, 80],
  THUMBNAILS: [80, 90],
  UPLOADING: [90, 100],
};

/**
 * Map a stage-local percentage (0..100) into weighted overall pipeline progress (0..100).
 */
export function computeWeightedProgress(
  stage: 'PROBING' | 'TRANSCODING' | 'THUMBNAILS' | 'UPLOADING',
  stagePercent: number,
): number {
  const [min, max] = STAGE_RANGES[stage];
  const clamped = Math.min(100, Math.max(0, stagePercent));
  return Math.round(min + ((max - min) * clamped) / 100);
}

export interface MediaAssetStore {
  create(input: Omit<MediaAssetRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<MediaAssetRecord>;
  findById(id: string): Promise<MediaAssetRecord | null>;
  findByExternalJobId(externalJobId: string): Promise<MediaAssetRecord | null>;
  listQueued(limit: number): Promise<MediaAssetRecord[]>;
  update(id: string, patch: Partial<MediaAssetRecord>): Promise<MediaAssetRecord>;
}

function mapPrismaAsset(row: {
  id: string;
  ownerId: string;
  sourceKey: string;
  contentType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  status: string;
  progress: number;
  backend: string;
  externalJobId: string | null;
  masterPlaylistKey: string | null;
  renditions: unknown;
  posterKey: string | null;
  thumbnailKeys: unknown;
  thumbnailsVttKey: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}): MediaAssetRecord {
  return {
    ...row,
    status: row.status as MediaAssetStatus,
    backend: row.backend === 'mediaconvert' ? 'mediaconvert' : 'ffmpeg',
    renditions: (row.renditions as HlsRenditionOutput[] | null) ?? null,
    thumbnailKeys: (row.thumbnailKeys as ThumbnailFramePlan[] | null) ?? null,
  };
}

export class PrismaMediaAssetStore implements MediaAssetStore {
  async create(
    input: Omit<MediaAssetRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<MediaAssetRecord> {
    const row = await prisma.mediaAsset.create({
      data: {
        ownerId: input.ownerId,
        sourceKey: input.sourceKey,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        durationSeconds: input.durationSeconds,
        width: input.width,
        height: input.height,
        status: input.status,
        progress: input.progress,
        backend: input.backend,
        externalJobId: input.externalJobId,
        masterPlaylistKey: input.masterPlaylistKey,
        renditions: (input.renditions ?? undefined) as Prisma.InputJsonValue | undefined,
        posterKey: input.posterKey,
        thumbnailKeys: (input.thumbnailKeys ?? undefined) as Prisma.InputJsonValue | undefined,
        thumbnailsVttKey: input.thumbnailsVttKey,
        errorMessage: input.errorMessage,
        completedAt: input.completedAt,
      },
    });
    return mapPrismaAsset(row);
  }

  async findById(id: string): Promise<MediaAssetRecord | null> {
    const row = await prisma.mediaAsset.findUnique({ where: { id } });
    return row ? mapPrismaAsset(row) : null;
  }

  async findByExternalJobId(externalJobId: string): Promise<MediaAssetRecord | null> {
    const row = await prisma.mediaAsset.findFirst({ where: { externalJobId } });
    return row ? mapPrismaAsset(row) : null;
  }

  async listQueued(limit: number): Promise<MediaAssetRecord[]> {
    const rows = await prisma.mediaAsset.findMany({
      where: { status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map(mapPrismaAsset);
  }

  async update(id: string, patch: Partial<MediaAssetRecord>): Promise<MediaAssetRecord> {
    const row = await prisma.mediaAsset.update({
      where: { id },
      data: {
        ...(patch.durationSeconds !== undefined ? { durationSeconds: patch.durationSeconds } : {}),
        ...(patch.width !== undefined ? { width: patch.width } : {}),
        ...(patch.height !== undefined ? { height: patch.height } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
        ...(patch.backend !== undefined ? { backend: patch.backend } : {}),
        ...(patch.externalJobId !== undefined ? { externalJobId: patch.externalJobId } : {}),
        ...(patch.masterPlaylistKey !== undefined ? { masterPlaylistKey: patch.masterPlaylistKey } : {}),
        ...(patch.renditions !== undefined
          ? { renditions: patch.renditions as unknown as Prisma.InputJsonValue }
          : {}),
        ...(patch.posterKey !== undefined ? { posterKey: patch.posterKey } : {}),
        ...(patch.thumbnailKeys !== undefined
          ? { thumbnailKeys: patch.thumbnailKeys as unknown as Prisma.InputJsonValue }
          : {}),
        ...(patch.thumbnailsVttKey !== undefined ? { thumbnailsVttKey: patch.thumbnailsVttKey } : {}),
        ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
        ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
      },
    });
    return mapPrismaAsset(row);
  }
}

export class InMemoryMediaAssetStore implements MediaAssetStore {
  private readonly items = new Map<string, MediaAssetRecord>();

  async create(
    input: Omit<MediaAssetRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<MediaAssetRecord> {
    const now = new Date();
    const record: MediaAssetRecord = {
      ...input,
      id: `media_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<MediaAssetRecord | null> {
    return this.items.get(id) ?? null;
  }

  async findByExternalJobId(externalJobId: string): Promise<MediaAssetRecord | null> {
    for (const item of this.items.values()) {
      if (item.externalJobId === externalJobId) return item;
    }
    return null;
  }

  async listQueued(limit: number): Promise<MediaAssetRecord[]> {
    return Array.from(this.items.values())
      .filter((i) => i.status === 'QUEUED')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);
  }

  async update(id: string, patch: Partial<MediaAssetRecord>): Promise<MediaAssetRecord> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`MediaAsset not found: ${id}`);
    const updated: MediaAssetRecord = {
      ...existing,
      ...patch,
      updatedAt: new Date(),
    };
    this.items.set(id, updated);
    return updated;
  }
}

export interface SignedPlaybackPayload {
  assetId: string;
  status: MediaAssetStatus;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  deliveryProvider: 'cloudfront' | 's3';
  expiresAt: string;
  masterPlaylistUrl: string;
  masterPlaylistM3u8: string;
  posterUrl: string | null;
  thumbnailsVttUrl: string | null;
  thumbnails: Array<{ index: number; timeSeconds: number; url: string }>;
  renditions: Array<{
    name: string;
    width: number;
    height: number;
    bandwidth: number;
    videoBitrateKbps: number;
    audioBitrateKbps: number;
    codecs: string;
    playlistUrl: string;
  }>;
}

export interface MediaConvertWebhookEvent {
  assetId?: string;
  jobId?: string;
  status: 'SUBMITTED' | 'PROGRESSING' | 'COMPLETE' | 'ERROR';
  progressPercent?: number;
  errorMessage?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
}

/**
 * Verify that `sourceKey` belongs to `userId` (stored under `<folder>/<userId>/<file>`)
 * to prevent cross-user IDOR transcoding requests.
 */
export function isOwnedObjectKey(sourceKey: string, userId: string): boolean {
  if (!sourceKey || sourceKey.includes('..') || sourceKey.startsWith('/')) return false;
  const segments = sourceKey.split('/').filter(Boolean);
  return segments.length >= 3 && segments.includes(userId);
}

export class MediaPipelineService {
  constructor(
    private readonly store: MediaAssetStore = new PrismaMediaAssetStore(),
    private readonly signUrl = getMediaDeliveryUrl,
  ) {}

  async enqueueVideo(input: {
    ownerId: string;
    sourceKey: string;
    contentType: string;
    sizeBytes: number;
    backend?: 'ffmpeg' | 'mediaconvert';
  }): Promise<MediaAssetRecord> {
    if (!isOwnedObjectKey(input.sourceKey, input.ownerId)) {
      throw new Error('Forbidden: source object key does not belong to user');
    }

    const backend = input.backend ?? getTranscoderBackend().name;
    return this.store.create({
      ownerId: input.ownerId,
      sourceKey: input.sourceKey,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      durationSeconds: null,
      width: null,
      height: null,
      status: 'QUEUED',
      progress: 0,
      backend,
      externalJobId: null,
      masterPlaylistKey: null,
      renditions: null,
      posterKey: null,
      thumbnailKeys: null,
      thumbnailsVttKey: null,
      errorMessage: null,
      completedAt: null,
    });
  }

  async transitionStatus(
    assetId: string,
    nextStatus: MediaAssetStatus,
    patch: Partial<MediaAssetRecord> = {},
  ): Promise<MediaAssetRecord> {
    const current = await this.store.findById(assetId);
    if (!current) throw new Error(`MediaAsset not found: ${assetId}`);
    if (!canTransitionMediaStatus(current.status, nextStatus)) {
      throw new Error(`Invalid media status transition: ${current.status} -> ${nextStatus}`);
    }

    const nextProgress =
      patch.progress !== undefined
        ? Math.min(100, Math.max(0, Math.round(patch.progress)))
        : nextStatus === 'READY'
          ? 100
          : current.progress;

    return this.store.update(assetId, {
      ...patch,
      status: nextStatus,
      progress: nextProgress,
      ...(nextStatus === 'READY' ? { completedAt: new Date(), errorMessage: null } : {}),
    });
  }

  async processAsset(
    assetId: string,
    backend: TranscoderBackend = getTranscoderBackend(),
  ): Promise<MediaAssetRecord> {
    const asset = await this.store.findById(assetId);
    if (!asset) throw new Error(`MediaAsset not found: ${assetId}`);

    try {
      const result = await backend.execute(
        {
          assetId: asset.id,
          sourceKey: asset.sourceKey,
          contentType: asset.contentType,
        },
        {
          onProbe: async (info) => {
            await this.store.update(asset.id, {
              durationSeconds: info.durationSeconds,
              width: info.width,
              height: info.height,
            });
          },
          onStage: async (stage, stagePercent) => {
            const weighted = computeWeightedProgress(stage, stagePercent);
            await this.transitionStatus(asset.id, stage, { progress: weighted });
          },
        },
      );

      if (result.mode === 'submitted') {
        return this.transitionStatus(asset.id, 'TRANSCODING', {
          backend: result.backend,
          externalJobId: result.externalJobId ?? null,
          masterPlaylistKey: result.masterPlaylistKey,
          renditions: result.renditions,
          posterKey: result.posterKey,
          thumbnailKeys: result.thumbnails,
          thumbnailsVttKey: result.thumbnailsVttKey,
          progress: 10,
        });
      }

      return this.transitionStatus(asset.id, 'READY', {
        backend: result.backend,
        durationSeconds: result.durationSeconds ?? asset.durationSeconds,
        width: result.width ?? asset.width,
        height: result.height ?? asset.height,
        masterPlaylistKey: result.masterPlaylistKey,
        renditions: result.renditions,
        posterKey: result.posterKey,
        thumbnailKeys: result.thumbnails,
        thumbnailsVttKey: result.thumbnailsVttKey,
        progress: 100,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.store.update(asset.id, {
        status: 'FAILED',
        errorMessage: message,
      });
    }
  }

  async handleWebhook(event: MediaConvertWebhookEvent): Promise<MediaAssetRecord | null> {
    const asset = event.assetId
      ? await this.store.findById(event.assetId)
      : event.jobId
        ? await this.store.findByExternalJobId(event.jobId)
        : null;

    if (!asset) return null;

    if (event.status === 'COMPLETE') {
      return this.transitionStatus(asset.id, 'READY', {
        progress: 100,
        durationSeconds: event.durationSeconds ?? asset.durationSeconds,
        width: event.width ?? asset.width,
        height: event.height ?? asset.height,
      });
    }

    if (event.status === 'ERROR') {
      return this.transitionStatus(asset.id, 'FAILED', {
        errorMessage: event.errorMessage ?? 'MediaConvert transcoding failed',
      });
    }

    const mappedProgress =
      event.progressPercent !== undefined
        ? computeWeightedProgress('TRANSCODING', event.progressPercent)
        : Math.max(asset.progress, 10);

    return this.transitionStatus(asset.id, 'TRANSCODING', {
      progress: mappedProgress,
      ...(event.jobId ? { externalJobId: event.jobId } : {}),
    });
  }

  async getStatus(assetId: string): Promise<MediaAssetRecord | null> {
    return this.store.findById(assetId);
  }

  async listQueued(limit = 10): Promise<MediaAssetRecord[]> {
    return this.store.listQueued(limit);
  }

  async getSignedPlayback(
    assetId: string,
    options: { ttlSeconds?: number; ipCidr?: string } = {},
  ): Promise<SignedPlaybackPayload | null> {
    const asset = await this.store.findById(assetId);
    if (!asset) return null;
    if (asset.status !== 'READY' || !asset.masterPlaylistKey) {
      throw new Error(`MediaAsset ${assetId} is not ready for playback (status=${asset.status})`);
    }

    const wildcardPrefix = `media/${asset.id}`;
    const masterSigned = await this.signUrl(asset.masterPlaylistKey, {
      ttlSeconds: options.ttlSeconds,
      wildcardPrefix,
      ipCidr: options.ipCidr,
    });

    const renditions = asset.renditions ?? [];
    const signedRenditions = await Promise.all(
      renditions.map(async (r) => {
        const signed = await this.signUrl(r.playlistKey, {
          ttlSeconds: options.ttlSeconds,
          wildcardPrefix,
          ipCidr: options.ipCidr,
        });
        return {
          name: r.name,
          width: r.width,
          height: r.height,
          bandwidth: r.bandwidth,
          videoBitrateKbps: r.videoBitrateKbps,
          audioBitrateKbps: r.audioBitrateKbps,
          codecs: r.codecs,
          playlistUrl: signed.url,
        };
      }),
    );

    const rawMaster = buildMasterPlaylist(renditions);
    const signedMasterM3u8 = await rewriteManifestWithSignedUrls(
      rawMaster,
      `media/${asset.id}/hls`,
      async (key) => {
        const s = await this.signUrl(key, {
          ttlSeconds: options.ttlSeconds,
          wildcardPrefix,
          ipCidr: options.ipCidr,
        });
        return s.url;
      },
    );

    const posterSigned = asset.posterKey
      ? await this.signUrl(asset.posterKey, { ttlSeconds: options.ttlSeconds })
      : null;

    const vttSigned = asset.thumbnailsVttKey
      ? await this.signUrl(asset.thumbnailsVttKey, { ttlSeconds: options.ttlSeconds })
      : null;

    const signedThumbnails = await Promise.all(
      (asset.thumbnailKeys ?? []).map(async (t) => {
        const signed = await this.signUrl(t.key, { ttlSeconds: options.ttlSeconds });
        return {
          index: t.index,
          timeSeconds: t.timeSeconds,
          url: signed.url,
        };
      }),
    );

    return {
      assetId: asset.id,
      status: asset.status,
      durationSeconds: asset.durationSeconds,
      width: asset.width,
      height: asset.height,
      deliveryProvider: masterSigned.provider,
      expiresAt: masterSigned.expiresAt,
      masterPlaylistUrl: masterSigned.url,
      masterPlaylistM3u8: signedMasterM3u8,
      posterUrl: posterSigned?.url ?? null,
      thumbnailsVttUrl: vttSigned?.url ?? null,
      thumbnails: signedThumbnails,
      renditions: signedRenditions,
    };
  }
}

export const defaultMediaPipelineService = new MediaPipelineService();
