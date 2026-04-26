"use client";

import { useEffect, useState } from "react";
import FileUpload from "@/components/file-upload";

type FileItem = {
  key: string;
  size: number;
  lastModified?: string;
  signedUrl: string;
};

export default function FilesPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/upload?prefix=uploads", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch files");
      const data = await res.json();
      setFiles(data.files || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchFiles();
  }, []);

  return (
    <div className="max-w-5xl mx-auto py-8 space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Project Files</h1>
        <p className="text-sm text-gray-600">
          Upload deliverables, design assets, and backups. Files are stored securely in cloud storage
          and delivered via signed URLs.
        </p>
      </header>

      <FileUpload
        uploadPath="uploads"
        maxSizeMB={Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_SIZE_MB || 100)}
        onUploaded={() => fetchFiles()}
      />

      <section className="rounded-lg border bg-white">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <p className="font-medium">File Manager</p>
            <p className="text-xs text-gray-500">Versioned uploads with signed access links.</p>
          </div>
          <button
            onClick={() => fetchFiles()}
            className="text-sm px-3 py-1 rounded bg-slate-900 text-white hover:bg-slate-800"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <p className="p-4 text-sm">Loading...</p>
        ) : error ? (
          <p className="p-4 text-sm text-red-600">{error}</p>
        ) : files.length === 0 ? (
          <p className="p-4 text-sm text-gray-600">No files uploaded yet.</p>
        ) : (
          <div className="divide-y">
            {files.map((file) => (
              <div key={file.key} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{file.key}</p>
                  <p className="text-xs text-gray-500">
                    {file.size ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "unknown"} •{" "}
                    {file.lastModified
                      ? new Date(file.lastModified).toLocaleString()
                      : "last modified unknown"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <a
                    href={file.signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 text-sm"
                  >
                    View
                  </a>
                  <button
                    className="text-sm text-red-600"
                    onClick={async () => {
                      await fetch(`/api/upload?key=${encodeURIComponent(file.key)}`, {
                        method: "DELETE",
                      });
                      await fetchFiles();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
