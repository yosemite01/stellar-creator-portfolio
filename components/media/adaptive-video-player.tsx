'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle, Film } from 'lucide-react';
import { LiveRegion } from '@/lib/accessibility';

export interface PlaybackRendition {
  name: string;
  width: number;
  height: number;
  bandwidth: number;
  playlistUrl: string;
}

export interface AdaptivePlaybackData {
  assetId: string;
  status: string;
  masterPlaylistUrl: string;
  posterUrl: string | null;
  expiresAt: string;
  renditions: PlaybackRendition[];
}

export interface AdaptiveVideoPlayerProps {
  assetId: string;
  title?: string;
  className?: string;
  /** Initial signed playback payload when hydrated from RSC. */
  initialPlayback?: AdaptivePlaybackData | null;
}

/**
 * Adaptive HLS video player with poster frames, multi-bitrate quality
 * selection, live transcoding progress polling, and automatic signed-URL
 * refresh before CloudFront/S3 expiry (Issue #1770).
 */
export function AdaptiveVideoPlayer({
  assetId,
  title = 'Portfolio video',
  className = '',
  initialPlayback = null,
}: AdaptiveVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playback, setPlayback] = useState<AdaptivePlaybackData | null>(initialPlayback);
  const [status, setStatus] = useState<string>(initialPlayback?.status ?? 'LOADING');
  const [progress, setProgress] = useState<number>(initialPlayback ? 100 : 0);
  const [selectedQuality, setSelectedQuality] = useState<string>('auto');
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');

  const loadPlayback = useCallback(async () => {
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(assetId)}/playback`);
      if (res.status === 409) {
        const processing = (await res.json()) as { status?: string; progress?: number };
        setStatus(processing.status ?? 'TRANSCODING');
        setProgress(processing.progress ?? 0);
        setAnnouncement(
          `Video is processing: ${processing.progress ?? 0}% complete`,
        );
        return false;
      }
      if (!res.ok) {
        setError('Unable to load video stream.');
        setStatus('FAILED');
        return true;
      }
      const data = (await res.json()) as AdaptivePlaybackData;
      setPlayback(data);
      setStatus('READY');
      setProgress(100);
      setError(null);
      setAnnouncement(`${title} is ready for adaptive playback.`);
      return true;
    } catch {
      setError('Network error while loading video stream.');
      return true;
    }
  }, [assetId, title]);

  // Poll until transcoding reaches READY
  useEffect(() => {
    if (playback) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const done = await loadPlayback();
      if (!done && !cancelled) {
        timer = setTimeout(tick, 4000);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [playback, loadPlayback]);

  // Proactively refresh signed URLs 60s before expiry
  useEffect(() => {
    if (!playback?.expiresAt) return;
    const expiryMs = new Date(playback.expiresAt).getTime();
    const refreshInMs = Math.max(10_000, expiryMs - Date.now() - 60_000);
    const timer = setTimeout(() => {
      void loadPlayback();
    }, refreshInMs);
    return () => clearTimeout(timer);
  }, [playback?.expiresAt, loadPlayback]);

  const activeSourceUrl = (() => {
    if (!playback) return '';
    if (selectedQuality === 'auto') return playback.masterPlaylistUrl;
    const match = playback.renditions.find((r) => r.name === selectedQuality);
    return match?.playlistUrl ?? playback.masterPlaylistUrl;
  })();

  if (error) {
    return (
      <div
        role="alert"
        className={`flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive ${className}`}
      >
        <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span>{error}</span>
      </div>
    );
  }

  if (!playback) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-muted/40 p-8 text-center ${className}`}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
          <span>Processing adaptive video ({status.toLowerCase()})…</span>
        </div>
        <div
          className="w-full max-w-xs h-2 rounded-full bg-muted overflow-hidden"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Video transcoding progress"
        >
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">{progress}% complete</p>
        <LiveRegion message={announcement} role="status" />
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="relative overflow-hidden rounded-xl border border-border bg-black">
        <video
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          poster={playback.posterUrl ?? undefined}
          src={activeSourceUrl}
          aria-label={title}
          className="w-full aspect-video"
        />
      </div>

      {playback.renditions.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Film className="h-3.5 w-3.5" aria-hidden="true" />
            Adaptive HLS ({playback.renditions.length} bitrates)
          </span>
          <label className="inline-flex items-center gap-2">
            <span>Quality</span>
            <select
              aria-label="Video playback quality"
              value={selectedQuality}
              onChange={(e) => {
                setSelectedQuality(e.target.value);
                setAnnouncement(`Video quality switched to ${e.target.value}`);
              }}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            >
              <option value="auto">Auto (ABR)</option>
              {playback.renditions.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name} ({Math.round(r.bandwidth / 1000)} kbps)
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <LiveRegion message={announcement} role="status" />
    </div>
  );
}
