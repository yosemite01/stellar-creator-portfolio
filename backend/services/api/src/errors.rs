//! Comprehensive error handling for Stellar API Service

use actix_web::{http::StatusCode, HttpResponse, ResponseError};
use serde::Serialize;
use std::fmt;

/// Custom API error type
#[derive(Debug)]
pub enum ApiError {
    // Database errors
    DatabaseError(String),
    NotFound(String),
    DuplicateEntry(String),
    
    // Validation errors
    ValidationError(String),
    InvalidInput(String),
    
    // Authentication errors
    Unauthorized(String),
    Forbidden(String),
    
    // Business logic errors
    InsufficientFunds,
    InvalidStatus(String),
    DeadlinePassed,
    
    // Internal errors
    InternalError(String),
    NotImplemented(String),
    
    // Request errors
    BadRequest(String),
    PayloadTooLarge,
    UnsupportedMediaType,
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ApiError::DatabaseError(msg) => write!(f, "Database error: {}", msg),
            ApiError::NotFound(msg) => write!(f, "Not found: {}", msg),
            ApiError::DuplicateEntry(msg) => write!(f, "Duplicate entry: {}", msg),
            ApiError::ValidationError(msg) => write!(f, "Validation error: {}", msg),
            ApiError::InvalidInput(msg) => write!(f, "Invalid input: {}", msg),
            ApiError::Unauthorized(msg) => write!(f, "Unauthorized: {}", msg),
            ApiError::Forbidden(msg) => write!(f, "Forbidden: {}", msg),
            ApiError::InsufficientFunds => write!(f, "Insufficient funds"),
            ApiError::InvalidStatus(msg) => write!(f, "Invalid status: {}", msg),
            ApiError::DeadlinePassed => write!(f, "Deadline has passed"),
            ApiError::InternalError(msg) => write!(f, "Internal error: {}", msg),
            ApiError::NotImplemented(feature) => write!(f, "Not implemented: {}", feature),
            ApiError::BadRequest(msg) => write!(f, "Bad request: {}", msg),
            ApiError::PayloadTooLarge => write!(f, "Payload too large"),
            ApiError::UnsupportedMediaType => write!(f, "Unsupported media type"),
        }
    }
}

impl std::error::Error for ApiError {}

#[derive(Serialize)]
struct ErrorResponse {
    success: bool,
    error: String,
    error_code: String,
    details: Option<serde_json::Value>,
}

impl ResponseError for ApiError {
    fn status_code(&self) -> StatusCode {
        match self {
            ApiError::DatabaseError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            ApiError::NotFound(_) => StatusCode::NOT_FOUND,
            ApiError::DuplicateEntry(_) => StatusCode::CONFLICT,
            ApiError::ValidationError(_) => StatusCode::BAD_REQUEST,
            ApiError::InvalidInput(_) => StatusCode::BAD_REQUEST,
            ApiError::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            ApiError::Forbidden(_) => StatusCode::FORBIDDEN,
            ApiError::InsufficientFunds => StatusCode::PAYMENT_REQUIRED,
            ApiError::InvalidStatus(_) => StatusCode::CONFLICT,
            ApiError::DeadlinePassed => StatusCode::GONE,
            ApiError::InternalError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            ApiError::NotImplemented(_) => StatusCode::NOT_IMPLEMENTED,
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::PayloadTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            ApiError::UnsupportedMediaType => StatusCode::UNSUPPORTED_MEDIA_TYPE,
        }
    }

    fn error_response(&self) -> HttpResponse {
        let error_code = match self {
            ApiError::DatabaseError(_) => "DATABASE_ERROR",
            ApiError::NotFound(_) => "NOT_FOUND",
            ApiError::DuplicateEntry(_) => "DUPLICATE_ENTRY",
            ApiError::ValidationError(_) => "VALIDATION_ERROR",
            ApiError::InvalidInput(_) => "INVALID_INPUT",
            ApiError::Unauthorized(_) => "UNAUTHORIZED",
            ApiError::Forbidden(_) => "FORBIDDEN",
            ApiError::InsufficientFunds => "INSUFFICIENT_FUNDS",
            ApiError::InvalidStatus(_) => "INVALID_STATUS",
            ApiError::DeadlinePassed => "DEADLINE_PASSED",
            ApiError::InternalError(_) => "INTERNAL_ERROR",
            ApiError::NotImplemented(_) => "NOT_IMPLEMENTED",
            ApiError::BadRequest(_) => "BAD_REQUEST",
            ApiError::PayloadTooLarge => "PAYLOAD_TOO_LARGE",
            ApiError::UnsupportedMediaType => "UNSUPPORTED_MEDIA_TYPE",
        };

        let error_response = ErrorResponse {
            success: false,
            error: self.to_string(),
            error_code: error_code.to_string(),
            details: None,
        };

        HttpResponse::build(self.status_code()).json(error_response)
    }
}

// Convert sqlx errors to ApiError
impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        tracing::error!("SQLx error: {:?}", err);
        match err {
            sqlx::Error::RowNotFound => ApiError::NotFound("Resource not found".to_string()),
            sqlx::Error::Database(db_err) => {
                let code = db_err.code().unwrap_or_default();
                if code == "23505" {
                    ApiError::DuplicateEntry("Duplicate entry".to_string())
                } else if code == "23503" {
                    ApiError::NotFound("Referenced resource not found".to_string())
                } else {
                    ApiError::DatabaseError(db_err.message().to_string())
                }
            }
            sqlx::Error::Io(_) => ApiError::InternalError("Database connection error".to_string()),
            _ => ApiError::InternalError("Database error".to_string()),
        }
    }
}

// Convert other errors
impl From<uuid::Error> for ApiError {
    fn from(err: uuid::Error) -> Self {
        ApiError::InvalidInput(format!("Invalid UUID: {}", err))
    }
}

impl From<chrono::ParseError> for ApiError {
    fn from(err: chrono::ParseError) -> Self {
        ApiError::InvalidInput(format!("Invalid date/time: {}", err))
    }
}

/// Result type alias for API handlers
pub type ApiResult<T> = Result<T, ApiError>;

/// Wrap handler results for consistent error formatting
pub fn map_err<T, E: Into<ApiError>>(result: Result<T, E>) -> ApiResult<T> {
    result.map_err(|e| e.into())
}

/// Validate required field
pub fn validate_required(value: Option<&str>, field_name: &str) -> ApiResult<String> {
    value
        .filter(|v| !v.trim().is_empty())
        .map(|v| v.trim().to_string())
        .ok_or_else(|| ApiError::ValidationError(format!("{} is required", field_name)))
}

/// Validate string length
pub fn validate_length(
    value: &str,
    field_name: &str,
    min: Option<usize>,
    max: Option<usize>,
) -> ApiResult<&str> {
    let len = value.len();
    if let Some(min_len) = min {
        if len < min_len {
            return Err(ApiError::ValidationError(format!(
                "{} must be at least {} characters",
                field_name, min_len
            )));
        }
    }
    if let Some(max_len) = max {
        if len > max_len {
            return Err(ApiError::ValidationError(format!(
                "{} must be at most {} characters",
                field_name, max_len
            )));
        }
    }
    Ok(value)
}

/// Validate budget amount
pub fn validate_budget(budget: i64) -> ApiResult<i64> {
    if budget <= 0 {
        return Err(ApiError::ValidationError(
            "Budget must be positive".to_string(),
        ));
    }
    // Maximum budget: 1 billion XLM in stroops
    const MAX_BUDGET: i64 = 10_000_000_000 * 10_000_000;
    if budget > MAX_BUDGET {
        return Err(ApiError::ValidationError(
            "Budget exceeds maximum allowed".to_string(),
        ));
    }
    Ok(budget)
}

/// Validate timeline
pub fn validate_timeline(days: i32) -> ApiResult<i32> {
    if days <= 0 {
        return Err(ApiError::ValidationError(
            "Timeline must be positive".to_string(),
        ));
    }
    if days > 365 {
        return Err(ApiError::ValidationError(
            "Timeline cannot exceed 365 days".to_string(),
        ));
    }
    Ok(days)
}

/// Validate deadline is in the future
pub fn validate_deadline(deadline: chrono::DateTime<chrono::Utc>) -> ApiResult<()> {
    if deadline < chrono::Utc::now() {
        return Err(ApiError::DeadlinePassed);
    }
    Ok(())
}

/// Validate wallet address format (Stellar public key)
pub fn validate_wallet_address(addr: &str) -> ApiResult<&str> {
    if addr.len() != 56 {
        return Err(ApiError::InvalidInput(
            "Invalid Stellar wallet address: must be 56 characters".to_string(),
        ));
    }
    if !addr.starts_with("G") {
        return Err(ApiError::InvalidInput(
            "Invalid Stellar wallet address: must start with G".to_string(),
        ));
    }
    // Basic base32 validation
    for c in addr.chars() {
        if !c.is_ascii_alphanumeric() {
            return Err(ApiError::InvalidInput(format!(
                "Invalid character in wallet address: {}",
                c
            )));
        }
    }
    Ok(addr)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_budget() {
        assert!(validate_budget(1000).is_ok());
        assert!(validate_budget(0).is_err());
        assert!(validate_budget(-100).is_err());
    }

    #[test]
    fn test_validate_timeline() {
        assert!(validate_timeline(30).is_ok());
        assert!(validate_timeline(0).is_err());
        assert!(validate_timeline(366).is_err());
    }

    #[test]
    fn test_validate_wallet_address() {
        let valid = "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqr";
        assert!(validate_wallet_address(valid).is_ok());
        assert!(validate_wallet_address("short").is_err());
        assert!(validate_wallet_address("SABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklm").is_err());
    }

    #[test]
    fn test_validate_length() {
        assert!(validate_length("hello", "name", Some(3), Some(10)).is_ok());
        assert!(validate_length("hi", "name", Some(3), Some(10)).is_err());
        assert!(validate_length("this is too long", "name", Some(3), Some(10)).is_err());
    }
}
