use std::net::IpAddr;
use std::time::{Duration, Instant};

use axum::extract::{Query, State};
use axum::Json;
use reqwest::Client as ReqwestClient;
use scraper::{Html, Selector};
use serde::Deserialize;
use url::Url;

use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::models::LinkPreviewDto;
use crate::state::AppState;

pub const CACHE_TTL: Duration = Duration::from_secs(86_400);
pub const FETCH_TIMEOUT: Duration = Duration::from_secs(5);
pub const USER_AGENT: &str =
    "Mozilla/5.0 (compatible; TogetherLinkBot/1.0; +https://github.com/jtjenkins/Together)";
const MAX_CACHE_ENTRIES: usize = 10_000;

/// One entry in the link-preview in-memory cache.
///
/// `cached_at` records when the metadata was fetched; entries are valid for
/// `CACHE_TTL` (24 hours) after that point.
#[derive(Clone)]
pub struct LinkPreviewCacheEntry {
    pub dto: LinkPreviewDto,
    cached_at: Instant,
}

impl LinkPreviewCacheEntry {
    fn new(dto: LinkPreviewDto) -> Self {
        Self {
            dto,
            cached_at: Instant::now(),
        }
    }

    pub fn is_fresh(&self) -> bool {
        self.cached_at.elapsed() < CACHE_TTL
    }
}

// ── Public helpers ─────────────────────────────────────────────────────────

/// Returns `true` if `ip` is a private, loopback, or link-local address.
pub fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            matches!(
                o,
                [127, ..]
                    | [10, ..]
                    | [169, 254, ..]
                    | [192, 168, ..]
                    | [0, ..]
                    | [255, 255, 255, 255]
            ) || (o[0] == 172 && (16..=31).contains(&o[1]))
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || (v6.segments()[0] & 0xfe00 == 0xfc00)
                || (v6.segments()[0] & 0xffc0 == 0xfe80)
        }
    }
}

/// Parse Open Graph tags from `html` and return a `LinkPreviewDto`.
/// Falls back to `<title>` for the title and hostname for site_name.
pub fn extract_og_data(html: &str, base_url: &str) -> LinkPreviewDto {
    let document = Html::parse_document(html);

    let title = get_meta_property(&document, "og:title").or_else(|| get_title_tag(&document));

    let description = get_meta_property(&document, "og:description")
        .or_else(|| get_meta_name(&document, "description"));

    let image = get_meta_property(&document, "og:image")
        .filter(|url| url.starts_with("http://") || url.starts_with("https://"));

    let site_name = get_meta_property(&document, "og:site_name").or_else(|| {
        Url::parse(base_url)
            .ok()
            .and_then(|u: Url| u.host_str().map(|h: &str| h.to_string()))
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
    let selector = Selector::parse(&format!(r#"meta[property="{property}"]"#)).ok()?;
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
    let parsed = Url::parse(&url_str).map_err(|_| AppError::Validation("Invalid URL".into()))?;

    match parsed.scheme() {
        "http" | "https" => {}
        _ => {
            return Err(AppError::Validation(
                "Only http/https URLs are supported".into(),
            ))
        }
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::Validation("URL has no host".into()))?
        .to_string();

    // ── SSRF: resolve hostname and check all IPs ──────────────────────────
    let lookup_target = format!("{}:80", host);
    let addrs: Vec<std::net::SocketAddr> = tokio::net::lookup_host(&lookup_target)
        .await
        .map_err(|e| {
            tracing::warn!(
                error = ?e,
                host = %host,
                "DNS lookup failed for link preview URL"
            );
            AppError::Validation("Could not resolve URL host".into())
        })?
        .collect();

    for addr in &addrs {
        if is_private_ip(addr.ip()) {
            return Err(AppError::Validation(
                "URL resolves to a private or reserved address".into(),
            ));
        }
    }

    // Pin the first resolved IP to the reqwest client to prevent DNS rebinding
    // (TOCTOU race where attacker-controlled DNS switches IPs between our check and reqwest's lookup).
    let pinned_addr = addrs
        .first()
        .copied()
        .ok_or_else(|| AppError::Validation("Could not resolve URL host".into()))?;

    // ── Check cache ───────────────────────────────────────────────────────
    {
        let cache = state.link_preview_cache.read().await;
        if let Some(entry) = cache.get(&url_str) {
            if entry.is_fresh() {
                return Ok(Json(entry.dto.clone()));
            }
        }
    }

    // ── Fetch and parse ───────────────────────────────────────────────────
    // Build a per-request client with the validated IP pinned to prevent DNS rebinding.
    let client = ReqwestClient::builder()
        .timeout(FETCH_TIMEOUT)
        .user_agent(USER_AGENT)
        .resolve(&host, pinned_addr)
        .build()
        .map_err(|e| {
            tracing::error!(error = ?e, "Failed to build reqwest client for link preview");
            AppError::Internal
        })?;

    let response = client.get(&url_str).send().await.map_err(|e| {
        tracing::warn!(error = ?e, url = %url_str, "Failed to fetch URL for link preview");
        AppError::Validation("Failed to fetch URL".into())
    })?;

    // Cap response body at 1 MB to prevent memory exhaustion from large/streaming responses.
    let bytes = response.bytes().await.map_err(|e| {
        tracing::warn!(
            error = ?e,
            url = %url_str,
            "Failed to read response body for link preview"
        );
        AppError::Internal
    })?;
    const MAX_BODY_BYTES: usize = 1_048_576; // 1 MB
    let html = if bytes.len() > MAX_BODY_BYTES {
        String::from_utf8_lossy(&bytes[..MAX_BODY_BYTES]).into_owned()
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    };

    let dto = extract_og_data(&html, &url_str);

    // ── Store in cache (skip if cache is full) ────────────────────────────
    {
        let mut cache = state.link_preview_cache.write().await;
        if cache.len() < MAX_CACHE_ENTRIES {
            cache.insert(url_str, LinkPreviewCacheEntry::new(dto.clone()));
        }
    }

    Ok(Json(dto))
}

// ── Unit tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn allows_172_15_just_outside_private_range() {
        assert!(!is_private_ip("172.15.255.255".parse().unwrap()));
    }

    #[test]
    fn allows_172_32_just_outside_private_range() {
        assert!(!is_private_ip("172.32.0.0".parse().unwrap()));
    }

    #[test]
    fn blocks_ipv6_ula() {
        assert!(is_private_ip("fc00::1".parse().unwrap()));
        assert!(is_private_ip("fd00::1".parse().unwrap()));
    }

    #[test]
    fn blocks_ipv6_link_local() {
        assert!(is_private_ip("fe80::1".parse().unwrap()));
    }

    #[test]
    fn meta_description_fallback() {
        let html = r#"<html><head>
            <meta name="description" content="Plain meta desc"/>
        </head></html>"#;
        let dto = extract_og_data(html, "https://example.com");
        assert_eq!(dto.description.as_deref(), Some("Plain meta desc"));
    }

    #[test]
    fn og_description_takes_precedence_over_meta_description() {
        let html = r#"<html><head>
            <meta property="og:description" content="OG desc"/>
            <meta name="description" content="Plain desc"/>
        </head></html>"#;
        let dto = extract_og_data(html, "https://example.com");
        assert_eq!(dto.description.as_deref(), Some("OG desc"));
    }

    #[test]
    fn rejects_non_https_og_image() {
        let html = r#"<html><head>
            <meta property="og:image" content="data:image/png;base64,abc"/>
        </head></html>"#;
        let dto = extract_og_data(html, "https://example.com");
        assert!(dto.image.is_none());
    }

    #[test]
    fn accepts_https_og_image() {
        let html = r#"<html><head>
            <meta property="og:image" content="https://cdn.example.com/img.png"/>
        </head></html>"#;
        let dto = extract_og_data(html, "https://example.com");
        assert_eq!(
            dto.image.as_deref(),
            Some("https://cdn.example.com/img.png")
        );
    }
}
