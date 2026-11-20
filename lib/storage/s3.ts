import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * S3-compatible object storage.
 *
 * Objects are private; callers receive short-lived signed URLs rather than
 * public links. Configuration (read lazily so tests and builds don't need
 * credentials):
 *
 *   S3_BUCKET                      bucket name (required)
 *   S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
 *                                  credentials; fall back to AWS_ACCESS_KEY_ID /
 *                                  AWS_SECRET_ACCESS_KEY, then the SDK's default chain
 *   S3_REGION                      falls back to AWS_REGION, then us-east-1
 *   S3_ENDPOINT                    custom endpoint for S3-compatible stores (optional)
 *   SIGNED_URL_TTL_SECONDS         lifetime of signed URLs (default 900)
 */

const DEFAULT_SIGNED_URL_TTL_SECONDS = 900;

export interface StoredFile {
  key: string;
  size: number;
  lastModified: Date | undefined;
  signedUrl: string;
}

export interface UploadObjectInput {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
}

let client: S3Client | undefined;

function getClient(): S3Client {
  if (!client) {
    const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
    const endpoint = process.env.S3_ENDPOINT;

    client = new S3Client({
      region: process.env.S3_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });
  }
  return client;
}

function getBucket(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error('S3_BUCKET environment variable is not set');
  }
  return bucket;
}

function signedUrlTtl(): number {
  const ttl = Number(process.env.SIGNED_URL_TTL_SECONDS);
  return Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_SIGNED_URL_TTL_SECONDS;
}

/** Signed GET URL for an existing object. */
export async function getDownloadUrl(key: string): Promise<string> {
  return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: getBucket(), Key: key }), {
    expiresIn: signedUrlTtl(),
  });
}

/** Uploads an object and returns its key with a signed URL to read it back. */
export async function uploadObject({
  key,
  body,
  contentType,
}: UploadObjectInput): Promise<{ key: string; signedUrl: string }> {
  await getClient().send(
    new PutObjectCommand({ Bucket: getBucket(), Key: key, Body: body, ContentType: contentType }),
  );
  return { key, signedUrl: await getDownloadUrl(key) };
}

/** Lists objects under a prefix, each with a signed URL. */
export async function listFiles(prefix = ''): Promise<StoredFile[]> {
  const response = await getClient().send(
    new ListObjectsV2Command({ Bucket: getBucket(), Prefix: prefix }),
  );

  return Promise.all(
    (response.Contents ?? [])
      .filter((object): object is typeof object & { Key: string } => Boolean(object.Key))
      .map(async (object) => ({
        key: object.Key,
        size: object.Size ?? 0,
        lastModified: object.LastModified,
        signedUrl: await getDownloadUrl(object.Key),
      })),
  );
}

/** Deletes an object. Succeeds if the object is already absent. */
export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}
export interface UploadObjectInput {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
  metadata?: Record<string, string>;
}

/** Interface for stored object with metadata */
export interface StoredObject {
  key: string;
  body: Buffer;
  contentType?: string;
  metadata?: Record<string, string>;
}

/** Uploads an object and returns its key with a signed URL to read it back. */
export async function uploadObject({
  key,
  body,
  contentType,
  metadata,
}: UploadObjectInput): Promise<{ key: string; signedUrl: string }> {
  const params: any = {
    Bucket: getBucket(),
    Key: key,
    Body: body,
    ContentType: contentType,
  };

  if (metadata) {
    params.Metadata = metadata;
  }

  await getClient().send(new PutObjectCommand(params));
  return { key, signedUrl: await getDownloadUrl(key) };
}

/** Downloads an object with its metadata. */
export async function getObject(key: string): Promise<StoredObject> {
  const response = await getClient().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: key }),
  );

  const body = await response.Body?.transformToByteArray();
  if (!body) {
    throw new Error(`Failed to download object: ${key}`);
  }

  return {
    key,
    body,
    contentType: response.ContentType,
    metadata: response.Metadata,
  };
}

/** Lists objects under a prefix, each with a signed URL. */
export async function listFiles(prefix = ''): Promise<StoredFile[]> {
  const response = await getClient().send(
    new ListObjectsV2Command({ Bucket: getBucket(), Prefix: prefix }),
  );

  return Promise.all(
    (response.Contents ?? [])
      .filter((object): object is typeof object & { Key: string } => Boolean(object.Key))
      .map(async (object) => ({
        key: object.Key,
        size: object.Size ?? 0,
        lastModified: object.LastModified,
        signedUrl: await getDownloadUrl(object.Key),
      })),
  );
}

/** Deletes an object. Succeeds if the object is already absent. */
export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}
