⚠️ This document has been moved to the [Together docs site](https://docs.together-chat.com/features/link-previews-and-giphy).
Please visit the new site for the latest version.

---

# Link Previews and Giphy Integration

Together supports automatic link previews for URLs pasted in messages and a built-in GIF search powered by the Giphy API.

## Link Previews

### How It Works

When a message contains a URL, the client extracts the first non-image link from the message text and renders a `LinkPreview` card beneath it. The card fetches Open Graph metadata from the server, which in turn fetches the target page, parses its HTML, and returns structured metadata.

The extraction flow on the client:

1. `extractUrls()` scans the message text with a regex matching `http://` and `https://` URLs.
2. The first URL that is not an image (checked by file extension) is selected.
3. The `LinkPreview` component calls `GET /link-preview` with that URL.
4. If the response contains a title, the preview card is rendered. If not (or if the request fails), nothing is shown — preview failures are non-fatal.

### Endpoint

```
GET /link-preview?url=<encoded-url>
Authorization: Bearer <token>
```

Requires authentication. The `url` query parameter must be a URL-encoded `http://` or `https://` URL.

### Response

```json
{
  "url": "https://example.com/article",
  "title": "Article Title",
  "description": "A short summary of the page.",
  "image": "https://cdn.example.com/og-image.png",
  "site_name": "Example"
}
```

All fields except `url` are optional (any may be `null`). The server populates them as follows:

| Field         | Primary source              | Fallback                                |
| ------------- | --------------------------- | --------------------------------------- |
| `title`       | `og:title` meta property    | `<title>` tag                           |
| `description` | `og:description` meta property | `<meta name="description">` tag      |
| `image`       | `og:image` meta property    | None (must be an `http://` or `https://` URL) |
| `site_name`   | `og:site_name` meta property | Hostname extracted from the URL        |

### Caching

Responses are cached in-memory on the server using a `HashMap<String, LinkPreviewCacheEntry>` behind an `RwLock`.

- **TTL**: 24 hours (`86_400` seconds). After expiry the URL is re-fetched on the next request.
- **Max entries**: 10,000. Once the cache is full, new URLs are not cached (existing entries still serve until they expire).
- **Scope**: Per-process. The cache is not shared across server restarts or multiple instances.

### SSRF Protection

The server prevents Server-Side Request Forgery (SSRF) attacks:

1. Only `http` and `https` schemes are allowed.
2. The URL's hostname is resolved via DNS, and every resolved IP address is checked against a blocklist of private, loopback, and link-local ranges (e.g., `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, ULA `fc00::/7`, link-local `fe80::/10`).
3. The first resolved IP is pinned to the HTTP client via `reqwest::ClientBuilder::resolve()` to prevent DNS rebinding (TOCTOU race where the attacker's DNS changes the resolved IP between the check and the actual fetch).

### Fetch Limits

- **Timeout**: 5 seconds per request.
- **Body size**: Capped at 1 MB. If the `Content-Length` header exceeds 1 MB, the request is rejected before downloading. If no header is present, the body is truncated to 1 MB after download.
- **User-Agent**: `Mozilla/5.0 (compatible; TogetherLinkBot/1.0; +https://github.com/jtjenkins/Together)`

### Error Cases

| Condition                           | HTTP Status | Error                                        |
| ----------------------------------- | ----------- | -------------------------------------------- |
| Missing or malformed `url` param    | 400         | `"Invalid URL"`                              |
| Non-http/https scheme               | 400         | `"Only http/https URLs are supported"`       |
| URL has no host                     | 400         | `"URL has no host"`                          |
| DNS resolution failure              | 400         | `"Could not resolve URL host"`               |
| Resolves to private/loopback IP     | 400         | `"URL resolves to a private or reserved address"` |
| Response body exceeds 1 MB          | 400         | `"Response too large"`                       |
| Fetch timeout or network error      | 400         | `"Failed to fetch URL"`                      |
| Internal client build failure       | 500         | Internal server error                        |
| Not authenticated                   | 401         | Unauthorized                                 |

## Giphy Integration

### How It Works

Users type the `/giphy <query>` slash command in the message input. This opens a GIF picker panel that searches the Giphy API via the server and displays results in a grid. Selecting a GIF inserts it into the message.

The search is debounced on the client (400ms delay) so the API is not called on every keystroke.

### Configuration

The server requires a `GIPHY_API_KEY` environment variable. The key is read at startup and stored as `Option<Arc<str>>` on `AppState`. If the key is not set, the search endpoint returns a 500 error.

### Endpoint

```
GET /giphy/search?q=<query>&limit=<n>
Authorization: Bearer <token>
```

Requires authentication.

**Query parameters:**

| Parameter | Type    | Required | Default | Notes                              |
| --------- | ------- | -------- | ------- | ---------------------------------- |
| `q`       | string  | yes      | --      | Search query                       |
| `limit`   | integer | no       | 15      | Number of results, capped at 25    |

The server forwards the query to `https://api.giphy.com/v1/gifs/search` with `rating=g` (safe content only).

### Response

```json
[
  {
    "url": "https://media.giphy.com/media/.../giphy.gif",
    "preview_url": "https://media.giphy.com/media/.../200_d.gif",
    "title": "Funny Cat GIF",
    "width": 480,
    "height": 360
  }
]
```

| Field         | Description                                                   |
| ------------- | ------------------------------------------------------------- |
| `url`         | Full-size GIF URL (from Giphy's `images.original.url`)        |
| `preview_url` | Smaller preview (from `images.fixed_height_downsampled.url`), falls back to `url` |
| `title`       | GIF title from Giphy, empty string if none                    |
| `width`       | Original width in pixels (0 if not available)                 |
| `height`      | Original height in pixels (0 if not available)                |

### Error Cases

| Condition                  | HTTP Status | Error                          |
| -------------------------- | ----------- | ------------------------------ |
| `GIPHY_API_KEY` not set    | 500         | Internal server error          |
| Giphy API unreachable      | 500         | Internal server error          |
| Giphy API returns an error | 500         | Internal server error          |
| Response parse failure     | 500         | Internal server error          |
| Not authenticated          | 401         | Unauthorized                   |

All Giphy errors are logged server-side with `tracing::error!` but returned to the client as generic 500 errors to avoid leaking internal details.

## Client Components

### LinkPreview (React)

Located at `clients/web/src/components/messages/LinkPreview.tsx`. Renders as a card with site name, clickable title, description, and thumbnail image. Shows a skeleton placeholder while loading. Renders nothing if the preview has no title or if the fetch fails.

### GifPicker (React)

Located at `clients/web/src/components/messages/GifPicker.tsx`. Triggered by the `/giphy` slash command. Displays a search input and a grid of clickable GIF thumbnails (using `preview_url`). If the Giphy API key is not configured, shows the message "Could not load GIFs. Is GIPHY_API_KEY configured?".
