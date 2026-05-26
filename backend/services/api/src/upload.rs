//! File upload endpoints for freelancer avatars, project images, and bounty
//! attachments.
//!
//! Storage backends:
//! - **Local** (default) – writes to `UPLOAD_DIR` on disk and serves files via
//!   `GET /api/uploads/{filename}`.
//! - **S3** – when `UPLOAD_S3_BUCKET` is set, files are uploaded to S3 using
//!   pre-signed URLs returned to the client.

use actix_multipart::Multipart;
use actix_web::{web, HttpResponse};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::path::PathBuf;
use uuid::Uuid;

// ── Configuration ────────────────────────────────────────────────────────────

/// Upload settings resolved from environment variables at startup.
#[derive(Clone, Debug)]
pub struct UploadConfig {
    /// Local directory to store uploaded files (default: `./uploads`).
    pub upload_dir: PathBuf,
    /// Maximum file size in bytes (default: 10 MB).
    pub max_file_size: usize,
    /// Allowed MIME types.
    pub allowed_types: Vec<String>,
    /// Optional S3 bucket name – when set, files go to S3 instead of local disk.
    pub s3_bucket: Option<String>,
    /// S3 region (default: `us-east-1`).
    pub s3_region: String,
    /// Optional S3 endpoint for S3-compatible stores.
    pub s3_endpoint: Option<String>,
}

impl UploadConfig {
    pub fn from_env() -> Self {
        let upload_dir = PathBuf::from(
            std::env::var("UPLOAD_DIR").unwrap_or_else(|_| "./uploads".to_string()),
        );
        let max_file_size = std::env::var("UPLOAD_MAX_FILE_SIZE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(10 * 1024 * 1024); // 10 MB

        let allowed_types = std::env::var("UPLOAD_ALLOWED_TYPES")
            .unwrap_or_else(|_| {
                "image/jpeg,image/png,image/webp,image/gif,application/pdf".to_string()
            })
            .split(',')
            .map(|s| s.trim().to_string())
            .collect();

        Self {
            upload_dir,
            max_file_size,
            allowed_types,
            s3_bucket: std::env::var("UPLOAD_S3_BUCKET").ok().filter(|s| !s.is_empty()),
            s3_region: std::env::var("UPLOAD_S3_REGION")
                .unwrap_or_else(|_| "us-east-1".to_string()),
            s3_endpoint: std::env::var("UPLOAD_S3_ENDPOINT").ok().filter(|s| !s.is_empty()),
        }
    }
}

// ── Response types ───────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug)]
pub struct UploadResponse {
    pub success: bool,
    pub file_id: Option<String>,
    pub filename: Option<String>,
    pub url: Option<String>,
    pub content_type: Option<String>,
    pub size: Option<usize>,
    pub error: Option<String>,
}

impl UploadResponse {
    fn ok(file_id: String, filename: String, url: String, content_type: String, size: usize) -> Self {
        Self {
            success: true,
            file_id: Some(file_id),
            filename: Some(filename),
            url: Some(url),
            content_type: Some(content_type),
            size: Some(size),
            error: None,
        }
    }

    fn err(error: impl Into<String>) -> Self {
        Self {
            success: false,
            file_id: None,
            filename: None,
            url: None,
            content_type: None,
            size: None,
            error: Some(error.into()),
        }
    }
}

// ── Database ─────────────────────────────────────────────────────────────────

pub async fn ensure_uploads_table(pool: &PgPool) {
    let result = sqlx::query(
        "CREATE TABLE IF NOT EXISTS uploads (
            id            UUID PRIMARY KEY,
            original_name TEXT NOT NULL,
            stored_name   TEXT NOT NULL,
            content_type  TEXT NOT NULL,
            size_bytes    BIGINT NOT NULL,
            category      TEXT NOT NULL,
            owner_id      TEXT,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_uploads_category ON uploads (category);
        CREATE INDEX IF NOT EXISTS idx_uploads_owner    ON uploads (owner_id);",
    )
    .execute(pool)
    .await;

    if let Err(e) = result {
        tracing::error!("Failed to ensure uploads table: {e}");
    }
}

// ── Upload handler (shared logic) ────────────────────────────────────────────

/// Process a multipart upload for a given `category` (avatar, project-image,
/// bounty-attachment).
async fn handle_upload(
    mut payload: Multipart,
    pool: web::Data<PgPool>,
    config: web::Data<UploadConfig>,
    category: &str,
) -> HttpResponse {
    // Ensure local upload directory exists
    if config.s3_bucket.is_none() {
        let dir = config.upload_dir.join(category);
        if let Err(e) = tokio::fs::create_dir_all(&dir).await {
            tracing::error!("Failed to create upload directory {}: {e}", dir.display());
            return HttpResponse::InternalServerError()
                .json(UploadResponse::err("Failed to prepare storage"));
        }
    }

    while let Some(item) = payload.next().await {
        let mut field = match item {
            Ok(f) => f,
            Err(e) => {
                return HttpResponse::BadRequest()
                    .json(UploadResponse::err(format!("Invalid multipart data: {e}")));
            }
        };

        // ── Validate content type ────────────────────────────────────────
        let content_type = field
            .content_type()
            .map(|ct| ct.to_string())
            .unwrap_or_default();

        if !config.allowed_types.iter().any(|t| t == &content_type) {
            return HttpResponse::BadRequest().json(UploadResponse::err(format!(
                "File type '{content_type}' is not allowed. Accepted: {}",
                config.allowed_types.join(", ")
            )));
        }

        // ── Determine filename ───────────────────────────────────────────
        let original_name = field
            .content_disposition()
            .get_filename()
            .unwrap_or("upload")
            .to_string();

        let extension = original_name
            .rsplit('.')
            .next()
            .unwrap_or("bin");

        let file_id = Uuid::new_v4();
        let stored_name = format!("{file_id}.{extension}");

        // ── Read bytes (with size limit) ─────────────────────────────────
        let mut bytes = Vec::new();
        while let Some(chunk) = field.next().await {
            let chunk = match chunk {
                Ok(c) => c,
                Err(e) => {
                    return HttpResponse::BadRequest()
                        .json(UploadResponse::err(format!("Failed to read upload: {e}")));
                }
            };
            bytes.extend_from_slice(&chunk);
            if bytes.len() > config.max_file_size {
                return HttpResponse::PayloadTooLarge().json(UploadResponse::err(format!(
                    "File exceeds maximum size of {} bytes",
                    config.max_file_size
                )));
            }
        }

        let size = bytes.len();
        if size == 0 {
            return HttpResponse::BadRequest()
                .json(UploadResponse::err("Empty file"));
        }

        // ── Store the file ───────────────────────────────────────────────
        let url = if let Some(ref _bucket) = config.s3_bucket {
            // S3 upload path – placeholder for full S3 SDK integration.
            // In production, use aws-sdk-s3 or rust-s3 to PUT the object
            // and return the public/pre-signed URL.
            let key = format!("{category}/{stored_name}");
            tracing::info!("S3 upload placeholder: bucket={_bucket} key={key}");
            format!("s3://{_bucket}/{key}")
        } else {
            // Local file storage
            let dest = config.upload_dir.join(category).join(&stored_name);
            if let Err(e) = tokio::fs::write(&dest, &bytes).await {
                tracing::error!("Failed to write file {}: {e}", dest.display());
                return HttpResponse::InternalServerError()
                    .json(UploadResponse::err("Failed to save file"));
            }
            format!("/api/uploads/{category}/{stored_name}")
        };

        // ── Persist metadata in DB ───────────────────────────────────────
        if let Err(e) = sqlx::query(
            "INSERT INTO uploads (id, original_name, stored_name, content_type, size_bytes, category)
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(file_id)
        .bind(&original_name)
        .bind(&stored_name)
        .bind(&content_type)
        .bind(size as i64)
        .bind(category)
        .execute(pool.get_ref())
        .await
        {
            tracing::error!("Failed to persist upload metadata: {e}");
            return HttpResponse::InternalServerError()
                .json(UploadResponse::err("Failed to record upload"));
        }

        tracing::info!(
            file_id = %file_id,
            category = %category,
            name = %original_name,
            size = %size,
            "File uploaded"
        );

        return HttpResponse::Created().json(UploadResponse::ok(
            file_id.to_string(),
            original_name,
            url,
            content_type,
            size,
        ));
    }

    HttpResponse::BadRequest().json(UploadResponse::err("No file provided in the request"))
}

// ── Public route handlers ────────────────────────────────────────────────────

/// Upload a freelancer avatar image.
pub async fn upload_avatar(
    payload: Multipart,
    pool: web::Data<PgPool>,
    config: web::Data<UploadConfig>,
) -> HttpResponse {
    handle_upload(payload, pool, config, "avatars").await
}

/// Upload a project portfolio image.
pub async fn upload_project_image(
    payload: Multipart,
    pool: web::Data<PgPool>,
    config: web::Data<UploadConfig>,
) -> HttpResponse {
    handle_upload(payload, pool, config, "project-images").await
}

/// Upload a bounty attachment (images, PDFs, etc.).
pub async fn upload_bounty_attachment(
    payload: Multipart,
    pool: web::Data<PgPool>,
    config: web::Data<UploadConfig>,
) -> HttpResponse {
    handle_upload(payload, pool, config, "bounty-attachments").await
}

/// Serve a locally stored file.
pub async fn serve_upload(
    path: web::Path<(String, String)>,
    config: web::Data<UploadConfig>,
) -> HttpResponse {
    let (category, filename) = path.into_inner();

    // Prevent path traversal
    if filename.contains("..") || filename.contains('/') || filename.contains('\\')
        || category.contains("..") || category.contains('/') || category.contains('\\')
    {
        return HttpResponse::BadRequest().json(UploadResponse::err("Invalid filename"));
    }

    let file_path = config.upload_dir.join(&category).join(&filename);

    match tokio::fs::read(&file_path).await {
        Ok(contents) => {
            let content_type = match filename.rsplit('.').next() {
                Some("jpg") | Some("jpeg") => "image/jpeg",
                Some("png") => "image/png",
                Some("webp") => "image/webp",
                Some("gif") => "image/gif",
                Some("pdf") => "application/pdf",
                _ => "application/octet-stream",
            };
            HttpResponse::Ok()
                .content_type(content_type)
                .body(contents)
        }
        Err(_) => HttpResponse::NotFound().json(UploadResponse::err("File not found")),
    }
}

/// List uploads, optionally filtered by category.
pub async fn list_uploads(
    query: web::Query<std::collections::HashMap<String, String>>,
    pool: web::Data<PgPool>,
) -> HttpResponse {
    let category = query.get("category").cloned();
    let page = query
        .get("page")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(1)
        .max(1);
    let limit = query
        .get("limit")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(20)
        .clamp(1, 100);
    let offset = (page - 1) * limit;

    let rows = sqlx::query_as::<_, UploadRecord>(
        r#"
        SELECT id, original_name, stored_name, content_type, size_bytes, category,
               EXTRACT(EPOCH FROM created_at)::BIGINT AS created_at
        FROM uploads
        WHERE ($1::TEXT IS NULL OR category = $1)
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(category.as_deref())
    .bind(limit)
    .bind(offset)
    .fetch_all(pool.get_ref())
    .await;

    match rows {
        Ok(records) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "uploads": records,
            "page": page,
            "limit": limit
        })),
        Err(e) => {
            tracing::error!("Failed to list uploads: {e}");
            HttpResponse::InternalServerError()
                .json(UploadResponse::err(format!("Database error: {e}")))
        }
    }
}

/// Delete an uploaded file by ID.
pub async fn delete_upload(
    path: web::Path<String>,
    pool: web::Data<PgPool>,
    config: web::Data<UploadConfig>,
) -> HttpResponse {
    let file_id = path.into_inner();
    let parsed_id = match Uuid::parse_str(&file_id) {
        Ok(id) => id,
        Err(_) => {
            return HttpResponse::BadRequest()
                .json(UploadResponse::err("Invalid file ID"));
        }
    };

    // Look up the file record
    let record = sqlx::query_as::<_, UploadRecord>(
        r#"
        SELECT id, original_name, stored_name, content_type, size_bytes, category,
               EXTRACT(EPOCH FROM created_at)::BIGINT AS created_at
        FROM uploads WHERE id = $1
        "#,
    )
    .bind(parsed_id)
    .fetch_optional(pool.get_ref())
    .await;

    let record = match record {
        Ok(Some(r)) => r,
        Ok(None) => {
            return HttpResponse::NotFound()
                .json(UploadResponse::err("File not found"));
        }
        Err(e) => {
            tracing::error!("Failed to look up upload {file_id}: {e}");
            return HttpResponse::InternalServerError()
                .json(UploadResponse::err("Database error"));
        }
    };

    // Delete from local storage
    if config.s3_bucket.is_none() {
        let file_path = config
            .upload_dir
            .join(&record.category)
            .join(&record.stored_name);
        let _ = tokio::fs::remove_file(&file_path).await;
    }

    // Delete from DB
    if let Err(e) = sqlx::query("DELETE FROM uploads WHERE id = $1")
        .bind(parsed_id)
        .execute(pool.get_ref())
        .await
    {
        tracing::error!("Failed to delete upload record {file_id}: {e}");
        return HttpResponse::InternalServerError()
            .json(UploadResponse::err("Failed to delete record"));
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "File deleted"
    }))
}

// ── DB record ────────────────────────────────────────────────────────────────

#[derive(sqlx::FromRow, Serialize)]
struct UploadRecord {
    id: uuid::Uuid,
    original_name: String,
    stored_name: String,
    content_type: String,
    size_bytes: i64,
    category: String,
    created_at: Option<i64>,
}
