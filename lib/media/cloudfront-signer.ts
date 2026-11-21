import crypto from 'node:crypto';
import { getDownloadUrl } from '@/lib/storage/s3';

/**
 * AWS CloudFront Signed URL implementation (Issue #1770).
 *
 * Implements CloudFront's exact URL-safe Base64 encoding and RSA signature
 * format for both Canned Policies (single resource + expiry) and Custom
 * Policies (wildcard HLS directories, optional start time & IP CIDR restriction).
 * Falls back cleanly to private S3 presigned URLs when CloudFront is unconfigured.
 */

const DEFAULT_CLOUDFRONT_TTL_SECONDS = 900;

/** CloudFront replaces `+`, `=`, `/` in base64 strings so they are query-safe. */
export function toCloudFrontBase64(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/=/g, '_')
    .replace(/\//g, '~');
}

export function fromCloudFrontBase64(encoded: string): Buffer {
  const standard = encoded
    .replace(/-/g, '+')
    .replace(/_/g, '=')
    .replace(/~/g, '/');
  return Buffer.from(standard, 'base64');
}

function normalizePrivateKey(rawKey: string): string {
  return rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey;
}

export interface CloudFrontConfig {
  domain: string;
  keyPairId: string;
  privateKeyPem: string;
  ttlSeconds: number;
}

export function getCloudFrontConfig(): CloudFrontConfig | null {
  const domain = process.env.CLOUDFRONT_DOMAIN?.trim();
  const keyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID?.trim();
  const privateKeyRaw = process.env.CLOUDFRONT_PRIVATE_KEY?.trim();

  if (!domain || !keyPairId || !privateKeyRaw) {
    return null;
  }

  const parsedTtl = Number(process.env.CLOUDFRONT_URL_TTL_SECONDS);
  const ttlSeconds =
    Number.isFinite(parsedTtl) && parsedTtl > 0
      ? parsedTtl
      : DEFAULT_CLOUDFRONT_TTL_SECONDS;

  return {
    domain: domain.replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    keyPairId,
    privateKeyPem: normalizePrivateKey(privateKeyRaw),
    ttlSeconds,
  };
}

export function isCloudFrontConfigured(): boolean {
  return getCloudFrontConfig() !== null;
}

export interface SignCloudFrontUrlOptions {
  url: string;
  keyPairId: string;
  privateKeyPem: string;
  /** Unix epoch timestamp in seconds or Date when the URL expires. */
  expiresAt: number | Date;
}

function toEpochSeconds(value: number | Date): number {
  return value instanceof Date ? Math.floor(value.getTime() / 1000) : Math.floor(value);
}

function appendQueryParams(url: string, params: Record<string, string>): string {
  const sep = url.includes('?') ? '&' : '?';
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return `${url}${sep}${query}`;
}

/**
 * Sign a single URL using a CloudFront Canned Policy.
 * CloudFront requires SHA1withRSA (`RSA-SHA1`) for URL signing policies.
 */
export function signCloudFrontUrl(options: SignCloudFrontUrlOptions): string {
  const expires = toEpochSeconds(options.expiresAt);
  const policyJson = JSON.stringify({
    Statement: [
      {
        Resource: options.url,
        Condition: {
          DateLessThan: { 'AWS:EpochTime': expires },
        },
      },
    ],
  });

  const signer = crypto.createSign('RSA-SHA1');
  signer.update(policyJson);
  const signature = toCloudFrontBase64(signer.sign(normalizePrivateKey(options.privateKeyPem)));

  return appendQueryParams(options.url, {
    Expires: String(expires),
    Signature: signature,
    'Key-Pair-Id': options.keyPairId,
  });
}

export interface SignCloudFrontCustomPolicyOptions {
  /** Concrete playback URL returned to the client. */
  url: string;
  /** Resource pattern authorized by the policy (e.g. `https://cdn.example.com/media/abc/*`). */
  resourcePattern?: string;
  keyPairId: string;
  privateKeyPem: string;
  expiresAt: number | Date;
  notBefore?: number | Date;
  ipCidr?: string;
}

/**
 * Sign a URL with a CloudFront Custom Policy (supports wildcard HLS paths,
 * start time, and optional IP CIDR restriction).
 */
export function signCloudFrontCustomPolicy(options: SignCloudFrontCustomPolicyOptions): string {
  const expires = toEpochSeconds(options.expiresAt);
  const condition: Record<string, unknown> = {
    DateLessThan: { 'AWS:EpochTime': expires },
  };

  if (options.notBefore !== undefined) {
    condition.DateGreaterThan = { 'AWS:EpochTime': toEpochSeconds(options.notBefore) };
  }
  if (options.ipCidr) {
    condition.IpAddress = { 'AWS:SourceIp': options.ipCidr };
  }

  const policyJson = JSON.stringify({
    Statement: [
      {
        Resource: options.resourcePattern ?? options.url,
        Condition: condition,
      },
    ],
  });

  const encodedPolicy = toCloudFrontBase64(policyJson);
  const signer = crypto.createSign('RSA-SHA1');
  signer.update(policyJson);
  const signature = toCloudFrontBase64(signer.sign(normalizePrivateKey(options.privateKeyPem)));

  return appendQueryParams(options.url, {
    Policy: encodedPolicy,
    Signature: signature,
    'Key-Pair-Id': options.keyPairId,
  });
}

export interface VerifyCloudFrontResult {
  valid: boolean;
  reason?: string;
  keyPairId?: string;
  expiresAt?: number;
  resource?: string;
}

/**
 * Cryptographically verify a CloudFront signed URL (both canned and custom policies)
 * against the corresponding RSA public key and current clock.
 */
export function verifyCloudFrontSignedUrl(
  signedUrl: string,
  publicKeyPem: string,
  nowMs = Date.now(),
): VerifyCloudFrontResult {
  let parsed: URL;
  try {
    parsed = new URL(signedUrl);
  } catch {
    return { valid: false, reason: 'Invalid URL' };
  }

  const signatureParam = parsed.searchParams.get('Signature');
  const keyPairId = parsed.searchParams.get('Key-Pair-Id');
  const policyParam = parsed.searchParams.get('Policy');
  const expiresParam = parsed.searchParams.get('Expires');

  if (!signatureParam || !keyPairId) {
    return { valid: false, reason: 'Missing CloudFront signature parameters' };
  }

  // Strip CloudFront auth query params to recover the base resource URL
  const baseUrl = new URL(parsed.toString());
  baseUrl.searchParams.delete('Expires');
  baseUrl.searchParams.delete('Policy');
  baseUrl.searchParams.delete('Signature');
  baseUrl.searchParams.delete('Key-Pair-Id');
  const cleanUrl = baseUrl.toString();

  let policyJson: string;
  let expiresAt: number;
  let resource: string;

  if (policyParam) {
    try {
      policyJson = fromCloudFrontBase64(policyParam).toString('utf8');
      const policyObj = JSON.parse(policyJson) as {
        Statement?: Array<{
          Resource?: string;
          Condition?: {
            DateLessThan?: { 'AWS:EpochTime'?: number };
            DateGreaterThan?: { 'AWS:EpochTime'?: number };
          };
        }>;
      };
      const stmt = policyObj.Statement?.[0];
      resource = stmt?.Resource ?? '';
      expiresAt = Number(stmt?.Condition?.DateLessThan?.['AWS:EpochTime']);
      const notBefore = stmt?.Condition?.DateGreaterThan?.['AWS:EpochTime'];

      if (!resource || !Number.isFinite(expiresAt)) {
        return { valid: false, reason: 'Malformed custom policy' };
      }

      // Check wildcard resource match against the requested URL
      const escaped = resource
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      if (!new RegExp(`^${escaped}$`).test(cleanUrl)) {
        return { valid: false, reason: 'URL does not match policy resource' };
      }

      const nowSeconds = Math.floor(nowMs / 1000);
      if (notBefore !== undefined && nowSeconds < notBefore) {
        return { valid: false, reason: 'URL not yet valid' };
      }
    } catch {
      return { valid: false, reason: 'Failed to decode custom policy' };
    }
  } else if (expiresParam) {
    expiresAt = Number(expiresParam);
    if (!Number.isFinite(expiresAt)) {
      return { valid: false, reason: 'Invalid Expires timestamp' };
    }
    resource = cleanUrl;
    policyJson = JSON.stringify({
      Statement: [
        {
          Resource: cleanUrl,
          Condition: { DateLessThan: { 'AWS:EpochTime': expiresAt } },
        },
      ],
    });
  } else {
    return { valid: false, reason: 'Missing Expires or Policy parameter' };
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  if (nowSeconds >= expiresAt) {
    return { valid: false, reason: 'Signed URL has expired', keyPairId, expiresAt, resource };
  }

  try {
    const verifier = crypto.createVerify('RSA-SHA1');
    verifier.update(policyJson);
    const sigBuf = fromCloudFrontBase64(signatureParam);
    const verified = verifier.verify(publicKeyPem, sigBuf);
    if (!verified) {
      return { valid: false, reason: 'Invalid RSA signature', keyPairId, expiresAt, resource };
    }
    return { valid: true, keyPairId, expiresAt, resource };
  } catch {
    return { valid: false, reason: 'Signature verification error' };
  }
}

export interface MediaDeliveryUrlOptions {
  ttlSeconds?: number;
  /** Optional wildcard directory prefix for custom-policy CloudFront signing. */
  wildcardPrefix?: string;
  ipCidr?: string;
}

/**
 * Produce a short-lived signed delivery URL for a media object key.
 * Uses AWS CloudFront Signed URLs when configured; falls back to S3 presigned URLs.
 */
export async function getMediaDeliveryUrl(
  key: string,
  options: MediaDeliveryUrlOptions = {},
): Promise<{ url: string; expiresAt: string; provider: 'cloudfront' | 's3' }> {
  const cf = getCloudFrontConfig();
  const normalizedKey = key.replace(/^\/+/, '');

  if (cf) {
    const ttl = options.ttlSeconds ?? cf.ttlSeconds;
    const expiresEpoch = Math.floor(Date.now() / 1000) + ttl;
    const url = `https://${cf.domain}/${normalizedKey}`;

    const signed = options.wildcardPrefix
      ? signCloudFrontCustomPolicy({
          url,
          resourcePattern: `https://${cf.domain}/${options.wildcardPrefix.replace(/^\/+/, '').replace(/\/+$/, '')}/*`,
          keyPairId: cf.keyPairId,
          privateKeyPem: cf.privateKeyPem,
          expiresAt: expiresEpoch,
          ipCidr: options.ipCidr,
        })
      : signCloudFrontUrl({
          url,
          keyPairId: cf.keyPairId,
          privateKeyPem: cf.privateKeyPem,
          expiresAt: expiresEpoch,
        });

    return {
      url: signed,
      expiresAt: new Date(expiresEpoch * 1000).toISOString(),
      provider: 'cloudfront',
    };
  }

  const s3Url = await getDownloadUrl(normalizedKey);
  const ttl = Number(process.env.SIGNED_URL_TTL_SECONDS) || DEFAULT_CLOUDFRONT_TTL_SECONDS;
  return {
    url: s3Url,
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    provider: 's3',
  };
}
