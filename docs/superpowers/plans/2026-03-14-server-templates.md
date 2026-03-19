# Server Templates Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to create servers from pre-configured templates (Gaming, Community, Study Group) that auto-populate channels and roles.

**Architecture:** Add a `server_templates` table seeded with built-in templates. Extend `POST /servers` to accept an optional `template_id`; when supplied, the handler creates the server then inserts the template's channels inside the same transaction. A new `GET /server-templates` endpoint lists available templates. The frontend's CreateServerModal gains a template-selection step rendered before the name/icon form.

**Tech Stack:** Rust/Axum/sqlx (backend), React + Zustand + Vitest (frontend), PostgreSQL (migration + seed)

---

## File Map

### Created

- `server/migrations/20260314000004_server_templates.sql` — table DDL + seed data
- `server/src/handlers/templates.rs` — `list_templates` handler
- `clients/web/src/components/servers/ServerTemplateCard.tsx` — template preview card
- `clients/web/src/components/servers/ServerTemplateCard.module.css` — styles

### Modified

- `server/src/models/mod.rs` — add `ServerTemplate`, `ServerTemplateDto`, `TemplateData`, `TemplateChannel`
- `server/src/handlers/servers.rs` — extend `CreateServerRequest` with `template_id`; apply template channels inside transaction
- `server/src/handlers/mod.rs` — declare `pub mod templates`
- `server/src/main.rs` — register `GET /server-templates` route
- `clients/web/src/types/index.ts` — `ServerTemplate`, updated `CreateServerRequest`
- `clients/web/src/api/client.ts` — `listTemplates()`, updated `createServer()`
- `clients/web/src/components/servers/CreateServerModal.tsx` — template selection step
- `clients/web/src/components/servers/ServerModals.module.css` — template grid styles

---

## Chunk 1: Database Migration

### Task 1: Create migration with table + seed data

**Files:**

- Create: `server/migrations/20260314000004_server_templates.sql`

- [ ] **Step 1: Write the migration**

```sql
-- server/migrations/20260314000004_server_templates.sql

CREATE TABLE IF NOT EXISTS server_templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    description TEXT NOT NULL CHECK (char_length(description) <= 500),
    category    TEXT NOT NULL CHECK (category IN ('gaming', 'community', 'study', 'custom')),
    template_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_builtin  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX server_templates_category_idx ON server_templates (category);

-- Built-in templates (seeded once at migration time)
INSERT INTO server_templates (name, description, category, template_data, is_builtin) VALUES
(
    'Gaming',
    'Perfect for gaming groups. Includes channels for announcements, game discussion, clips, and voice lounges.',
    'gaming',
    '{
        "channels": [
            {"name": "announcements",  "type": "text",  "category": "Info",          "position": 0},
            {"name": "general",        "type": "text",  "category": "Text Channels", "position": 1},
            {"name": "gaming",         "type": "text",  "category": "Text Channels", "position": 2},
            {"name": "clips-and-memes","type": "text",  "category": "Text Channels", "position": 3},
            {"name": "General",        "type": "voice", "category": "Voice Channels","position": 4},
            {"name": "Gaming Lounge",  "type": "voice", "category": "Voice Channels","position": 5}
        ]
    }'::jsonb,
    TRUE
),
(
    'Community',
    'Great for open communities. Includes welcome, introductions, and off-topic channels.',
    'community',
    '{
        "channels": [
            {"name": "announcements",  "type": "text",  "category": "Info",          "position": 0},
            {"name": "welcome",        "type": "text",  "category": "Info",          "position": 1},
            {"name": "introductions",  "type": "text",  "category": "Community",     "position": 2},
            {"name": "general",        "type": "text",  "category": "Community",     "position": 3},
            {"name": "off-topic",      "type": "text",  "category": "Community",     "position": 4},
            {"name": "General",        "type": "voice", "category": "Voice Channels","position": 5},
            {"name": "Lounge",         "type": "voice", "category": "Voice Channels","position": 6}
        ]
    }'::jsonb,
    TRUE
),
(
    'Study Group',
    'Designed for collaborative learning. Includes resource sharing, homework help, and quiet study rooms.',
    'study',
    '{
        "channels": [
            {"name": "announcements",  "type": "text",  "category": "Info",          "position": 0},
            {"name": "general",        "type": "text",  "category": "Discussion",    "position": 1},
            {"name": "resources",      "type": "text",  "category": "Discussion",    "position": 2},
            {"name": "homework-help",  "type": "text",  "category": "Discussion",    "position": 3},
            {"name": "Study Room 1",   "type": "voice", "category": "Study Rooms",   "position": 4},
            {"name": "Study Room 2",   "type": "voice", "category": "Study Rooms",   "position": 5},
            {"name": "Break Room",     "type": "voice", "category": "Study Rooms",   "position": 6}
        ]
    }'::jsonb,
    TRUE
);
```

- [ ] **Step 2: Run the migration**

```bash
cd server && sqlx migrate run
```

Expected: `Applied 20260314000004/migrate server_templates`

- [ ] **Step 3: Commit**

```bash
git add server/migrations/20260314000004_server_templates.sql
git commit -m "feat(db): add server_templates table with built-in seeds"
```

---

## Chunk 2: Backend Models

### Task 2: Add Rust models for templates

**Files:**

- Modify: `server/src/models/mod.rs`

- [ ] **Step 1: Read the models file to understand existing structure**

Read `server/src/models/mod.rs` — look for where `Server` / `ServerDto` are defined to place new types nearby.

- [ ] **Step 2: Add models after the Server section**

Add after the existing `ServerDto` definition:

```rust
/// A channel definition inside a template's JSON `template_data`.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct TemplateChannel {
    pub name: String,
    pub r#type: ChannelType,
    pub category: Option<String>,
    pub position: i32,
}

/// The structured payload stored as JSONB in `server_templates.template_data`.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct TemplateData {
    pub channels: Vec<TemplateChannel>,
}

/// Database row for `server_templates`.
#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct ServerTemplate {
    pub id: uuid::Uuid,
    pub name: String,
    pub description: String,
    pub category: String,
    pub template_data: sqlx::types::Json<TemplateData>,
    pub is_builtin: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// API response shape for a template.
#[derive(Debug, serde::Serialize)]
pub struct ServerTemplateDto {
    pub id: uuid::Uuid,
    pub name: String,
    pub description: String,
    pub category: String,
    pub channels: Vec<TemplateChannel>,
    pub is_builtin: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl From<ServerTemplate> for ServerTemplateDto {
    fn from(t: ServerTemplate) -> Self {
        ServerTemplateDto {
            id: t.id,
            name: t.name,
            description: t.description,
            category: t.category,
            channels: t.template_data.0.channels,
            is_builtin: t.is_builtin,
            created_at: t.created_at,
        }
    }
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd server && cargo build 2>&1 | head -30
```

Expected: no errors (warnings OK for now).

- [ ] **Step 4: Commit**

```bash
git add server/src/models/mod.rs
git commit -m "feat(models): add ServerTemplate, TemplateData, ServerTemplateDto"
```

---

## Chunk 3: Backend Handler — list_templates

### Task 3: Write list_templates handler with test

**Files:**

- Create: `server/src/handlers/templates.rs`
- Modify: `server/src/handlers/mod.rs`
- Modify: `server/src/main.rs`

- [ ] **Step 1: Write the handler**

```rust
// server/src/handlers/templates.rs

use axum::{extract::State, Json};
use crate::{
    models::{ServerTemplate, ServerTemplateDto},
    state::AppState,
    error::AppResult,
};

/// GET /server-templates
/// Returns all available server templates ordered by category then name.
pub async fn list_templates(
    State(state): State<AppState>,
) -> AppResult<Json<Vec<ServerTemplateDto>>> {
    let rows: Vec<ServerTemplate> = sqlx::query_as(
        "SELECT id, name, description, category, template_data, is_builtin, created_at
         FROM server_templates
         ORDER BY is_builtin DESC, category, name",
    )
    .fetch_all(&state.pool)
    .await?;

    let dtos: Vec<ServerTemplateDto> = rows.into_iter().map(ServerTemplateDto::from).collect();
    Ok(Json(dtos))
}
```

- [ ] **Step 2: Declare the module in mod.rs**

In `server/src/handlers/mod.rs`, add:

```rust
pub mod templates;
```

- [ ] **Step 3: Register the route in main.rs**

In `server/src/main.rs`, find the route section. Add alongside other public routes (no auth required for listing templates):

```rust
.route("/server-templates", get(handlers::templates::list_templates))
```

- [ ] **Step 4: Verify it compiles**

```bash
cd server && cargo build 2>&1 | head -30
```

Expected: clean build.

- [ ] **Step 5: Write integration test**

In `server/tests/` — create or find a relevant test file. Add:

```rust
// In server/tests/templates.rs  (create this file)

mod common;

use axum::http::StatusCode;

#[sqlx::test(migrations = "migrations")]
async fn test_list_templates_returns_builtin_templates(pool: sqlx::PgPool) {
    let app = common::build_test_app(pool).await;

    let response = app
        .oneshot(
            axum::http::Request::builder()
                .uri("/server-templates")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let templates: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();

    assert_eq!(templates.len(), 3, "expected 3 built-in templates");

    let names: Vec<&str> = templates
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"Gaming"));
    assert!(names.contains(&"Community"));
    assert!(names.contains(&"Study Group"));

    // Each template must expose its channels
    for t in &templates {
        let channels = t["channels"].as_array().unwrap();
        assert!(
            !channels.is_empty(),
            "template '{}' has no channels",
            t["name"]
        );
    }
}
```

- [ ] **Step 6: Run the test**

```bash
cd server && cargo test test_list_templates_returns_builtin_templates -- --nocapture
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/handlers/templates.rs server/src/handlers/mod.rs server/src/main.rs server/tests/templates.rs
git commit -m "feat(api): add GET /server-templates endpoint"
```

---

## Chunk 4: Backend — create server from template

### Task 4: Extend create_server to apply template channels

**Files:**

- Modify: `server/src/handlers/servers.rs`

- [ ] **Step 1: Read servers.rs**

Read `server/src/handlers/servers.rs` in full to understand `CreateServerRequest` and `create_server` handler.

- [ ] **Step 2: Add template_id to CreateServerRequest**

Find `CreateServerRequest` and add the optional field:

```rust
#[derive(Debug, serde::Deserialize, validator::Validate)]
pub struct CreateServerRequest {
    #[validate(length(min = 1, max = 100, message = "Server name must be 1–100 characters"))]
    pub name: String,
    #[validate(url)]
    pub icon_url: Option<String>,
    pub is_public: Option<bool>,
    /// If set, create channels defined in the template.
    pub template_id: Option<uuid::Uuid>,
}
```

- [ ] **Step 3: Apply template inside the create_server transaction**

Inside `create_server`, after the server and default `#general` channel are inserted (within the same `tx`), add:

```rust
// If a template was requested, fetch it and insert its channels
if let Some(template_id) = req.template_id {
    let template: Option<crate::models::ServerTemplate> = sqlx::query_as(
        "SELECT id, name, description, category, template_data, is_builtin, created_at
         FROM server_templates WHERE id = $1",
    )
    .bind(template_id)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some(tmpl) = template {
        // Remove the default #general channel inserted above — template provides its own
        sqlx::query("DELETE FROM channels WHERE server_id = $1")
            .bind(server_id)
            .execute(&mut *tx)
            .await?;

        for ch in &tmpl.template_data.0.channels {
            sqlx::query(
                "INSERT INTO channels (server_id, name, type, category, position)
                 VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(server_id)
            .bind(&ch.name)
            .bind(ch.r#type.to_string())   // ChannelType serializes to "text"/"voice"
            .bind(&ch.category)
            .bind(ch.position)
            .execute(&mut *tx)
            .await?;
        }
    }
    // Unknown template_id is silently ignored (no error) — server is still created
}
```

> **Note on ChannelType serialization**: If `ChannelType` doesn't implement `Display`, use `serde_json::to_value(&ch.r#type).unwrap().as_str().unwrap().to_owned()` or add a `Display` impl. Check the existing code path that inserts the default channel to see what type string is used, and match it exactly.

- [ ] **Step 4: Verify it compiles**

```bash
cd server && cargo build 2>&1 | head -40
```

Fix any type/borrow errors. Common fix: `&mut *tx` vs `&mut tx` — match the existing usage in `create_server`.

- [ ] **Step 5: Write integration test**

```rust
// Append to server/tests/templates.rs

#[sqlx::test(migrations = "migrations")]
async fn test_create_server_from_gaming_template(pool: sqlx::PgPool) {
    let app = common::build_test_app(pool.clone()).await;

    // Register a user and get a token
    let token = common::register_and_get_token(&pool, "templateuser").await;

    // Fetch the Gaming template id
    let templates_resp = app
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .uri("/server-templates")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let templates: Vec<serde_json::Value> = serde_json::from_slice(
        &axum::body::to_bytes(templates_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let gaming = templates.iter().find(|t| t["name"] == "Gaming").unwrap();
    let template_id = gaming["id"].as_str().unwrap();

    // Create a server from the template
    let body = serde_json::json!({
        "name": "My Gaming Server",
        "template_id": template_id
    });
    let response = app
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/servers")
                .header("Authorization", format!("Bearer {token}"))
                .header("Content-Type", "application/json")
                .body(axum::body::Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);

    let server: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let server_id = server["id"].as_str().unwrap();

    // Verify channels were created from template (6 expected for Gaming)
    let channels: Vec<serde_json::Value> = sqlx::query_as::<_, (serde_json::Value,)>(
        "SELECT row_to_json(c) FROM channels c WHERE server_id = $1 ORDER BY position",
    )
    .bind(uuid::Uuid::parse_str(server_id).unwrap())
    .fetch_all(&pool)
    .await
    .unwrap()
    .into_iter()
    .map(|(v,)| v)
    .collect();

    assert_eq!(channels.len(), 6, "Gaming template should create 6 channels");
    assert_eq!(channels[0]["name"], "announcements");
}
```

- [ ] **Step 6: Run tests**

```bash
cd server && cargo test templates -- --nocapture
```

Expected: both tests PASS.

- [ ] **Step 7: Run clippy**

```bash
cd server && cargo clippy -- -D warnings
```

Fix any warnings.

- [ ] **Step 8: Commit**

```bash
git add server/src/handlers/servers.rs server/tests/templates.rs
git commit -m "feat(api): support template_id in POST /servers to pre-populate channels"
```

---

## Chunk 5: Frontend Types and API Client

### Task 5: Add TypeScript types and API methods

**Files:**

- Modify: `clients/web/src/types/index.ts`
- Modify: `clients/web/src/api/client.ts`

- [ ] **Step 1: Add types to index.ts**

Read `clients/web/src/types/index.ts`, then add after the `UpdateServerRequest` interface:

```typescript
export interface TemplateChannel {
  name: string;
  type: "text" | "voice";
  category: string | null;
  position: number;
}

export interface ServerTemplate {
  id: string;
  name: string;
  description: string;
  category: "gaming" | "community" | "study" | "custom";
  channels: TemplateChannel[];
  is_builtin: boolean;
  created_at: string;
}
```

Also update `CreateServerRequest` to add the optional field:

```typescript
export interface CreateServerRequest {
  name: string;
  icon_url?: string;
  is_public?: boolean;
  template_id?: string; // add this line
}
```

- [ ] **Step 2: Add API methods to client.ts**

Read `clients/web/src/api/client.ts`, then add `listTemplates` alongside the server methods:

```typescript
async listTemplates(): Promise<ServerTemplate[]> {
  return this.get("/server-templates");
}
```

`createServer` already accepts `CreateServerRequest` — no change needed since `template_id` is optional.

- [ ] **Step 3: Run typecheck**

```bash
cd clients/web && npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add clients/web/src/types/index.ts clients/web/src/api/client.ts
git commit -m "feat(types): add ServerTemplate types and listTemplates API method"
```

---

## Chunk 6: Frontend UI — Template Card Component

### Task 6: Build ServerTemplateCard component

**Files:**

- Create: `clients/web/src/components/servers/ServerTemplateCard.tsx`
- Create: `clients/web/src/components/servers/ServerTemplateCard.module.css`

- [ ] **Step 1: Write the CSS module**

```css
/* clients/web/src/components/servers/ServerTemplateCard.module.css */

.card {
  border: 2px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
  text-align: left;
  background: var(--bg-secondary);
  width: 100%;
}

.card:hover {
  border-color: var(--accent);
  background: var(--bg-tertiary);
}

.card.selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-secondary));
}

.header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.icon {
  font-size: 24px;
  line-height: 1;
}

.name {
  font-weight: 600;
  font-size: 15px;
  color: var(--text-primary);
}

.description {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 10px;
  line-height: 1.4;
}

.channelList {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.channelTag {
  font-size: 11px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 6px;
  color: var(--text-muted);
}

.channelTag.voice::before {
  content: "🔊 ";
}

.channelTag.text::before {
  content: "# ";
}
```

- [ ] **Step 2: Write the component**

```tsx
// clients/web/src/components/servers/ServerTemplateCard.tsx

import type { ServerTemplate } from "../../types";
import styles from "./ServerTemplateCard.module.css";

const CATEGORY_ICONS: Record<string, string> = {
  gaming: "🎮",
  community: "🌐",
  study: "📚",
  custom: "✨",
};

interface Props {
  template: ServerTemplate;
  selected: boolean;
  onSelect: (template: ServerTemplate) => void;
}

export function ServerTemplateCard({ template, selected, onSelect }: Props) {
  return (
    <button
      type="button"
      className={`${styles.card} ${selected ? styles.selected : ""}`}
      onClick={() => onSelect(template)}
      aria-pressed={selected}
    >
      <div className={styles.header}>
        <span className={styles.icon}>
          {CATEGORY_ICONS[template.category] ?? "✨"}
        </span>
        <span className={styles.name}>{template.name}</span>
      </div>
      <p className={styles.description}>{template.description}</p>
      <div className={styles.channelList}>
        {template.channels.slice(0, 6).map((ch) => (
          <span
            key={ch.name}
            className={`${styles.channelTag} ${styles[ch.type]}`}
          >
            {ch.name}
          </span>
        ))}
        {template.channels.length > 6 && (
          <span className={styles.channelTag}>
            +{template.channels.length - 6} more
          </span>
        )}
      </div>
    </button>
  );
}
```

- [ ] **Step 3: Run typecheck**

```bash
cd clients/web && npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add clients/web/src/components/servers/ServerTemplateCard.tsx \
        clients/web/src/components/servers/ServerTemplateCard.module.css
git commit -m "feat(ui): add ServerTemplateCard component"
```

---

## Chunk 7: Frontend UI — Template Step in CreateServerModal

### Task 7: Add template selection step to CreateServerModal

**Files:**

- Modify: `clients/web/src/components/servers/CreateServerModal.tsx`
- Modify: `clients/web/src/components/servers/ServerModals.module.css`

- [ ] **Step 1: Read the current modal**

Read `clients/web/src/components/servers/CreateServerModal.tsx` in full.

- [ ] **Step 2: Rewrite with two-step flow**

Replace the file contents with a two-step modal:

- **Step 1 (template):** Show "Start from scratch" option + template cards. User picks one and clicks Next.
- **Step 2 (details):** Name and icon fields. Back button returns to step 1. Submit creates the server.

```tsx
// clients/web/src/components/servers/CreateServerModal.tsx

import { useState, useEffect, type FormEvent } from "react";
import { Modal } from "../ui/Modal";
import { ServerTemplateCard } from "./ServerTemplateCard";
import { useServerStore } from "../../stores/serverStore";
import { api } from "../../api/client";
import type { ServerTemplate } from "../../types";
import styles from "./ServerModals.module.css";

interface CreateServerModalProps {
  open: boolean;
  onClose: () => void;
}

const BLANK_TEMPLATE: ServerTemplate = {
  id: "",
  name: "Start from scratch",
  description: "Create a server with a single #general channel.",
  category: "custom",
  channels: [{ name: "general", type: "text", category: null, position: 0 }],
  is_builtin: false,
  created_at: "",
};

export function CreateServerModal({ open, onClose }: CreateServerModalProps) {
  const [step, setStep] = useState<"template" | "details">("template");
  const [templates, setTemplates] = useState<ServerTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] =
    useState<ServerTemplate>(BLANK_TEMPLATE);
  const [name, setName] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const createServer = useServerStore((s) => s.createServer);
  const setActiveServer = useServerStore((s) => s.setActiveServer);

  // Load templates when modal opens
  useEffect(() => {
    if (!open) return;
    api
      .listTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([])); // fail silently — blank option still works
  }, [open]);

  const handleClose = () => {
    // Reset all state on close
    setStep("template");
    setSelectedTemplate(BLANK_TEMPLATE);
    setName("");
    setIconUrl("");
    setIsPublic(true);
    setError("");
    onClose();
  };

  const handleNext = () => {
    setStep("details");
  };

  const handleBack = () => {
    setStep("template");
    setError("");
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError("");
    try {
      const server = await createServer({
        name: name.trim(),
        icon_url: iconUrl.trim() || undefined,
        is_public: isPublic,
        template_id: selectedTemplate.id || undefined,
      });
      setActiveServer(server.id);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create server");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={
        step === "template" ? "Choose a Template" : "Customize Your Server"
      }
    >
      {step === "template" ? (
        <div className={styles.templateStep}>
          <p className={styles.templateHint}>
            Templates pre-populate channels so you can get started quickly.
          </p>
          <div className={styles.templateGrid}>
            <ServerTemplateCard
              template={BLANK_TEMPLATE}
              selected={selectedTemplate.id === ""}
              onSelect={setSelectedTemplate}
            />
            {templates.map((t) => (
              <ServerTemplateCard
                key={t.id}
                template={t}
                selected={selectedTemplate.id === t.id}
                onSelect={setSelectedTemplate}
              />
            ))}
          </div>
          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleNext}
            >
              Next
            </button>
          </div>
        </div>
      ) : (
        <>
          {error && <div className={styles.error}>{error}</div>}
          <p className={styles.templateHint}>
            Using template: <strong>{selectedTemplate.name}</strong>
          </p>
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="server-name" className={styles.label}>
                Server Name *
              </label>
              <input
                id="server-name"
                type="text"
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Awesome Server"
                maxLength={100}
                required
                autoFocus
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="server-icon" className={styles.label}>
                Icon URL
              </label>
              <input
                id="server-icon"
                type="url"
                className={styles.input}
                value={iconUrl}
                onChange={(e) => setIconUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
            <div className={styles.checkboxField}>
              <input
                id="server-public"
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
              <label htmlFor="server-public">Make server discoverable</label>
            </div>
            <div className={styles.formActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={handleBack}
              >
                Back
              </button>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={isSubmitting || !name.trim()}
              >
                {isSubmitting ? "Creating…" : "Create Server"}
              </button>
            </div>
          </form>
        </>
      )}
    </Modal>
  );
}
```

- [ ] **Step 3: Add template grid styles to ServerModals.module.css**

Read `clients/web/src/components/servers/ServerModals.module.css`, then append:

```css
/* Template selection step */
.templateStep {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.templateHint {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

.templateGrid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  max-height: 380px;
  overflow-y: auto;
  padding-right: 4px;
}
```

- [ ] **Step 4: Run typecheck and lint**

```bash
cd clients/web && npm run typecheck && npm run lint
```

Expected: no errors. Fix any lint warnings.

- [ ] **Step 5: Commit**

```bash
git add clients/web/src/components/servers/CreateServerModal.tsx \
        clients/web/src/components/servers/ServerModals.module.css
git commit -m "feat(ui): add template selection step to CreateServerModal"
```

---

## Chunk 8: Frontend Tests

### Task 8: Write Vitest tests for the new UI flow

**Files:**

- Modify or create: `clients/web/src/__tests__/create-server-modal.test.tsx`

> **Check first**: run `ls clients/web/src/__tests__/` to see if there's already a test for `CreateServerModal`. If so, extend it; otherwise create new.

- [ ] **Step 1: Write tests**

```tsx
// clients/web/src/__tests__/create-server-modal.test.tsx

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreateServerModal } from "../components/servers/CreateServerModal";
import * as apiModule from "../api/client";
import { useServerStore } from "../stores/serverStore";

const mockTemplates = [
  {
    id: "tmpl-gaming",
    name: "Gaming",
    description: "For gamers",
    category: "gaming",
    channels: [
      { name: "general", type: "text", category: null, position: 0 },
      { name: "gaming", type: "text", category: null, position: 1 },
      { name: "General", type: "voice", category: null, position: 2 },
    ],
    is_builtin: true,
    created_at: "2026-03-14T00:00:00Z",
  },
];

vi.mock("../api/client", () => ({
  api: {
    listTemplates: vi.fn(),
    createServer: vi.fn(),
  },
}));

vi.mock("../stores/serverStore", () => ({
  useServerStore: vi.fn(),
}));

const mockCreateServer = vi.fn();
const mockSetActiveServer = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (apiModule.api.listTemplates as ReturnType<typeof vi.fn>).mockResolvedValue(
    mockTemplates,
  );
  (useServerStore as ReturnType<typeof vi.fn>).mockImplementation((selector) =>
    selector({
      createServer: mockCreateServer,
      setActiveServer: mockSetActiveServer,
    }),
  );
});

describe("CreateServerModal", () => {
  it("shows template selection step first", async () => {
    render(<CreateServerModal open onClose={vi.fn()} />);
    expect(await screen.findByText("Gaming")).toBeInTheDocument();
    expect(screen.getByText("Start from scratch")).toBeInTheDocument();
    expect(screen.queryByLabelText("Server Name *")).not.toBeInTheDocument();
  });

  it("proceeds to details step on Next", async () => {
    render(<CreateServerModal open onClose={vi.fn()} />);
    await screen.findByText("Gaming"); // wait for templates to load
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByLabelText("Server Name *")).toBeInTheDocument();
  });

  it("shows selected template name in details step", async () => {
    render(<CreateServerModal open onClose={vi.fn()} />);
    await screen.findByText("Gaming");
    fireEvent.click(screen.getByText("Gaming")); // select Gaming template
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText(/Using template: Gaming/)).toBeInTheDocument();
  });

  it("back button returns to template step", async () => {
    render(<CreateServerModal open onClose={vi.fn()} />);
    await screen.findByText("Gaming");
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByText("Gaming")).toBeInTheDocument();
    expect(screen.queryByLabelText("Server Name *")).not.toBeInTheDocument();
  });

  it("submits with template_id when template selected", async () => {
    mockCreateServer.mockResolvedValue({ id: "srv-1" });
    render(<CreateServerModal open onClose={vi.fn()} />);
    await screen.findByText("Gaming");
    fireEvent.click(screen.getByText("Gaming"));
    fireEvent.click(screen.getByText("Next"));

    fireEvent.change(screen.getByLabelText("Server Name *"), {
      target: { value: "My Server" },
    });
    fireEvent.click(screen.getByText("Create Server"));

    await waitFor(() => {
      expect(mockCreateServer).toHaveBeenCalledWith(
        expect.objectContaining({ template_id: "tmpl-gaming" }),
      );
    });
  });

  it("submits without template_id when 'Start from scratch' selected", async () => {
    mockCreateServer.mockResolvedValue({ id: "srv-2" });
    render(<CreateServerModal open onClose={vi.fn()} />);
    await screen.findByText("Gaming");
    // Default selection is blank (no template)
    fireEvent.click(screen.getByText("Next"));

    fireEvent.change(screen.getByLabelText("Server Name *"), {
      target: { value: "Blank Server" },
    });
    fireEvent.click(screen.getByText("Create Server"));

    await waitFor(() => {
      expect(mockCreateServer).toHaveBeenCalledWith(
        expect.objectContaining({ template_id: undefined }),
      );
    });
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd clients/web && npm test -- --reporter=verbose create-server-modal
```

Expected: all 6 tests PASS.

- [ ] **Step 3: Run full test suite to check for regressions**

```bash
cd clients/web && npm test
```

Expected: all tests PASS (or same failures as before this branch).

- [ ] **Step 4: Commit**

```bash
git add clients/web/src/__tests__/create-server-modal.test.tsx
git commit -m "test(ui): add CreateServerModal template selection tests"
```

---

## Chunk 9: Final Verification

### Task 9: Verify, lint, and clean up

- [ ] **Step 1: Run backend full test suite**

```bash
cd server && cargo test
```

Expected: all tests PASS.

- [ ] **Step 2: Run clippy**

```bash
cd server && cargo clippy -- -D warnings
```

Expected: zero warnings.

- [ ] **Step 3: Run rustfmt**

```bash
cd server && cargo fmt
git diff --name-only  # should show only formatting changes
```

- [ ] **Step 4: Run frontend typecheck and lint**

```bash
cd clients/web && npm run typecheck && npm run lint
```

Expected: no errors.

- [ ] **Step 5: Commit fmt/lint fixes if any**

```bash
git add -u
git commit -m "chore: rustfmt and lint fixes"
```

- [ ] **Step 6: Emit completion signal**

```bash
openclaw system event --text "Done: Server templates implemented" --mode now
```
