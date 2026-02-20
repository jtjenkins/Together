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
  UpdateMessageRequest,
  ListMessagesQuery,
  VoiceParticipant,
  UpdateVoiceStateRequest,
  Attachment,
} from "../types";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

class ApiClient {
  private accessToken: string | null = null;

  setToken(token: string | null) {
    this.accessToken = token;
  }

  getToken(): string | null {
    return this.accessToken;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
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

    const headers: Record<string, string> = {};
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    return fetch(`${API_BASE}/messages/${messageId}/attachments`, {
      method: "POST",
      headers,
      body: formData,
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new ApiRequestError(res.status, body.error || "Upload failed");
      }
      return res.json();
    });
  }

  listAttachments(messageId: string): Promise<Attachment[]> {
    return this.request(`/messages/${messageId}/attachments`);
  }

  /** Resolve an attachment URL for use in <img> / <a> tags. */
  fileUrl(path: string): string {
    return `${API_BASE}${path}`;
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
