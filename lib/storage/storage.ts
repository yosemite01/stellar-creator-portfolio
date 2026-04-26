import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";

export type StorageProvider = "s3" | "r2";

export type UploadParams = {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
};

export type UploadedObject = {
  key: string;
  url: string;
  signedUrl: string;
  versionId?: string;
};

export type ListedObject = {
  key: string;
  size: number;
  lastModified?: Date;
  signedUrl: string;
};

const requiredEnv = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];

function assertEnv() {
  const missing = requiredEnv.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
}

let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) return client;
  assertEnv();

  const provider = (process.env.STORAGE_PROVIDER as StorageProvider) || "s3";

  client = new S3Client({
    region: process.env.S3_REGION || "us-east-1",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: provider === "r2",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });

  return client;
}

export async function uploadObject(params: UploadParams): Promise<UploadedObject> {
  const bucket = process.env.S3_BUCKET!;
  const s3 = getClient();

  const put = new PutObjectCommand({
    Bucket: bucket,
    Key: params.key,
    Body: params.body,
    ContentType: params.contentType,
    CacheControl: params.cacheControl,
    Metadata: params.metadata,
  });

  const result = await s3.send(put);

  const signedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: params.key,
    }),
    { expiresIn: Number(process.env.SIGNED_URL_TTL_SECONDS || 900) }
  );

  const publicBase = process.env.S3_PUBLIC_BASE_URL;
  const url = publicBase ? `${publicBase.replace(/\/$/, "")}/${params.key}` : signedUrl;

  return {
    key: params.key,
    url,
    signedUrl,
    versionId: result.VersionId,
  };
}

export async function getDownloadUrl(key: string, expiresInSeconds = 900): Promise<string> {
  const s3 = getClient();
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: key,
    }),
    { expiresIn: expiresInSeconds }
  );
}

export async function listFiles(prefix = ""): Promise<ListedObject[]> {
  const s3 = getClient();
  const bucket = process.env.S3_BUCKET!;

  const list = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
    })
  );

  const objects =
    list.Contents?.map((item) => ({
      key: item.Key!,
      size: item.Size || 0,
      lastModified: item.LastModified,
    })) || [];

  const withUrls = await Promise.all(
    objects.map(async (obj) => ({
      ...obj,
      signedUrl: await getDownloadUrl(obj.key),
    }))
  );

  return withUrls;
}

export async function deleteFile(key: string) {
  const s3 = getClient();
  await s3.send(
    new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: key,
    })
  );
}

export function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.once("end", () => resolve(Buffer.concat(chunks)));
    stream.once("error", reject);
  });
}
