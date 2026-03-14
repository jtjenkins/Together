# Video Calls & Screen Sharing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional camera video and screen sharing to existing voice channels with a grid UI, riding the existing P2P WebRTC mesh and signaling infrastructure.

**Architecture:** Video and screen tracks are added to existing `RTCPeerConnection`s per peer. WebRTC's `onnegotiationneeded` handles renegotiation automatically when tracks are added/removed. The server gains two new boolean columns on `voice_states`; the client gains new store state, hook props, and two new components (`VideoTile`, `VideoGrid`).

**Tech Stack:** Rust/sqlx (backend), React/TypeScript/Zustand (frontend), WebRTC browser APIs (`getUserMedia`, `getDisplayMedia`, `RTCRtpSender.replaceTrack`), lucide-react icons, CSS Modules.

**Spec:** `docs/superpowers/specs/2026-03-13-video-calls-design.md`

---

## File Map

**Create:**

- `server/migrations/20260313000001_voice_video.sql`
- `server/migrations/20260313000001_voice_video.down.sql`
- `clients/web/src/components/voice/VideoTile.tsx`
- `clients/web/src/components/voice/VideoTile.module.css`
- `clients/web/src/components/voice/VideoGrid.tsx`
- `clients/web/src/components/voice/VideoGrid.module.css`
- `clients/web/src/__tests__/voice-store.test.ts`
- `clients/web/src/__tests__/video-tile.test.tsx`

**Modify:**

- `server/src/models/mod.rs` — add `self_video`/`self_screen` to `VoiceState`, `VoiceStateDto`, `UpdateVoiceStateRequest`
- `server/src/handlers/voice.rs` — update `VoiceParticipantRow`, RETURNING clauses, validation guard, SQL
- `server/tests/voice_tests.rs` — new test cases for video/screen fields
- `clients/web/src/types/index.ts` — extend `VoiceParticipant`, `VoiceStateUpdateEvent`, `UpdateVoiceStateRequest`
- `clients/web/src/stores/voiceStore.ts` — add `isCameraOn`, `isScreenSharing`, `toggleCamera`, `toggleScreen`
- `clients/web/src/hooks/useWebRTC.ts` — add camera/screen props, rewrite `ontrack`, add track effects
- `clients/web/src/components/voice/VoiceChannel.tsx` — wire up store, hook, grid, camera dropdown

---

## Chunk 1: Backend — Migration, Models, Handler

### Task 1: Database migration

**Files:**

- Create: `server/migrations/20260313000001_voice_video.sql`
- Create: `server/migrations/20260313000001_voice_video.down.sql`

- [ ] **Step 1: Write the up migration**

```sql
-- server/migrations/20260313000001_voice_video.sql
ALTER TABLE voice_states
  ADD COLUMN self_video  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN self_screen BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN voice_states.self_video  IS 'User has camera enabled';
COMMENT ON COLUMN voice_states.self_screen IS 'User is sharing their screen';
```

- [ ] **Step 2: Write the down migration**

```sql
-- server/migrations/20260313000001_voice_video.down.sql
ALTER TABLE voice_states
  DROP COLUMN self_video,
  DROP COLUMN self_screen;
```

- [ ] **Step 3: Run the migration**

```bash
cd server
sqlx migrate run
```

Expected: `Applied 20260313000001/migrate voice_video`

- [ ] **Step 4: Commit**

```bash
git add server/migrations/
git commit -m "feat(db): add self_video and self_screen columns to voice_states"
```

---

### Task 2: Update Rust models

**Files:**

- Modify: `server/src/models/mod.rs`

- [ ] **Step 1: Add fields to `VoiceState`**

Find the `VoiceState` struct (around line 247) and add after `self_deaf`:

```rust
pub struct VoiceState {
    pub user_id: Uuid,
    pub channel_id: Uuid,
    pub self_mute: bool,
    pub self_deaf: bool,
    pub self_video: bool,
    pub self_screen: bool,
    pub server_mute: bool,
    pub server_deaf: bool,
    pub joined_at: DateTime<Utc>,
}
```

- [ ] **Step 2: Add fields to `VoiceStateDto`**

Find the `VoiceStateDto` struct (around line 264) and add after `self_deaf`:

```rust
pub struct VoiceStateDto {
    pub user_id: Uuid,
    pub channel_id: Option<Uuid>,
    pub self_mute: bool,
    pub self_deaf: bool,
    pub self_video: bool,
    pub self_screen: bool,
    pub server_mute: bool,
    pub server_deaf: bool,
    pub joined_at: Option<DateTime<Utc>>,
}
```

- [ ] **Step 3: Update `From<VoiceState> for VoiceStateDto`**

Add the new fields in the `from` impl:

```rust
impl From<VoiceState> for VoiceStateDto {
    fn from(vs: VoiceState) -> Self {
        VoiceStateDto {
            user_id: vs.user_id,
            channel_id: Some(vs.channel_id),
            self_mute: vs.self_mute,
            self_deaf: vs.self_deaf,
            self_video: vs.self_video,
            self_screen: vs.self_screen,
            server_mute: vs.server_mute,
            server_deaf: vs.server_deaf,
            joined_at: Some(vs.joined_at),
        }
    }
}
```

- [ ] **Step 4: Update `VoiceStateDto::leave`**

Add the new fields (both `false`) in the `leave` constructor:

```rust
pub fn leave(user_id: Uuid) -> Self {
    VoiceStateDto {
        user_id,
        channel_id: None,
        self_mute: false,
        self_deaf: false,
        self_video: false,
        self_screen: false,
        server_mute: false,
        server_deaf: false,
        joined_at: None,
    }
}
```

- [ ] **Step 5: Update `UpdateVoiceStateRequest`**

Add the new optional fields to the struct (which has `#[serde(deny_unknown_fields)]` — this is why the struct update must happen before deploying):

```rust
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateVoiceStateRequest {
    pub self_mute: Option<bool>,
    pub self_deaf: Option<bool>,
    pub self_video: Option<bool>,
    pub self_screen: Option<bool>,
}
```

- [ ] **Step 6: Verify it compiles**

```bash
cd server
cargo check 2>&1 | head -30
```

Expected: compile errors in `voice.rs` (RETURNING clauses and VoiceParticipantRow missing fields — fix in next task). No errors in `models/mod.rs` itself.

---

### Task 3: Update voice handler

**Files:**

- Modify: `server/src/handlers/voice.rs`

- [ ] **Step 1: Add fields to `VoiceParticipantRow`**

Find the struct (around line 120) and add after `self_deaf`:

```rust
#[derive(sqlx::FromRow)]
struct VoiceParticipantRow {
    user_id: Uuid,
    channel_id: Uuid,
    username: String,
    self_mute: bool,
    self_deaf: bool,
    self_video: bool,
    self_screen: bool,
    server_mute: bool,
    server_deaf: bool,
    joined_at: DateTime<Utc>,
}
```

- [ ] **Step 2: Update `join_voice_channel` RETURNING clause**

Find the UPSERT query (around line 183). Update the `RETURNING` clause:

```sql
RETURNING user_id, channel_id, self_mute, self_deaf,
          self_video, self_screen, server_mute, server_deaf, joined_at
```

- [ ] **Step 3: Update validation guard in `update_voice_state`**

Find the guard (around line 248) and extend it:

```rust
if req.self_mute.is_none() && req.self_deaf.is_none()
    && req.self_video.is_none() && req.self_screen.is_none()
{
    return Err(AppError::Validation(
        "At least one field (self_mute, self_deaf, self_video, or self_screen) must be provided"
            .into(),
    ));
}
```

- [ ] **Step 4: Update `update_voice_state` SQL**

Find the UPDATE query (around line 258). Replace the SET and RETURNING:

```sql
UPDATE voice_states
SET self_mute   = COALESCE($1, self_mute),
    self_deaf   = COALESCE($2, self_deaf),
    self_video  = COALESCE($3, self_video),
    self_screen = COALESCE($4, self_screen)
WHERE user_id = $5 AND channel_id = $6
RETURNING user_id, channel_id, self_mute, self_deaf,
          self_video, self_screen, server_mute, server_deaf, joined_at
```

Also update the `.bind()` calls to add the new fields before `user_id` and `channel_id`:

```rust
.bind(req.self_mute)
.bind(req.self_deaf)
.bind(req.self_video)
.bind(req.self_screen)
.bind(auth.user_id())
.bind(channel_id)
```

- [ ] **Step 5: Update `list_voice_participants` SQL and struct construction**

Find the SELECT query (around line 292). Add the new columns:

```sql
SELECT vs.user_id, vs.channel_id, u.username,
       vs.self_mute, vs.self_deaf, vs.self_video, vs.self_screen,
       vs.server_mute, vs.server_deaf, vs.joined_at
FROM voice_states vs
JOIN users u ON vs.user_id = u.id
WHERE vs.channel_id = $1
ORDER BY vs.joined_at ASC
```

Find the `VoiceStateDto { ... }` construction (around line 307). Add the new fields:

```rust
let dto = VoiceStateDto {
    user_id: row.user_id,
    channel_id: Some(row.channel_id),
    self_mute: row.self_mute,
    self_deaf: row.self_deaf,
    self_video: row.self_video,
    self_screen: row.self_screen,
    server_mute: row.server_mute,
    server_deaf: row.server_deaf,
    joined_at: Some(row.joined_at),
};
```

- [ ] **Step 6: Verify compilation**

```bash
cd server
cargo check 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 7: Run existing voice tests to confirm no regressions**

```bash
cd server
cargo test --test voice_tests 2>&1 | tail -20
```

Expected: all existing tests pass. New fields default to `false` so existing assertions remain valid.

---

### Task 4: Backend tests for video/screen fields

**Files:**

- Modify: `server/tests/voice_tests.rs`

Add these test functions at the end of the `// PATCH /channels/:channel_id/voice — additional update tests` section (around line 735):

- [ ] **Step 1: Write tests**

```rust
#[sqlx::test]
async fn update_self_video_returns_200(pool: sqlx::PgPool) {
    let app = common::app_with_pool(pool).await;
    let f = Fixture::setup(app.clone()).await;

    // Join first
    common::post_authed(app.clone(), &format!("/channels/{}/voice", f.vc1_id), &f.owner_token).await;

    let (status, body) = common::patch_json_authed(
        app.clone(),
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({ "self_video": true }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert!(body["self_video"].as_bool().unwrap());
    assert!(!body["self_screen"].as_bool().unwrap());
}

#[sqlx::test]
async fn update_self_screen_returns_200(pool: sqlx::PgPool) {
    let app = common::app_with_pool(pool).await;
    let f = Fixture::setup(app.clone()).await;

    common::post_authed(app.clone(), &format!("/channels/{}/voice", f.vc1_id), &f.owner_token).await;

    let (status, body) = common::patch_json_authed(
        app.clone(),
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({ "self_screen": true }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert!(body["self_screen"].as_bool().unwrap());
    assert!(!body["self_video"].as_bool().unwrap());
}

#[sqlx::test]
async fn participant_list_includes_video_fields(pool: sqlx::PgPool) {
    let app = common::app_with_pool(pool).await;
    let f = Fixture::setup(app.clone()).await;

    common::post_authed(app.clone(), &format!("/channels/{}/voice", f.vc1_id), &f.owner_token).await;

    let (status, body) = common::get_authed(
        app.clone(),
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let participants = body.as_array().unwrap();
    assert_eq!(participants.len(), 1);
    assert!(!participants[0]["self_video"].as_bool().unwrap());
    assert!(!participants[0]["self_screen"].as_bool().unwrap());
}

#[sqlx::test]
async fn empty_patch_body_still_returns_400(pool: sqlx::PgPool) {
    let app = common::app_with_pool(pool).await;
    let f = Fixture::setup(app.clone()).await;

    common::post_authed(app.clone(), &format!("/channels/{}/voice", f.vc1_id), &f.owner_token).await;

    let (status, _) = common::patch_json_authed(
        app.clone(),
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}
```

> **Note:** `common::patch_json_authed` and `common::post_authed` and `common::get_authed` may need to be added to `server/tests/common/mod.rs` if they don't exist. Check with `grep -n "pub async fn patch_json_authed\|pub async fn post_authed\|pub async fn get_authed" server/tests/common/mod.rs`. If missing, add them following the existing `post_json_authed` / `get_no_auth` patterns.

- [ ] **Step 2: Run the new tests**

```bash
cd server
cargo test --test voice_tests update_self_video update_self_screen participant_list_includes_video empty_patch 2>&1 | tail -20
```

Expected: all 4 new tests pass.

- [ ] **Step 3: Run full voice test suite**

```bash
cd server
cargo test --test voice_tests 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 4: Run clippy and fmt**

```bash
cd server
cargo fmt && cargo clippy -- -D warnings 2>&1 | tail -20
```

Expected: no warnings or errors.

- [ ] **Step 5: Commit**

```bash
git add server/migrations/ server/src/models/mod.rs server/src/handlers/voice.rs server/tests/voice_tests.rs
git commit -m "feat(voice): add self_video and self_screen to voice state"
```

---

## Chunk 2: Frontend Types and Voice Store

### Task 5: Update TypeScript types

**Files:**

- Modify: `clients/web/src/types/index.ts`

- [ ] **Step 1: Extend `VoiceParticipant`** (around line 151)

Add after `self_deaf`:

```typescript
export interface VoiceParticipant {
  user_id: string;
  username: string;
  channel_id: string | null;
  self_mute: boolean;
  self_deaf: boolean;
  self_video: boolean;
  self_screen: boolean;
  server_mute: boolean;
  server_deaf: boolean;
  joined_at: string | null;
}
```

- [ ] **Step 2: Extend `UpdateVoiceStateRequest`** (around line 162)

```typescript
export interface UpdateVoiceStateRequest {
  self_mute?: boolean;
  self_deaf?: boolean;
  self_video?: boolean;
  self_screen?: boolean;
}
```

- [ ] **Step 3: Extend `VoiceStateUpdateEvent`** (around line 167)

Add after `self_deaf`:

```typescript
export interface VoiceStateUpdateEvent {
  user_id: string;
  username: string;
  channel_id: string | null;
  self_mute: boolean;
  self_deaf: boolean;
  self_video: boolean;
  self_screen: boolean;
  server_mute: boolean;
  server_deaf: boolean;
  joined_at: string | null;
}
```

- [ ] **Step 4: Typecheck**

```bash
cd clients/web
npm run typecheck 2>&1 | head -30
```

Expected: no errors (new fields are present wherever the type is used; existing usage doesn't break because we're adding not removing).

---

### Task 6: Update voice store

**Files:**

- Modify: `clients/web/src/stores/voiceStore.ts`
- Create: `clients/web/src/__tests__/voice-store.test.ts`

- [ ] **Step 1: Write failing tests first**

```typescript
// clients/web/src/__tests__/voice-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useVoiceStore } from "../stores/voiceStore";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    joinVoiceChannel: vi.fn(),
    leaveVoiceChannel: vi.fn(),
    updateVoiceState: vi.fn(),
  },
}));

beforeEach(() => {
  useVoiceStore.setState({
    connectedChannelId: null,
    isMuted: false,
    isDeafened: false,
    isCameraOn: false,
    isScreenSharing: false,
    isConnecting: false,
    error: null,
  });
  vi.clearAllMocks();
});

describe("toggleCamera", () => {
  it("optimistically sets isCameraOn to true and calls API", async () => {
    vi.mocked(api.updateVoiceState).mockResolvedValueOnce({} as never);
    useVoiceStore.setState({ connectedChannelId: "chan-1" });

    await useVoiceStore.getState().toggleCamera();

    expect(useVoiceStore.getState().isCameraOn).toBe(true);
    expect(api.updateVoiceState).toHaveBeenCalledWith("chan-1", {
      self_video: true,
    });
  });

  it("reverts isCameraOn on API failure", async () => {
    vi.mocked(api.updateVoiceState).mockRejectedValueOnce(new Error("fail"));
    useVoiceStore.setState({ connectedChannelId: "chan-1", isCameraOn: false });

    await expect(useVoiceStore.getState().toggleCamera()).rejects.toThrow();
    expect(useVoiceStore.getState().isCameraOn).toBe(false);
  });

  it("does nothing when not in a channel", async () => {
    await useVoiceStore.getState().toggleCamera();
    expect(api.updateVoiceState).not.toHaveBeenCalled();
  });
});

describe("toggleScreen", () => {
  it("optimistically sets isScreenSharing to true and calls API", async () => {
    vi.mocked(api.updateVoiceState).mockResolvedValueOnce({} as never);
    useVoiceStore.setState({ connectedChannelId: "chan-1" });

    await useVoiceStore.getState().toggleScreen();

    expect(useVoiceStore.getState().isScreenSharing).toBe(true);
    expect(api.updateVoiceState).toHaveBeenCalledWith("chan-1", {
      self_screen: true,
    });
  });

  it("reverts isScreenSharing on API failure", async () => {
    vi.mocked(api.updateVoiceState).mockRejectedValueOnce(new Error("fail"));
    useVoiceStore.setState({
      connectedChannelId: "chan-1",
      isScreenSharing: false,
    });

    await expect(useVoiceStore.getState().toggleScreen()).rejects.toThrow();
    expect(useVoiceStore.getState().isScreenSharing).toBe(false);
  });
});

describe("leave", () => {
  it("resets isCameraOn and isScreenSharing to false", async () => {
    vi.mocked(api.leaveVoiceChannel).mockResolvedValueOnce(undefined as never);
    useVoiceStore.setState({
      connectedChannelId: "chan-1",
      isCameraOn: true,
      isScreenSharing: true,
    });

    await useVoiceStore.getState().leave();

    expect(useVoiceStore.getState().isCameraOn).toBe(false);
    expect(useVoiceStore.getState().isScreenSharing).toBe(false);
  });
});

describe("join", () => {
  it("initialises isCameraOn and isScreenSharing from server response", async () => {
    vi.mocked(api.joinVoiceChannel).mockResolvedValueOnce({
      user_id: "u1",
      channel_id: "chan-1",
      self_mute: false,
      self_deaf: false,
      self_video: true,
      self_screen: false,
      server_mute: false,
      server_deaf: false,
      joined_at: new Date().toISOString(),
    } as never);

    await useVoiceStore.getState().join("chan-1");

    expect(useVoiceStore.getState().isCameraOn).toBe(true);
    expect(useVoiceStore.getState().isScreenSharing).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd clients/web
npm test -- voice-store 2>&1 | tail -20
```

Expected: FAIL — `isCameraOn` and related actions don't exist yet.

- [ ] **Step 3: Implement store changes**

Update `voiceStore.ts` to add the new fields and actions. The full updated store:

```typescript
import { create } from "zustand";
import type { VoiceParticipant, UpdateVoiceStateRequest } from "../types";
import { api, ApiRequestError } from "../api/client";

interface VoiceStore {
  connectedChannelId: string | null;
  isMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  isConnecting: boolean;
  error: string | null;

  join: (channelId: string) => Promise<VoiceParticipant>;
  leave: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  clearError: () => void;
}

export const useVoiceStore = create<VoiceStore>((set) => ({
  connectedChannelId: null,
  isMuted: false,
  isDeafened: false,
  isCameraOn: false,
  isScreenSharing: false,
  isConnecting: false,
  error: null,

  join: async (channelId) => {
    set({ isConnecting: true, error: null });
    try {
      const vs = await api.joinVoiceChannel(channelId);
      set({
        connectedChannelId: channelId,
        isMuted: vs.self_mute,
        isDeafened: vs.self_deaf,
        isCameraOn: vs.self_video,
        isScreenSharing: vs.self_screen,
        isConnecting: false,
      });
      return vs;
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to join voice";
      set({ error: message, isConnecting: false });
      throw err;
    }
  },

  leave: async () => {
    const { connectedChannelId: channelId } = useVoiceStore.getState();
    if (!channelId) return;
    set({
      connectedChannelId: null,
      isMuted: false,
      isDeafened: false,
      isCameraOn: false,
      isScreenSharing: false,
    });
    try {
      await api.leaveVoiceChannel(channelId);
    } catch (err) {
      console.error("[VoiceStore] leave: failed to notify server", err);
    }
  },

  toggleMute: async () => {
    const { connectedChannelId: channelId, isMuted: currentMuted } =
      useVoiceStore.getState();
    if (!channelId) return;
    const newMuted = !currentMuted;
    set({ isMuted: newMuted });
    try {
      await api.updateVoiceState(channelId, {
        self_mute: newMuted,
      } satisfies UpdateVoiceStateRequest);
    } catch (err) {
      set({ isMuted: currentMuted });
      throw err;
    }
  },

  toggleDeafen: async () => {
    const { connectedChannelId: channelId, isDeafened: currentDeafened } =
      useVoiceStore.getState();
    if (!channelId) return;
    const newDeafened = !currentDeafened;
    set({ isDeafened: newDeafened });
    try {
      await api.updateVoiceState(channelId, {
        self_deaf: newDeafened,
      } satisfies UpdateVoiceStateRequest);
    } catch (err) {
      set({ isDeafened: currentDeafened });
      throw err;
    }
  },

  toggleCamera: async () => {
    const { connectedChannelId: channelId, isCameraOn: current } =
      useVoiceStore.getState();
    if (!channelId) return;
    const next = !current;
    set({ isCameraOn: next });
    try {
      await api.updateVoiceState(channelId, {
        self_video: next,
      } satisfies UpdateVoiceStateRequest);
    } catch (err) {
      set({ isCameraOn: current });
      throw err;
    }
  },

  toggleScreen: async () => {
    const { connectedChannelId: channelId, isScreenSharing: current } =
      useVoiceStore.getState();
    if (!channelId) return;
    const next = !current;
    set({ isScreenSharing: next });
    try {
      await api.updateVoiceState(channelId, {
        self_screen: next,
      } satisfies UpdateVoiceStateRequest);
    } catch (err) {
      set({ isScreenSharing: current });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd clients/web
npm test -- voice-store 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Typecheck and lint**

```bash
cd clients/web
npm run typecheck && npm run lint 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add clients/web/src/types/index.ts clients/web/src/stores/voiceStore.ts clients/web/src/__tests__/voice-store.test.ts
git commit -m "feat(voice): add isCameraOn/isScreenSharing state and toggleCamera/toggleScreen actions"
```

---

## Chunk 3: useWebRTC Hook

### Task 7: Extend useWebRTC with video/screen support

**Files:**

- Modify: `clients/web/src/hooks/useWebRTC.ts`

This is the largest change. Work through it in sub-steps.

- [ ] **Step 1: Add new types and props**

Add the `RemoteStreams` interface and new props to `UseWebRTCOptions`. In the interface section at the top (after the existing interfaces):

```typescript
export interface RemoteStreams {
  camera?: MediaStream;
  screen?: MediaStream;
  username: string;
}
```

Add to `UseWebRTCOptions`:

```typescript
interface UseWebRTCOptions {
  enabled: boolean;
  myUserId: string;
  participants: VoiceParticipant[];
  initialPeers: string[];
  isMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  micDeviceId?: string | null;
  speakerDeviceId?: string | null;
  cameraDeviceId?: string | null;
  onError?: (message: string) => void;
  onSpeakingChange?: (userId: string, isSpeaking: boolean) => void;
  onRemoteStreamsChange?: () => void;
}
```

- [ ] **Step 2: Add new refs in the hook body**

After the existing refs (after `audioCtxRef`), add:

```typescript
const localVideoStreamRef = useRef<MediaStream | null>(null);
const localScreenStreamRef = useRef<MediaStream | null>(null);
const remoteVideoStreamsRef = useRef<Map<string, RemoteStreams>>(new Map());
const cameraDeviceIdRef = useRef(cameraDeviceId);
cameraDeviceIdRef.current = cameraDeviceId;
const onRemoteStreamsChangeRef = useRef(onRemoteStreamsChange);
onRemoteStreamsChangeRef.current = onRemoteStreamsChange;
```

Also add `isCameraOn` and `isScreenSharing` to the destructured props:

```typescript
export function useWebRTC({
  enabled,
  myUserId,
  participants,
  initialPeers,
  isMuted,
  isDeafened,
  isCameraOn,
  isScreenSharing,
  micDeviceId,
  speakerDeviceId,
  cameraDeviceId,
  onError,
  onSpeakingChange,
  onRemoteStreamsChange,
}: UseWebRTCOptions) {
```

- [ ] **Step 3: Add `getRemoteVideoStreams` getter and expose local stream refs**

Add a stable getter function inside the hook (after the ref declarations):

```typescript
const getRemoteVideoStreams = useCallback(
  () => remoteVideoStreamsRef.current,
  [],
);
```

Return these from the hook at the bottom:

```typescript
return {
  getRemoteVideoStreams,
  localVideoStreamRef,
  localScreenStreamRef,
};
```

> Note: The hook currently has no return value. Change `export function useWebRTC` to return this object.

- [ ] **Step 4: Rewrite `createPeer` ontrack handler**

Find the `ontrack` handler inside `createPeer` (around line 239). Replace the existing handler entirely:

```typescript
// Play remote audio/video tracks when they arrive
pc.ontrack = (event) => {
  if (event.track.kind === "audio") {
    // ── Audio path (unchanged) ──────────────────────────────
    const remoteStream = new MediaStream();
    event.streams[0]?.getAudioTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
    playRemoteStream(peerId, remoteStream);
  } else if (event.track.kind === "video") {
    // ── Video path ──────────────────────────────────────────
    // Stream label encodes role: "<peerId>-camera" or "<peerId>-screen"
    const streamId = event.streams[0]?.id ?? "";
    const isScreen = streamId.endsWith("-screen");
    const existing = remoteVideoStreamsRef.current.get(peerId) ?? {
      username:
        participants.find((p) => p.user_id === peerId)?.username ?? peerId,
    };
    const updated: RemoteStreams = isScreen
      ? { ...existing, screen: event.streams[0] }
      : { ...existing, camera: event.streams[0] };
    remoteVideoStreamsRef.current.set(peerId, updated);
    onRemoteStreamsChangeRef.current?.();
  }
};
```

> **Important:** The old handler stored audio tracks in a module-level `remoteStream`. The new handler creates a fresh `MediaStream` for audio each time `ontrack` fires. Verify the `playRemoteStream` call is compatible — it already accepts a `MediaStream` and plays it on an `<audio>` element.

- [ ] **Step 5: Add `closePeer` cleanup for video streams**

In the `closePeer` callback, after the existing audio element cleanup, add:

```typescript
// Clean up remote video streams
remoteVideoStreamsRef.current.delete(peerId);
onRemoteStreamsChangeRef.current?.();
```

- [ ] **Step 6: Add camera track effect**

Add after the existing mic `useEffect` (the one that calls `getUserMedia`):

```typescript
// Acquire / release local camera stream
useEffect(() => {
  if (!enabled || !isCameraOn) {
    // Disable: stop tracks and remove senders from all peer connections
    if (localVideoStreamRef.current) {
      localVideoStreamRef.current.getTracks().forEach((t) => t.stop());
      localVideoStreamRef.current = null;
      peersRef.current.forEach((pc) => {
        const sender = pc
          .getSenders()
          .find(
            (s) =>
              s.track?.kind === "video" && !s.track?.label.includes("screen"),
          );
        if (sender) pc.removeTrack(sender);
      });
    }
    return;
  }

  let cancelled = false;
  const constraints: MediaStreamConstraints = {
    video: cameraDeviceId ? { deviceId: { exact: cameraDeviceId } } : true,
    audio: false,
  };

  navigator.mediaDevices
    ?.getUserMedia(constraints)
    .then((stream) => {
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      localVideoStreamRef.current = stream;
      const [track] = stream.getVideoTracks();
      if (!track) return;

      peersRef.current.forEach((pc, peerId) => {
        const cameraStream = new MediaStream([track]);
        cameraStream.id = `${peerId}-camera`; // label for ontrack identification
        pc.addTrack(track, cameraStream);
      });
    })
    .catch((err) => {
      console.error("[WebRTC] camera getUserMedia failed", err);
      onError?.("Camera unavailable");
    });

  return () => {
    cancelled = true;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [enabled, isCameraOn]);
```

- [ ] **Step 7: Add camera device-change effect**

Add after the camera toggle effect:

```typescript
// Hot-swap camera device while camera is active
useEffect(() => {
  if (!enabled || !isCameraOn || !localVideoStreamRef.current) return;

  let cancelled = false;
  const constraints: MediaStreamConstraints = {
    video: cameraDeviceId ? { deviceId: { exact: cameraDeviceId } } : true,
    audio: false,
  };

  navigator.mediaDevices
    ?.getUserMedia(constraints)
    .then((newStream) => {
      if (cancelled) {
        newStream.getTracks().forEach((t) => t.stop());
        return;
      }
      // Stop old tracks
      localVideoStreamRef.current?.getTracks().forEach((t) => t.stop());
      localVideoStreamRef.current = newStream;
      const [newTrack] = newStream.getVideoTracks();
      if (!newTrack) return;

      // Replace track on all peer connections without renegotiation
      peersRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) {
          sender.replaceTrack(newTrack).catch((err: unknown) => {
            console.warn("[WebRTC] replaceTrack failed", err);
          });
        }
      });
    })
    .catch((err) => {
      console.error("[WebRTC] camera device change failed", err);
    });

  return () => {
    cancelled = true;
  };
  // cameraDeviceId intentionally in deps — changing device hot-swaps the stream.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [enabled, cameraDeviceId]);
```

- [ ] **Step 8: Add screen share effect**

```typescript
// Acquire / release screen share stream
useEffect(() => {
  if (!enabled || !isScreenSharing) {
    if (localScreenStreamRef.current) {
      localScreenStreamRef.current.getTracks().forEach((t) => t.stop());
      localScreenStreamRef.current = null;
      peersRef.current.forEach((pc) => {
        // Remove the screen sender (identified by stream label ending in "-screen")
        const sender = pc.getSenders().find((s) => {
          const streams = pc.getLocalStreams?.() ?? [];
          return streams.some(
            (st) =>
              st.id.endsWith("-screen") && st.getTracks().includes(s.track!),
          );
        });
        if (sender) pc.removeTrack(sender);
      });
    }
    return;
  }

  let cancelled = false;

  (
    navigator.mediaDevices as MediaDevices & {
      getDisplayMedia?: (c: DisplayMediaStreamOptions) => Promise<MediaStream>;
    }
  )
    .getDisplayMedia?.({ video: true, audio: false })
    .then((stream) => {
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      localScreenStreamRef.current = stream;
      const [track] = stream.getVideoTracks();
      if (!track) return;

      // Sync store when OS "Stop sharing" button is clicked
      track.addEventListener("ended", () => {
        // Dynamically import to avoid circular dep — voiceStore → useWebRTC
        import("../stores/voiceStore").then(({ useVoiceStore }) => {
          if (useVoiceStore.getState().isScreenSharing) {
            useVoiceStore
              .getState()
              .toggleScreen()
              .catch(() => {});
          }
        });
      });

      peersRef.current.forEach((pc, peerId) => {
        const screenStream = new MediaStream([track]);
        screenStream.id = `${peerId}-screen`;
        pc.addTrack(track, screenStream);
      });
    })
    .catch((err: unknown) => {
      console.error("[WebRTC] getDisplayMedia failed", err);
      const name = (err as { name?: string }).name;
      if (name === "NotSupportedError" || name === "NotAllowedError") {
        if (name === "NotSupportedError") {
          onError?.("Screen sharing is not supported on this device");
        }
        // NotAllowedError = user cancelled picker — no error message needed
      } else {
        onError?.("Screen sharing unavailable");
      }
      // Revert store state
      import("../stores/voiceStore").then(({ useVoiceStore }) => {
        if (useVoiceStore.getState().isScreenSharing) {
          useVoiceStore
            .getState()
            .toggleScreen()
            .catch(() => {});
        }
      });
    });

  return () => {
    cancelled = true;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [enabled, isScreenSharing]);
```

- [ ] **Step 9: Update `createPeer` to add existing video/screen tracks to new connections**

In `createPeer`, after adding local audio tracks (the `localStream.getAudioTracks().forEach` block), add:

```typescript
// Add existing camera track if active
if (localVideoStreamRef.current) {
  const [videoTrack] = localVideoStreamRef.current.getVideoTracks();
  if (videoTrack) {
    const cameraStream = new MediaStream([videoTrack]);
    cameraStream.id = `${peerId}-camera`;
    pc.addTrack(videoTrack, cameraStream);
  }
}

// Add existing screen track if active
if (localScreenStreamRef.current) {
  const [screenTrack] = localScreenStreamRef.current.getVideoTracks();
  if (screenTrack) {
    const screenStream = new MediaStream([screenTrack]);
    screenStream.id = `${peerId}-screen`;
    pc.addTrack(screenTrack, screenStream);
  }
}
```

- [ ] **Step 10: Update cleanup on unmount**

In the unmount `useEffect`, after the audio cleanup, add:

```typescript
localVideoStreamRef.current?.getTracks().forEach((t) => t.stop());
localVideoStreamRef.current = null;
localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
localScreenStreamRef.current = null;
remoteVideoStreamsRef.current.clear();
```

- [ ] **Step 11: Typecheck and lint**

```bash
cd clients/web
npm run typecheck && npm run lint 2>&1 | tail -30
```

Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add clients/web/src/hooks/useWebRTC.ts
git commit -m "feat(webrtc): add camera/screen track support with renegotiation"
```

---

## Chunk 4: VideoTile and VideoGrid Components

### Task 8: VideoTile component

**Files:**

- Create: `clients/web/src/components/voice/VideoTile.tsx`
- Create: `clients/web/src/components/voice/VideoTile.module.css`
- Create: `clients/web/src/__tests__/video-tile.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// clients/web/src/__tests__/video-tile.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { VideoTile } from "../components/voice/VideoTile";

function makeStream(): MediaStream {
  return {
    id: "test-stream",
    getTracks: () => [],
    getVideoTracks: () => [],
    getAudioTracks: () => [],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStream;
}

describe("VideoTile", () => {
  it("renders a video element", () => {
    const { container } = render(
      <VideoTile
        stream={makeStream()}
        username="Alice"
        isLocal={false}
        isScreen={false}
      />,
    );
    expect(container.querySelector("video")).not.toBeNull();
  });

  it("shows the username label", () => {
    render(
      <VideoTile
        stream={makeStream()}
        username="Alice"
        isLocal={false}
        isScreen={false}
      />,
    );
    expect(screen.getByText("Alice")).toBeTruthy();
  });

  it("mutes local tiles", () => {
    const { container } = render(
      <VideoTile
        stream={makeStream()}
        username="Me"
        isLocal={true}
        isScreen={false}
      />,
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.muted).toBe(true);
  });

  it("does not mute remote tiles", () => {
    const { container } = render(
      <VideoTile
        stream={makeStream()}
        username="Bob"
        isLocal={false}
        isScreen={false}
      />,
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.muted).toBe(false);
  });

  it("shows Screen badge when isScreen is true", () => {
    render(
      <VideoTile
        stream={makeStream()}
        username="Alice"
        isLocal={false}
        isScreen={true}
      />,
    );
    expect(screen.getByText("Screen")).toBeTruthy();
  });

  it("does not show Screen badge for camera tiles", () => {
    render(
      <VideoTile
        stream={makeStream()}
        username="Alice"
        isLocal={false}
        isScreen={false}
      />,
    );
    expect(screen.queryByText("Screen")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd clients/web
npm test -- video-tile 2>&1 | tail -10
```

Expected: FAIL — component doesn't exist yet.

- [ ] **Step 3: Implement VideoTile**

```typescript
// clients/web/src/components/voice/VideoTile.tsx
import { useEffect, useRef } from "react";
import styles from "./VideoTile.module.css";

interface VideoTileProps {
  stream: MediaStream;
  username: string;
  isLocal: boolean;
  isScreen: boolean;
}

export function VideoTile({ stream, username, isLocal, isScreen }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className={styles.tile}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={styles.video}
      />
      <div className={styles.overlay}>
        <span className={styles.username}>{username}</span>
        {isScreen && <span className={styles.badge}>Screen</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement VideoTile CSS**

```css
/* clients/web/src/components/voice/VideoTile.module.css */
.tile {
  position: relative;
  background: #1a1a1a;
  border-radius: 8px;
  overflow: hidden;
  aspect-ratio: 16 / 9;
}

.video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.6));
}

.username {
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  background: rgba(88, 101, 242, 0.85);
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd clients/web
npm test -- video-tile 2>&1 | tail -10
```

Expected: all tests pass.

---

### Task 9: VideoGrid component

**Files:**

- Create: `clients/web/src/components/voice/VideoGrid.tsx`
- Create: `clients/web/src/components/voice/VideoGrid.module.css`

No separate unit tests for VideoGrid — it is pure layout composition of VideoTile and will be tested end-to-end via VoiceChannel.

- [ ] **Step 1: Implement VideoGrid**

```typescript
// clients/web/src/components/voice/VideoGrid.tsx
import { VideoTile } from "./VideoTile";
import type { RemoteStreams } from "../../hooks/useWebRTC";
import styles from "./VideoGrid.module.css";

interface VideoGridProps {
  getRemoteStreams: () => Map<string, RemoteStreams>;
  streamVersion: number;
  localCameraStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  localUserId: string;
  localUsername: string;
}

export function VideoGrid({
  getRemoteStreams,
  streamVersion: _streamVersion, // consumed to trigger re-render via parent state
  localCameraStream,
  localScreenStream,
  localUserId,
  localUsername,
}: VideoGridProps) {
  const remoteStreams = getRemoteStreams();

  // Collect all tiles: local camera, local screen, then remote camera/screen pairs
  const tiles: Array<{
    key: string;
    stream: MediaStream;
    username: string;
    isLocal: boolean;
    isScreen: boolean;
  }> = [];

  if (localCameraStream) {
    tiles.push({
      key: `${localUserId}-camera`,
      stream: localCameraStream,
      username: localUsername,
      isLocal: true,
      isScreen: false,
    });
  }

  if (localScreenStream) {
    tiles.push({
      key: `${localUserId}-screen`,
      stream: localScreenStream,
      username: localUsername,
      isLocal: true,
      isScreen: true,
    });
  }

  remoteStreams.forEach((rs, userId) => {
    if (rs.camera) {
      tiles.push({
        key: `${userId}-camera`,
        stream: rs.camera,
        username: rs.username,
        isLocal: false,
        isScreen: false,
      });
    }
    if (rs.screen) {
      tiles.push({
        key: `${userId}-screen`,
        stream: rs.screen,
        username: rs.username,
        isLocal: false,
        isScreen: true,
      });
    }
  });

  if (tiles.length === 0) return null;

  return (
    <div className={styles.grid}>
      {tiles.map((t) => (
        <VideoTile
          key={t.key}
          stream={t.stream}
          username={t.username}
          isLocal={t.isLocal}
          isScreen={t.isScreen}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Implement VideoGrid CSS**

```css
/* clients/web/src/components/voice/VideoGrid.module.css */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 8px;
  padding: 8px;
  background: #111;
  border-radius: 8px;
  margin-bottom: 8px;
}
```

- [ ] **Step 3: Typecheck**

```bash
cd clients/web
npm run typecheck 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add clients/web/src/components/voice/VideoTile.tsx \
        clients/web/src/components/voice/VideoTile.module.css \
        clients/web/src/components/voice/VideoGrid.tsx \
        clients/web/src/components/voice/VideoGrid.module.css \
        clients/web/src/__tests__/video-tile.test.tsx
git commit -m "feat(voice): add VideoTile and VideoGrid components"
```

---

## Chunk 5: VoiceChannel Integration

### Task 10: Wire everything together in VoiceChannel

**Files:**

- Modify: `clients/web/src/components/voice/VoiceChannel.tsx`

- [ ] **Step 1: Add new imports**

Add to the lucide-react import:

```typescript
import {
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  Volume2,
  PhoneOff,
  Settings,
  X,
  Video,
  VideoOff,
  ScreenShare,
  ScreenShareOff,
} from "lucide-react";
```

Add component imports:

```typescript
import { VideoGrid } from "./VideoGrid";
import { useVoiceStore } from "../../stores/voiceStore";
```

- [ ] **Step 2: Add new state**

After the existing device state (around line 57), add:

```typescript
const [cameraDeviceId, setCameraDeviceId] = useState<string | null>(null);
const [cameraDevices, setCameraDevices] = useState<AudioDevice[]>([]);
const [streamVersion, setStreamVersion] = useState(0);
```

Read new store values (after the existing `isDeafened`, etc.):

```typescript
const isCameraOn = useVoiceStore((s) => s.isCameraOn);
const isScreenSharing = useVoiceStore((s) => s.isScreenSharing);
const toggleCamera = useVoiceStore((s) => s.toggleCamera);
const toggleScreen = useVoiceStore((s) => s.toggleScreen);
```

- [ ] **Step 3: Extend `enumerateDevices` to include camera**

In the `enumerateDevices` callback, add after the `setSpeakerDevices` block:

```typescript
setCameraDevices(
  devices
    .filter((d) => d.kind === "videoinput")
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Camera ${i + 1}`,
    })),
);
```

- [ ] **Step 4: Add `onRemoteStreamsChange` callback and `handleToggleCamera`/`handleToggleScreen`**

```typescript
const handleRemoteStreamsChange = useCallback(() => {
  setStreamVersion((v) => v + 1);
}, []);

const handleToggleCamera = useCallback(async () => {
  try {
    await toggleCamera();
  } catch (err) {
    console.error("[VoiceChannel] toggleCamera failed", err);
  }
}, [toggleCamera]);

const handleToggleScreen = useCallback(async () => {
  try {
    await toggleScreen();
  } catch (err) {
    console.error("[VoiceChannel] toggleScreen failed", err);
  }
}, [toggleScreen]);
```

- [ ] **Step 5: Update `useWebRTC` call site**

Find the `useWebRTC({...})` call (around line 210) and add the new props:

```typescript
const { getRemoteVideoStreams, localVideoStreamRef, localScreenStreamRef } =
  useWebRTC({
    enabled: isConnected,
    myUserId: currentUser?.id ?? "",
    participants,
    initialPeers,
    isMuted,
    isDeafened,
    isCameraOn,
    isScreenSharing,
    micDeviceId,
    speakerDeviceId,
    cameraDeviceId,
    onError: setRtcError,
    onSpeakingChange: handleSpeakingChange,
    onRemoteStreamsChange: handleRemoteStreamsChange,
  });
```

- [ ] **Step 6: Add VideoGrid to the JSX**

In the connected state section, add `<VideoGrid>` above the participant list:

```tsx
<VideoGrid
  getRemoteStreams={getRemoteVideoStreams}
  streamVersion={streamVersion}
  localCameraStream={localVideoStreamRef.current}
  localScreenStream={localScreenStreamRef.current}
  localUserId={currentUser?.id ?? ""}
  localUsername={currentUser?.username ?? ""}
/>
```

- [ ] **Step 7: Add camera and screen share buttons to controls bar**

In the controls bar (after the deafen button, before the settings button):

```tsx
<button
  className={`${styles.controlBtn} ${isCameraOn ? styles.controlActive : ""}`}
  onClick={handleToggleCamera}
  title={isCameraOn ? "Turn off camera" : "Turn on camera"}
  aria-label={isCameraOn ? "Turn off camera" : "Turn on camera"}
>
  {isCameraOn ? <VideoOff size={20} /> : <Video size={20} />}
</button>
<button
  className={`${styles.controlBtn} ${isScreenSharing ? styles.controlActive : ""}`}
  onClick={handleToggleScreen}
  title={isScreenSharing ? "Stop sharing screen" : "Share screen"}
  aria-label={isScreenSharing ? "Stop sharing screen" : "Share screen"}
>
  {isScreenSharing ? <ScreenShareOff size={20} /> : <ScreenShare size={20} />}
</button>
```

- [ ] **Step 8: Add Camera row to the settings panel**

In the `showSettings` panel, after the Speaker `<select>` block:

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
      <option key={d.deviceId} value={d.deviceId}>
        {d.label}
      </option>
    ))}
  </select>
</div>
```

- [ ] **Step 9: Typecheck and lint**

```bash
cd clients/web
npm run typecheck && npm run lint 2>&1 | tail -30
```

Expected: no errors.

- [ ] **Step 10: Run all frontend tests**

```bash
cd clients/web
npm test 2>&1 | tail -20
```

Expected: all tests pass (including the new voice-store and video-tile tests).

- [ ] **Step 11: Run all backend tests**

```bash
cd server
cargo test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 12: Final commit**

```bash
git add clients/web/src/components/voice/VoiceChannel.tsx
git commit -m "feat(voice): integrate video/screen sharing into VoiceChannel UI

- Camera and screen share toggle buttons in controls bar
- VideoGrid renders above participant list when any stream active
- Camera device dropdown in settings panel (alongside mic/speaker)
- Connects useWebRTC hook to voiceStore isCameraOn/isScreenSharing"
```

---

## Verification Checklist

Before marking complete:

- [ ] `cd server && cargo test` — all tests pass
- [ ] `cd server && cargo clippy -- -D warnings` — no warnings
- [ ] `cd server && cargo fmt -- --check` — no formatting diff
- [ ] `cd clients/web && npm test` — all tests pass
- [ ] `cd clients/web && npm run typecheck` — no errors
- [ ] `cd clients/web && npm run lint` — no errors
