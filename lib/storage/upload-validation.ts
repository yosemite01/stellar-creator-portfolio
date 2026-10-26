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
