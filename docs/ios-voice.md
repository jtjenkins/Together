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

## Background Mic Behavior

iOS WebView mutes the microphone when the app goes to background (e.g., user switches
to check email). The mic unmutes automatically when returning to Together. This is an
accepted limitation of the Tauri v2 WebView approach on iOS.
