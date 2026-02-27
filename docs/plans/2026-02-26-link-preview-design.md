# Link & Image Preview Design

**Date:** 2026-02-26
**Status:** Approved

## Summary

Add Discord-style inline image rendering and link preview cards to message rendering on web and mobile. Image URLs in message text render as inline images. The first non-image URL in a message triggers a server-fetched Open Graph preview card displayed below the message.

## Decisions

| Question | Decision |
|---|---|
| Image URLs in text | Render inline (like Discord) |
| OG metadata fetch location | Server-side endpoint |
| Cache TTL | 24-hour in-memory |
| Preview count per message | First non-image URL only |

## Architecture & Data Flow

```
Message text: "Check this out https://verge.com/article and https://i.imgur.com/cat.png"

Client render:
  1. Regex finds URLs in text
  2. Image URL (.png) → isImageUrl() = true → render <img> inline
  3. First non-image URL → GET /link-preview?url=https://verge.com/article
     Server: cache check (24hr) → reqwest fetch → parse OG tags → cache + return
     Client: render LinkPreview card below message text
```

**Rules:**
- Image URLs render inline, max 400×300px, click to open full URL
- Only the first non-image URL per message gets a preview card
- The raw URL remains visible as text in the message body
- `/link-preview` requires a valid JWT but no specific server membership

## Server Implementation

### New dependency
`scraper = "0.19"` in `server/Cargo.toml` — parses HTML to extract `<meta>` and `<title>` tags.

### Cache
`Arc<Mutex<HashMap<String, (LinkPreviewDto, Instant)>>>` added to `AppState`. Entries expire after 24 hours (checked on read, not evicted on a timer — good enough for this scale).

### New route
`GET /link-preview?url=<encoded-url>` — authenticated handler in `server/src/handlers/link_preview.rs`.

### Handler logic
1. Parse and validate URL (must be `http` or `https` scheme)
2. **SSRF protection:** resolve hostname, reject private/loopback IPs (`127.x`, `10.x`, `172.16-31.x`, `192.168.x`, `169.254.x`, `::1`)
3. Check in-memory cache — return if entry is <24 hours old
4. `reqwest::get(url)` with 5-second timeout and a real `User-Agent` header to avoid bot blocks
5. Parse HTML with `scraper`:
   - `og:title` → `title` (fallback: `<title>` tag)
   - `og:description` → `description`
   - `og:image` → `image`
   - `og:site_name` → `site_name` (fallback: URL hostname)
6. Store result in cache and return `200 OK`

### Response shape
```json
{
  "url": "https://example.com/article",
  "title": "Article Title",
  "description": "Optional description text.",
  "image": "https://example.com/og-image.jpg",
  "site_name": "Example"
}
```
All fields except `url` are nullable. Returns `200` with partial data rather than an error so the client degrades gracefully.

## Web Client Implementation

### New files
- `clients/web/src/utils/links.ts` — `extractUrls(text)`, `isImageUrl(url)`
- `clients/web/src/components/messages/LinkPreview.tsx`
- `clients/web/src/components/messages/LinkPreview.module.css`

### `links.ts`
```typescript
// Returns all http/https URLs found in text
extractUrls(text: string): string[]

// True for .jpg .jpeg .png .gif .webp .svg .avif extensions
isImageUrl(url: string): boolean
```

### `MessageItem.tsx` changes
- `renderMentions()` → `renderContent()`: splits text on URLs (and `@mentions`), wrapping image URLs in inline `<img>` tags
- Below message text: `<LinkPreview url={firstNonImageUrl} />` if one exists
- `<LinkPreview>` fetches lazily on mount; shows a subtle skeleton while loading; renders nothing on error

### `api.client.ts` addition
`getLinkPreview(url: string): Promise<LinkPreviewDto>`

### Preview card appearance
```
┌─────────────────────────────────────────┐
│  site_name (small, muted)               │
│                                         │
│  Title (bold, links to URL)             │
│  Description, max 3 lines...  [thumb]   │
└─────────────────────────────────────────┘
```
- Dark card with 3px left accent border, max 400px wide
- OG image thumbnail: 80×80px, `object-fit: cover`, right-aligned
- Title is an `<a>` to the URL (`target="_blank"`)
- Card itself is not a link (avoids accidental navigation)

## Mobile Client Implementation

### New files
- `clients/mobile/src/utils/links.ts` — same utilities as web
- `clients/mobile/src/components/LinkPreview.tsx`

### `ChatScreen.tsx` changes
- `renderMentionSpans()` → `renderContent()`: same URL-splitting logic, wraps image URLs in RN `<Image>` components inline
- `<LinkPreview url={...} />` renders below message bubble for first non-image URL

### Preview card (React Native)
- `View` with dark background + `borderLeftWidth: 3` accent
- `numberOfLines={2}` on description
- 72×72 `Image` with `resizeMode="cover"`, right-aligned
- Tapping opens URL via `Linking.openURL()`

## Testing

### Server
- Unit tests for SSRF IP validation
- Integration test for `GET /link-preview` using a real or mock HTTP response

### Web
- `clients/web/src/__tests__/links.test.ts` — `extractUrls`, `isImageUrl`
- `clients/web/src/__tests__/link-preview.test.tsx` — skeleton render, card render with mocked API, no-op on error

### Mobile
- `clients/mobile/__tests__/utils/links.test.ts` — same utility coverage as web
