# Video Calls & Screen Sharing — Design Spec

**Date:** 2026-03-13
**Branch:** feature/message-search (to be implemented on a new feature branch)
**Status:** Approved

---

## Overview

Add optional camera video and screen sharing to existing voice channels. Users in a voice channel can independently toggle their camera and/or share their screen. Multiple users can share screens simultaneously. All video feeds are displayed in a grid layout within the voice channel UI.

This feature extends the existing P2P WebRTC mesh without changing the signaling protocol or channel type system.

> **Architecture note:** `CLAUDE.md` describes the voice architecture as "SFU (Selective Forwarding Unit)" but the actual implementation in `useWebRTC.ts` is a true P2P mesh — each client holds one `RTCPeerConnection` per peer with no server-side media forwarding. This spec and implementation follow the actual code, not the outdated documentation.

---

## Scope

**In scope:**
- Camera video toggle in voice channels
- Screen share toggle in voice channels (multiple simultaneous sharers)
- Grid layout for all active video/screen feeds
- Best-effort screen sharing on mobile (graceful error fallback)
- State broadcast to all channel members via existing `VOICE_STATE_UPDATE` event

**Out of scope:**
- Dedicated video channel type (no new channel type added)
- Recording
- SFU/media server
- Server-side video processing
- System audio capture during screen sharing (see note in Frontend Changes)

---

## Architecture

### Approach: Extend existing P2P connections (renegotiation)

Video and screen tracks are added to the existing `RTCPeerConnection` per peer. When a user enables their camera or starts a screen share, the track is added to each peer connection and WebRTC's `onnegotiationneeded` fires a new offer/answer exchange over the existing `VOICE_SIGNAL` WebSocket relay. No signaling protocol changes are required.

**Bandwidth characteristics:** P2P mesh is O(n²) for video bandwidth. At 10 participants all sharing video this is 90 simultaneous video streams. Acceptable for gaming voice channels (typically 3–8 participants). Migration to an SFU is the defined path if this becomes a bottleneck.

---

## Backend Changes

### 1. Database Migration

Create a new migration file with a filename that sorts after the current last migration. Sqlx applies migrations in lexicographic filename order. The current last migration is `20240312000003_is_admin.sql`. Using today's date, the new file should be named `20260313000001_voice_video.sql` (which sorts after all existing migrations):

```sql
ALTER TABLE voice_states
  ADD COLUMN self_video  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN self_screen BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN voice_states.self_video  IS 'User has camera enabled';
COMMENT ON COLUMN voice_states.self_screen IS 'User is sharing their screen';
```

Both columns default to `FALSE` — existing rows are unaffected. A corresponding `20260313000001_voice_video.down.sql` should `ALTER TABLE voice_states DROP COLUMN self_video, DROP COLUMN self_screen`.

### 2. Model Changes (`server/src/models/mod.rs`)

- `VoiceState` gains `self_video: bool`, `self_screen: bool`
- `VoiceStateDto` gains `self_video: bool`, `self_screen: bool`
- `UpdateVoiceStateRequest` gains `self_video: Option<bool>`, `self_screen: Option<bool>`

> **Important:** `UpdateVoiceStateRequest` is decorated with `#[serde(deny_unknown_fields)]`. The new fields **must** be added to the struct before the migration is deployed — otherwise any request body containing `self_video` or `self_screen` will be rejected with a deserialization error even if the SQL already accepts them.

- `VoiceStateDto::leave` constructor: set `self_video: false` and `self_screen: false`

### 3. PATCH Handler (`server/src/handlers/voice.rs`)

**Validation guard** — the current guard checks only `self_mute` and `self_deaf`. It must be extended to cover the new fields, otherwise a body of `{ "self_video": true }` will be rejected with a 400:

```rust
if req.self_mute.is_none() && req.self_deaf.is_none()
    && req.self_video.is_none() && req.self_screen.is_none()
{
    return Err(AppError::Validation(
        "At least one field must be provided".into(),
    ));
}
```

**SQL** — the `COALESCE` update extends to the new fields, and the `RETURNING` clause must explicitly include them (the existing handler uses an explicit column list, not `RETURNING *`):

```sql
UPDATE voice_states
SET self_mute   = COALESCE($1, self_mute),
    self_deaf   = COALESCE($2, self_deaf),
    self_video  = COALESCE($3, self_video),
    self_screen = COALESCE($4, self_screen)
WHERE user_id = $5 AND channel_id = $6
RETURNING user_id, channel_id, self_mute, self_deaf,
          server_mute, server_deaf, self_video, self_screen, joined_at
```

**`join_voice_channel` UPSERT** — the existing `RETURNING` clause in `join_voice_channel` also uses an explicit column list and must be updated to include `self_video` and `self_screen`, otherwise `sqlx` will fail to deserialize the returned `VoiceState` row.

**`list_voice_participants`** — `VoiceParticipantRow` is constructed via a `JOIN` query and used to build `VoiceStateDto` with named-field struct syntax. Both the query and the `VoiceParticipantRow` struct must include `self_video` and `self_screen`, otherwise the code will fail to compile (missing struct fields) and the participant list response will be missing the new fields.

### 4. VOICE_STATE_UPDATE Broadcast

`VoiceStateDto` is serialized directly for broadcast. Once `self_video` and `self_screen` are on the struct, they appear in all `VOICE_STATE_UPDATE` payloads automatically. No broadcast code changes are needed.

### 5. Leave / Disconnect Cleanup

Voice state rows are deleted on leave/disconnect. No explicit cleanup of video/screen state is required.

---

## Frontend Changes

### 1. TypeScript Types (`clients/web/src/types/index.ts`)

**`VoiceParticipant`** gains:
```typescript
self_video: boolean;
self_screen: boolean;
```

**`VoiceStateUpdateEvent`** also gains the same two fields (it mirrors `VoiceParticipant` and is used by the WebSocket event handler for `VOICE_STATE_UPDATE` events):
```typescript
self_video: boolean;
self_screen: boolean;
```

**`UpdateVoiceStateRequest`** gains:
```typescript
self_video?: boolean;
self_screen?: boolean;
```
This is required so `toggleCamera` / `toggleScreen` in `voiceStore` can call `api.updateVoiceState(channelId, { self_video: true } satisfies UpdateVoiceStateRequest)` without a TypeScript compile error.

### 2. Voice Store (`clients/web/src/stores/voiceStore.ts`)

New state fields:
```typescript
isCameraOn: boolean       // local camera active
isScreenSharing: boolean  // local screen share active
```

New actions:
```typescript
toggleCamera: () => Promise<void>
toggleScreen: () => Promise<void>
```

Both follow the existing `toggleMute` pattern:
1. Optimistically update local state
2. Call `PATCH /channels/:id/voice` with the new value
3. Revert state on API failure

**`join` action** — the existing `join` initializes `isMuted` and `isDeafened` from the server response (`vs.self_mute`, `vs.self_deaf`). It must also initialize `isCameraOn` from `vs.self_video` and `isScreenSharing` from `vs.self_screen`. This ensures consistency if a user rejoins with stale video state in the DB.

**`leave` action** — must reset `isCameraOn` and `isScreenSharing` to `false` alongside the existing `isMuted`/`isDeafened` resets. Without this, a user who leaves while their camera is on will re-enter with `isCameraOn: true`, triggering an immediate `getUserMedia` call on rejoin.

### 3. `useWebRTC` Hook (`clients/web/src/hooks/useWebRTC.ts`)

New props:
```typescript
isCameraOn: boolean
isScreenSharing: boolean
/** deviceId of the preferred camera input; undefined = browser default. */
cameraDeviceId?: string | null
onRemoteStreamsChange?: () => void   // signals that remoteVideoStreamsRef has changed
```

The `onRemoteStreamsChange` callback follows the existing hook pattern used by `onSpeakingChange` — it is stored in a ref (`onRemoteStreamsChangeRef`) to avoid stale closures and is called to notify the parent that `remoteVideoStreamsRef` has been updated. The parent calls a stable getter (e.g. `getRemoteVideoStreams()`) rather than receiving a new `Map` reference on each call, preventing unnecessary re-renders during active renegotiation.

Where `RemoteStreams` is:
```typescript
interface RemoteStreams {
  camera?: MediaStream;
  screen?: MediaStream;
  username: string;
}
```

New internal refs:
- `localVideoStreamRef` — camera `MediaStream` from `getUserMedia({ video: true })`
- `localScreenStreamRef` — screen `MediaStream` from `getDisplayMedia({ video: true, audio: false })`
- `remoteVideoStreamsRef: Map<peerId, RemoteStreams>` — remote video streams, updated on `ontrack`
- `onRemoteStreamsChangeRef` — stable ref wrapping the `onRemoteStreamsChange` callback

**Camera toggle effect:** When `isCameraOn` changes:
- Enable: call `getUserMedia({ video: cameraDeviceId ? { deviceId: { exact: cameraDeviceId } } : true })`, add video track to all existing peer connections via `addTrack`. `onnegotiationneeded` fires on each connection, triggering a new offer/answer exchange.
- Disable: stop the camera track, remove the sender from each peer connection via `removeTrack`. `onnegotiationneeded` fires, triggering renegotiation.

**Camera device change effect:** When `cameraDeviceId` changes while `isCameraOn` is true, re-acquire the stream with the new device and replace the video track on all existing peer connections via `RTCRtpSender.replaceTrack()` — this does **not** trigger renegotiation, matching the existing `micDeviceId` pattern for seamless device switching. The old camera stream's tracks are stopped before the new stream is acquired.

**Screen share toggle effect:** Same pattern using `getDisplayMedia({ video: true, audio: false })`. System audio capture is intentionally disabled — it introduces privacy concerns (capturing application audio unexpectedly) and adds complexity for an initial implementation. It can be opt-in in a future iteration.

Additionally, listen for the `ended` event on the screen track (fired when the user clicks the OS/browser "Stop sharing" button) and call `toggleScreen()` to sync store state.

**`ontrack` handler rewrite:** The existing `ontrack` handler in `createPeer` only handles audio — it filters `event.streams[0]?.getAudioTracks()` and discards everything else. Adding video requires a full rewrite of this handler to branch on `event.track.kind`:

- `kind === "audio"` → existing audio path (feed to `remoteStream`, play via `<audio>` element, start speaking detector)
- `kind === "video"` → read `event.streams[0].id` to determine role (see below), store in `remoteVideoStreamsRef`, call `onRemoteStreamsChangeRef.current?.()`

The old handler must not run in parallel with the new one — it should be replaced entirely, not supplemented.

**Remote track identification:** To distinguish camera vs. screen video tracks from the same peer, each track is added to a named `MediaStream` with a stable label: camera tracks are added with stream label `"<peerId>-camera"` and screen tracks with `"<peerId>-screen"`. The offerer creates streams with these labels before calling `addTrack`. The answerer reads `event.streams[0].id` on `ontrack` to determine track role. This is robust across renegotiations and does not depend on SDP `mid` ordering.

**Peer joins mid-stream:** Existing peers act as offerers for new joiners. Because video tracks are already on the peer connection at offer time, new participants receive all active video tracks as part of the initial negotiation.

### 4. New Components

#### `VideoGrid.tsx` (`clients/web/src/components/voice/VideoGrid.tsx`)

Props:
```typescript
interface VideoGridProps {
  getRemoteStreams: () => Map<string, RemoteStreams>;
  streamVersion: number;   // incremented by parent on each onRemoteStreamsChange; triggers re-render
  localCameraStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  localUserId: string;
  localUsername: string;
}
```

- Renders a CSS grid that reflows as streams are added/removed
- Renders nothing when no video/screen streams are active (participant list shows instead)
- One `VideoTile` per active stream (camera and screen are separate tiles)
- Must **not** be wrapped in `React.memo` — or if it is, `streamVersion` must be included so memo comparison fails and re-renders are triggered correctly when remote streams change

#### `VideoTile.tsx` (`clients/web/src/components/voice/VideoTile.tsx`)

Props:
```typescript
interface VideoTileProps {
  stream: MediaStream;
  username: string;
  isLocal: boolean;
  isScreen: boolean;
}
```

- Renders a `<video>` element with `autoPlay` and `playsInline`
- `muted` for local tiles to prevent echo
- Username label overlay at the bottom
- "Screen" badge overlay when `isScreen` is true

#### `VideoGrid.module.css` and `VideoTile.module.css`

CSS modules for the grid layout and tile styling, consistent with the existing voice component CSS patterns.

### 5. `VoiceChannel.tsx` Changes

- Passes `isCameraOn`, `isScreenSharing`, and `cameraDeviceId` from local state to `useWebRTC`
- Passes `onRemoteStreamsChange` callback to `useWebRTC`; on callback, increments a `streamVersion` counter state (e.g. `setStreamVersion(v => v + 1)`) to trigger re-render; reads current streams via `getRemoteVideoStreams()` at render time
- Holds `localCameraStream` and `localScreenStream` from the hook's returned refs
- Renders `<VideoGrid>` above the participant list when any stream is active
- Adds two new buttons to the controls bar:
  - Camera: `Video` icon (on) / `VideoOff` icon (off) — from lucide-react
  - Screen share: `ScreenShare` icon (on) / `ScreenShareOff` icon (off) — from lucide-react
  - Both follow the existing mute/deafen button style

**Device enumeration** — `enumerateDevices()` is extended to also enumerate `videoinput` devices and populate a `cameraDevices` state list (same `AudioDevice` shape: `{ deviceId, label }`). The existing call sites (`onJoin` and `showSettings` toggle) already invoke `enumerateDevices()` so no additional call sites are needed.

**Settings panel** — a "Camera" row is added to the existing `showSettings` panel below the Microphone and Speaker rows, following the same `<select>` pattern:

```tsx
<div className={styles.deviceRow}>
  <label className={styles.deviceLabel}>Camera</label>
  <select
    className={styles.deviceSelect}
    value={cameraDeviceId ?? ""}
    onChange={(e) => setCameraDeviceId(e.target.value || null)}
  >
    <option value="">Default</option>
    {cameraDevices.map((d) => (
      <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
    ))}
  </select>
</div>
```

> **Screen source selection:** `getDisplayMedia()` opens the OS/browser's native source picker (screen, window, or tab) when the user clicks the screen share button. There is no browser API to pre-select a screen source via `deviceId`, so no screen source dropdown is needed — the OS picker handles it natively.

---

## Error Handling

| Scenario | Handling |
|---|---|
| `getUserMedia` denied (camera) | Revert `isCameraOn` to `false`; surface error via `activeError` in `VoiceChannel` |
| `getDisplayMedia` denied (screen) | Revert `isScreenSharing` to `false`; surface error via `activeError` |
| Screen share not supported (mobile) | Catch `NotSupportedError` / `NotAllowedError`; show "Screen sharing is not supported on this device" |
| OS "Stop sharing" button clicked | `ended` event on screen track → call `toggleScreen()` to sync state |
| Renegotiation offer/answer fails | Call `onError`; remove track locally; audio connection unaffected |
| API `PATCH` fails on toggle | Revert optimistic state update (same as existing `toggleMute` pattern) |

---

## Data Flow

```
User clicks camera button
  → voiceStore.toggleCamera()
    → optimistic: set isCameraOn = true
    → PATCH /channels/:id/voice { self_video: true }
    → server broadcasts VOICE_STATE_UPDATE { self_video: true, ... } to channel
    → other clients update participant state
  → useWebRTC detects isCameraOn change
    → getUserMedia({ video: true })
    → addTrack to all RTCPeerConnections (stream label: "<peerId>-camera")
    → onnegotiationneeded fires on each connection
    → createOffer → setLocalDescription → sendVoiceSignal(peer, "offer", sdp)
    → peers answer → setRemoteDescription
    → video track flows to peers
    → peers' ontrack fires → stream label read → remoteVideoStreamsRef updated
    → onRemoteStreamsChangeRef.current() called
    → VoiceChannel re-renders VideoGrid with new stream
```

---

## Testing

### Backend (`server/tests/`)

- `PATCH /channels/:id/voice` with `self_video: true` — returns updated DTO with `self_video: true`
- `PATCH /channels/:id/voice` with `self_screen: true` — returns updated DTO with `self_screen: true`
- `PATCH /channels/:id/voice` with `{}` — returns 400 (at least one field required)
- `VOICE_STATE_UPDATE` broadcast includes `self_video` and `self_screen` fields
- `GET /channels/:id/voice` participant list includes `self_video` and `self_screen` fields
- Existing voice tests pass unmodified (new fields default to `false`)

### Frontend (`clients/web/src/__tests__/`)

- `voiceStore` — `toggleCamera` optimistic update and revert on API failure
- `voiceStore` — `toggleScreen` optimistic update and revert on API failure
- `voiceStore` — `leave` resets `isCameraOn` and `isScreenSharing` to `false`
- `VideoTile` — renders `<video>` element; shows username label; is muted when `isLocal`
- `useWebRTC` — mock `getUserMedia`; verify track added to peer connections when `isCameraOn` becomes true
- `useWebRTC` — mock `getUserMedia` with a new device; verify `replaceTrack` called (not renegotiation) when `cameraDeviceId` changes while camera is active
- `useWebRTC` — mock screen track `ended` event; verify `toggleScreen` is called
- `VoiceChannel` — camera device dropdown appears in settings panel; selecting a device updates `cameraDeviceId` state

---

## Future Work

- **SFU migration path:** When P2P video becomes a bottleneck (typically >10 simultaneous video participants), the defined next step is introducing Livekit or a Pion SFU. The signaling relay is already in place; the main work would be replacing peer connections with a server-side publisher/subscriber model.
- **System audio during screen share:** `getDisplayMedia` is called with `audio: false`. System audio capture can be added as an opt-in in a future iteration.
- **Video quality controls:** Bitrate caps per track can be added via `RTCRtpSender.setParameters()` to manage bandwidth in larger calls.
