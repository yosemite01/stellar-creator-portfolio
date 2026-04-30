"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";

type UploadedResponse = {
  key: string;
  url: string;
  signedUrl: string;
  size: number;
  contentType?: string;
  versionId?: string;
};

type UploadState = {
  id: string;
  name: string;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
  response?: UploadedResponse;
};

type FileUploadProps = {
  uploadPath?: string;
  maxSizeMB?: number;
  allowedTypes?: string[];
  onUploaded?: (file: UploadedResponse) => void;
};

const DEFAULT_ALLOWED = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
];

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.size <= 1.5 * 1024 * 1024) return file;

  const bitmap = await createImageBitmap(file);
  const MAX_DIMENSION = 1920;
  const ratio = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);

  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.82)
  );
  if (!blob) return file;

  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

function validateFile(file: File, maxSizeMB: number, types: string[]) {
  if (file.size > maxSizeMB * 1024 * 1024) {
    return `File ${file.name} exceeds ${maxSizeMB}MB limit`;
  }
  if (!types.includes(file.type)) {
    return `File type ${file.type || "unknown"} not allowed`;
  }
  return null;
}

export function FileUpload({
  uploadPath = "uploads",
  maxSizeMB = 100,
  allowedTypes = DEFAULT_ALLOWED,
  onUploaded,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [dragging, setDragging] = useState(false);

  const acceptAttr = useMemo(() => allowedTypes.join(","), [allowedTypes]);

  const startUpload = useCallback(
    async (file: File) => {
      const id = crypto.randomUUID();
      setUploads((prev) => [...prev, { id, name: file.name, status: "pending", progress: 0 }]);

      const compressed = await compressImage(file);
      const form = new FormData();
      form.append("file", compressed);
      form.append("path", uploadPath);

      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/upload");
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const percent = Math.round((event.loaded / event.total) * 100);
        setUploads((prev) =>
          prev.map((u) => (u.id === id ? { ...u, progress: percent, status: "uploading" } : u))
        );
      };
      xhr.onreadystatechange = () => {
        if (xhr.readyState === XMLHttpRequest.DONE) {
          if (xhr.status >= 200 && xhr.status < 300) {
            const response: UploadedResponse = JSON.parse(xhr.responseText);
            setUploads((prev) =>
              prev.map((u) =>
                u.id === id ? { ...u, status: "done", progress: 100, response } : u
              )
            );
            onUploaded?.(response);
          } else {
            const error = xhr.responseText || "Upload failed";
            setUploads((prev) =>
              prev.map((u) => (u.id === id ? { ...u, status: "error", error } : u))
            );
          }
        }
      };
      xhr.onerror = () => {
        setUploads((prev) =>
          prev.map((u) => (u.id === id ? { ...u, status: "error", error: "Network error" } : u))
        );
      };

      xhr.send(form);
    },
    [uploadPath, onUploaded]
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      for (const file of arr) {
        const validation = validateFile(file, maxSizeMB, allowedTypes);
        if (validation) {
          setUploads((prev) => [
            ...prev,
            { id: crypto.randomUUID(), name: file.name, status: "error", progress: 0, error: validation },
          ]);
          continue;
        }
        await startUpload(file);
      }
    },
    [allowedTypes, maxSizeMB, startUpload]
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      if (event.dataTransfer?.files?.length) {
        void handleFiles(event.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  return (
    <div className="space-y-4">
      <div
        className={`border-2 border-dashed rounded-lg p-6 transition ${dragging ? "border-blue-500 bg-blue-50" : "border-gray-300"}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="flex flex-col items-center justify-center space-y-2 text-center">
          <p className="text-sm text-gray-700">Drag & drop files or</p>
          <button
            type="button"
            className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
            onClick={() => inputRef.current?.click()}
          >
            Browse
          </button>
          <p className="text-xs text-gray-500">
            Allowed: {allowedTypes.join(", ")} • Max {maxSizeMB}MB
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          multiple
          accept={acceptAttr}
          onChange={(e) => e.target.files && void handleFiles(e.target.files)}
        />
      </div>

      <div className="space-y-2">
        {uploads.map((upload) => (
          <div
            key={upload.id}
            className="flex items-center justify-between rounded border px-3 py-2 bg-white"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{upload.name}</p>
              <p className="text-xs text-gray-500">{upload.status}</p>
              <div className="h-2 bg-gray-100 rounded mt-1">
                <div
                  className={`h-2 rounded ${upload.status === "error" ? "bg-red-500" : "bg-blue-600"}`}
                  style={{ width: `${upload.progress}%` }}
                />
              </div>
              {upload.error ? (
                <p className="text-xs text-red-600 mt-1">{upload.error}</p>
              ) : null}
            </div>
            {upload.response ? (
              <a
                href={upload.response.signedUrl}
                className="text-blue-600 text-xs ml-4"
                target="_blank"
                rel="noreferrer"
              >
                open
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export default FileUpload;
