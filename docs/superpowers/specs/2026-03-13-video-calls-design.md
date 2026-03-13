# Video Calls & Screen Sharing — Design Spec

**Date:** 2026-03-13
**Branch:** feature/message-search (to be implemented on a new feature branch)
**Status:** Approved

---

## Overview

Add optional camera video and screen sharing to existing voice channels. Users in a voice channel can independently toggle their camera and/or share their screen. Multiple users can share screens simultaneously. All video feeds are displayed in a grid layout within the voice channel UI.

This feature extends the existing P2P WebRTC mesh without changing the signaling protocol or channel type system.

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

---

## Architecture

### Approach: Extend existing P2P connections (renegotiation)

Video and screen tracks are added to the existing `RTCPeerConnection` per peer. When a user enables their camera or starts a screen share, the track is added to each peer connection and WebRTC's `onnegotiationneeded` fires a new offer/answer exchange over the existing `VOICE_SIGNAL` WebSocket relay. No signaling protocol changes are required.

**Bandwidth characteristics:** P2P mesh is O(n²) for video bandwidth. At 10 participants all sharing video this is 90 simultaneous video streams. Acceptable for gaming voice channels (typically 3–8 participants). Migration to an SFU is the defined path if this becomes a bottleneck.

---

## Backend Changes

### 1. Database Migration

New migration `20240312000004_voice_video.sql`:

```sql
ALTER TABLE voice_states
  ADD COLUMN self_video  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN self_screen BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN voice_states.self_video  IS 'User has camera enabled';
COMMENT ON COLUMN voice_states.self_screen IS 'User is sharing their screen';
```

Both columns default to `FALSE` — existing rows are unaffected.

### 2. Model Changes (`server/src/models/mod.rs`)

- `VoiceState` gains `self_video: bool`, `self_screen: bool`
- `VoiceStateDto` gains `self_video: bool`, `self_screen: bool`
- `UpdateVoiceStateRequest` gains `self_video: Option<bool>`, `self_screen: Option<bool>`
- `VoiceStateDto::leave` constructor sets both to `false`

### 3. PATCH Handler (`server/src/handlers/voice.rs`)

The `update_voice_state` handler's `COALESCE` SQL extends to include the new fields:

```sql
UPDATE voice_states
SET self_mute   = COALESCE($1, self_mute),
    self_deaf   = COALESCE($2, self_deaf),
    self_video  = COALESCE($3, self_video),
    self_screen = COALESCE($4, self_screen)
WHERE user_id = $5 AND channel_id = $6
RETURNING ...
```

The existing "at least one field must be provided" validation covers the new fields — no additional validation logic needed.

### 4. VOICE_STATE_UPDATE Broadcast

`VoiceStateDto` is serialized directly for broadcast. Once `self_video` and `self_screen` are on the struct, they appear in all `VOICE_STATE_UPDATE` payloads automatically. No broadcast code changes are needed.

### 5. Leave / Disconnect Cleanup

Voice state rows are deleted on leave/disconnect. No explicit cleanup of video/screen state is required.

---

## Frontend Changes

### 1. TypeScript Types (`clients/web/src/types/index.ts`)

`VoiceParticipant` gains:
```typescript
self_video: boolean;
self_screen: boolean;
```

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

### 3. `useWebRTC` Hook (`clients/web/src/hooks/useWebRTC.ts`)

New props:
```typescript
isCameraOn: boolean
isScreenSharing: boolean
onRemoteStreamsChange?: (streams: Map<string, RemoteStreams>) => void
```

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

**Camera toggle effect:** When `isCameraOn` changes:
- Enable: call `getUserMedia({ video: true })`, add video track to all existing peer connections via `addTrack`. `onnegotiationneeded` fires on each connection, triggering a new offer/answer exchange.
- Disable: stop the camera track, remove the sender from each peer connection via `removeTrack`. `onnegotiationneeded` fires, triggering renegotiation.

**Screen share toggle effect:** Same pattern using `getDisplayMedia`. Additionally, listen for the `ended` event on the screen track (fired when the user clicks the OS/browser "Stop sharing" button) and call `toggleScreen()` to sync store state.

**Remote track identification:** When `pc.ontrack` fires, distinguish audio vs. video by `event.track.kind`. Distinguish camera vs. screen video tracks using the SDP `mid` — camera is negotiated first (lower mid index) and screen second (higher mid index). Both are stored in `remoteVideoStreamsRef` and reported via `onRemoteStreamsChange`.

**Peer joins mid-stream:** Existing peers act as offerers for new joiners. Because video tracks are already on the peer connection at offer time, new participants receive all active video tracks as part of the initial negotiation.

### 4. New Components

#### `VideoGrid.tsx` (`clients/web/src/components/voice/VideoGrid.tsx`)

Props:
```typescript
interface VideoGridProps {
  remoteStreams: Map<string, RemoteStreams>;
  localCameraStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  localUserId: string;
  localUsername: string;
}
```

- Renders a CSS grid that reflows as streams are added/removed
- Renders nothing when no video/screen streams are active (participant list shows instead)
- One `VideoTile` per active stream (camera and screen are separate tiles)

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

- Passes `isCameraOn` and `isScreenSharing` from `voiceStore` to `useWebRTC`
- Receives `remoteStreams` via `onRemoteStreamsChange` callback, stored in local state
- Renders `<VideoGrid>` above the participant list when any stream is active
- Adds two new buttons to the controls bar:
  - Camera: `Video` icon (on) / `VideoOff` icon (off) — from lucide-react
  - Screen share: `ScreenShare` icon (on) / `ScreenShareOff` icon (off) — from lucide-react
  - Both follow the existing mute/deafen button style

---

## Error Handling

| Scenario | Handling |
|---|---|
| `getUserMedia` denied (camera) | Revert `isCameraOn` to `false`; surface error via `activeError` in `VoiceChannel` |
| `getDisplayMedia` denied (screen) | Revert `isScreenSharing` to `false`; surface error via `activeError` |
| Screen share not supported (mobile) | Catch `NotSupportedError`; show "Screen sharing is not supported on this device" |
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
    → addTrack to all RTCPeerConnections
    → onnegotiationneeded fires on each connection
    → createOffer → setLocalDescription → sendVoiceSignal(peer, "offer", sdp)
    → peers answer → setRemoteDescription
    → video track flows to peers
    → peers' ontrack fires → remoteVideoStreamsRef updated → onRemoteStreamsChange called
    → VoiceChannel re-renders VideoGrid with new stream
```

---

## Testing

### Backend (`server/tests/`)

- `PATCH /channels/:id/voice` with `self_video: true` — returns updated DTO with `self_video: true`
- `PATCH /channels/:id/voice` with `self_screen: true` — returns updated DTO with `self_screen: true`
- `VOICE_STATE_UPDATE` broadcast includes `self_video` and `self_screen` fields
- Existing voice tests pass unmodified (new fields default to `false`)

### Frontend (`clients/web/src/__tests__/`)

- `voiceStore` — `toggleCamera` optimistic update and revert on API failure
- `voiceStore` — `toggleScreen` optimistic update and revert on API failure
- `VideoTile` — renders `<video>` element; shows username label; is muted when `isLocal`
- `useWebRTC` — mock `getUserMedia`; verify track added to peer connections when `isCameraOn` becomes true
- `useWebRTC` — mock screen track `ended` event; verify `toggleScreen` is called

---

## Open Questions / Future Work

- **Mid-based track identification:** The camera-first, screen-second mid ordering is an implementation convention — it should be enforced explicitly in the offer SDP to be robust. This can be revisited during implementation.
- **SFU migration path:** When P2P video becomes a bottleneck (typically >10 simultaneous video participants), the defined next step is introducing Livekit or a Pion SFU. The signaling relay is already in place; the main work would be replacing peer connections with a server-side publisher/subscriber model.
- **Video quality controls:** Bitrate caps per track could be added via `RTCRtpSender.setParameters()` to manage bandwidth in larger calls. Out of scope for initial implementation.
