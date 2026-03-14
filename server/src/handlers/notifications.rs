use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{
        DeleteSubscriptionRequest, NotificationPreferences, RegisterSubscriptionRequest,
        UpdateNotificationPrefsRequest,
    },
    state::AppState,
};

/// GET /notifications/vapid-public-key
pub async fn get_vapid_public_key(
    State(state): State<AppState>,
) -> AppResult<Json<Value>> {
    let key = state
        .config
        .vapid_public_key
        .as_deref()
        .ok_or_else(|| AppError::Validation("VAPID not configured".into()))?;
    Ok(Json(json!({ "public_key": key })))
}

/// POST /notifications/subscriptions
pub async fn register_subscription(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<RegisterSubscriptionRequest>,
) -> AppResult<StatusCode> {
    match req.subscription_type.as_str() {
        "web" => {
            if req.endpoint.is_none() || req.p256dh.is_none() || req.auth_key.is_none() {
                return Err(AppError::Validation(
                    "Web push requires endpoint, p256dh, and auth_key".into(),
                ));
            }
        }
        "fcm" | "apns" => {
            if req.device_token.is_none() {
                return Err(AppError::Validation(
                    "FCM/APNs require device_token".into(),
                ));
            }
        }
        _ => return Err(AppError::Validation("Invalid subscription_type".into())),
    }

    sqlx::query(
        r#"
        INSERT INTO push_subscriptions
            (user_id, subscription_type, endpoint, p256dh, auth_key, device_token, user_agent)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (endpoint) WHERE endpoint IS NOT NULL
            DO UPDATE SET
                user_id    = EXCLUDED.user_id,
                p256dh     = EXCLUDED.p256dh,
                auth_key   = EXCLUDED.auth_key,
                created_at = NOW()
        "#,
    )
    .bind(auth.user_id())
    .bind(&req.subscription_type)
    .bind(&req.endpoint)
    .bind(&req.p256dh)
    .bind(&req.auth_key)
    .bind(&req.device_token)
    .bind(&req.user_agent)
    .execute(&state.pool)
    .await?;

    Ok(StatusCode::CREATED)
}

/// DELETE /notifications/subscriptions
pub async fn delete_subscription(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<DeleteSubscriptionRequest>,
) -> AppResult<StatusCode> {
    if req.endpoint.is_none() && req.device_token.is_none() {
        return Err(AppError::Validation(
            "Provide endpoint or device_token".into(),
        ));
    }

    sqlx::query(
        r#"
        DELETE FROM push_subscriptions
        WHERE user_id = $1
          AND (endpoint = $2 OR device_token = $3)
        "#,
    )
    .bind(auth.user_id())
    .bind(&req.endpoint)
    .bind(&req.device_token)
    .execute(&state.pool)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /notifications/preferences
pub async fn get_preferences(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<NotificationPreferences>> {
    let prefs = sqlx::query_as::<_, NotificationPreferences>(
        r#"
        SELECT user_id, all_messages, dm_notifications, mention_notifications
        FROM notification_preferences
        WHERE user_id = $1
        "#,
    )
    .bind(auth.user_id())
    .fetch_optional(&state.pool)
    .await?
    .unwrap_or(NotificationPreferences {
        user_id: auth.user_id(),
        all_messages: false,
        dm_notifications: true,
        mention_notifications: true,
    });

    Ok(Json(prefs))
}

/// PUT /notifications/preferences
pub async fn update_preferences(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<UpdateNotificationPrefsRequest>,
) -> AppResult<Json<NotificationPreferences>> {
    let prefs = sqlx::query_as::<_, NotificationPreferences>(
        r#"
        INSERT INTO notification_preferences
            (user_id, all_messages, dm_notifications, mention_notifications)
        VALUES ($1, COALESCE($2, false), COALESCE($3, true), COALESCE($4, true))
        ON CONFLICT (user_id) DO UPDATE SET
            all_messages          = COALESCE($2, notification_preferences.all_messages),
            dm_notifications      = COALESCE($3, notification_preferences.dm_notifications),
            mention_notifications = COALESCE($4, notification_preferences.mention_notifications),
            updated_at            = NOW()
        RETURNING user_id, all_messages, dm_notifications, mention_notifications
        "#,
    )
    .bind(auth.user_id())
    .bind(req.all_messages)
    .bind(req.dm_notifications)
    .bind(req.mention_notifications)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(prefs))
}
