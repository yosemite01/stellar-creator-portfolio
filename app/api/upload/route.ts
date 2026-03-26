import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { deleteFile, getDownloadUrl, listFiles, uploadObject } from "@/lib/storage";

export const runtime = "nodejs";

const DEFAULT_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_SIZE_MB || 100);

export function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/-\./g, ".");
}

export function allowedTypes(): string[] {
  const envTypes = process.env.ALLOWED_FILE_TYPES;
  if (!envTypes) return DEFAULT_ALLOWED_TYPES;
  return envTypes.split(",").map((t) => t.trim());
}

async function maybeCompressImage(buffer: Buffer, mime: string): Promise<Buffer> {
  if (!mime.startsWith("image/")) return buffer;
  try {
    // Lazy-load sharp; falls back gracefully if unavailable at runtime.
    const sharp = (await import("sharp")).default;
    return await sharp(buffer).rotate().jpeg({ quality: 82 }).toBuffer();
  } catch {
    return buffer;
  }
}

export async function validateFile(file: File) {
  if (!file) return "File is required.";

  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return `File exceeds ${MAX_UPLOAD_MB}MB limit.`;
  }

  const mime = file.type || "application/octet-stream";
  if (!allowedTypes().includes(mime)) {
    return `Unsupported file type: ${mime}`;
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const userPrefix = (formData.get("path") as string) || "uploads";
    const owner = (formData.get("userId") as string) || "anonymous";

    const validationError = file ? await validateFile(file) : "File is required.";
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const buffer = await maybeCompressImage(Buffer.from(await file!.arrayBuffer()), file!.type);

    const versionStamp = new Date().toISOString().replace(/[:.]/g, "-");
    const key = `${userPrefix}/${owner}/${versionStamp}-${crypto.randomUUID()}-${slugify(file!.name)}`;

    const uploaded = await uploadObject({
      key,
      body: buffer,
      contentType: file!.type || "application/octet-stream",
      cacheControl: "public, max-age=31536000, immutable",
      metadata: {
        originalName: file!.name,
        owner,
        uploadedAt: new Date().toISOString(),
      },
    });

    return NextResponse.json(
      {
        key: uploaded.key,
        url: uploaded.url,
        signedUrl: uploaded.signedUrl,
        versionId: uploaded.versionId,
        size: buffer.length,
        contentType: file!.type,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Upload error", error);
    return NextResponse.json({ error: "Failed to upload file." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const prefix = searchParams.get("prefix") || "uploads";
    const files = await listFiles(prefix);
    return NextResponse.json({ files });
  } catch (error) {
    console.error("List files error", error);
    return NextResponse.json({ error: "Failed to list files." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
    await deleteFile(key);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Delete file error", error);
    return NextResponse.json({ error: "Failed to delete file." }, { status: 500 });
  }
}
