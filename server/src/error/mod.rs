use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(sqlx::Error),

    #[error("Authentication error: {0}")]
    Auth(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Internal server error")]
    Internal,
}

/// Map sqlx errors to AppError, with special handling for unique-constraint
/// violations (PG error code 23505) so they surface as 409 Conflict rather
/// than 500 Internal Server Error.
impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        if let sqlx::Error::Database(ref db_err) = e {
            if db_err.code().as_deref() == Some("23505") {
                let message = match db_err.constraint() {
                    Some(c) if c.contains("username") => "Username already taken",
                    Some(c) if c.contains("email") => "Email already registered",
                    _ => "Resource already exists",
                };
                return AppError::Conflict(message.into());
            }
        }
        AppError::Database(e)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message): (StatusCode, String) = match self {
            AppError::Database(e) => {
                tracing::error!("Database error: {:?}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, "Database error".into())
            }
            AppError::Auth(msg) => (StatusCode::UNAUTHORIZED, msg),
            AppError::Validation(msg) => (StatusCode::BAD_REQUEST, msg),
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, msg),
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, msg),
            AppError::Internal => {
                tracing::error!("Internal server error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Internal server error".into(),
                )
            }
        };

        (status, Json(json!({ "error": message }))).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::response::IntoResponse;
    use http_body_util::BodyExt;

    async fn body_json(body: Body) -> serde_json::Value {
        let bytes = body.collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn auth_error_returns_401() {
        let response = AppError::Auth("unauthorized".into()).into_response();
        assert_eq!(response.status(), axum::http::StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn validation_error_returns_400() {
        let response = AppError::Validation("invalid input".into()).into_response();
        assert_eq!(response.status(), axum::http::StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn not_found_error_returns_404() {
        let response = AppError::NotFound("User not found".into()).into_response();
        assert_eq!(response.status(), axum::http::StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn conflict_error_returns_409() {
        let response = AppError::Conflict("already exists".into()).into_response();
        assert_eq!(response.status(), axum::http::StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn internal_error_returns_500() {
        let response = AppError::Internal.into_response();
        assert_eq!(
            response.status(),
            axum::http::StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[tokio::test]
    async fn database_row_not_found_returns_500() {
        let response = AppError::Database(sqlx::Error::RowNotFound).into_response();
        assert_eq!(
            response.status(),
            axum::http::StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[tokio::test]
    async fn auth_error_body_has_error_key() {
        let response = AppError::Auth("unauthorized".into()).into_response();
        let json = body_json(response.into_body()).await;
        assert_eq!(json["error"], "unauthorized");
    }

    #[tokio::test]
    async fn validation_error_body_has_error_key() {
        let response = AppError::Validation("invalid input".into()).into_response();
        let json = body_json(response.into_body()).await;
        assert_eq!(json["error"], "invalid input");
    }

    #[tokio::test]
    async fn conflict_error_body_has_error_key() {
        let response = AppError::Conflict("already exists".into()).into_response();
        let json = body_json(response.into_body()).await;
        assert_eq!(json["error"], "already exists");
    }

    #[tokio::test]
    async fn not_found_returns_404_and_correct_body() {
        let response = AppError::NotFound("User not found".into()).into_response();
        assert_eq!(response.status(), axum::http::StatusCode::NOT_FOUND);
        let json = body_json(response.into_body()).await;
        assert_eq!(json["error"], "User not found");
    }
}
