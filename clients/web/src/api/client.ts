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
} from "../types";
import { isTauri, SERVER_URL_KEY } from "../utils/tauri";

function resolveApiBase(): string {
  if (isTauri) {
    const saved = localStorage.getItem(SERVER_URL_KEY);
    return saved ? `${saved}/api` : "";
  }
  return import.meta.env.VITE_API_URL || "/api";
}

class ApiClient {
  private accessToken: string | null = null;
  private apiBase: string = resolveApiBase();

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
    localStorage.setItem(SERVER_URL_KEY, url);
    this.apiBase = `${url}/api`;
  }

  private async request<T>(
    path: string,
    options: RequestInit & { skipContentType?: boolean } = {},
  ): Promise<T> {
    if (!this.apiBase) {
      throw new Error(
        "[ApiClient] No server URL configured. Enter your Together server address to continue.",
      );
    }

    const { skipContentType, ...fetchOptions } = options;
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
      const body = await res.json().catch(() => ({ error: "Unknown error" }));
      throw new ApiRequestError(res.status, body.error || "Request failed");
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return res.json();
  }

  // ─── Auth ──────────────────────────────────────────────────

  register(data: RegisterRequest): Promise<AuthResponse> {
    return this.request("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  login(data: LoginRequest): Promise<AuthResponse> {
    return this.request("/auth/login", {
      method: "POST",
      body: JSON.stringify(data),
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

  uploadAttachments(messageId: string, files: File[]): Promise<Attachment[]> {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    return this.request(`/messages/${messageId}/attachments`, {
      method: "POST",
      body: formData,
      skipContentType: true,
    });
  }

  listAttachments(messageId: string): Promise<Attachment[]> {
    return this.request(`/messages/${messageId}/attachments`);
  }

  /** Resolve an attachment URL for use in <img> / <a> tags. */
  fileUrl(path: string): string {
    return `${this.apiBase}${path}`;
  }

  // ─── Read States ───────────────────────────────────────

  ackChannel(channelId: string): Promise<void> {
    return this.request(`/channels/${channelId}/ack`, { method: "POST" });
  }

  // ─── Direct Messages ───────────────────────────────────

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

  listDmMessages(
    channelId: string,
    query?: { before?: string; limit?: number },
  ): Promise<DirectMessage[]> {
    const params = new URLSearchParams();
    if (query?.before) params.set("before", query.before);
    if (query?.limit) params.set("limit", String(query.limit));
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

  // ─── Reactions ─────────────────────────────────────────

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
