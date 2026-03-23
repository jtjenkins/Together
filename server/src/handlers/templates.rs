use axum::{extract::State, Json};

use crate::{
    auth::AuthUser,
    error::AppResult,
    models::{ServerTemplate, ServerTemplateDto},
    state::AppState,
};

/// GET /server-templates — list all available server templates.
pub async fn list_templates(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> AppResult<Json<Vec<ServerTemplateDto>>> {
    let rows = sqlx::query_as::<_, ServerTemplate>(
        "SELECT id, name, description, category, template_data, is_builtin, created_at
         FROM server_templates
         ORDER BY is_builtin DESC, name ASC",
    )
    .fetch_all(&state.pool)
    .await?;

    let dtos = rows
        .into_iter()
        .map(ServerTemplateDto::try_from)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Json(dtos))
}
