//! Message search handler using PostgreSQL full-text search.
//!
//! Provides server-wide or channel-scoped message search with relevance ranking
//! and result highlighting.

use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::{DateTime, Utc};
use uuid::Uuid;
use validator::Validate;

use super::shared::require_member;
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{SearchQuery, SearchResponse, SearchResult},
    state::AppState,
};

// ============================================================================
// Constants
// ============================================================================

/// Default number of results per page.
const DEFAULT_LIMIT: i64 = 50;

/// Maximum number of results per page.
const MAX_LIMIT: i64 = 100;

// ============================================================================
// Handler
// ============================================================================

/// GET /servers/:id/search — search messages in a server.
///
/// Full-text search using PostgreSQL `to_tsvector` and `plainto_tsquery`.
/// Results are ranked by relevance and highlighted with `<mark>` tags.
///
/// Authorization: User must be a member of the server.
pub async fn search_messages(
    Path(server_id): Path<Uuid>,
    Query(params): Query<SearchQuery>,
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<SearchResponse>> {
    // Validate query
    params
        .validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;

    // Verify membership
    require_member(&state.pool, server_id, auth.user_id()).await?;

    let limit = params.limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT);

    tracing::info!(
        server_id = %server_id,
        query = %params.q,
        channel_id = ?params.channel_id,
        limit = limit,
        "Message search"
    );

    // Search with optional channel filter
    let results: Vec<SearchRow> = if let Some(channel_id) = params.channel_id {
        // Channel-scoped search
        sqlx::query_as::<_, SearchRow>(
            r#"
            SELECT
                m.id,
                m.channel_id,
                m.author_id,
                u.username AS author_username,
                m.content,
                ts_headline('english', m.content, plainto_tsquery('english', $1),
                    'StartSel=<mark> StopSel=</mark> MaxWords=35 MinWords=15') AS highlight,
                m.created_at,
                ts_rank_cd(to_tsvector('english', m.content), plainto_tsquery('english', $1)) AS rank
            FROM messages m
            LEFT JOIN users u ON m.author_id = u.id
            WHERE m.deleted = FALSE
              AND m.channel_id = $2
              AND to_tsvector('english', m.content) @@ plainto_tsquery('english', $1)
            ORDER BY rank DESC, m.created_at DESC
            LIMIT $3
            "#,
        )
        .bind(&params.q)
        .bind(channel_id)
        .bind(limit + 1) // +1 to check for has_more
        .fetch_all(&state.pool)
        .await?
    } else {
        // Server-wide search
        sqlx::query_as::<_, SearchRow>(
            r#"
            SELECT
                m.id,
                m.channel_id,
                m.author_id,
                u.username AS author_username,
                m.content,
                ts_headline('english', m.content, plainto_tsquery('english', $1),
                    'StartSel=<mark> StopSel=</mark> MaxWords=35 MinWords=15') AS highlight,
                m.created_at,
                ts_rank_cd(to_tsvector('english', m.content), plainto_tsquery('english', $1)) AS rank
            FROM messages m
            LEFT JOIN users u ON m.author_id = u.id
            JOIN channels c ON m.channel_id = c.id
            WHERE m.deleted = FALSE
              AND c.server_id = $2
              AND to_tsvector('english', m.content) @@ plainto_tsquery('english', $1)
            ORDER BY rank DESC, m.created_at DESC
            LIMIT $3
            "#,
        )
        .bind(&params.q)
        .bind(server_id)
        .bind(limit + 1) // +1 to check for has_more
        .fetch_all(&state.pool)
        .await?
    };

    // Get total count (approximate for large result sets)
    let total: i64 = if let Some(channel_id) = params.channel_id {
        sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM messages m
            WHERE m.deleted = FALSE
              AND m.channel_id = $1
              AND to_tsvector('english', m.content) @@ plainto_tsquery('english', $2)
            "#,
        )
        .bind(channel_id)
        .bind(&params.q)
        .fetch_one(&state.pool)
        .await?
    } else {
        sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM messages m
            JOIN channels c ON m.channel_id = c.id
            WHERE m.deleted = FALSE
              AND c.server_id = $1
              AND to_tsvector('english', m.content) @@ plainto_tsquery('english', $2)
            "#,
        )
        .bind(server_id)
        .bind(&params.q)
        .fetch_one(&state.pool)
        .await?
    };

    // Check for pagination
    let has_more = results.len() > limit as usize;
    let mut results = results;
    if has_more {
        results.truncate(limit as usize);
    }

    let next_cursor = if has_more && !results.is_empty() {
        Some(results.last().unwrap().id)
    } else {
        None
    };

    Ok(Json(SearchResponse {
        results: results.into_iter().map(SearchResult::from).collect(),
        total,
        has_more,
        next_cursor,
    }))
}

// ============================================================================
// Internal types
// ============================================================================

/// Raw database row for search results.
#[derive(sqlx::FromRow)]
struct SearchRow {
    id: Uuid,
    channel_id: Uuid,
    author_id: Option<Uuid>,
    author_username: Option<String>,
    content: String,
    highlight: String,
    created_at: DateTime<Utc>,
    rank: f32,
}

impl From<SearchRow> for SearchResult {
    fn from(row: SearchRow) -> Self {
        Self {
            id: row.id,
            channel_id: row.channel_id,
            author_id: row.author_id,
            author_username: row.author_username,
            content: row.content,
            highlight: row.highlight,
            created_at: row.created_at,
            rank: row.rank,
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_search_query_validation() {
        // Valid query
        let query = SearchQuery {
            q: "hello world".to_string(),
            channel_id: None,
            before: None,
            limit: None,
        };
        assert!(query.validate().is_ok());

        // Too short
        let query = SearchQuery {
            q: "x".to_string(),
            channel_id: None,
            before: None,
            limit: None,
        };
        assert!(query.validate().is_err());

        // Too long
        let query = SearchQuery {
            q: "x".repeat(201),
            channel_id: None,
            before: None,
            limit: None,
        };
        assert!(query.validate().is_err());
    }

    #[test]
    fn test_limit_bounds() {
        // Default limit
        let query = SearchQuery {
            q: "test".to_string(),
            channel_id: None,
            before: None,
            limit: None,
        };
        let limit = query.limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT);
        assert_eq!(limit, 50);

        // Max limit
        let query = SearchQuery {
            q: "test".to_string(),
            channel_id: None,
            before: None,
            limit: Some(100),
        };
        let limit = query.limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT);
        assert_eq!(limit, 100);

        // Over max limit
        let query = SearchQuery {
            q: "test".to_string(),
            channel_id: None,
            before: None,
            limit: Some(200),
        };
        let limit = query.limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT);
        assert_eq!(limit, 100); // Clamped to max
    }
}
