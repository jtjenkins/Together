use std::net::IpAddr;
use std::time::Duration;

use scraper::{Html, Selector};
use url::Url;

use crate::models::LinkPreviewDto;

pub const CACHE_TTL: Duration = Duration::from_secs(86_400);
pub const FETCH_TIMEOUT: Duration = Duration::from_secs(5);
pub const USER_AGENT: &str =
    "Mozilla/5.0 (compatible; TogetherLinkBot/1.0; +https://github.com/jtjenkins/Together)";

// ── Public helpers ─────────────────────────────────────────────────────────

/// Returns `true` if `ip` is a private, loopback, or link-local address.
pub fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            matches!(
                o,
                [127, ..] |
                [10, ..] |
                [169, 254, ..] |
                [192, 168, ..] |
                [0, ..] |
                [255, 255, 255, 255]
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

    let title = get_meta_property(&document, "og:title")
        .or_else(|| get_title_tag(&document));

    let description = get_meta_property(&document, "og:description")
        .or_else(|| get_meta_name(&document, "description"));

    let image = get_meta_property(&document, "og:image");

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
}
