// ─── User Types ──────────────────────────────────────────────

export type UserStatus = "online" | "away" | "dnd" | "offline";

export interface UserDto {
  id: string;
  username: string;
  email: string | null;
  avatar_url: string | null;
  status: UserStatus;
  custom_status: string | null;
  created_at: string;
}

export interface UpdateUserDto {
  avatar_url?: string | null;
  status?: UserStatus;
  custom_status?: string | null;
}

// ─── Auth Types ──────────────────────────────────────────────

export interface RegisterRequest {
  username: string;
  email?: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: UserDto;
}

// ─── Server Types ────────────────────────────────────────────

export interface ServerDto {
  id: string;
  name: string;
  owner_id: string;
  icon_url: string | null;
  is_public: boolean;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateServerRequest {
  name: string;
  icon_url?: string;
  is_public?: boolean;
}

export interface UpdateServerRequest {
  name?: string;
  icon_url?: string;
  is_public?: boolean;
}

// ─── Member Types ────────────────────────────────────────────

export interface MemberDto {
  user_id: string;
  username: string;
  avatar_url: string | null;
  status: UserStatus;
  nickname: string | null;
  joined_at: string;
}

// ─── Channel Types ───────────────────────────────────────────

export type ChannelType = "text" | "voice";

export interface Channel {
  id: string;
  server_id: string;
  name: string;
  type: ChannelType;
  position: number;
  category: string | null;
  topic: string | null;
  created_at: string;
}

export interface CreateChannelRequest {
  name: string;
  type: ChannelType;
  topic?: string;
  category?: string;
}

export interface UpdateChannelRequest {
  name?: string;
  topic?: string;
  category?: string;
  position?: number;
}

// ─── Message Types ───────────────────────────────────────────

export interface Message {
  id: string;
  channel_id: string;
  author_id: string | null;
  content: string;
  reply_to: string | null;
  mention_user_ids: string[];
  mention_everyone: boolean;
  /** Set on thread replies; null on root messages. */
  thread_id: string | null;
  /** Number of non-deleted thread replies; meaningful only on root messages. */
  thread_reply_count: number;
  edited_at: string | null;
  deleted: boolean;
  created_at: string;
}

export interface CreateMessageRequest {
  content: string;
  reply_to?: string;
}

export interface CreateThreadReplyRequest {
  content: string;
}

export interface UpdateMessageRequest {
  content: string;
}

export interface ListMessagesQuery {
  before?: string;
  limit?: number;
}

// ─── Voice Types ─────────────────────────────────────────────

export interface VoiceParticipant {
  user_id: string;
  username: string;
  channel_id: string | null;
  self_mute: boolean;
  self_deaf: boolean;
  server_mute: boolean;
  server_deaf: boolean;
  joined_at: string | null;
}

export interface UpdateVoiceStateRequest {
  self_mute?: boolean;
  self_deaf?: boolean;
}

export interface VoiceStateUpdateEvent {
  user_id: string;
  username: string;
  channel_id: string | null;
  self_mute: boolean;
  self_deaf: boolean;
  server_mute: boolean;
  server_deaf: boolean;
  joined_at: string | null;
}

type VoiceSignalBase = {
  to_user_id?: string;
  from_user_id?: string;
};

// Discriminated union so callers must provide sdp for offer/answer
// and candidate for ICE candidates — never mix them up.
export type VoiceSignalData =
  | (VoiceSignalBase & { type: "offer"; sdp: string })
  | (VoiceSignalBase & { type: "answer"; sdp: string })
  | (VoiceSignalBase & { type: "candidate"; candidate: string });

// ─── Attachment Types ─────────────────────────────────────────

type AttachmentBase = {
  id: string;
  message_id: string;
  filename: string;
  file_size: number;
  mime_type: string;
  url: string;
  created_at: string;
};

// width and height are always both present or both absent — never mixed.
export type Attachment = AttachmentBase &
  ({ width: number; height: number } | { width: null; height: null });

// ─── WebSocket Types ─────────────────────────────────────────

export type GatewayOp =
  | "DISPATCH"
  | "HEARTBEAT"
  | "HEARTBEAT_ACK"
  | "PRESENCE_UPDATE"
  | "VOICE_SIGNAL";

export interface GatewayMessage {
  op: GatewayOp;
  t: string | null;
  d: unknown;
}

// ─── Direct Message Types ─────────────────────────────────

export interface DirectMessageChannel {
  id: string;
  recipient: UserDto;
  created_at: string;
  last_message_at: string | null;
}

export interface DirectMessage {
  id: string;
  channel_id: string;
  author_id: string | null;
  content: string;
  edited_at: string | null;
  deleted: boolean;
  created_at: string;
}

// ─── Reaction Types ───────────────────────────────────────

export interface ReactionCount {
  emoji: string;
  count: number;
  me: boolean;
}

// ─── Unread Types ─────────────────────────────────────────

export interface UnreadCount {
  channel_id: string;
  unread_count: number;
}

// ─── WebSocket Event Payloads ─────────────────────────────

export interface MentionCount {
  channel_id: string;
  count: number;
}

export interface ReadyEvent {
  user: UserDto;
  servers: ServerDto[];
  dm_channels: DirectMessageChannel[];
  unread_counts: UnreadCount[];
  mention_counts: MentionCount[];
}

export interface DmChannelCreateEvent extends DirectMessageChannel {}

export interface ReactionEvent {
  message_id: string;
  channel_id: string;
  user_id: string;
  emoji: string;
}

export interface PresenceUpdateEvent {
  user_id: string;
  status: UserStatus;
  custom_status: string | null;
}

export interface MessageDeleteEvent {
  id: string;
  channel_id: string;
}

// ─── Link Preview Types ───────────────────────────────────────────────────

export interface LinkPreviewDto {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site_name: string | null;
}

// ─── API Error ───────────────────────────────────────────────

export interface ApiError {
  error: string;
}
