use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AuthError;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub password_hash: Option<String>,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub oauth_provider: Option<String>,
    pub oauth_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn find_user_by_email(pool: &PgPool, email: &str) -> Result<Option<User>, AuthError> {
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
        .bind(email)
        .fetch_optional(pool)
        .await?;
    Ok(user)
}

pub async fn find_user_by_oauth(
    pool: &PgPool,
    provider: &str,
    oauth_id: &str,
) -> Result<Option<User>, AuthError> {
    let user = sqlx::query_as::<_, User>(
        "SELECT * FROM users WHERE oauth_provider = $1 AND oauth_id = $2",
    )
    .bind(provider)
    .bind(oauth_id)
    .fetch_optional(pool)
    .await?;
    Ok(user)
}

pub async fn create_user(
    pool: &PgPool,
    email: &str,
    password_hash: Option<&str>,
    display_name: Option<&str>,
    avatar_url: Option<&str>,
    oauth_provider: Option<&str>,
    oauth_id: Option<&str>,
) -> Result<User, AuthError> {
    let user = sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (email, password_hash, display_name, avatar_url, oauth_provider, oauth_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        "#,
    )
    .bind(email)
    .bind(password_hash)
    .bind(display_name)
    .bind(avatar_url)
    .bind(oauth_provider)
    .bind(oauth_id)
    .fetch_one(pool)
    .await?;
    Ok(user)
}

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

pub async fn delete_refresh_token(pool: &PgPool, token_hash: &[u8]) -> Result<(), AuthError> {
    sqlx::query("DELETE FROM refresh_tokens WHERE token_hash = $1")
        .bind(token_hash)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_all_user_refresh_tokens(pool: &PgPool, user_id: &str) -> Result<(), AuthError> {
    sqlx::query("DELETE FROM refresh_tokens WHERE user_id = $1")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn find_user_by_id(pool: &PgPool, id: Uuid) -> Result<Option<User>, AuthError> {
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(user)
}

pub async fn update_user_profile(
    pool: &PgPool,
    id: Uuid,
    display_name: Option<&str>,
    avatar_url: Option<&str>,
) -> Result<User, AuthError> {
    let user = sqlx::query_as::<_, User>(
        r#"
        UPDATE users
        SET display_name = COALESCE($2, display_name),
            avatar_url = COALESCE($3, avatar_url)
        WHERE id = $1
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(display_name)
    .bind(avatar_url)
    .fetch_one(pool)
    .await?;
    Ok(user)
}

pub async fn update_user_password(
    pool: &PgPool,
    id: Uuid,
    password_hash: &str,
) -> Result<(), AuthError> {
    sqlx::query("UPDATE users SET password_hash = $2 WHERE id = $1")
        .bind(id)
        .bind(password_hash)
        .execute(pool)
        .await?;
    Ok(())
}
