# Link & Image Preview Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render image URLs inline in messages and show Open Graph preview cards for non-image links, Discord-style, on both web and mobile.

**Architecture:** Client-side URL detection (regex) determines whether a URL is an image (rendered inline) or a link (triggers `GET /link-preview?url=...`). The server fetches OG metadata via `reqwest`, caches results in a 24-hour in-memory `HashMap`, and returns a `LinkPreviewDto`. No database changes required.

**Tech Stack:** Rust (`scraper` crate, `reqwest`, `url`), React (web), React Native (mobile), Vitest (web tests), Jest/jest-expo (mobile tests).

---

### Task 1: Add `scraper` dependency to server

**Files:**
- Modify: `server/Cargo.toml`

**Step 1: Add the dependency**

In `server/Cargo.toml`, add after the `reqwest` line:

```toml
scraper = "0.19"             # HTML parsing for OG tag extraction
url = "2"                    # URL parsing (used by reqwest internally, now explicit)
```

**Step 2: Verify it compiles**

```bash
cd /Volumes/Storage/Development/GitHub/Together/server
~/.cargo/bin/cargo check 2>&1 | tail -5
```

Expected: `Finished` with no errors.

**Step 3: Commit**

```bash
git add server/Cargo.toml server/Cargo.lock
git commit -m "chore(server): add scraper and url crates for link preview"
```

---

### Task 2: Add `LinkPreviewDto` struct and cache to `AppState`

**Files:**
- Create: `server/src/models/link_preview.rs`
- Modify: `server/src/models/mod.rs`
- Modify: `server/src/state.rs`

**Step 1: Create the DTO model**

Create `server/src/models/link_preview.rs`:

```rust
use serde::{Deserialize, Serialize};

/// Open Graph metadata returned by `GET /link-preview`.
///
/// All fields except `url` are optional — a page may have no OG tags.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkPreviewDto {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub site_name: Option<String>,
}
```

**Step 2: Expose the model from `models/mod.rs`**

Open `server/src/models/mod.rs` and add:

```rust
pub mod link_preview;
pub use link_preview::LinkPreviewDto;
```

**Step 3: Add cache field to `AppState`**

Open `server/src/state.rs`. Replace the entire file with:

```rust
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use sqlx::PgPool;

use crate::models::LinkPreviewDto;
use crate::websocket::ConnectionManager;

/// Shared application state passed to all handlers and extractors.
///
/// `ConnectionManager` is cheaply cloneable (it wraps an `Arc` internally),
/// so cloning `AppState` for each request is inexpensive.
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub jwt_secret: Arc<str>,
    pub connections: ConnectionManager,
    /// Root directory where uploaded files are stored.
    pub upload_dir: PathBuf,
    /// In-memory cache for Open Graph link preview metadata.
    ///
    /// Keyed by canonical URL string. Each entry holds the fetched DTO and the
    /// `Instant` at which it was cached; entries older than 24 hours are re-fetched.
    pub link_preview_cache: Arc<Mutex<HashMap<String, (LinkPreviewDto, Instant)>>>,
}
```

**Step 4: Initialize the cache in `main.rs`**

Open `server/src/main.rs`. Find the `AppState { ... }` construction (around line 94) and add the new field:

```rust
    let app_state = AppState {
        pool,
        jwt_secret: config.jwt_secret,
        connections: ConnectionManager::new(),
        upload_dir: config.upload_dir.clone(),
        link_preview_cache: Arc::new(Mutex::new(HashMap::new())),
    };
```

Add the missing import at the top of `main.rs` (after existing `use` lines):

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
```

**Step 5: Verify compilation**

```bash
cd /Volumes/Storage/Development/GitHub/Together/server
~/.cargo/bin/cargo check 2>&1 | tail -5
```

Expected: `Finished` with no errors.

**Step 6: Commit**

```bash
git add server/src/models/link_preview.rs server/src/models/mod.rs server/src/state.rs server/src/main.rs
git commit -m "feat(server): add LinkPreviewDto and in-memory preview cache to AppState"
```

---

### Task 3: SSRF validator and OG parser — write failing tests first

**Files:**
- Create: `server/src/handlers/link_preview.rs` (tests only for now)

**Step 1: Create the handler file with unit tests only**

Create `server/src/handlers/link_preview.rs` with just the test module and stubs:

```rust
use std::net::IpAddr;

use scraper::{Html, Selector};

use crate::models::LinkPreviewDto;

// ── Public helpers (implemented in Task 4) ─────────────────────────────────

/// Returns `true` if `ip` is a private, loopback, or link-local address.
pub fn is_private_ip(ip: IpAddr) -> bool {
    todo!()
}

/// Parse Open Graph tags from `html` and return a `LinkPreviewDto`.
/// Falls back to `<title>` for the title and hostname for site_name.
pub fn extract_og_data(html: &str, base_url: &str) -> LinkPreviewDto {
    todo!()
}

// ── Unit tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── is_private_ip ──────────────────────────────────────────────────────

    #[test]
    fn blocks_loopback_ipv4() {
        assert!(is_private_ip("127.0.0.1".parse().unwrap()));
    }

    #[test]
    fn blocks_loopback_ipv4_other() {
        assert!(is_private_ip("127.255.255.255".parse().unwrap()));
    }

    #[test]
    fn blocks_private_class_a() {
        assert!(is_private_ip("10.0.0.1".parse().unwrap()));
    }

    #[test]
    fn blocks_private_class_b_low() {
        assert!(is_private_ip("172.16.0.1".parse().unwrap()));
    }

    #[test]
    fn blocks_private_class_b_high() {
        assert!(is_private_ip("172.31.255.255".parse().unwrap()));
    }

    #[test]
    fn blocks_private_class_c() {
        assert!(is_private_ip("192.168.1.1".parse().unwrap()));
    }

    #[test]
    fn blocks_link_local() {
        assert!(is_private_ip("169.254.0.1".parse().unwrap()));
    }

    #[test]
    fn blocks_ipv6_loopback() {
        assert!(is_private_ip("::1".parse().unwrap()));
    }

    #[test]
    fn allows_public_ipv4() {
        assert!(!is_private_ip("8.8.8.8".parse().unwrap()));
        assert!(!is_private_ip("1.1.1.1".parse().unwrap()));
    }

    #[test]
    fn allows_public_ipv6() {
        assert!(!is_private_ip("2606:4700:4700::1111".parse().unwrap()));
    }

    // ── extract_og_data ────────────────────────────────────────────────────

    #[test]
    fn extracts_og_title() {
        let html = r#"<html><head><meta property="og:title" content="My Title"/></head></html>"#;
        let dto = extract_og_data(html, "https://example.com");
        assert_eq!(dto.title.as_deref(), Some("My Title"));
    }

    #[test]
    fn falls_back_to_title_tag() {
        let html = r#"<html><head><title>Page Title</title></head></html>"#;
        let dto = extract_og_data(html, "https://example.com");
        assert_eq!(dto.title.as_deref(), Some("Page Title"));
    }

    #[test]
    fn og_title_takes_precedence_over_title_tag() {
        let html = r#"<html><head>
            <title>Page Title</title>
            <meta property="og:title" content="OG Title"/>
        </head></html>"#;
        let dto = extract_og_data(html, "https://example.com");
        assert_eq!(dto.title.as_deref(), Some("OG Title"));
    }

    #[test]
    fn extracts_all_og_fields() {
        let html = r#"<html><head>
            <meta property="og:title" content="T"/>
            <meta property="og:description" content="D"/>
            <meta property="og:image" content="https://example.com/img.png"/>
            <meta property="og:site_name" content="S"/>
        </head></html>"#;
        let dto = extract_og_data(html, "https://example.com");
        assert_eq!(dto.title.as_deref(), Some("T"));
        assert_eq!(dto.description.as_deref(), Some("D"));
        assert_eq!(dto.image.as_deref(), Some("https://example.com/img.png"));
        assert_eq!(dto.site_name.as_deref(), Some("S"));
    }

    #[test]
    fn falls_back_site_name_to_hostname() {
        let html = r#"<html><head></head></html>"#;
        let dto = extract_og_data(html, "https://example.com/article");
        assert_eq!(dto.site_name.as_deref(), Some("example.com"));
    }

    #[test]
    fn returns_none_for_missing_fields() {
        let html = r#"<html><head></head></html>"#;
        let dto = extract_og_data(html, "https://example.com");
        assert!(dto.title.is_none());
        assert!(dto.description.is_none());
        assert!(dto.image.is_none());
    }

    #[test]
    fn ignores_whitespace_only_content() {
        let html = r#"<html><head><meta property="og:title" content="   "/></head></html>"#;
        let dto = extract_og_data(html, "https://example.com");
        assert!(dto.title.is_none());
    }
}
```

**Step 2: Expose the module (needed for compilation)**

Open `server/src/handlers/mod.rs` and add:

```rust
pub mod link_preview;
```

**Step 3: Run tests — watch them fail**

```bash
cd /Volumes/Storage/Development/GitHub/Together/server
~/.cargo/bin/cargo test link_preview 2>&1 | tail -20
```

Expected: compilation error `not yet implemented` (the `todo!()` panics) or test failures. This confirms the tests are real.

---

### Task 4: Implement `is_private_ip` and `extract_og_data`

**Files:**
- Modify: `server/src/handlers/link_preview.rs`

**Step 1: Replace the `todo!()` stubs with real implementations**

Replace the two stub functions at the top of `server/src/handlers/link_preview.rs` with:

```rust
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{extract::{Query, State}, Json};
use reqwest::Url;
use scraper::{Html, Selector};
use serde::Deserialize;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::LinkPreviewDto,
    state::AppState,
};

const CACHE_TTL: Duration = Duration::from_secs(86_400); // 24 hours
const FETCH_TIMEOUT: Duration = Duration::from_secs(5);
const USER_AGENT: &str =
    "Mozilla/5.0 (compatible; TogetherLinkBot/1.0; +https://github.com/jtjenkins/Together)";

/// Returns `true` if `ip` is a private, loopback, or link-local address.
///
/// Used for SSRF protection before making outbound HTTP requests.
pub fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            matches!(
                o,
                [127, ..] |           // 127.0.0.0/8 loopback
                [10, ..] |            // 10.0.0.0/8 private
                [169, 254, ..] |      // 169.254.0.0/16 link-local
                [192, 168, ..] |      // 192.168.0.0/16 private
                [0, ..] |             // 0.x.x.x unspecified
                [255, 255, 255, 255]  // broadcast
            ) || (o[0] == 172 && (16..=31).contains(&o[1])) // 172.16-31.x.x private
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()                              // ::1
                || (v6.segments()[0] & 0xfe00 == 0xfc00) // fc00::/7 ULA
                || (v6.segments()[0] & 0xffc0 == 0xfe80) // fe80::/10 link-local
        }
    }
}

/// Parse Open Graph tags from `html` and return a `LinkPreviewDto`.
/// Falls back to `<title>` for the title and hostname for site_name.
pub fn extract_og_data(html: &str, base_url: &str) -> LinkPreviewDto {
    let document = Html::parse_document(html);

    let title = get_meta_property(&document, "og:title")
        .or_else(|| get_title_tag(&document));

    let description = get_meta_property(&document, "og:description")
        .or_else(|| get_meta_name(&document, "description"));

    let image = get_meta_property(&document, "og:image");

    let site_name = get_meta_property(&document, "og:site_name").or_else(|| {
        Url::parse(base_url)
            .ok()
            .and_then(|u| u.host_str().map(|h| h.to_string()))
    });

    LinkPreviewDto {
        url: base_url.to_string(),
        title,
        description,
        image,
        site_name,
    }
}

fn get_meta_property(doc: &Html, property: &str) -> Option<String> {
    let selector =
        Selector::parse(&format!(r#"meta[property="{property}"]"#)).ok()?;
    doc.select(&selector)
        .next()
        .and_then(|el| el.value().attr("content"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn get_meta_name(doc: &Html, name: &str) -> Option<String> {
    let selector = Selector::parse(&format!(r#"meta[name="{name}"]"#)).ok()?;
    doc.select(&selector)
        .next()
        .and_then(|el| el.value().attr("content"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn get_title_tag(doc: &Html) -> Option<String> {
    let selector = Selector::parse("title").ok()?;
    doc.select(&selector)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
        .filter(|s| !s.is_empty())
}
```

**Step 2: Run tests — watch them pass**

```bash
cd /Volumes/Storage/Development/GitHub/Together/server
~/.cargo/bin/cargo test link_preview 2>&1 | tail -20
```

Expected: all 17 tests pass.

**Step 3: Commit**

```bash
git add server/src/handlers/link_preview.rs server/src/handlers/mod.rs
git commit -m "feat(server): SSRF validator and OG parser with unit tests"
```

---

### Task 5: Implement the `get_link_preview` HTTP handler and register the route

**Files:**
- Modify: `server/src/handlers/link_preview.rs` (add handler below the unit tests)
- Modify: `server/src/main.rs`

**Step 1: Add the HTTP handler and query struct**

Append this block to `server/src/handlers/link_preview.rs`, after the `get_title_tag` helper and before `#[cfg(test)]`:

```rust
// ── Query params ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct LinkPreviewQuery {
    pub url: String,
}

// ── Handler ────────────────────────────────────────────────────────────────

/// GET /link-preview?url=<encoded-url>
///
/// Returns Open Graph metadata for the given URL, with results cached for 24 hours.
/// Requires authentication. Rejects private/loopback IPs (SSRF protection).
pub async fn get_link_preview(
    State(state): State<AppState>,
    _auth: AuthUser,
    Query(params): Query<LinkPreviewQuery>,
) -> AppResult<Json<LinkPreviewDto>> {
    let url_str = params.url.clone();

    // ── Validate URL ──────────────────────────────────────────────────────
    let parsed = Url::parse(&url_str).map_err(|_| {
        AppError::Validation("Invalid URL".into())
    })?;

    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err(AppError::Validation("Only http/https URLs are supported".into())),
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::Validation("URL has no host".into()))?
        .to_string();

    // ── SSRF: resolve hostname and check all IPs ──────────────────────────
    let lookup_target = format!("{}:80", host);
    let addrs = tokio::net::lookup_host(&lookup_target)
        .await
        .map_err(|_| AppError::Validation("Could not resolve URL host".into()))?;

    for addr in addrs {
        if is_private_ip(addr.ip()) {
            return Err(AppError::Validation(
                "URL resolves to a private or reserved address".into(),
            ));
        }
    }

    // ── Check cache ───────────────────────────────────────────────────────
    {
        let cache = state.link_preview_cache.lock().unwrap();
        if let Some((dto, cached_at)) = cache.get(&url_str) {
            if cached_at.elapsed() < CACHE_TTL {
                return Ok(Json(dto.clone()));
            }
        }
    }

    // ── Fetch and parse ───────────────────────────────────────────────────
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|_| AppError::Internal)?;

    let response = client.get(&url_str).send().await.map_err(|e| {
        tracing::warn!(error = ?e, url = %url_str, "Failed to fetch URL for link preview");
        AppError::Validation("Failed to fetch URL".into())
    })?;

    let html = response.text().await.map_err(|_| AppError::Internal)?;
    let dto = extract_og_data(&html, &url_str);

    // ── Store in cache ────────────────────────────────────────────────────
    {
        let mut cache = state.link_preview_cache.lock().unwrap();
        cache.insert(url_str, (dto.clone(), Instant::now()));
    }

    Ok(Json(dto))
}
```

**Step 2: Register the route in `main.rs`**

In `server/src/main.rs`, find the line `.route("/health", get(handlers::health_check))` and add the new route directly below it:

```rust
        .route("/link-preview", get(handlers::link_preview::get_link_preview))
```

**Step 3: Verify compilation**

```bash
cd /Volumes/Storage/Development/GitHub/Together/server
~/.cargo/bin/cargo check 2>&1 | tail -5
```

Expected: `Finished` with no errors.

**Step 4: Run all server tests**

```bash
cd /Volumes/Storage/Development/GitHub/Together/server
~/.cargo/bin/cargo test 2>&1 | tail -10
```

Expected: all tests pass.

**Step 5: Run `cargo fmt`**

```bash
~/.cargo/bin/cargo fmt --manifest-path /Volumes/Storage/Development/GitHub/Together/server/Cargo.toml
```

**Step 6: Commit**

```bash
git add server/src/handlers/link_preview.rs server/src/main.rs
git commit -m "feat(server): GET /link-preview endpoint with 24h cache and SSRF protection"
```

---

### Task 6: Add `LinkPreviewDto` to web types and `getLinkPreview` to API client

**Files:**
- Modify: `clients/web/src/types/index.ts`
- Modify: `clients/web/src/api/client.ts`

**Step 1: Add the type**

Open `clients/web/src/types/index.ts` and append at the end:

```typescript
// ─── Link Preview Types ───────────────────────────────────────────────────

export interface LinkPreviewDto {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site_name: string | null;
}
```

**Step 2: Import the type in `api/client.ts`**

Open `clients/web/src/api/client.ts`. In the `import type { ... }` block at the top, add `LinkPreviewDto` to the list.

**Step 3: Add the method to `ApiClient`**

In `clients/web/src/api/client.ts`, find the `listReactions` method and add after it:

```typescript
  getLinkPreview(url: string): Promise<LinkPreviewDto> {
    return this.request<LinkPreviewDto>(
      `/link-preview?url=${encodeURIComponent(url)}`,
    );
  }
```

**Step 4: Verify TypeScript**

```bash
cd /Volumes/Storage/Development/GitHub/Together/clients/web
npm run typecheck 2>&1 | tail -10
```

Expected: no errors.

**Step 5: Commit**

```bash
git add clients/web/src/types/index.ts clients/web/src/api/client.ts
git commit -m "feat(web): add LinkPreviewDto type and getLinkPreview API method"
```

---

### Task 7: Web `links.ts` utilities — TDD

**Files:**
- Create: `clients/web/src/utils/links.ts`
- Create: `clients/web/src/__tests__/links.test.ts`

**Step 1: Write failing tests**

Create `clients/web/src/__tests__/links.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractUrls, isImageUrl } from "../utils/links";

describe("extractUrls", () => {
  it("returns empty array for plain text", () => {
    expect(extractUrls("hello world")).toEqual([]);
  });

  it("finds a single http URL", () => {
    expect(extractUrls("check https://example.com out")).toEqual([
      "https://example.com",
    ]);
  });

  it("finds a single http URL (no trailing space)", () => {
    expect(extractUrls("https://example.com")).toEqual(["https://example.com"]);
  });

  it("finds multiple URLs", () => {
    expect(extractUrls("https://a.com and https://b.com")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  it("preserves URL with path and query string", () => {
    expect(extractUrls("visit https://example.com/path?q=1&r=2")).toEqual([
      "https://example.com/path?q=1&r=2",
    ]);
  });

  it("returns empty for text with no URLs", () => {
    expect(extractUrls("no links here at all")).toEqual([]);
  });

  it("finds a URL embedded in sentence without spaces", () => {
    expect(extractUrls("seehttps://example.comhere")).toEqual([
      "https://example.comhere",
    ]);
  });
});

describe("isImageUrl", () => {
  it("returns true for .jpg", () => {
    expect(isImageUrl("https://example.com/photo.jpg")).toBe(true);
  });

  it("returns true for .jpeg", () => {
    expect(isImageUrl("https://example.com/photo.jpeg")).toBe(true);
  });

  it("returns true for .png", () => {
    expect(isImageUrl("https://example.com/img.png")).toBe(true);
  });

  it("returns true for .gif", () => {
    expect(isImageUrl("https://example.com/a.gif")).toBe(true);
  });

  it("returns true for .webp", () => {
    expect(isImageUrl("https://example.com/a.webp")).toBe(true);
  });

  it("returns true for .svg", () => {
    expect(isImageUrl("https://example.com/a.svg")).toBe(true);
  });

  it("returns true for .avif", () => {
    expect(isImageUrl("https://example.com/a.avif")).toBe(true);
  });

  it("returns false for a regular article URL", () => {
    expect(isImageUrl("https://example.com/article")).toBe(false);
  });

  it("returns false for a URL with no extension", () => {
    expect(isImageUrl("https://example.com")).toBe(false);
  });

  it("ignores query string when checking extension", () => {
    expect(isImageUrl("https://example.com/photo.jpg?size=large")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isImageUrl("https://example.com/PHOTO.JPG")).toBe(true);
    expect(isImageUrl("https://example.com/PHOTO.PNG")).toBe(true);
  });

  it("returns false for .pdf", () => {
    expect(isImageUrl("https://example.com/doc.pdf")).toBe(false);
  });
});
```

**Step 2: Run tests — watch them fail**

```bash
cd /Volumes/Storage/Development/GitHub/Together/clients/web
npm test -- --reporter=verbose src/__tests__/links.test.ts 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../utils/links'`.

**Step 3: Implement `links.ts`**

Create `clients/web/src/utils/links.ts`:

```typescript
/** Matches http and https URLs. Stops at whitespace and common delimiters. */
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;

/** Image file extensions we render inline. */
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|svg|avif)(\?.*)?$/i;

/**
 * Extract all http/https URLs from a string, in order of appearance.
 */
export function extractUrls(text: string): string[] {
  return [...text.matchAll(URL_REGEX)].map((m) => m[0]);
}

/**
 * Returns true if the URL's path ends with an image file extension.
 * Query strings are ignored.
 */
export function isImageUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return IMAGE_EXT_RE.test(pathname);
  } catch {
    return false;
  }
}
```

**Step 4: Run tests — watch them pass**

```bash
cd /Volumes/Storage/Development/GitHub/Together/clients/web
npm test -- --reporter=verbose src/__tests__/links.test.ts 2>&1 | tail -20
```

Expected: all 18 tests pass.

**Step 5: Commit**

```bash
git add clients/web/src/utils/links.ts clients/web/src/__tests__/links.test.ts
git commit -m "feat(web): add extractUrls and isImageUrl link utilities with tests"
```

---

### Task 8: Web `LinkPreview` component — TDD

**Files:**
- Create: `clients/web/src/components/messages/LinkPreview.tsx`
- Create: `clients/web/src/components/messages/LinkPreview.module.css`
- Create: `clients/web/src/__tests__/link-preview.test.tsx`

**Step 1: Write failing tests**

Create `clients/web/src/__tests__/link-preview.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { LinkPreview } from "../components/messages/LinkPreview";

// Mock the api module so we don't make real HTTP calls.
vi.mock("../api/client", () => ({
  api: {
    getLinkPreview: vi.fn(),
  },
}));

// Import AFTER vi.mock so we get the mocked version.
import { api } from "../api/client";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LinkPreview", () => {
  describe("loading state", () => {
    it("renders a skeleton while loading", () => {
      vi.mocked(api.getLinkPreview).mockReturnValue(new Promise(() => {}));
      const { container } = render(
        <LinkPreview url="https://example.com" />,
      );
      // Skeleton should be present; no title content yet
      expect(container.firstChild).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });

  describe("successful fetch", () => {
    it("renders site name, title, and description", async () => {
      vi.mocked(api.getLinkPreview).mockResolvedValue({
        url: "https://example.com",
        title: "Example Title",
        description: "An example description.",
        image: null,
        site_name: "Example Site",
      });
      render(<LinkPreview url="https://example.com" />);
      await waitFor(() =>
        expect(screen.getByText("Example Title")).toBeInTheDocument(),
      );
      expect(screen.getByText("An example description.")).toBeInTheDocument();
      expect(screen.getByText("Example Site")).toBeInTheDocument();
    });

    it("renders a thumbnail image when og:image is present", async () => {
      vi.mocked(api.getLinkPreview).mockResolvedValue({
        url: "https://example.com",
        title: "With Image",
        description: null,
        image: "https://example.com/og.jpg",
        site_name: null,
      });
      render(<LinkPreview url="https://example.com" />);
      await waitFor(() => {
        const img = screen.getByRole("img");
        expect(img).toHaveAttribute("src", "https://example.com/og.jpg");
      });
    });

    it("title links to the URL in a new tab", async () => {
      vi.mocked(api.getLinkPreview).mockResolvedValue({
        url: "https://example.com",
        title: "Click Me",
        description: null,
        image: null,
        site_name: null,
      });
      render(<LinkPreview url="https://example.com" />);
      await waitFor(() => {
        const link = screen.getByRole("link", { name: "Click Me" });
        expect(link).toHaveAttribute("href", "https://example.com");
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noreferrer");
      });
    });

    it("renders nothing (empty) when title is null", async () => {
      vi.mocked(api.getLinkPreview).mockResolvedValue({
        url: "https://example.com",
        title: null,
        description: "No title here",
        image: null,
        site_name: null,
      });
      const { container } = render(<LinkPreview url="https://example.com" />);
      await waitFor(() => {
        expect(container).toBeEmptyDOMElement();
      });
    });

    it("skips site_name when null", async () => {
      vi.mocked(api.getLinkPreview).mockResolvedValue({
        url: "https://example.com",
        title: "Just Title",
        description: null,
        image: null,
        site_name: null,
      });
      render(<LinkPreview url="https://example.com" />);
      await waitFor(() =>
        expect(screen.getByText("Just Title")).toBeInTheDocument(),
      );
      // No site name element
      expect(screen.queryByTestId("site-name")).not.toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("renders nothing when the API call rejects", async () => {
      vi.mocked(api.getLinkPreview).mockRejectedValue(
        new Error("Network error"),
      );
      const { container } = render(<LinkPreview url="https://example.com" />);
      await waitFor(() => {
        expect(container).toBeEmptyDOMElement();
      });
    });
  });
});
```

**Step 2: Run tests — watch them fail**

```bash
cd /Volumes/Storage/Development/GitHub/Together/clients/web
npm test -- --reporter=verbose src/__tests__/link-preview.test.tsx 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../components/messages/LinkPreview'`.

**Step 3: Implement the CSS**

Create `clients/web/src/components/messages/LinkPreview.module.css`:

```css
/* ── Skeleton shown while fetch is in progress ─────────────────────────── */
.skeleton {
  height: 80px;
  max-width: 400px;
  margin-top: 6px;
  border-radius: 4px;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.04) 25%,
    rgba(255, 255, 255, 0.08) 50%,
    rgba(255, 255, 255, 0.04) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ── Preview card ──────────────────────────────────────────────────────── */
.card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: 400px;
  margin-top: 6px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.04);
  border-left: 3px solid #5865f2;
  border-radius: 0 4px 4px 0;
  position: relative;
}

.siteName {
  font-size: 11px;
  font-weight: 600;
  color: #8e9297;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.title {
  font-size: 13px;
  font-weight: 600;
  color: #00aff4;
  text-decoration: none;
  line-height: 1.3;
}

.title:hover {
  text-decoration: underline;
}

.description {
  font-size: 12px;
  color: #b9bbbe;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.thumbnail {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 80px;
  height: 80px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}

/* When a thumbnail is present, leave room on the right */
.card:has(.thumbnail) {
  padding-right: 104px;
}
```

**Step 4: Implement the component**

Create `clients/web/src/components/messages/LinkPreview.tsx`:

```tsx
import React, { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { LinkPreviewDto } from "../../types";
import styles from "./LinkPreview.module.css";

interface LinkPreviewProps {
  url: string;
}

export function LinkPreview({ url }: LinkPreviewProps) {
  const [data, setData] = useState<LinkPreviewDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .getLinkPreview(url)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        // Non-fatal: render nothing on error
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (loading) {
    return <div className={styles.skeleton} />;
  }

  // Render nothing if there's no title to show
  if (!data?.title) {
    return null;
  }

  return (
    <div className={styles.card}>
      {data.site_name && (
        <div className={styles.siteName} data-testid="site-name">
          {data.site_name}
        </div>
      )}
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={styles.title}
      >
        {data.title}
      </a>
      {data.description && (
        <div className={styles.description}>{data.description}</div>
      )}
      {data.image && (
        <img src={data.image} alt="" className={styles.thumbnail} />
      )}
    </div>
  );
}
```

**Step 5: Run tests — watch them pass**

```bash
cd /Volumes/Storage/Development/GitHub/Together/clients/web
npm test -- --reporter=verbose src/__tests__/link-preview.test.tsx 2>&1 | tail -20
```

Expected: all 7 tests pass.

**Step 6: Run the full web test suite**

```bash
cd /Volumes/Storage/Development/GitHub/Together/clients/web
npm test 2>&1 | tail -5
```

Expected: all tests pass.

**Step 7: Commit**

```bash
git add clients/web/src/components/messages/LinkPreview.tsx \
        clients/web/src/components/messages/LinkPreview.module.css \
        clients/web/src/__tests__/link-preview.test.tsx
git commit -m "feat(web): LinkPreview component with skeleton, OG card, and tests"
```

---

### Task 9: Update web `MessageItem` to render inline images and link previews

**Files:**
- Modify: `clients/web/src/components/messages/MessageItem.tsx`
- Modify: `clients/web/src/components/messages/MessageItem.module.css`

**Step 1: Update imports in `MessageItem.tsx`**

At the top of `clients/web/src/components/messages/MessageItem.tsx`, add to the existing imports:

```tsx
import { extractUrls, isImageUrl } from "../../utils/links";
import { LinkPreview } from "./LinkPreview";
```

**Step 2: Replace `renderMentions` with `renderContent`**

Remove the entire `renderMentions` function (lines 24–56) and replace it with:

```tsx
/** Renders message content: converts :emoji: codes, linkifies URLs (image URLs
 *  render as inline <img>, other URLs as clickable links), and highlights @mentions.
 *  Returns rendered nodes plus the first non-image URL for the preview card. */
function renderContent(
  content: string,
  members: MemberDto[],
  currentUserId: string | null,
): { nodes: React.ReactNode[]; firstLinkUrl: string | null } {
  const processed = parseEmoji(content);

  // Find the first non-image URL for the preview card (one per message)
  const allUrls = extractUrls(processed);
  const firstLinkUrl = allUrls.find((u) => !isImageUrl(u)) ?? null;

  // Split on URLs to interleave image/link elements with text spans
  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
  const parts = processed.split(urlPattern);
  const urlMatches = [...processed.matchAll(urlPattern)].map((m) => m[0]);

  const nodes: React.ReactNode[] = [];

  parts.forEach((textPart, i) => {
    // Render the text segment with mention highlighting
    if (textPart) {
      textPart.split(/(@\w+)/g).forEach((chunk, j) => {
        const stripped = chunk.startsWith("@") ? chunk.slice(1) : null;
        if (stripped !== null) {
          if (stripped === "everyone") {
            nodes.push(
              <span key={`t${i}-${j}`} className={styles.mention}>
                {chunk}
              </span>,
            );
            return;
          }
          const matched = members.find((m) => m.username === stripped);
          if (matched) {
            const isSelf = matched.user_id === currentUserId;
            nodes.push(
              <span
                key={`t${i}-${j}`}
                className={`${styles.mention} ${isSelf ? styles.mentionSelf : ""}`}
              >
                {chunk}
              </span>,
            );
            return;
          }
        }
        nodes.push(chunk);
      });
    }

    // Render the URL that follows this text segment (if any)
    const url = urlMatches[i];
    if (url) {
      if (isImageUrl(url)) {
        nodes.push(
          <a
            key={`u${i}`}
            href={url}
            target="_blank"
            rel="noreferrer"
            className={styles.imageLink}
          >
            <img src={url} alt="" className={styles.inlineImage} />
          </a>,
        );
      } else {
        nodes.push(
          <a
            key={`u${i}`}
            href={url}
            target="_blank"
            rel="noreferrer"
            className={styles.link}
          >
            {url}
          </a>,
        );
      }
    }
  });

  return { nodes, firstLinkUrl };
}
```

**Step 3: Update the render call site**

In the `MessageItem` function body, find the line:

```tsx
{message.content !== "\u200b" && (
  <div className={styles.text}>
    {renderMentions(message.content, members, user?.id ?? null)}
  </div>
)}
```

Replace it with:

```tsx
{message.content !== "\u200b" && (() => {
  const { nodes, firstLinkUrl } = renderContent(
    message.content,
    members,
    user?.id ?? null,
  );
  return (
    <>
      <div className={styles.text}>{nodes}</div>
      {firstLinkUrl && <LinkPreview url={firstLinkUrl} />}
    </>
  );
})()}
```

**Step 4: Add inline image styles to `MessageItem.module.css`**

Append to `clients/web/src/components/messages/MessageItem.module.css`:

```css
/* ── Inline image URLs ───────────────────────────────────────────────────── */
.imageLink {
  display: block;
  margin-top: 4px;
}

.inlineImage {
  max-width: 400px;
  max-height: 300px;
  border-radius: 4px;
  object-fit: contain;
  display: block;
}

/* ── Plain URL links in message text ─────────────────────────────────────── */
.link {
  color: #00aff4;
  text-decoration: none;
  word-break: break-all;
}

.link:hover {
  text-decoration: underline;
}
```

**Step 5: TypeScript check**

```bash
cd /Volumes/Storage/Development/GitHub/Together/clients/web
npm run typecheck 2>&1 | tail -10
```

Expected: no errors.

**Step 6: Run lint**

```bash
cd /Volumes/Storage/Development/GitHub/Together/clients/web
npm run lint 2>&1 | tail -10
```

Expected: no errors.

**Step 7: Run all web tests**

```bash
cd /Volumes/Storage/Development/GitHub/Together/clients/web
npm test 2>&1 | tail -5
```

Expected: all tests pass.

**Step 8: Commit**

```bash
git add clients/web/src/components/messages/MessageItem.tsx \
        clients/web/src/components/messages/MessageItem.module.css
git commit -m "feat(web): render inline image URLs and link preview cards in messages"
```

---

### Task 10: Add `LinkPreviewDto` to mobile types and `getLinkPreview` to mobile API client

**Files:**
- Modify: `clients/mobile/src/types/index.ts`
- Modify: `clients/mobile/src/api/client.ts`

**Step 1: Add the type to mobile types**

Open `clients/mobile/src/types/index.ts` and append at the end:

```typescript
// ─── Link Preview Types ───────────────────────────────────────────────────

export interface LinkPreviewDto {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site_name: string | null;
}
```

**Step 2: Import and add the API method in `clients/mobile/src/api/client.ts`**

Add `LinkPreviewDto` to the import list at the top.

Find the method just before `export const api = new ApiClient();` and add:

```typescript
  getLinkPreview(url: string): Promise<LinkPreviewDto> {
    return this.request<LinkPreviewDto>(
      `/link-preview?url=${encodeURIComponent(url)}`,
    );
  }
```

**Step 3: TypeScript check**

```bash
cd /Volumes/Storage/Development/GitHub/Together/clients/mobile
npx tsc --noEmit 2>&1 | tail -10
```

Expected: no errors.

**Step 4: Commit**

```bash
git add clients/mobile/src/types/index.ts clients/mobile/src/api/client.ts
git commit -m "feat(mobile): add LinkPreviewDto type and getLinkPreview API method"
```

---

### Task 11: Mobile `links.ts` utilities — TDD

**Files:**
- Create: `clients/mobile/src/utils/links.ts`
- Create: `clients/mobile/__tests__/utils/links.test.ts`

**Step 1: Write failing tests**

Create `clients/mobile/__tests__/utils/links.test.ts`:

```typescript
import { extractUrls, isImageUrl } from "../../src/utils/links";

describe("extractUrls", () => {
  it("returns empty array for plain text", () => {
    expect(extractUrls("hello world")).toEqual([]);
  });

  it("finds a single https URL", () => {
    expect(extractUrls("check https://example.com out")).toEqual([
      "https://example.com",
    ]);
  });

  it("finds multiple URLs", () => {
    expect(extractUrls("https://a.com and https://b.com")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  it("preserves URL with path and query string", () => {
    expect(extractUrls("go to https://example.com/path?q=1")).toEqual([
      "https://example.com/path?q=1",
    ]);
  });

  it("returns empty for text with no URLs", () => {
    expect(extractUrls("no links here")).toEqual([]);
  });
});

describe("isImageUrl", () => {
  it("returns true for .jpg", () => {
    expect(isImageUrl("https://example.com/photo.jpg")).toBe(true);
  });

  it("returns true for .jpeg", () => {
    expect(isImageUrl("https://example.com/photo.jpeg")).toBe(true);
  });

  it("returns true for .png", () => {
    expect(isImageUrl("https://example.com/img.png")).toBe(true);
  });

  it("returns true for .gif", () => {
    expect(isImageUrl("https://example.com/a.gif")).toBe(true);
  });

  it("returns true for .webp", () => {
    expect(isImageUrl("https://example.com/a.webp")).toBe(true);
  });

  it("returns true for .svg", () => {
    expect(isImageUrl("https://example.com/a.svg")).toBe(true);
  });

  it("returns true for .avif", () => {
    expect(isImageUrl("https://example.com/a.avif")).toBe(true);
  });

  it("returns false for a regular article URL", () => {
    expect(isImageUrl("https://example.com/article")).toBe(false);
  });

  it("ignores query string when checking extension", () => {
    expect(isImageUrl("https://example.com/photo.jpg?size=large")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isImageUrl("https://example.com/PHOTO.JPG")).toBe(true);
  });

  it("returns false for .pdf", () => {
    expect(isImageUrl("https://example.com/doc.pdf")).toBe(false);
  });
});
```

**Step 2: Run tests — watch them fail**

```bash
cd /Volumes/Storage/Development/GitHub/Together/clients/mobile
npx jest __tests__/utils/links.test.ts --no-coverage 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../../src/utils/links'`.

**Step 3: Implement**

Create `clients/mobile/src/utils/links.ts` (identical logic to web):

```typescript
/** Matches http and https URLs. Stops at whitespace and common delimiters. */
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;

/** Image file extensions we render inline. */
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|svg|avif)(\?.*)?$/i;

/**
 * Extract all http/https URLs from a string, in order of appearance.
 */
export function extractUrls(text: string): string[] {
  return [...text.matchAll(URL_REGEX)].map((m) => m[0]);
}

/**
 * Returns true if the URL's path ends with an image file extension.
 * Query strings are ignored when checking the extension.
 */
export function isImageUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return IMAGE_EXT_RE.test(pathname);
  } catch {
    return false;
  }
}
```

**Step 4: Run tests — watch them pass**

```bash
cd /Volumes/Storage/Development/GitHub/Together/clients/mobile
npx jest __tests__/utils/links.test.ts --no-coverage 2>&1 | tail -10
```

Expected: all 16 tests pass.

**Step 5: Commit**

```bash
git add clients/mobile/src/utils/links.ts clients/mobile/__tests__/utils/links.test.ts
git commit -m "feat(mobile): add extractUrls and isImageUrl link utilities with tests"
```

---

### Task 12: Mobile `LinkPreview` component

**Files:**
- Create: `clients/mobile/src/components/LinkPreview.tsx`

**Step 1: Create the component**

Create `clients/mobile/src/components/LinkPreview.tsx`:

```tsx
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Linking,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { api } from "../api/client";
import type { LinkPreviewDto } from "../types";

interface LinkPreviewProps {
  url: string;
}

export function LinkPreview({ url }: LinkPreviewProps) {
  const [data, setData] = useState<LinkPreviewDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .getLinkPreview(url)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        // Non-fatal: component renders nothing on error
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (loading) {
    return (
      <View style={styles.skeleton}>
        <ActivityIndicator size="small" color="#5865f2" />
      </View>
    );
  }

  if (!data?.title) return null;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => Linking.openURL(url)}
      activeOpacity={0.8}
    >
      <View style={styles.content}>
        {data.site_name && (
          <Text style={styles.siteName} numberOfLines={1}>
            {data.site_name}
          </Text>
        )}
        <Text style={styles.title} numberOfLines={2}>
          {data.title}
        </Text>
        {data.description && (
          <Text style={styles.description} numberOfLines={2}>
            {data.description}
          </Text>
        )}
      </View>
      {data.image && (
        <Image
          source={{ uri: data.image }}
          style={styles.thumbnail}
          resizeMode="cover"
        />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    height: 64,
    marginTop: 6,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.06)",
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    borderLeftWidth: 3,
    borderLeftColor: "#5865f2",
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.04)",
    overflow: "hidden",
  },
  content: {
    flex: 1,
    padding: 10,
    gap: 2,
  },
  siteName: {
    fontSize: 10,
    fontWeight: "700",
    color: "#8e9297",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 13,
    fontWeight: "600",
    color: "#00aff4",
  },
  description: {
    fontSize: 12,
    color: "#b9bbbe",
    lineHeight: 16,
  },
  thumbnail: {
    width: 72,
    height: 72,
    flexShrink: 0,
  },
});
```

**Step 2: TypeScript check**

```bash
cd /Volumes/Storage/Development/GitHub/Together/clients/mobile
npx tsc --noEmit 2>&1 | tail -10
```

Expected: no errors.

**Step 3: Commit**

```bash
git add clients/mobile/src/components/LinkPreview.tsx
git commit -m "feat(mobile): LinkPreview component with OG card and loading state"
```

---

### Task 13: Update mobile `ChatScreen` to render inline images and link previews

**Files:**
- Modify: `clients/mobile/src/screens/ChatScreen.tsx`

**Step 1: Add imports**

At the top of `clients/mobile/src/screens/ChatScreen.tsx`, add to the existing import from `../utils/emoji`:

```tsx
import { extractUrls, isImageUrl } from "../utils/links";
import { LinkPreview } from "../components/LinkPreview";
```

**Step 2: Replace `renderMentionSpans` with `renderContent`**

Remove the `renderMentionSpans` function (lines 56–76) and replace with:

```tsx
/** Renders message content: converts :emoji: codes, renders image URLs inline,
 *  linkifies other URLs, and highlights @mentions.
 *  Returns rendered nodes plus the first non-image URL for the preview card. */
function renderContent(
  content: string,
  memberUsernames: Set<string>,
  currentUsername: string | null,
): { nodes: React.ReactNode[]; firstLinkUrl: string | null } {
  const processed = parseEmoji(content);

  const allUrls = extractUrls(processed);
  const firstLinkUrl = allUrls.find((u) => !isImageUrl(u)) ?? null;

  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
  const parts = processed.split(urlPattern);
  const urlMatches = [...processed.matchAll(urlPattern)].map((m) => m[0]);

  const nodes: React.ReactNode[] = [];

  parts.forEach((textPart, i) => {
    // Text segment with mention highlighting
    if (textPart) {
      textPart.split(/(@\w+)/g).forEach((chunk, j) => {
        const stripped = chunk.startsWith("@") ? chunk.slice(1) : null;
        if (stripped !== null) {
          if (stripped === "everyone" || memberUsernames.has(stripped)) {
            const isSelf =
              stripped !== "everyone" && stripped === currentUsername;
            nodes.push(
              <Text
                key={`t${i}-${j}`}
                style={isSelf ? mentionSelfStyle : mentionStyle}
              >
                {chunk}
              </Text>,
            );
            return;
          }
        }
        nodes.push(<Text key={`t${i}-${j}`}>{chunk}</Text>);
      });
    }

    // URL segment
    const url = urlMatches[i];
    if (url) {
      if (isImageUrl(url)) {
        nodes.push(
          <Image
            key={`u${i}`}
            source={{ uri: url }}
            style={inlineImageStyle}
            resizeMode="contain"
          />,
        );
      } else {
        nodes.push(
          <Text
            key={`u${i}`}
            style={linkStyle}
            onPress={() => Linking.openURL(url)}
          >
            {url}
          </Text>,
        );
      }
    }
  });

  return { nodes, firstLinkUrl };
}
```

**Step 3: Add missing import for `Linking`**

`Linking` is already imported from `react-native` at the top of the file. Confirm it is in the import list; if not, add it.

**Step 4: Add inline style constants**

After the existing `mentionSelfStyle` constant, add:

```tsx
const linkStyle = {
  color: "#00aff4" as const,
};

const inlineImageStyle = {
  width: 200,
  height: 150,
  borderRadius: 4,
  marginTop: 4,
} as const;
```

**Step 5: Update all call sites of `renderMentionSpans`**

Search for `renderMentionSpans(` in `ChatScreen.tsx` and replace each call with the new pattern. There will be one or two call sites inside the message render function. Replace:

```tsx
{renderMentionSpans(msg.content, memberUsernames, currentUser?.username ?? null)}
```

With:

```tsx
{(() => {
  const { nodes, firstLinkUrl } = renderContent(
    msg.content,
    memberUsernames,
    currentUser?.username ?? null,
  );
  return (
    <>
      <Text>{nodes}</Text>
      {firstLinkUrl && <LinkPreview url={firstLinkUrl} />}
    </>
  );
})()}
```

**Step 6: TypeScript check**

```bash
cd /Volumes/Storage/Development/GitHub/Together/clients/mobile
npx tsc --noEmit 2>&1 | tail -10
```

Expected: no errors.

**Step 7: Run all mobile tests**

```bash
cd /Volumes/Storage/Development/GitHub/Together/clients/mobile
npx jest --no-coverage 2>&1 | tail -10
```

Expected: all tests pass.

**Step 8: Commit**

```bash
git add clients/mobile/src/screens/ChatScreen.tsx
git commit -m "feat(mobile): render inline image URLs and link preview cards in messages"
```

---

### Task 14: Final checks and CI push

**Step 1: Run server lint and tests**

```bash
cd /Volumes/Storage/Development/GitHub/Together/server
~/.cargo/bin/cargo fmt --manifest-path Cargo.toml
~/.cargo/bin/cargo clippy -- -D warnings 2>&1 | tail -20
~/.cargo/bin/cargo test 2>&1 | tail -10
```

Expected: fmt exits cleanly, clippy no warnings, all tests pass.

**Step 2: Run all web checks**

```bash
cd /Volumes/Storage/Development/GitHub/Together/clients/web
npm run lint && npm run typecheck && npm test 2>&1 | tail -10
```

Expected: no errors, all tests pass.

**Step 3: Run all mobile checks**

```bash
cd /Volumes/Storage/Development/GitHub/Together/clients/mobile
npx tsc --noEmit && npx jest --no-coverage 2>&1 | tail -10
```

Expected: no errors, all tests pass.

**Step 4: Push branch and open PR**

```bash
git push -u origin phase-16-link-previews
gh pr create \
  --title "Phase 16: Link and image previews" \
  --body "$(cat <<'EOF'
## Summary
- Image URLs in messages render inline (max 400×300px), like Discord
- First non-image URL in a message fetches Open Graph metadata via `GET /link-preview?url=...` and shows a preview card (title, description, thumbnail, site name)
- Server: new `scraper`-powered OG parser, 24-hour in-memory cache, SSRF protection rejects private/loopback IPs
- Web and mobile both updated with the same URL detection logic and preview components

## Test Plan
- [ ] Server unit tests: `cargo test link_preview` — all pass
- [ ] Web unit tests: `npm test` in `clients/web` — all pass
- [ ] Mobile unit tests: `npx jest` in `clients/mobile` — all pass
- [ ] CI green across all jobs

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
