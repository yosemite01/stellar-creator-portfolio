use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AuthError;

pub async fn insert_refresh_token(
    pool: &PgPool,
    id: Uuid,
    user_id: &str,
    token_hash: &[u8],
    family_id: Uuid,
    expires_at: DateTime<Utc>,
) -> Result<(), AuthError> {
    sqlx::query(
        r#"
        INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(id)
    .bind(user_id)
    .bind(token_hash)
    .bind(family_id)
    .bind(expires_at)
    .execute(pool)
    .await?;
    Ok(())
}

/// Atomically rotates a refresh token: deletes the old one and inserts a new one.
/// If the old token is not found (already used), this indicates token theft —
/// all tokens in the same family are revoked.
pub async fn rotate_refresh_token(
    pool: &PgPool,
    old_hash: &[u8],
    new_id: Uuid,
    new_hash: &[u8],
    expires_at: DateTime<Utc>,
) -> Result<(String, Uuid), AuthError> {
    let mut tx = pool.begin().await?;

    let row: Option<(String, Uuid)> = sqlx::query_as(
        r#"
        DELETE FROM refresh_tokens
        WHERE token_hash = $1 AND expires_at > NOW()
        RETURNING user_id, family_id
        "#,
    )
    .bind(old_hash)
    .fetch_optional(&mut *tx)
    .await?;

    let (user_id, family_id) = match row {
        Some(r) => r,
        None => {
            // Token not found — check if it was already consumed (reuse detection).
            // Look for any token in a family that matches this user via the hash
            // in the used_refresh_tokens audit table.
            let reused: Option<(String, Uuid)> = sqlx::query_as(
                r#"
                SELECT user_id, family_id FROM used_refresh_tokens
                WHERE token_hash = $1
                LIMIT 1
                "#,
            )
            .bind(old_hash)
            .fetch_optional(&mut *tx)
            .await
            .unwrap_or(None);

            if let Some((uid, fid)) = reused {
                tracing::warn!(
                    user_id = %uid,
                    family_id = %fid,
                    "Refresh token reuse detected — revoking all sessions for user"
                );
                // Revoke all tokens for this user
                let _ = sqlx::query("DELETE FROM refresh_tokens WHERE user_id = $1")
                    .bind(&uid)
                    .execute(&mut *tx)
                    .await;
                tx.commit().await?;
                return Err(AuthError::TokenReuseDetected);
            }

            return Err(AuthError::InvalidRefreshToken);
        }
    };

    // Record the consumed token in the audit table for reuse detection
    let _ = sqlx::query(
        r#"
        INSERT INTO used_refresh_tokens (token_hash, user_id, family_id, used_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (token_hash) DO NOTHING
        "#,
    )
    .bind(old_hash)
    .bind(&user_id)
    .bind(family_id)
    .execute(&mut *tx)
    .await;

    sqlx::query(
        r#"
        INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(new_id)
    .bind(&user_id)
    .bind(new_hash)
    .bind(family_id)
    .bind(expires_at)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok((user_id, family_id))
}

/// Revoke all refresh tokens for a given user (e.g., on logout or compromise).
pub async fn revoke_all_user_tokens(pool: &PgPool, user_id: &str) -> Result<u64, AuthError> {
    let result = sqlx::query("DELETE FROM refresh_tokens WHERE user_id = $1")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}
