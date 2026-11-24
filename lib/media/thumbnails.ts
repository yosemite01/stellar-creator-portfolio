/**
 * Video poster frame and timeline thumbnail planning + WebVTT preview track
 * generation (Issue #1770).
 */

export interface ThumbnailFramePlan {
  index: number;
  timeSeconds: number;
  key: string;
}

export interface MediaThumbnailPlan {
  poster: {
    timeSeconds: number;
    width: number;
    height: number;
    key: string;
  };
  thumbnails: ThumbnailFramePlan[];
  vttKey: string;
}

export interface PlanThumbnailsOptions {
  /** Number of preview thumbnails to extract across the video timeline (default 4). */
  count?: number;
  posterWidth?: number;
  posterHeight?: number;
}

/**
 * Compute deterministic extraction timestamps and object keys for the poster
 * frame (offset to ~10% to skip fade-in/black opening frames) and timeline
 * preview thumbnails.
 */
export function planThumbnails(
  assetId: string,
  durationSeconds: number,
  options: PlanThumbnailsOptions = {},
): MediaThumbnailPlan {
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  const count = Math.min(Math.max(1, options.count ?? 4), 20);
  const posterWidth = options.posterWidth ?? 1280;
  const posterHeight = options.posterHeight ?? 720;

  const posterTime =
    safeDuration <= 1 ? 0 : Math.min(5, Math.max(0.5, Number((safeDuration * 0.1).toFixed(2))));

  const thumbnails: ThumbnailFramePlan[] = [];
  for (let i = 0; i < count; i += 1) {
    const ratio = count === 1 ? 0 : i / count;
    const t = Number((safeDuration * ratio).toFixed(2));
    const padded = String(i + 1).padStart(3, '0');
    thumbnails.push({
      index: i + 1,
      timeSeconds: t,
      key: `media/${assetId}/thumbnails/thumb-${padded}.jpg`,
    });
  }

  return {
    poster: {
      timeSeconds: posterTime,
      width: posterWidth,
      height: posterHeight,
      key: `media/${assetId}/poster.jpg`,
    },
    thumbnails,
    vttKey: `media/${assetId}/thumbnails/thumbnails.vtt`,
  };
}

function formatVttTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * Build a WebVTT preview track mapping timeline ranges to signed thumbnail URLs
 * for scrub-bar previews in adaptive players.
 */
export async function buildThumbnailsVtt(
  thumbnails: readonly ThumbnailFramePlan[],
  durationSeconds: number,
  resolveUrl: (key: string) => Promise<string> | string,
): Promise<string> {
  const lines = ['WEBVTT', ''];
  const totalDuration = Math.max(durationSeconds, thumbnails.length);

  for (let i = 0; i < thumbnails.length; i += 1) {
    const current = thumbnails[i];
    const nextTime =
      i + 1 < thumbnails.length ? thumbnails[i + 1].timeSeconds : totalDuration;
    const endTime = Math.max(current.timeSeconds + 1, nextTime);
    const url = await resolveUrl(current.key);
    lines.push(`${formatVttTimestamp(current.timeSeconds)} --> ${formatVttTimestamp(endTime)}`);
    lines.push(url);
    lines.push('');
  }

  return lines.join('\n');
}

/** Safe argv array (no shell interpolation) for extracting a single JPEG frame with ffmpeg. */
export function buildFfmpegFrameArgs(
  inputPath: string,
  outputPath: string,
  timeSeconds: number,
  width: number,
  height: number,
): string[] {
  return [
    '-y',
    '-ss',
    String(Math.max(0, timeSeconds)),
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-vf',
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    '-q:v',
    '3',
    outputPath,
  ];
}
