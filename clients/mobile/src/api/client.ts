import type {
  AuthResponse,
  RegisterRequest,
  LoginRequest,
  UserDto,
  UpdateUserDto,
  ServerDto,
  CreateServerRequest,
  UpdateServerRequest,
  MemberDto,
  Channel,
  CreateChannelRequest,
  UpdateChannelRequest,
  Message,
  CreateMessageRequest,
  CreateThreadReplyRequest,
  UpdateMessageRequest,
  ListMessagesQuery,
  VoiceParticipant,
  UpdateVoiceStateRequest,
  Attachment,
  DirectMessageChannel,
  DirectMessage,
  ReactionCount,
  LinkPreviewDto,
  GifResult,
  PollDto,
} from "../types";
import { storage } from "../utils/storage";
import { SERVER_URL_KEY, TOKEN_KEY, REFRESH_KEY } from "../utils/platform";

/** A file selected from the device to upload as a message attachment. */
export interface MobileFile {
  uri: string;
  name: string;
  type: string;
}

function resolveApiBase(): string {
  const saved = storage.getItem(SERVER_URL_KEY);
  return saved ? `${saved}/api` : "";
}

class ApiClient {
  private accessToken: string | null = null;
  private apiBase: string = resolveApiBase();
  private onSessionExpired: (() => void) | null = null;

  /** Register a callback invoked when the refresh token is rejected (session truly dead). */
  setSessionExpiredCallback(cb: () => void): void {
    this.onSessionExpired = cb;
  }

  setToken(token: string | null) {
    this.accessToken = token;
  }

  getToken(): string | null {
    return this.accessToken;
  }

  setServerUrl(url: string): void {
    try {
      new URL(url);
    } catch {
      throw new TypeError(`[ApiClient] "${url}" is not a valid server URL`);
    }
    storage.setItem(SERVER_URL_KEY, url);
    this.apiBase = `${url}/api`;
  }

  private async request<T>(
    path: string,
    options: RequestInit & {
      skipContentType?: boolean;
      skipRefresh?: boolean;
    } = {},
  ): Promise<T> {
    if (!this.apiBase) {
      throw new Error(
        "[ApiClient] No server URL configured. Enter your Together server address to continue.",
      );
    }

    const { skipContentType, skipRefresh, ...fetchOptions } = options;
    const headers: Record<string, string> = {
      ...(skipContentType ? {} : { "Content-Type": "application/json" }),
      ...(fetchOptions.headers as Record<string, string>),
    };

    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const res = await fetch(`${this.apiBase}${path}`, {
      ...fetchOptions,
      headers,
    });

    if (!res.ok) {
      // On 401, try to silently refresh the access token and retry once
      if (res.status === 401 && !skipRefresh) {
        const refreshed = await this.tryRefresh();
        if (refreshed) {
          return this.request<T>(path, { ...options, skipRefresh: true });
        }
      }
      const body = await res.json().catch(() => ({ error: "Unknown error" }));
      throw new ApiRequestError(res.status, body.error || "Request failed");
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return res.json() as Promise<T>;
  }

  /** Exchange a stored refresh token for a new access token. Returns true on success. */
  private async tryRefresh(): Promise<boolean> {
    const refreshToken = storage.getItem(REFRESH_KEY);
    if (!refreshToken) return false;
    try {
      const res = await this.request<AuthResponse>("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refresh_token: refreshToken }),
        skipRefresh: true,
      });
      storage.setItem(TOKEN_KEY, res.access_token);
      storage.setItem(REFRESH_KEY, res.refresh_token);
      this.accessToken = res.access_token;
      return true;
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        // Server explicitly rejected the refresh token — session is dead.
        this.onSessionExpired?.();
      } else {
        // Network failure, server error, etc. — don't clear a potentially valid session.
        console.error("[ApiClient] Token refresh failed:", err);
      }
      return false;
    }
  }

  // ─── Auth ──────────────────────────────────────────────────

  register(data: RegisterRequest): Promise<AuthResponse> {
    return this.request("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
      skipRefresh: true,
    });
  }

  login(data: LoginRequest): Promise<AuthResponse> {
    return this.request("/auth/login", {
      method: "POST",
      body: JSON.stringify(data),
      skipRefresh: true,
    });
  }

  // ─── Users ─────────────────────────────────────────────────

  getCurrentUser(): Promise<UserDto> {
    return this.request("/users/@me");
  }

  updateCurrentUser(data: UpdateUserDto): Promise<UserDto> {
    return this.request("/users/@me", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  // ─── Servers ───────────────────────────────────────────────

  createServer(data: CreateServerRequest): Promise<ServerDto> {
    return this.request("/servers", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  listServers(): Promise<ServerDto[]> {
    return this.request("/servers");
  }

  getServer(id: string): Promise<ServerDto> {
    return this.request(`/servers/${id}`);
  }

  updateServer(id: string, data: UpdateServerRequest): Promise<ServerDto> {
    return this.request(`/servers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  deleteServer(id: string): Promise<void> {
    return this.request(`/servers/${id}`, { method: "DELETE" });
  }

  joinServer(id: string): Promise<{ message: string }> {
    return this.request(`/servers/${id}/join`, { method: "POST" });
  }

  leaveServer(id: string): Promise<void> {
    return this.request(`/servers/${id}/leave`, { method: "DELETE" });
  }

  listMembers(serverId: string): Promise<MemberDto[]> {
    return this.request(`/servers/${serverId}/members`);
  }

  // ─── Channels ──────────────────────────────────────────────

  createChannel(
    serverId: string,
    data: CreateChannelRequest,
  ): Promise<Channel> {
    return this.request(`/servers/${serverId}/channels`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  listChannels(serverId: string): Promise<Channel[]> {
    return this.request(`/servers/${serverId}/channels`);
  }

  getChannel(serverId: string, channelId: string): Promise<Channel> {
    return this.request(`/servers/${serverId}/channels/${channelId}`);
  }

  updateChannel(
    serverId: string,
    channelId: string,
    data: UpdateChannelRequest,
  ): Promise<Channel> {
    return this.request(`/servers/${serverId}/channels/${channelId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  deleteChannel(serverId: string, channelId: string): Promise<void> {
    return this.request(`/servers/${serverId}/channels/${channelId}`, {
      method: "DELETE",
    });
  }

  // ─── Messages ──────────────────────────────────────────────

  createMessage(
    channelId: string,
    data: CreateMessageRequest,
  ): Promise<Message> {
    return this.request(`/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  listMessages(
    channelId: string,
    query?: ListMessagesQuery,
  ): Promise<Message[]> {
    const params = new URLSearchParams();
    if (query?.before) params.set("before", query.before);
    if (query?.limit) params.set("limit", String(query.limit));
    const qs = params.toString();
    return this.request(`/channels/${channelId}/messages${qs ? `?${qs}` : ""}`);
  }

  updateMessage(
    messageId: string,
    data: UpdateMessageRequest,
  ): Promise<Message> {
    return this.request(`/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  deleteMessage(messageId: string): Promise<void> {
    return this.request(`/messages/${messageId}`, { method: "DELETE" });
  }

  // ─── Voice ─────────────────────────────────────────────────

  joinVoiceChannel(channelId: string): Promise<VoiceParticipant> {
    return this.request(`/channels/${channelId}/voice`, { method: "POST" });
  }

  leaveVoiceChannel(channelId: string): Promise<void> {
    return this.request(`/channels/${channelId}/voice`, { method: "DELETE" });
  }

  updateVoiceState(
    channelId: string,
    data: UpdateVoiceStateRequest,
  ): Promise<VoiceParticipant> {
    return this.request(`/channels/${channelId}/voice`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  listVoiceParticipants(channelId: string): Promise<VoiceParticipant[]> {
    return this.request(`/channels/${channelId}/voice`);
  }

  // ─── Attachments ───────────────────────────────────────────

  uploadAttachments(
    messageId: string,
    files: MobileFile[],
  ): Promise<Attachment[]> {
    const formData = new FormData();
    files.forEach((file) => {
      // React Native FormData accepts { uri, name, type } objects
      (formData as FormData).append("files", {
        uri: file.uri,
        name: file.name,
        type: file.type,
      } as unknown as Blob);
    });
    return this.request(`/messages/${messageId}/attachments`, {
      method: "POST",
      body: formData,
      skipContentType: true,
    });
  }

  listAttachments(messageId: string): Promise<Attachment[]> {
    return this.request(`/messages/${messageId}/attachments`);
  }

  // ─── DM Channels ───────────────────────────────────────────

  openDmChannel(userId: string): Promise<DirectMessageChannel> {
    return this.request("/dm-channels", {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    });
  }

  listDmChannels(): Promise<DirectMessageChannel[]> {
    return this.request("/dm-channels");
  }

  sendDmMessage(channelId: string, content: string): Promise<DirectMessage> {
    return this.request(`/dm-channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  }

  listDmMessages(channelId: string, before?: string): Promise<DirectMessage[]> {
    const params = new URLSearchParams();
    if (before) params.set("before", before);
    const qs = params.toString();
    return this.request(
      `/dm-channels/${channelId}/messages${qs ? `?${qs}` : ""}`,
    );
  }

  ackDmChannel(channelId: string): Promise<void> {
    return this.request(`/dm-channels/${channelId}/ack`, { method: "POST" });
  }

  // ─── Threads ───────────────────────────────────────────────

  listThreadReplies(
    channelId: string,
    messageId: string,
    query?: { before?: string; limit?: number },
  ): Promise<Message[]> {
    const params = new URLSearchParams();
    if (query?.before) params.set("before", query.before);
    if (query?.limit) params.set("limit", String(query.limit));
    const qs = params.toString();
    return this.request(
      `/channels/${channelId}/messages/${messageId}/thread${qs ? `?${qs}` : ""}`,
    );
  }

  createThreadReply(
    channelId: string,
    messageId: string,
    data: CreateThreadReplyRequest,
  ): Promise<Message> {
    return this.request(`/channels/${channelId}/messages/${messageId}/thread`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // ─── Reactions ─────────────────────────────────────────────

  addReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    return this.request(
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
      { method: "PUT" },
    );
  }

  removeReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    return this.request(
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
      { method: "DELETE" },
    );
  }

  listReactions(
    channelId: string,
    messageId: string,
  ): Promise<ReactionCount[]> {
    return this.request(
      `/channels/${channelId}/messages/${messageId}/reactions`,
    );
  }

  // ─── Read States ───────────────────────────────────────────

  ackChannel(channelId: string): Promise<void> {
    return this.request(`/channels/${channelId}/ack`, { method: "POST" });
  }

  // ─── Link Preview ──────────────────────────────────────────

  getLinkPreview(url: string): Promise<LinkPreviewDto> {
    return this.request<LinkPreviewDto>(
      `/link-preview?url=${encodeURIComponent(url)}`,
    );
  }

  // ─── Giphy ───────────────────────────────────────────────────

  searchGifs(q: string, limit = 15): Promise<GifResult[]> {
    return this.request<GifResult[]>(
      `/giphy/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    );
  }

  // ─── Polls ───────────────────────────────────────────────────

  createPoll(
    channelId: string,
    data: { question: string; options: string[] },
  ): Promise<Message> {
    return this.request<Message>(`/channels/${channelId}/polls`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  castVote(pollId: string, optionId: string): Promise<PollDto> {
    return this.request<PollDto>(`/polls/${pollId}/vote`, {
      method: "POST",
      body: JSON.stringify({ option_id: optionId }),
    });
  }

  // ─── Events ──────────────────────────────────────────────────

  createEvent(
    channelId: string,
    data: { name: string; description?: string; starts_at: string },
  ): Promise<Message> {
    return this.request<Message>(`/channels/${channelId}/events`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** Resolve an attachment URL for use in Image sources. */
  fileUrl(path: string): string {
    return `${this.apiBase}${path}`;
  }
}

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export const api = new ApiClient();
