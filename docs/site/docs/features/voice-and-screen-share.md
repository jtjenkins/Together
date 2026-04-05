---
outline: deep
---

# Screen Sharing

Together supports screen sharing within voice channels. Multiple participants can share their screens simultaneously, and all active shares appear in a video grid alongside camera feeds.

---

## Starting and Stopping a Screen Share

### Prerequisites

- You must already be in a voice channel.
- Your browser or OS must grant screen capture permission when prompted.

### Starting

1. Join a voice channel.
2. In the voice channel controls bar, click the **Screen Share** button (the monitor icon).
3. Your browser or operating system will open a native source picker — choose a screen, a window, or a browser tab.
4. Click **Share** (or the equivalent in your OS picker). Your screen feed immediately appears in the video grid for all channel members.

### Stopping

You can stop a screen share in two ways:

- Click the **Screen Share** button again in the Together controls bar (it will be highlighted while active).
- Click the **Stop sharing** button in your browser's or OS's built-in sharing indicator bar. Together detects this automatically and syncs its state.

Leaving the voice channel also ends any active screen share.

---

## Quality and Resolution

Screen sharing uses your browser's default `getDisplayMedia` capture settings. Together does not currently expose manual quality or resolution controls — the browser negotiates resolution and frame rate based on available bandwidth.

Practical characteristics:

- **Resolution:** Typically captures at your source resolution, scaled to what the WebRTC connection can sustain.
- **Frame rate:** Browser default (usually up to 30 fps for tab sharing, lower for full-screen capture).
- **Audio:** System audio is **not** captured during screen sharing. Only the content you see is shared — no application sounds or microphone audio is added to the screen feed. Your microphone audio continues over the normal voice channel.

Future versions may add bitrate controls for managing bandwidth in larger calls.

---

## Multiple Simultaneous Sharers

Any number of participants can share their screen at the same time. Each active share appears as a separate tile in the video grid. Camera feeds and screen feeds are shown together in the same grid layout.

---

## Privacy Considerations

- **What is shared:** Exactly what you select in the OS/browser source picker — a specific screen, window, or tab. Nothing outside your selection is captured.
- **Who can see it:** All members currently in the same voice channel.
- **Server visibility:** Together uses a peer-to-peer (P2P) WebRTC architecture. Screen share video flows **directly between your browser and your peers** — the Together server never receives, processes, or stores any screen share video or audio.
- **Tab sharing tip:** Sharing a specific browser tab is the most privacy-preserving option. It limits capture to exactly that tab and prevents accidentally revealing notifications, other windows, or taskbar contents.
- **Stop before switching:** If you switch to a window that contains sensitive content, stop sharing first. The OS source picker selects the source at the time you start sharing — switching away does not automatically stop the share.

---

## Go Live System

In addition to basic screen sharing (P2P via WebRTC), Together provides a server-managed **Go Live** feature for structured broadcasting within voice channels.

### Server-Side Session Management

Go Live sessions are managed through `handlers/go_live.rs`, which provides dedicated REST endpoints:

| Method | Endpoint                              | Description                        |
| ------ | ------------------------------------- | ---------------------------------- |
| POST   | `/channels/:channel_id/go-live`       | Start a Go Live session            |
| DELETE | `/channels/:channel_id/go-live`       | Stop the current Go Live session   |
| GET    | `/channels/:channel_id/go-live`       | Get the active Go Live session     |

### Quality Tiers

When starting a Go Live session, the broadcaster selects a quality tier:

| Tier   | Resolution | Use Case                    |
| ------ | ---------- | --------------------------- |
| 480p   | 854x480    | Low bandwidth / mobile      |
| 720p   | 1280x720   | Default / general use       |
| 1080p  | 1920x1080  | High quality / presentations|

### Enforcement

Only **one broadcaster per channel** is allowed at a time. If a second user attempts to start a Go Live session while one is already active, the request is rejected.

### WebSocket Events

| Event           | Direction       | Description                                      |
| --------------- | --------------- | ------------------------------------------------ |
| `GO_LIVE_START` | server → client | Broadcast when a user begins a Go Live session   |
| `GO_LIVE_STOP`  | server → client | Broadcast when the Go Live session ends           |

### Voice State Integration

The voice state for each user tracks a `self_screen` field indicating whether the user is currently sharing their screen via Go Live. This is included in `VOICE_STATE_UPDATE` events so all channel participants can update their UI accordingly.

---

## Limitations

| Limitation              | Detail                                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Voice channel only      | Screen sharing is available inside voice channels. There is no standalone screen share outside a voice call.                                                                                                                                                                                                                                        |
| No system audio         | Application sounds and system audio are not captured. Microphone audio is transmitted separately over the voice channel.                                                                                                                                                                                                                            |
| Mobile support          | Screen sharing requires `getDisplayMedia` browser support. On mobile (Android/iOS via the Together app), screen sharing may not be available or may be restricted by the OS. If unsupported, Together shows an error and remains in its previous state — the voice connection is unaffected.                                                        |
| Bandwidth at scale      | Together uses P2P mesh networking. Each participant receives a direct stream from each sharer. In a channel with many active sharers, outbound bandwidth requirements increase. For typical gaming groups (3–8 people), this is not an issue. Very large channels with many simultaneous video and screen feeds may experience quality degradation. |
| No recording            | Together does not record screen shares. There is no server-side storage of any video feed.                                                                                                                                                                                                                                                          |
| No source pre-selection | The screen source (monitor, window, or tab) is chosen via your OS/browser picker at the moment you click Share. There is no in-app dropdown to pre-select a source.                                                                                                                                                                                 |

---

## Troubleshooting

**"Screen sharing is not supported on this device"**
Your browser or OS does not support `getDisplayMedia`. This is common on iOS and some Android configurations. Ensure you are using a supported browser (Chrome, Firefox, Edge, or Safari 13+) and that screen recording permission has been granted in OS settings.

**Permission denied**
You clicked "Cancel" or "Don't Allow" in the browser or OS permission prompt. Click the Screen Share button again and accept the permission request. On macOS, you may need to grant Screen Recording permission to your browser in **System Settings → Privacy & Security → Screen Recording**.

**Peers cannot see my screen**

- Confirm you see an active share indicator in the controls bar.
- Ask peers to check if the video grid is visible in their voice channel view.
- If the issue persists, leaving and rejoining the voice channel re-establishes all peer connections.

**Low quality or stuttering**
Screen sharing quality is negotiated based on available network bandwidth. Sharing a single window or browser tab instead of a full screen reduces the required bitrate and often improves stability.
