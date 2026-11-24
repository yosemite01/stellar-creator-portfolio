import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  buildMasterPlaylist,
  buildRenditionOutputs,
  buildVariantPlaylist,
  rewriteManifestWithSignedUrls,
  selectRenditionsForSource,
} from '@/lib/media/hls';
import {
  signCloudFrontCustomPolicy,
  signCloudFrontUrl,
  verifyCloudFrontSignedUrl,
} from '@/lib/media/cloudfront-signer';
import {
  buildThumbnailsVtt,
  planThumbnails,
} from '@/lib/media/thumbnails';
import {
  buildFfmpegHlsArgs,
  buildMediaConvertJobSpec,
  MediaConvertBackend,
  parseFfmpegProgressPercent,
  type TranscoderBackend,
} from '@/lib/media/transcoder';
import {
  canTransitionMediaStatus,
  computeWeightedProgress,
  InMemoryMediaAssetStore,
  isOwnedObjectKey,
  MediaPipelineService,
} from '@/server/services/media-pipeline';
import { isVideoMimeType, sniffType } from '@/lib/storage/upload-validation';

vi.mock('@/lib/auth/auth', () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from '@/lib/auth/auth';
import { POST as transcodePost } from '@/app/api/media/transcode/route';
import { POST as webhookPost } from '@/app/api/media/webhook/route';

// Generate an ephemeral RSA keypair for cryptographic CloudFront signing tests
const { privateKey: TEST_PRIVATE_KEY, publicKey: TEST_PUBLIC_KEY } = crypto.generateKeyPairSync(
  'rsa',
  {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  },
);

describe('HLS Adaptive Bitrate Ladder & Playlists (#1770)', () => {
  it('selects renditions without upscaling above source height', () => {
    const hd = selectRenditionsForSource(720);
    expect(hd.map((r) => r.name)).toEqual(['360p', '480p', '720p']);

    const fullHd = selectRenditionsForSource(1080);
    expect(fullHd.map((r) => r.name)).toEqual(['360p', '480p', '720p', '1080p']);

    const tiny = selectRenditionsForSource(240);
    expect(tiny.map((r) => r.name)).toEqual(['360p']);
  });

  it('builds a valid RFC 8216 master playlist with multiple bitrates', () => {
    const renditions = buildRenditionOutputs('asset-1', selectRenditionsForSource(1080));
    const master = buildMasterPlaylist(renditions);

    expect(master).toContain('#EXTM3U');
    expect(master).toContain('#EXT-X-VERSION:3');
    expect(master).toContain('RESOLUTION=640x360');
    expect(master).toContain('RESOLUTION=1280x720');
    expect(master).toContain('RESOLUTION=1920x1080');
    expect(master).toContain('360p/index.m3u8');
    expect(master).toContain('1080p/index.m3u8');
  });

  it('rewrites HLS playlists so every variant and segment uses a signed URL', async () => {
    const variant = buildVariantPlaylist([
      { uri: 'seg_0000.ts', durationSeconds: 6.0 },
      { uri: 'seg_0001.ts', durationSeconds: 4.5 },
    ]);

    const signed = await rewriteManifestWithSignedUrls(
      variant,
      'media/asset-1/hls/720p',
      (key) => `https://cdn.example.com/${key}?Signature=abc&Key-Pair-Id=K1`,
    );

    expect(signed).toContain(
      'https://cdn.example.com/media/asset-1/hls/720p/seg_0000.ts?Signature=abc&Key-Pair-Id=K1',
    );
    expect(signed).toContain(
      'https://cdn.example.com/media/asset-1/hls/720p/seg_0001.ts?Signature=abc&Key-Pair-Id=K1',
    );
    expect(signed).toContain('#EXT-X-ENDLIST');
  });
});

describe('CloudFront Signed URLs (#1770)', () => {
  it('signs and cryptographically verifies a CloudFront canned policy URL', () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 600;
    const url = 'https://d111111abcdef8.cloudfront.net/media/asset-1/hls/master.m3u8';

    const signed = signCloudFrontUrl({
      url,
      keyPairId: 'K2JCJMDEHXQW5F',
      privateKeyPem: TEST_PRIVATE_KEY,
      expiresAt,
    });

    expect(signed).toContain('Expires=');
    expect(signed).toContain('Signature=');
    expect(signed).toContain('Key-Pair-Id=K2JCJMDEHXQW5F');

    const verified = verifyCloudFrontSignedUrl(signed, TEST_PUBLIC_KEY);
    expect(verified.valid).toBe(true);
    expect(verified.keyPairId).toBe('K2JCJMDEHXQW5F');
  });

  it('signs and verifies wildcard custom policy URLs for HLS directories', () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 900;
    const signed = signCloudFrontCustomPolicy({
      url: 'https://cdn.example.com/media/asset-99/hls/720p/seg_0001.ts',
      resourcePattern: 'https://cdn.example.com/media/asset-99/*',
      keyPairId: 'KCUSTOM',
      privateKeyPem: TEST_PRIVATE_KEY,
      expiresAt,
    });

    expect(signed).toContain('Policy=');
    const verified = verifyCloudFrontSignedUrl(signed, TEST_PUBLIC_KEY);
    expect(verified.valid).toBe(true);
  });

  it('rejects tampered URLs and expired CloudFront signatures (negative security tests)', () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    const signed = signCloudFrontUrl({
      url: 'https://cdn.example.com/media/asset-1/poster.jpg',
      keyPairId: 'K1',
      privateKeyPem: TEST_PRIVATE_KEY,
      expiresAt,
    });

    // Tamper path to attempt hotlinking a different asset
    const tampered = signed.replace('asset-1', 'asset-2');
    expect(verifyCloudFrontSignedUrl(tampered, TEST_PUBLIC_KEY).valid).toBe(false);

    // Simulate clock past expiry
    const expired = verifyCloudFrontSignedUrl(signed, TEST_PUBLIC_KEY, (expiresAt + 10) * 1000);
    expect(expired.valid).toBe(false);
    expect(expired.reason).toMatch(/expired/i);
  });
});

describe('Thumbnails, Poster Frames & Transcoder Specs (#1770)', () => {
  it('plans poster frame offset from start and evenly spaced thumbnails + WebVTT', async () => {
    const plan = planThumbnails('vid-1', 40, { count: 4 });
    expect(plan.poster.key).toBe('media/vid-1/poster.jpg');
    expect(plan.poster.timeSeconds).toBe(4);
    expect(plan.thumbnails).toHaveLength(4);
    expect(plan.thumbnails.map((t) => t.timeSeconds)).toEqual([0, 10, 20, 30]);

    const vtt = await buildThumbnailsVtt(
      plan.thumbnails,
      40,
      (key) => `https://cdn.example.com/${key}?sig=1`,
    );
    expect(vtt).toContain('WEBVTT');
    expect(vtt).toContain('00:00:00.000 --> 00:00:10.000');
    expect(vtt).toContain('https://cdn.example.com/media/vid-1/thumbnails/thumb-001.jpg?sig=1');
  });

  it('parses ffmpeg progress output accurately and constructs safe ffmpeg/MediaConvert configs', () => {
    expect(parseFfmpegProgressPercent('out_time_us=15000000', 30)).toBe(50);
    expect(parseFfmpegProgressPercent('progress=end', 30)).toBe(100);
    expect(parseFfmpegProgressPercent('frame=100', 30)).toBeNull();

    const args = buildFfmpegHlsArgs('/tmp/in.mp4', '/tmp/out', selectRenditionsForSource(720)[2]);
    expect(args).toContain('-hls_playlist_type');
    expect(args).toContain('vod');

    const mcSpec = buildMediaConvertJobSpec(
      { assetId: 'vid-mc', sourceKey: 'uploads/u1/demo.mp4', contentType: 'video/mp4' },
      { endpoint: 'https://mc.example.com', roleArn: 'arn:aws:iam::123:role/mc', bucket: 'media-bkt' },
    );
    expect((mcSpec.UserMetadata as { mediaAssetId: string }).mediaAssetId).toBe('vid-mc');
  });

  it('detects MP4, QuickTime, and WebM video magic bytes', () => {
    const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const mov = new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]);
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);

    expect(sniffType(mp4)).toBe('video/mp4');
    expect(sniffType(mov)).toBe('video/quicktime');
    expect(sniffType(webm)).toBe('video/webm');
    expect(isVideoMimeType('video/mp4')).toBe(true);
    expect(isVideoMimeType('image/png')).toBe(false);
  });
});

describe('Media Pipeline State Machine & End-to-End Adaptive Playback (#1770)', () => {
  it('enforces valid status transitions and weighted progress tracking', () => {
    expect(canTransitionMediaStatus('QUEUED', 'PROBING')).toBe(true);
    expect(canTransitionMediaStatus('READY', 'QUEUED')).toBe(false);
    expect(computeWeightedProgress('PROBING', 100)).toBe(5);
    expect(computeWeightedProgress('TRANSCODING', 50)).toBe(43);
    expect(computeWeightedProgress('UPLOADING', 100)).toBe(100);
  });

  it('processes an uploaded video to READY with multiple HLS bitrates and signed CloudFront URLs', async () => {
    const store = new InMemoryMediaAssetStore();
    const expiresAt = Math.floor(Date.now() / 1000) + 900;

    const service = new MediaPipelineService(store, async (key) => {
      const signed = signCloudFrontCustomPolicy({
        url: `https://cdn.example.com/${key}`,
        resourcePattern: 'https://cdn.example.com/media/*',
        keyPairId: 'KTEST',
        privateKeyPem: TEST_PRIVATE_KEY,
        expiresAt,
      });
      return {
        url: signed,
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        provider: 'cloudfront',
      };
    });

    const asset = await service.enqueueVideo({
      ownerId: 'creator-42',
      sourceKey: 'portfolio/creator-42/showreel.mp4',
      contentType: 'video/mp4',
      sizeBytes: 24_000_000,
    });
    expect(asset.status).toBe('QUEUED');

    const progressHistory: number[] = [];
    const mockBackend: TranscoderBackend = {
      name: 'ffmpeg',
      async execute(input, cb) {
        await cb?.onProbe?.({ durationSeconds: 45, width: 1920, height: 1080 });
        await cb?.onStage?.('PROBING', 100);
        progressHistory.push((await service.getStatus(input.assetId))!.progress);
        await cb?.onStage?.('TRANSCODING', 50);
        progressHistory.push((await service.getStatus(input.assetId))!.progress);
        await cb?.onStage?.('THUMBNAILS', 100);
        await cb?.onStage?.('UPLOADING', 100);

        const profiles = selectRenditionsForSource(1080);
        const renditions = buildRenditionOutputs(input.assetId, profiles);
        const thumbs = planThumbnails(input.assetId, 45);
        return {
          backend: 'ffmpeg',
          mode: 'completed',
          durationSeconds: 45,
          width: 1920,
          height: 1080,
          masterPlaylistKey: `media/${input.assetId}/hls/master.m3u8`,
          renditions,
          posterKey: thumbs.poster.key,
          thumbnails: thumbs.thumbnails,
          thumbnailsVttKey: thumbs.vttKey,
        };
      },
    };

    const ready = await service.processAsset(asset.id, mockBackend);
    expect(ready.status).toBe('READY');
    expect(ready.progress).toBe(100);
    expect(progressHistory).toEqual([5, 43]);

    const playback = await service.getSignedPlayback(asset.id);
    expect(playback).not.toBeNull();
    expect(playback!.deliveryProvider).toBe('cloudfront');
    expect(playback!.renditions.map((r) => r.name)).toEqual(['360p', '480p', '720p', '1080p']);
    expect(playback!.posterUrl).toContain('Policy=');
    expect(playback!.thumbnails).toHaveLength(4);
    expect(playback!.masterPlaylistM3u8).toContain('#EXT-X-STREAM-INF:');
    expect(playback!.masterPlaylistM3u8).toContain('Signature=');
    expect(
      verifyCloudFrontSignedUrl(playback!.masterPlaylistUrl, TEST_PUBLIC_KEY).valid,
    ).toBe(true);
  });

  it('tracks MediaConvert async submission and webhook completion', async () => {
    const store = new InMemoryMediaAssetStore();
    const service = new MediaPipelineService(store);
    const asset = await service.enqueueVideo({
      ownerId: 'creator-7',
      sourceKey: 'uploads/creator-7/clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 5_000_000,
      backend: 'mediaconvert',
    });

    const mcBackend = new MediaConvertBackend(
      { endpoint: 'https://mc.test', roleArn: 'arn:aws:iam::1:role/mc', bucket: 'bkt' },
      async () => ({ jobId: 'mc-job-999' }),
    );

    const submitted = await service.processAsset(asset.id, mcBackend);
    expect(submitted.status).toBe('TRANSCODING');
    expect(submitted.externalJobId).toBe('mc-job-999');

    const mid = await service.handleWebhook({
      jobId: 'mc-job-999',
      status: 'PROGRESSING',
      progressPercent: 60,
    });
    expect(mid?.status).toBe('TRANSCODING');
    expect(mid?.progress).toBe(50);

    const done = await service.handleWebhook({
      jobId: 'mc-job-999',
      status: 'COMPLETE',
      durationSeconds: 120,
      width: 1280,
      height: 720,
    });
    expect(done?.status).toBe('READY');
    expect(done?.progress).toBe(100);
  });
});

describe('Media API Route Security Boundaries (#1770)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEDIA_WEBHOOK_SECRET;
  });

  it('rejects unauthenticated requests to POST /api/media/transcode', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    const req = new NextRequest('http://localhost:3000/api/media/transcode', {
      method: 'POST',
      body: JSON.stringify({
        sourceKey: 'uploads/u1/video.mp4',
        contentType: 'video/mp4',
        sizeBytes: 1000,
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await transcodePost(req);
    expect(res.status).toBe(401);
  });

  it('blocks cross-user IDOR attempts on POST /api/media/transcode (negative security test)', async () => {
    expect(isOwnedObjectKey('uploads/victim/secret.mp4', 'attacker')).toBe(false);
    expect(isOwnedObjectKey('uploads/attacker/../victim/secret.mp4', 'attacker')).toBe(false);
    expect(isOwnedObjectKey('uploads/attacker/valid.mp4', 'attacker')).toBe(true);

    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'attacker' } } as never);
    const req = new NextRequest('http://localhost:3000/api/media/transcode', {
      method: 'POST',
      body: JSON.stringify({
        sourceKey: 'uploads/victim/private.mp4',
        contentType: 'video/mp4',
        sizeBytes: 5000,
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await transcodePost(req);
    expect(res.status).toBe(403);
  });

  it('rejects unauthorized webhook calls without valid X-Media-Webhook-Secret', async () => {
    process.env.MEDIA_WEBHOOK_SECRET = 'expected-secret';
    const req = new NextRequest('http://localhost:3000/api/media/webhook', {
      method: 'POST',
      body: JSON.stringify({ assetId: 'media_1', status: 'COMPLETE' }),
      headers: {
        'Content-Type': 'application/json',
        'x-media-webhook-secret': 'bad-secret',
      },
    });
    const res = await webhookPost(req);
    expect(res.status).toBe(401);
  });
});
