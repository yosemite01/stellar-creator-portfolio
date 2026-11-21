/**
 * HLS (HTTP Live Streaming, RFC 8216) adaptive bitrate ladder, playlist
 * generation, and signed-URL manifest rewriting (Issue #1770).
 */

export interface HlsRenditionProfile {
  name: '360p' | '480p' | '720p' | '1080p';
  width: number;
  height: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  maxRateKbps: number;
  bufSizeKbps: number;
  codecs: string;
}

export interface HlsRenditionOutput {
  name: string;
  width: number;
  height: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  bandwidth: number;
  codecs: string;
  playlistKey: string;
}

export const HLS_SEGMENT_DURATION_SECONDS = 6;

export const DEFAULT_HLS_RENDITIONS: readonly HlsRenditionProfile[] = [
  {
    name: '360p',
    width: 640,
    height: 360,
    videoBitrateKbps: 800,
    audioBitrateKbps: 96,
    maxRateKbps: 856,
    bufSizeKbps: 1200,
    codecs: 'avc1.42e01e,mp4a.40.2',
  },
  {
    name: '480p',
    width: 854,
    height: 480,
    videoBitrateKbps: 1400,
    audioBitrateKbps: 128,
    maxRateKbps: 1498,
    bufSizeKbps: 2100,
    codecs: 'avc1.4d401f,mp4a.40.2',
  },
  {
    name: '720p',
    width: 1280,
    height: 720,
    videoBitrateKbps: 2800,
    audioBitrateKbps: 128,
    maxRateKbps: 2996,
    bufSizeKbps: 4200,
    codecs: 'avc1.4d401f,mp4a.40.2',
  },
  {
    name: '1080p',
    width: 1920,
    height: 1080,
    videoBitrateKbps: 5000,
    audioBitrateKbps: 192,
    maxRateKbps: 5350,
    bufSizeKbps: 7500,
    codecs: 'avc1.640028,mp4a.40.2',
  },
] as const;

/**
 * Select renditions appropriate for a source video's height without upscaling.
 * Always yields at least the 360p baseline rendition so adaptive playback works
 * even for low-resolution mobile captures.
 */
export function selectRenditionsForSource(sourceHeight?: number | null): HlsRenditionProfile[] {
  if (!sourceHeight || !Number.isFinite(sourceHeight) || sourceHeight <= 0) {
    return [...DEFAULT_HLS_RENDITIONS];
  }

  const eligible = DEFAULT_HLS_RENDITIONS.filter((r) => r.height <= sourceHeight);
  return eligible.length > 0 ? eligible : [DEFAULT_HLS_RENDITIONS[0]];
}

export function computeRenditionBandwidth(profile: Pick<HlsRenditionProfile, 'videoBitrateKbps' | 'audioBitrateKbps'>): number {
  return (profile.videoBitrateKbps + profile.audioBitrateKbps) * 1000;
}

export function buildRenditionOutputs(
  assetId: string,
  profiles: readonly HlsRenditionProfile[],
): HlsRenditionOutput[] {
  return profiles.map((profile) => ({
    name: profile.name,
    width: profile.width,
    height: profile.height,
    videoBitrateKbps: profile.videoBitrateKbps,
    audioBitrateKbps: profile.audioBitrateKbps,
    bandwidth: computeRenditionBandwidth(profile),
    codecs: profile.codecs,
    playlistKey: `media/${assetId}/hls/${profile.name}/index.m3u8`,
  }));
}

/**
 * Generate an RFC 8216 HLS master playlist referencing each ABR rendition.
 */
export function buildMasterPlaylist(
  renditions: readonly (HlsRenditionOutput & { uri?: string })[],
): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-INDEPENDENT-SEGMENTS'];

  const sorted = [...renditions].sort((a, b) => a.bandwidth - b.bandwidth);
  for (const r of sorted) {
    const averageBandwidth = Math.round(r.bandwidth * 0.85);
    const uri = r.uri ?? `${r.name}/index.m3u8`;
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},AVERAGE-BANDWIDTH=${averageBandwidth},RESOLUTION=${r.width}x${r.height},CODECS="${r.codecs}"`,
    );
    lines.push(uri);
  }

  return `${lines.join('\n')}\n`;
}

export interface HlsSegmentEntry {
  uri: string;
  durationSeconds: number;
}

/**
 * Generate a VOD HLS variant playlist (index.m3u8) for a set of `.ts` segments.
 */
export function buildVariantPlaylist(
  segments: readonly HlsSegmentEntry[],
  targetDuration = HLS_SEGMENT_DURATION_SECONDS,
): string {
  const maxDuration = segments.reduce(
    (max, seg) => Math.max(max, Math.ceil(seg.durationSeconds)),
    targetDuration,
  );

  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${maxDuration}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ];

  for (const seg of segments) {
    lines.push(`#EXTINF:${seg.durationSeconds.toFixed(3)},`);
    lines.push(seg.uri);
  }

  lines.push('#EXT-X-ENDLIST');
  return `${lines.join('\n')}\n`;
}

function joinObjectKey(baseDirKey: string, relativeUri: string): string {
  const cleanBase = baseDirKey.replace(/\/+$/, '');
  const cleanRel = relativeUri.replace(/^\/+/, '');
  return cleanBase ? `${cleanBase}/${cleanRel}` : cleanRel;
}

/**
 * Rewrite every relative playlist or segment URI in an HLS `.m3u8` manifest
 * into a short-lived signed CloudFront/S3 delivery URL, preventing hotlinking
 * of individual video segments.
 */
export async function rewriteManifestWithSignedUrls(
  manifest: string,
  baseDirKey: string,
  signKey: (objectKey: string) => Promise<string> | string,
): Promise<string> {
  const lines = manifest.split(/\r?\n/);
  const rewritten = await Promise.all(
    lines.map(async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      // Sign inline URI="..." attributes (e.g. #EXT-X-KEY or #EXT-X-MEDIA)
      if (trimmed.startsWith('#')) {
        if (!trimmed.includes('URI="')) return line;
        const match = trimmed.match(/URI="([^"]+)"/);
        if (!match) return line;
        const rawUri = match[1];
        if (/^https?:\/\//i.test(rawUri)) return line;
        const signed = await signKey(joinObjectKey(baseDirKey, rawUri));
        return line.replace(`URI="${rawUri}"`, `URI="${signed}"`);
      }

      // Already an absolute URL — leave intact
      if (/^https?:\/\//i.test(trimmed)) return line;

      const key = joinObjectKey(baseDirKey, trimmed);
      return await signKey(key);
    }),
  );

  return rewritten.join('\n');
}
