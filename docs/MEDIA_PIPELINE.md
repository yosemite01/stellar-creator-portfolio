# Adaptive Media Pipeline: HLS Transcoding & Signed URLs (Issue #1770)

## Design Note

### Overview
Serving raw uploaded videos directly from object storage stalls mobile playback and enables unauthorized hotlinking. This pipeline transcodes uploaded videos (`video/mp4`, `video/webm`, `video/quicktime`) into multi-bitrate HLS (RFC 8216) renditions with poster frames, timeline thumbnails, progress tracking, and short-lived AWS CloudFront Signed URLs (with automatic fallback to private S3 presigned URLs).

---

### Data Model

Additive Prisma table `MediaAsset` (migration `20261121000000_ipfs_pin_health_and_media_pipeline`):

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `TEXT` (cuid) | Primary key |
| `ownerId` | `TEXT` | Owning user ID (enforced on upload/transcode/status) |
| `sourceKey` | `TEXT` | Private S3 key of original uploaded video |
| `contentType` | `TEXT` | Validated MIME type (`video/mp4`, `video/webm`, `video/quicktime`) |
| `sizeBytes` | `INT` | Source size in bytes |
| `durationSeconds` | `FLOAT?` | Probed duration in seconds |
| `width` / `height` | `INT?` | Probed source resolution |
| `status` | `TEXT` | `QUEUED` → `PROBING` → `TRANSCODING` → `THUMBNAILS` → `UPLOADING` → `READY` \| `FAILED` |
| `progress` | `INT` | Weighted pipeline progress (`0..100`) |
| `backend` | `TEXT` | `ffmpeg` or `mediaconvert` |
| `externalJobId` | `TEXT?` | AWS MediaConvert job ID (when using MediaConvert) |
| `masterPlaylistKey` | `TEXT?` | S3 key for `master.m3u8` |
| `renditions` | `JSONB?` | Array of ABR rendition metadata (`360p`, `480p`, `720p`, `1080p`) |
| `posterKey` | `TEXT?` | S3 key for poster JPEG (`1280x720`) |
| `thumbnailKeys` | `JSONB?` | Array of `{ index, timeSeconds, key }` preview thumbnails |
| `thumbnailsVttKey` | `TEXT?` | S3 key for WebVTT scrub-preview track |
| `errorMessage` | `TEXT?` | Diagnostic error details when `FAILED` |

---

### Adaptive Bitrate (ABR) Ladder (`lib/media/hls.ts`)

Renditions are selected via `selectRenditionsForSource(sourceHeight)` so videos are never upscaled above their native resolution:

| Profile | Resolution | Video Bitrate | Audio Bitrate | Segment Length |
| :--- | :--- | :--- | :--- | :--- |
| `360p` | `640x360` | 800 kbps | 96 kbps | 6s |
| `480p` | `854x480` | 1400 kbps | 128 kbps | 6s |
| `720p` | `1280x720` | 2800 kbps | 128 kbps | 6s |
| `1080p` | `1920x1080` | 5000 kbps | 192 kbps | 6s |

---

### Signed CloudFront URLs (`lib/media/cloudfront-signer.ts`)

- Implements CloudFront URL-safe Base64 and RSA-SHA1 policy signing for:
  - **Canned Policies** (`Expires`, `Signature`, `Key-Pair-Id`) for single objects (poster, thumbnails).
  - **Custom Policies** (`Policy`, `Signature`, `Key-Pair-Id`) with wildcard directory resource patterns (`https://<cdn>/media/<assetId>/*`) and optional IP CIDR restriction for HLS playlists and `.ts` segments.
- `rewriteManifestWithSignedUrls()` rewrites every relative playlist and segment URI inside `.m3u8` manifests so individual chunks cannot be hotlinked.
- Falls back cleanly to S3 presigned URLs (`lib/storage/s3.ts`) when `CLOUDFRONT_*` variables are not configured.

---

### API Surface & Worker

| Endpoint / Module | Auth | Description |
| :--- | :--- | :--- |
| `POST /api/upload` | Session | Stores private S3 object; automatically enqueues HLS transcoding for video MIME types. |
| `POST /api/media/transcode` | Session + ownership check | Explicitly enqueues transcoding for an uploaded S3 video key (blocks cross-user IDOR). |
| `GET /api/media/[id]/status` | Session | Returns stage, weighted `progress` (0..100), renditions, and signed poster URL. |
| `GET /api/media/[id]/playback` | Public/Session (when `READY`) | Returns signed CloudFront/S3 HLS master URL, ABR renditions, poster, thumbnails, or raw signed `.m3u8` (`?format=m3u8`). Returns `409` while still processing. |
| `POST /api/media/webhook` | `X-Media-Webhook-Secret` | Constant-time secret verified progress & completion callback for AWS MediaConvert. |
| `server/jobs/media-transcoder-worker.ts` | Worker | Polls queued `MediaAsset` jobs and runs `FfmpegWorkerBackend` or submits to `MediaConvertBackend`. |
| `components/media/adaptive-video-player.tsx` | Client UI | Accessible adaptive `<video>` player with poster frame, bitrate selector, transcoding progress bar, and proactive signed URL refresh before expiry. |

---

### Failure Modes & Mitigations

| Failure Mode | Mitigation |
| :--- | :--- |
| Transcoder crash or corrupt video file | State transitions to `FAILED` with `errorMessage`; temporary workspace cleaned up in `finally`; user sees clear error status. |
| Hotlinking / stolen CDN URL | All playlists, `.ts` segments, posters, and thumbnails require short-lived RSA-signed URLs (`CLOUDFRONT_URL_TTL_SECONDS`, default 900s); expired or tampered signatures are rejected. |
| Cross-user IDOR on `/api/media/transcode` | `isOwnedObjectKey()` rejects any key not scoped under the authenticated user's directory or containing `..`. |
| Playback requested before transcoding finishes | `/api/media/[id]/playback` returns HTTP `409` with live `status` and `progress`; `AdaptiveVideoPlayer` polls automatically until `READY`. |
