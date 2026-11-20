/** Server-side validation shared by the upload route and its tests. */

const DEFAULT_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
];

const DEFAULT_MAX_UPLOAD_MB = 100;

/** MIME types accepted for upload; override with ALLOWED_FILE_TYPES (comma-separated). */
export function allowedTypes(): string[] {
  const configured = process.env.ALLOWED_FILE_TYPES?.split(',')
    .map((type) => type.trim())
    .filter(Boolean);
  return configured?.length ? configured : DEFAULT_ALLOWED_TYPES;
}

/** Upload size limit in bytes; override with MAX_UPLOAD_MB. */
export function maxUploadBytes(): number {
  const configured = Number(process.env.MAX_UPLOAD_MB);
  const megabytes = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_UPLOAD_MB;
  return megabytes * 1024 * 1024;
}

/**
 * Reduces a filename to lowercase letters, digits, dots and single hyphens
 * so it is safe to embed in an object key.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/-+\./g, '.')
    .replace(/^-+|-+$/g, '');
}

/** Returns a human-readable rejection reason, or null when the file is acceptable. */
export async function validateFile(file: Pick<File, 'name' | 'size' | 'type'>): Promise<string | null> {
  const limit = maxUploadBytes();
  if (file.size > limit) {
    return `File ${file.name} exceeds ${Math.round(limit / (1024 * 1024))}MB limit`;
  }
  if (!allowedTypes().includes(file.type)) {
    return `File type ${file.type || 'unknown'} not allowed`;
  }
  return null;
}

/**
 * Detect a MIME type from magic bytes (the real content), ignoring whatever
 * the client declared. Returns null for unknown/unsniffable content so callers
 * can deny by default.
 */
export function sniffType(bytes: Uint8Array): string | null {
  const at = (offset: number, sig: number[]) =>
    sig.every((b, i) => bytes[offset + i] === b);
  if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (at(0, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf'; // %PDF
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp'; // RIFF....WEBP
  if (at(0, [0x50, 0x4b, 0x03, 0x04]) || at(0, [0x50, 0x4b, 0x05, 0x06])) return 'application/zip'; // PK..
  return null;
}

/**
 * Validate the actual bytes of a file requested for IPFS pinning (#1508).
 * Checks real length (not a possibly-lying Content-Length) and sniffs the
 * content type, rejecting anything outside the allowlist. Returns a status +
 * message on rejection, or null when the upload is acceptable.
 */
export function validatePinnedBytes(bytes: Uint8Array): { status: number; error: string } | null {
  const limit = maxUploadBytes();
  if (bytes.byteLength > limit) {
    return { status: 413, error: `File exceeds ${Math.round(limit / (1024 * 1024))}MB limit` };
  }
  const detected = sniffType(bytes);
  if (!detected || !allowedTypes().includes(detected)) {
    return { status: 415, error: `File type ${detected || 'unknown'} not allowed` };
  }
  return null;
}

// ── Hardened upload pipeline (Issue #1814) ─────────────────────────────────
//
// Declared MIME type and size are client-controlled, so the upload route now:
//   1. caps the request body while streaming it (never buffers past the limit),
//   2. detects the real type from magic bytes and requires it to match,
//   3. rejects polyglots (a second format hidden inside the file),
//   4. inspects ZIP central directories for decompression bombs,
//   5. re-encodes images with sharp, which drops EXIF/XMP/ICC metadata and
//      anything appended after the image data.

export class UploadTooLargeError extends Error {
  constructor(public readonly limit: number) {
    super(`Upload exceeds ${Math.round(limit / (1024 * 1024))}MB limit`);
    this.name = 'UploadTooLargeError';
  }
}

/** Slack for multipart boundaries/headers on top of the file size limit. */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * Read a stream into memory, aborting as soon as more than `limit` bytes have
 * arrived. Protects against bodies that lie about (or omit) Content-Length.
 */
export async function readStreamWithLimit(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new UploadTooLargeError(limit);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export const ZIP_LIMITS = {
  maxEntries: 1_000,
  /** Total uncompressed size allowed, as a multiple of the upload limit. */
  maxUncompressedFactor: 10,
  /** Per-entry and overall compression ratio above which we assume a bomb. */
  maxRatio: 100,
};

function readU16(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8);
}
function readU32(b: Uint8Array, o: number) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

/**
 * Walk the ZIP central directory without decompressing anything and reject
 * archives that would expand beyond sane limits (zip bombs), nest archives,
 * use ZIP64 sizes we can't verify, or are malformed.
 */
export function inspectZip(bytes: Uint8Array, uploadLimit = maxUploadBytes()): string | null {
  // End of central directory record: last 22..(22+65535) bytes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (readU32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return 'Malformed ZIP archive';

  const entries = readU16(bytes, eocd + 10);
  const cdSize = readU32(bytes, eocd + 12);
  const cdOffset = readU32(bytes, eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff) return 'ZIP64 archives are not supported';
  if (entries > ZIP_LIMITS.maxEntries) return 'ZIP archive has too many entries';
  if (cdOffset + cdSize > bytes.length) return 'Malformed ZIP archive';

  let p = cdOffset;
  let totalCompressed = 0;
  let totalUncompressed = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > bytes.length || readU32(bytes, p) !== 0x02014b50) return 'Malformed ZIP archive';
    const compressed = readU32(bytes, p + 20);
    const uncompressed = readU32(bytes, p + 24);
    const nameLen = readU16(bytes, p + 28);
    const extraLen = readU16(bytes, p + 30);
    const commentLen = readU16(bytes, p + 32);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) {
      return 'ZIP64 archives are not supported';
    }
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen)).toLowerCase();
    if (/\.(zip|gz|tgz|bz2|xz|7z|rar)$/.test(name)) return 'Nested archives are not allowed';
    if (compressed > 0 && uncompressed / compressed > ZIP_LIMITS.maxRatio) {
      return 'ZIP entry compression ratio too high (possible decompression bomb)';
    }
    if (compressed === 0 && uncompressed > 0) return 'Malformed ZIP archive';
    totalCompressed += compressed;
    totalUncompressed += uncompressed;
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (totalUncompressed > uploadLimit * ZIP_LIMITS.maxUncompressedFactor) {
    return 'ZIP archive expands beyond the allowed size (possible decompression bomb)';
  }
  if (totalCompressed > 0 && totalUncompressed / totalCompressed > ZIP_LIMITS.maxRatio) {
    return 'ZIP archive compression ratio too high (possible decompression bomb)';
  }
  return null;
}

const ACTIVE_CONTENT = /<\s*(script|html|svg|iframe|object|embed)\b|javascript:/i;

function indexOfSeq(bytes: Uint8Array, seq: number[], from = 0): number {
  outer: for (let i = from; i <= bytes.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) if (bytes[i + j] !== seq[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Reject polyglots: files that are valid as their detected type but also
 * carry a second format (an embedded ZIP/JAR, or HTML/script that a browser
 * might sniff). Images are additionally neutralised by re-encoding.
 */
export function detectPolyglot(bytes: Uint8Array, detected: string): string | null {
  if (detected !== 'application/zip') {
    if (indexOfSeq(bytes, [0x50, 0x4b, 0x05, 0x06]) >= 0 || indexOfSeq(bytes, [0x50, 0x4b, 0x03, 0x04], 4) >= 0) {
      return 'File contains an embedded archive (polyglot)';
    }
  }
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  if (ACTIVE_CONTENT.test(head)) return 'File contains active content (polyglot)';
  if (detected === 'application/pdf') {
    const text = new TextDecoder('latin1').decode(bytes);
    if (/\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(text)) {
      return 'PDF contains scripts, launch actions or embedded files';
    }
  }
  return null;
}

/** Image types we re-encode. */
export const REENCODED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Decoded pixel cap for images: blocks pixel-flood / decompression bombs. */
export const MAX_IMAGE_PIXELS = 40_000_000;

// Minimal structural type for the parts of sharp we use, so the module stays
// an optional runtime dependency (it ships with Next.js image optimisation).
export interface SharpLike {
  rotate(): SharpLike;
  jpeg(o?: object): SharpLike;
  png(o?: object): SharpLike;
  webp(o?: object): SharpLike;
  toBuffer(): Promise<Buffer>;
}
export type SharpFactory = (input: Uint8Array, options: { limitInputPixels: number; failOn?: string }) => SharpLike;

async function loadSharp(): Promise<SharpFactory> {
  const name = 'sharp';
  const mod = (await import(/* webpackIgnore: true */ name)) as { default?: SharpFactory } & SharpFactory;
  return (mod.default ?? mod) as SharpFactory;
}

/**
 * Re-encode an image. sharp drops all metadata (EXIF incl. GPS, XMP, ICC)
 * unless `withMetadata()` is called, and output contains only the decoded
 * pixels, so trailing payloads are discarded. `.rotate()` bakes the EXIF
 * orientation in before it is stripped. Throws if the image is corrupt or
 * exceeds MAX_IMAGE_PIXELS.
 */
export async function reencodeImage(
  bytes: Uint8Array,
  type: (typeof REENCODED_IMAGE_TYPES)[number],
  factory?: SharpFactory,
): Promise<Buffer> {
  const sharp = factory ?? (await loadSharp());
  const img = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' }).rotate();
  const out = type === 'image/jpeg' ? img.jpeg({ quality: 90 }) : type === 'image/png' ? img.png() : img.webp({ quality: 90 });
  return out.toBuffer();
}

export type UploadCheck =
  | { ok: true; type: string; body: Uint8Array }
  | { ok: false; status: number; error: string };

/**
 * Full content check for an upload: size, magic bytes vs declared type,
 * polyglots, zip bombs, then image re-encoding. Returns the bytes that should
 * actually be stored.
 */
export async function inspectUpload(
  bytes: Uint8Array,
  declaredType: string,
  factory?: SharpFactory,
): Promise<UploadCheck> {
  const limit = maxUploadBytes();
  if (bytes.byteLength > limit) {
    return { ok: false, status: 413, error: `File exceeds ${Math.round(limit / (1024 * 1024))}MB limit` };
  }
  const detected = sniffType(bytes);
  if (!detected || !allowedTypes().includes(detected)) {
    return { ok: false, status: 415, error: `File type ${detected || 'unknown'} not allowed` };
  }
  const declared = declaredType === 'application/x-zip-compressed' ? 'application/zip' : declaredType;
  if (declared && declared !== detected) {
    return { ok: false, status: 415, error: `Declared type ${declaredType} does not match content (${detected})` };
  }
  const polyglot = detectPolyglot(bytes, detected);
  if (polyglot) return { ok: false, status: 415, error: polyglot };

  if (detected === 'application/zip') {
    const zipError = inspectZip(bytes, limit);
    if (zipError) return { ok: false, status: 415, error: zipError };
  }

  if ((REENCODED_IMAGE_TYPES as readonly string[]).includes(detected)) {
    try {
      const body = await reencodeImage(bytes, detected as (typeof REENCODED_IMAGE_TYPES)[number], factory);
      return { ok: true, type: detected, body: new Uint8Array(body) };
    } catch {
      // Fail closed: corrupt, oversized-in-pixels, or sharp unavailable.
      return { ok: false, status: 415, error: 'Image could not be processed' };
    }
  }
  return { ok: true, type: detected, body: bytes };
}
