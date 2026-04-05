---
outline: deep
---

# iOS Voice Setup

Together's voice feature uses WebRTC. On iOS, the WKWebView (Safari engine used by
Tauri) cannot generate "Host" ICE candidates due to iOS network privacy restrictions.
This means voice calls from iOS devices **require a TURN server** to connect.

## TURN Server Setup (coturn)

Add to `docker-compose.dev.yml`:

```yaml
coturn:
  image: coturn/coturn:latest
  ports:
    - "3478:3478/udp"
    - "3478:3478/tcp"
    - "49152-49200:49152-49200/udp"
  command: >
    -n --log-file=stdout
    --min-port=49152 --max-port=49200
    --use-auth-secret
    --static-auth-secret=together_dev_turn_secret
    --realm=together.local
  network_mode: host
```

## ICE Server Endpoint

The Together server provides a `GET /ice-servers` endpoint that returns the ICE server configuration for WebRTC connections. This endpoint requires authentication (`Authorization: Bearer <token>`).

### Response Format

The response includes STUN and (when configured) TURN servers:

- **STUN servers** (Google public: `stun:stun.l.google.com:19302`, `stun:stun1.l.google.com:19302`) are **always included**, even when no TURN server is configured.
- **TURN servers** are included only when `TURN_URL` and `TURN_SECRET` are set in the environment.

### TURN Credential Generation

TURN credentials are generated using **HMAC-SHA1** with the shared secret configured in `TURN_SECRET`:

- **Username format**: `{timestamp}:{username}` — where `timestamp` is the Unix epoch when the credential expires and `username` is the authenticated user's username. This produces per-user credentials.
- **TTL**: Credentials are valid for **24 hours** from the time of generation.
- **Password**: The HMAC-SHA1 digest of the username string, using the shared secret as the key, base64-encoded.

This follows the standard coturn ephemeral credential mechanism (RFC draft `--use-auth-secret`).

---

## Background Mic Behavior

iOS WebView mutes the microphone when the app goes to background (e.g., user switches
to check email). The mic unmutes automatically when returning to Together. This is an
accepted limitation of the Tauri v2 WebView approach on iOS.
