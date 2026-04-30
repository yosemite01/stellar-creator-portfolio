import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDownloadUrl, listFiles, uploadObject } from "../lib/storage";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

vi.mock("@aws-sdk/client-s3", () => {
  class MockClient {
    sends: any[] = [];
    async send(command: any) {
      this.sends.push(command);
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [{ Key: "uploads/test.txt", Size: 12, LastModified: new Date() }] };
      }
      return { VersionId: "123" };
    }
  }
  return {
    S3Client: MockClient,
    PutObjectCommand: class PutObjectCommand {
      constructor(public input: any) {}
    },
    ListObjectsV2Command: class ListObjectsV2Command {
      constructor(public input: any) {}
    },
    GetObjectCommand: class GetObjectCommand {
      constructor(public input: any) {}
    },
    DeleteObjectCommand: class DeleteObjectCommand {
      constructor(public input: any) {}
    },
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://signed.url/object"),
}));

beforeEach(() => {
  vi.stubEnv("S3_BUCKET", "test-bucket");
  vi.stubEnv("S3_ACCESS_KEY_ID", "key");
  vi.stubEnv("S3_SECRET_ACCESS_KEY", "secret");
  vi.stubEnv("SIGNED_URL_TTL_SECONDS", "60");
});

describe("storage", () => {
  it("uploads and returns signed url", async () => {
    const res = await uploadObject({
      key: "uploads/test.txt",
      body: Buffer.from("hello"),
      contentType: "text/plain",
    });
    expect(res.key).toBe("uploads/test.txt");
    expect(getSignedUrl).toHaveBeenCalled();
  });

  it("lists files with signed urls", async () => {
    const items = await listFiles("uploads");
    expect(items[0].signedUrl).toContain("https://");
    expect(items[0].key).toBe("uploads/test.txt");
  });

  it("creates download url for key", async () => {
    const url = await getDownloadUrl("uploads/test.txt");
    expect(url).toContain("https://");
  });
});
