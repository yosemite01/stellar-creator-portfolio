import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
import { serverConfig } from "@/lib/config";

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

let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) return client;

  const { provider, region, endpoint, accessKeyId, secretAccessKey } = serverConfig.storage;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("S3 credentials are not configured");
  }

  client = new S3Client({
    region,
    endpoint,
    forcePathStyle: provider === "r2",
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return client;
}

export async function uploadObject(params: UploadParams): Promise<UploadedObject> {
  const { bucket, signedUrlTtlSeconds, publicBaseUrl } = serverConfig.storage;
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
    { expiresIn: signedUrlTtlSeconds }
  );

  const url = publicBaseUrl ? `${publicBaseUrl.replace(/\/$/, "")}/${params.key}` : signedUrl;

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
      Bucket: serverConfig.storage.bucket,
      Key: key,
    }),
    { expiresIn: expiresInSeconds }
  );
}

export async function listFiles(prefix = ""): Promise<ListedObject[]> {
  const s3 = getClient();
  const bucket = serverConfig.storage.bucket;

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
      Bucket: serverConfig.storage.bucket,
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
