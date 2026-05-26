import { describe, expect, it, vi } from "vitest";
import { allowedTypes, slugify, validateFile } from "../app/api/upload/route";

const makeStubFile = (name: string, sizeBytes: number, type: string) =>
  ({ name, size: sizeBytes, type } as unknown as File);

describe("slugify", () => {
  it("normalizes filenames", () => {
    expect(slugify("My File (v1).png")).toBe("my-file-v1.png");
  });
});

describe("allowedTypes", () => {
  it("falls back to default when env not set", () => {
    expect(allowedTypes()).toContain("image/png");
  });

  it("uses env types when provided", () => {
    vi.stubEnv("ALLOWED_FILE_TYPES", "text/plain");
    expect(allowedTypes()).toEqual(["text/plain"]);
    vi.unstubAllEnvs();
  });
});

describe("validateFile", () => {
  it("rejects oversize files", async () => {
    const file = makeStubFile("big.pdf", 200 * 1024 * 1024, "application/pdf");
    await expect(validateFile(file)).resolves.toMatch(/exceeds/);
  });

  it("accepts allowed types and size", async () => {
    const file = makeStubFile("ok.png", 1024, "image/png");
    await expect(validateFile(file)).resolves.toBeNull();
  });
});
