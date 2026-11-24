import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { getObject, uploadObject } from '@/lib/storage/s3';
import {
  buildMasterPlaylist,
  buildRenditionOutputs,
  HLS_SEGMENT_DURATION_SECONDS,
  selectRenditionsForSource,
  type HlsRenditionOutput,
  type HlsRenditionProfile,
} from './hls';
import {
  buildFfmpegFrameArgs,
  buildThumbnailsVtt,
  planThumbnails,
  type ThumbnailFramePlan,
} from './thumbnails';

const execFileAsync = promisify(execFile);

/**
 * Dual-backend media transcoder supporting local ffmpeg workers and AWS
 * Elemental MediaConvert (Issue #1770).
 */

export interface VideoProbeInfo {
  durationSeconds: number;
  width: number;
  height: number;
}

export interface TranscodeExecutionInput {
  assetId: string;
  sourceKey: string;
  contentType: string;
}

export interface TranscodeProgressCallbacks {
  onStage?: (stage: 'PROBING' | 'TRANSCODING' | 'THUMBNAILS' | 'UPLOADING', stagePercent: number) => Promise<void> | void;
  onProbe?: (info: VideoProbeInfo) => Promise<void> | void;
}

export interface TranscodeExecutionResult {
  backend: 'ffmpeg' | 'mediaconvert';
  mode: 'completed' | 'submitted';
  externalJobId?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  masterPlaylistKey: string;
  renditions: HlsRenditionOutput[];
  posterKey: string;
  thumbnails: ThumbnailFramePlan[];
  thumbnailsVttKey: string;
}

export interface TranscoderBackend {
  readonly name: 'ffmpeg' | 'mediaconvert';
  execute(
    input: TranscodeExecutionInput,
    callbacks?: TranscodeProgressCallbacks,
  ): Promise<TranscodeExecutionResult>;
}

/**
 * Parse a single `ffmpeg -progress pipe:1` key=value output line to compute
 * normalized transcoding progress [0..100].
 */
export function parseFfmpegProgressPercent(
  line: string,
  durationSeconds: number,
): number | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  const trimmed = line.trim();
  if (trimmed === 'progress=end') return 100;

  if (trimmed.startsWith('out_time_us=')) {
    const us = Number(trimmed.slice('out_time_us='.length));
    if (!Number.isFinite(us) || us < 0) return null;
    return Math.min(99, Math.max(0, Math.round((us / (durationSeconds * 1_000_000)) * 100)));
  }

  if (trimmed.startsWith('out_time_ms=')) {
    // ffmpeg emits out_time_ms in microseconds despite its name.
    const us = Number(trimmed.slice('out_time_ms='.length));
    if (!Number.isFinite(us) || us < 0) return null;
    return Math.min(99, Math.max(0, Math.round((us / (durationSeconds * 1_000_000)) * 100)));
  }

  return null;
}

/**
 * Build safe (no-shell) ffmpeg arguments to transcode `inputPath` into one HLS
 * rendition inside `outputDir`.
 */
export function buildFfmpegHlsArgs(
  inputPath: string,
  outputDir: string,
  profile: HlsRenditionProfile,
): string[] {
  const segmentPattern = path.join(outputDir, 'seg_%04d.ts');
  const playlistPath = path.join(outputDir, 'index.m3u8');

  return [
    '-y',
    '-i',
    inputPath,
    '-vf',
    `scale=w=${profile.width}:h=${profile.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-b:a',
    `${profile.audioBitrateKbps}k`,
    '-c:v',
    'h264',
    '-profile:v',
    'main',
    '-crf',
    '20',
    '-sc_threshold',
    '0',
    '-g',
    '48',
    '-keyint_min',
    '48',
    '-b:v',
    `${profile.videoBitrateKbps}k`,
    '-maxrate',
    `${profile.maxRateKbps}k`,
    '-bufsize',
    `${profile.bufSizeKbps}k`,
    '-hls_time',
    String(HLS_SEGMENT_DURATION_SECONDS),
    '-hls_playlist_type',
    'vod',
    '-hls_segment_filename',
    segmentPattern,
    '-progress',
    'pipe:1',
    '-nostats',
    playlistPath,
  ];
}

/**
 * Local ffmpeg/ffprobe worker backend: downloads source video from S3, probes
 * metadata, transcodes ABR HLS renditions with live progress tracking, extracts
 * poster + preview thumbnails, and uploads all outputs back to private S3.
 */
export class FfmpegWorkerBackend implements TranscoderBackend {
  readonly name = 'ffmpeg' as const;

  constructor(
    private readonly ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg',
    private readonly ffprobeBin = process.env.FFPROBE_PATH || 'ffprobe',
  ) {}

  async probe(inputPath: string): Promise<VideoProbeInfo> {
    const { stdout } = await execFileAsync(this.ffprobeBin, [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height:format=duration',
      '-of',
      'json',
      inputPath,
    ]);
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ width?: number; height?: number }>;
      format?: { duration?: string };
    };
    const stream = parsed.streams?.[0];
    return {
      width: Number(stream?.width ?? 1280),
      height: Number(stream?.height ?? 720),
      durationSeconds: Number(parsed.format?.duration ?? 0),
    };
  }

  private runFfmpegWithProgress(
    args: string[],
    durationSeconds: number,
    onPercent: (pct: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        const lines = chunk.toString('utf8').split(/\r?\n/);
        for (const line of lines) {
          const pct = parseFfmpegProgressPercent(line, durationSeconds);
          if (pct !== null) onPercent(pct);
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      });
    });
  }

  async execute(
    input: TranscodeExecutionInput,
    callbacks: TranscodeProgressCallbacks = {},
  ): Promise<TranscodeExecutionResult> {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `media-${input.assetId}-`));

    try {
      await callbacks.onStage?.('PROBING', 0);
      const source = await getObject(input.sourceKey);
      const inputPath = path.join(workDir, 'source');
      await fs.writeFile(inputPath, source.body);

      const probeInfo = await this.probe(inputPath);
      await callbacks.onProbe?.(probeInfo);
      await callbacks.onStage?.('PROBING', 100);

      const profiles = selectRenditionsForSource(probeInfo.height);
      const renditions = buildRenditionOutputs(input.assetId, profiles);

      // Transcode each ABR rendition
      for (let i = 0; i < profiles.length; i += 1) {
        const profile = profiles[i];
        const renditionDir = path.join(workDir, 'hls', profile.name);
        await fs.mkdir(renditionDir, { recursive: true });
        const args = buildFfmpegHlsArgs(inputPath, renditionDir, profile);

        await this.runFfmpegWithProgress(args, probeInfo.durationSeconds, (pct) => {
          const aggregate = Math.round(((i + pct / 100) / profiles.length) * 100);
          void callbacks.onStage?.('TRANSCODING', aggregate);
        });
      }
      await callbacks.onStage?.('TRANSCODING', 100);

      // Extract poster and preview thumbnails
      await callbacks.onStage?.('THUMBNAILS', 0);
      const thumbPlan = planThumbnails(input.assetId, probeInfo.durationSeconds);
      const thumbDir = path.join(workDir, 'thumbnails');
      await fs.mkdir(thumbDir, { recursive: true });

      const posterPath = path.join(workDir, 'poster.jpg');
      await execFileAsync(
        this.ffmpegBin,
        buildFfmpegFrameArgs(
          inputPath,
          posterPath,
          thumbPlan.poster.timeSeconds,
          thumbPlan.poster.width,
          thumbPlan.poster.height,
        ),
      );

      for (let i = 0; i < thumbPlan.thumbnails.length; i += 1) {
        const item = thumbPlan.thumbnails[i];
        const outPath = path.join(thumbDir, path.basename(item.key));
        await execFileAsync(
          this.ffmpegBin,
          buildFfmpegFrameArgs(inputPath, outPath, item.timeSeconds, 320, 180),
        );
        await callbacks.onStage?.(
          'THUMBNAILS',
          Math.round(((i + 1) / thumbPlan.thumbnails.length) * 100),
        );
      }

      // Upload HLS renditions, master playlist, poster, thumbnails, and WebVTT
      await callbacks.onStage?.('UPLOADING', 0);
      const masterPlaylistKey = `media/${input.assetId}/hls/master.m3u8`;
      const masterContent = buildMasterPlaylist(renditions);

      const uploadTasks: Array<() => Promise<unknown>> = [
        () =>
          uploadObject({
            key: masterPlaylistKey,
            body: masterContent,
            contentType: 'application/vnd.apple.mpegurl',
          }),
        async () =>
          uploadObject({
            key: thumbPlan.poster.key,
            body: await fs.readFile(posterPath),
            contentType: 'image/jpeg',
          }),
      ];

      for (const rendition of renditions) {
        const dir = path.join(workDir, 'hls', rendition.name);
        const files = await fs.readdir(dir);
        for (const fname of files) {
          const fpath = path.join(dir, fname);
          const key = `media/${input.assetId}/hls/${rendition.name}/${fname}`;
          const contentType = fname.endsWith('.m3u8')
            ? 'application/vnd.apple.mpegurl'
            : 'video/MP2T';
          uploadTasks.push(async () =>
            uploadObject({
              key,
              body: await fs.readFile(fpath),
              contentType,
            }),
          );
        }
      }

      for (const item of thumbPlan.thumbnails) {
        const fpath = path.join(thumbDir, path.basename(item.key));
        uploadTasks.push(async () =>
          uploadObject({
            key: item.key,
            body: await fs.readFile(fpath),
            contentType: 'image/jpeg',
          }),
        );
      }

      const vttContent = await buildThumbnailsVtt(
        thumbPlan.thumbnails,
        probeInfo.durationSeconds,
        (key) => path.basename(key),
      );
      uploadTasks.push(() =>
        uploadObject({
          key: thumbPlan.vttKey,
          body: vttContent,
          contentType: 'text/vtt',
        }),
      );

      for (let i = 0; i < uploadTasks.length; i += 1) {
        await uploadTasks[i]();
        await callbacks.onStage?.('UPLOADING', Math.round(((i + 1) / uploadTasks.length) * 100));
      }

      return {
        backend: 'ffmpeg',
        mode: 'completed',
        durationSeconds: probeInfo.durationSeconds,
        width: probeInfo.width,
        height: probeInfo.height,
        masterPlaylistKey,
        renditions,
        posterKey: thumbPlan.poster.key,
        thumbnails: thumbPlan.thumbnails,
        thumbnailsVttKey: thumbPlan.vttKey,
      };
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  }
}

export interface MediaConvertJobConfig {
  endpoint: string;
  roleArn: string;
  queueArn?: string;
  bucket: string;
}

/**
 * Construct an AWS Elemental MediaConvert job definition with HLS ABR outputs
 * and frame-capture thumbnails.
 */
export function buildMediaConvertJobSpec(
  input: TranscodeExecutionInput,
  config: MediaConvertJobConfig,
  profiles: readonly HlsRenditionProfile[] = selectRenditionsForSource(),
): Record<string, unknown> {
  const destinationBase = `s3://${config.bucket}/media/${input.assetId}/`;

  return {
    Role: config.roleArn,
    ...(config.queueArn ? { Queue: config.queueArn } : {}),
    UserMetadata: {
      mediaAssetId: input.assetId,
    },
    Settings: {
      Inputs: [
        {
          FileInput: `s3://${config.bucket}/${input.sourceKey.replace(/^\/+/, '')}`,
          AudioSelectors: {
            'Audio Selector 1': { DefaultSelection: 'DEFAULT' },
          },
          VideoSelector: {},
        },
      ],
      OutputGroups: [
        {
          Name: 'Apple HLS',
          OutputGroupSettings: {
            Type: 'HLS_GROUP_SETTINGS',
            HlsGroupSettings: {
              SegmentLength: HLS_SEGMENT_DURATION_SECONDS,
              MinSegmentLength: 0,
              Destination: `${destinationBase}hls/master`,
            },
          },
          Outputs: profiles.map((p) => ({
            NameModifier: `_${p.name}`,
            ContainerSettings: { Container: 'M3U8' },
            VideoDescription: {
              Width: p.width,
              Height: p.height,
              CodecSettings: {
                Codec: 'H_264',
                H264Settings: {
                  Bitrate: p.videoBitrateKbps * 1000,
                  RateControlMode: 'CBR',
                  CodecProfile: 'MAIN',
                },
              },
            },
            AudioDescriptions: [
              {
                AudioSourceName: 'Audio Selector 1',
                CodecSettings: {
                  Codec: 'AAC',
                  AacSettings: {
                    Bitrate: p.audioBitrateKbps * 1000,
                    CodingMode: 'CODING_MODE_2_0',
                    SampleRate: 48000,
                  },
                },
              },
            ],
          })),
        },
        {
          Name: 'Thumbnails',
          OutputGroupSettings: {
            Type: 'FILE_GROUP_SETTINGS',
            FileGroupSettings: {
              Destination: `${destinationBase}thumbnails/thumb`,
            },
          },
          Outputs: [
            {
              ContainerSettings: { Container: 'RAW' },
              VideoDescription: {
                Width: 1280,
                Height: 720,
                CodecSettings: {
                  Codec: 'FRAME_CAPTURE',
                  FrameCaptureSettings: {
                    FramerateNumerator: 1,
                    FramerateDenominator: 10,
                    MaxCaptures: 4,
                    Quality: 80,
                  },
                },
              },
            },
          ],
        },
      ],
    },
  };
}

/**
 * AWS Elemental MediaConvert backend: submits asynchronous transcode jobs and
 * reconciles progress/completion via POST /api/media/webhook.
 */
export class MediaConvertBackend implements TranscoderBackend {
  readonly name = 'mediaconvert' as const;

  constructor(
    private readonly config: MediaConvertJobConfig,
    private readonly submitJob?: (spec: Record<string, unknown>) => Promise<{ jobId: string }>,
  ) {}

  async execute(
    input: TranscodeExecutionInput,
    callbacks: TranscodeProgressCallbacks = {},
  ): Promise<TranscodeExecutionResult> {
    await callbacks.onStage?.('TRANSCODING', 5);
    const profiles = selectRenditionsForSource();
    const renditions = buildRenditionOutputs(input.assetId, profiles);
    const thumbPlan = planThumbnails(input.assetId, 60);
    const spec = buildMediaConvertJobSpec(input, this.config, profiles);

    let externalJobId: string;
    if (this.submitJob) {
      const submitted = await this.submitJob(spec);
      externalJobId = submitted.jobId;
    } else {
      const res = await fetch(`${this.config.endpoint.replace(/\/+$/, '')}/2017-08-29/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec),
      });
      if (!res.ok) {
        throw new Error(`MediaConvert submission failed with HTTP ${res.status}`);
      }
      const data = (await res.json()) as { job?: { id?: string } };
      externalJobId = data.job?.id ?? `mc-${input.assetId}`;
    }

    return {
      backend: 'mediaconvert',
      mode: 'submitted',
      externalJobId,
      masterPlaylistKey: `media/${input.assetId}/hls/master.m3u8`,
      renditions,
      posterKey: thumbPlan.poster.key,
      thumbnails: thumbPlan.thumbnails,
      thumbnailsVttKey: thumbPlan.vttKey,
    };
  }
}

export function getTranscoderBackend(): TranscoderBackend {
  const backend = process.env.MEDIA_TRANSCODER_BACKEND?.toLowerCase();
  const endpoint = process.env.MEDIACONVERT_ENDPOINT;
  const roleArn = process.env.MEDIACONVERT_ROLE_ARN;
  const bucket = process.env.S3_BUCKET;

  if ((backend === 'mediaconvert' || (!backend && endpoint && roleArn)) && endpoint && roleArn && bucket) {
    return new MediaConvertBackend({
      endpoint,
      roleArn,
      queueArn: process.env.MEDIACONVERT_QUEUE_ARN,
      bucket,
    });
  }

  return new FfmpegWorkerBackend();
}
