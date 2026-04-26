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

/// Deletes the matching refresh token row and inserts a new one with the same `family_id` (rotation).
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

    let (user_id, family_id) = row.ok_or(AuthError::InvalidRefreshToken)?;

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
