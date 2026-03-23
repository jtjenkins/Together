import type {
  AuthResponse,
  RegisterRequest,
  LoginRequest,
  UserDto,
  UpdateUserDto,
  PublicProfileDto,
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
  CustomEmoji,
  LinkPreviewDto,
  GifResult,
  PollDto,
  ForgotPasswordResponse,
  ResetPasswordRequest,
  IceServersResponse,
  SearchQuery,
  SearchResponse,
  AutomodConfig,
  UpdateAutomodConfigRequest,
  AutomodWordFilter,
  AutomodLog,
  ServerBan,
  BotDto,
  CreateBotRequest,
  BotCreatedResponse,
  UpdateBotRequest,
  BotLogEntry,
  GoLiveSession,
  StartGoLiveRequest,
  ServerTemplate,
  ServerInviteDto,
  CreateInviteRequest,
  InvitePreviewDto,
  WebhookDto,
  CreateWebhookRequest,
  WebhookCreatedResponse,
  UpdateWebhookRequest,
  KickMemberRequest,
  BanMemberRequest,
  TimeoutMemberRequest,
  RoleDto,
  CreateRoleRequest,
  UpdateRoleRequest,
  AdminStatsResponse,
  AdminUsersResponse,
  AdminServersResponse,
  UpdateAdminUserRequest,
  AdminUsersQuery,
  AdminServersQuery,
  InstanceSettings,
  UpdateInstanceSettingsRequest,
  RegistrationMode,
  AuditLog,
  AuditLogQuery,
  ChannelPermissionOverride,
  SetOverrideRequest,
} from "../types";
import { isTauri, SERVER_URL_KEY } from "../utils/tauri";

const TOKEN_KEY = "together_access_token";
const REFRESH_KEY = "together_refresh_token";

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
    localStorage.setItem(SERVER_URL_KEY, url);
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

    return res.json();
  }

  /** Exchange a stored refresh token for a new access token. Returns true on success. */
  private async tryRefresh(): Promise<boolean> {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return false;
    try {
      const res = await this.request<AuthResponse>("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refresh_token: refreshToken }),
        skipRefresh: true,
      });
      localStorage.setItem(TOKEN_KEY, res.access_token);
      localStorage.setItem(REFRESH_KEY, res.refresh_token);
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

  getUserProfile(userId: string): Promise<PublicProfileDto> {
    return this.request(`/users/${userId}`);
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

  browseServers(): Promise<ServerDto[]> {
    return this.request("/servers/browse");
  }

  listTemplates(): Promise<ServerTemplate[]> {
    return this.request("/server-templates");
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

  // ─── Channel Permission Overrides ─────────────────────────

  listChannelOverrides(
    channelId: string,
  ): Promise<ChannelPermissionOverride[]> {
    return this.request<ChannelPermissionOverride[]>(
      `/channels/${channelId}/overrides`,
    );
  }

  setChannelOverride(
    channelId: string,
    data: SetOverrideRequest,
  ): Promise<ChannelPermissionOverride> {
    return this.request<ChannelPermissionOverride>(
      `/channels/${channelId}/overrides`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    );
  }

  deleteChannelOverride(channelId: string, overrideId: string): Promise<void> {
    return this.request<void>(
      `/channels/${channelId}/overrides/${overrideId}`,
      { method: "DELETE" },
    );
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

  getMessage(channelId: string, messageId: string): Promise<Message> {
    return this.request<Message>(
      `/channels/${channelId}/messages/${messageId}`,
    );
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

  // ─── Go Live ────────────────────────────────────────────────

  startGoLive(
    channelId: string,
    data: StartGoLiveRequest,
  ): Promise<GoLiveSession> {
    return this.request(`/channels/${channelId}/go-live`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  stopGoLive(channelId: string): Promise<void> {
    return this.request(`/channels/${channelId}/go-live`, {
      method: "DELETE",
    });
  }

  getGoLive(channelId: string): Promise<GoLiveSession> {
    return this.request(`/channels/${channelId}/go-live`);
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

  // ── Custom Emojis ────────────────────────────────────────────────────────────

  listCustomEmojis(serverId: string): Promise<CustomEmoji[]> {
    return this.request(`/servers/${serverId}/emojis`);
  }

  async uploadCustomEmoji(
    serverId: string,
    name: string,
    file: File,
  ): Promise<CustomEmoji> {
    const form = new FormData();
    form.append("name", name);
    form.append("image", file);
    // Do NOT set Content-Type — browser sets it with the multipart boundary automatically.
    return this.request<CustomEmoji>(`/servers/${serverId}/emojis`, {
      method: "POST",
      body: form,
      skipContentType: true,
    });
  }

  deleteCustomEmoji(serverId: string, emojiId: string): Promise<void> {
    return this.request(`/servers/${serverId}/emojis/${emojiId}`, {
      method: "DELETE",
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

  // ─── Pins ───────────────────────────────────────────────

  pinMessage(channelId: string, messageId: string): Promise<void> {
    return this.request(`/channels/${channelId}/messages/${messageId}/pin`, {
      method: "POST",
    });
  }

  unpinMessage(channelId: string, messageId: string): Promise<void> {
    return this.request(`/channels/${channelId}/messages/${messageId}/pin`, {
      method: "DELETE",
    });
  }

  listPinnedMessages(channelId: string): Promise<Message[]> {
    return this.request(`/channels/${channelId}/pinned-messages`);
  }

  getLinkPreview(url: string): Promise<LinkPreviewDto> {
    return this.request<LinkPreviewDto>(
      `/link-preview?url=${encodeURIComponent(url)}`,
    );
  }

  searchGifs(q: string, limit = 15): Promise<GifResult[]> {
    return this.request<GifResult[]>(
      `/giphy/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    );
  }

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

  createEvent(
    channelId: string,
    data: { name: string; description?: string; starts_at: string },
  ): Promise<Message> {
    return this.request<Message>(`/channels/${channelId}/events`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // ─── Password Reset ──────────────────────────────────────────────────────

  /** Generate a password reset token for a user by email. Admin only. */
  forgotPassword(email: string): Promise<ForgotPasswordResponse> {
    return this.request<ForgotPasswordResponse>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  /** Reset a user's password using a reset token. */
  resetPassword(data: ResetPasswordRequest): Promise<void> {
    return this.request<void>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // ─── Search ──────────────────────────────────────────────────────────────

  /** Search messages in a server or specific channel. */
  searchMessages(
    serverId: string,
    query: SearchQuery,
    signal?: AbortSignal,
  ): Promise<SearchResponse> {
    const params = new URLSearchParams();
    params.set("q", query.q);
    if (query.channel_id) params.set("channel_id", query.channel_id);
    if (query.before) params.set("before", query.before);
    if (query.limit) params.set("limit", String(query.limit));
    return this.request<SearchResponse>(
      `/servers/${serverId}/search?${params.toString()}`,
      { signal },
    );
  }

  // ─── ICE Servers (WebRTC) ──────────────────────────────────────────────

  /** Get ICE servers for WebRTC peer connections, including TURN credentials. */
  getIceServers(): Promise<IceServersResponse> {
    return this.request<IceServersResponse>("/ice-servers");
  }

  // ─── Automod ───────────────────────────────────────────────────────────

  getAutomodConfig(serverId: string): Promise<AutomodConfig> {
    return this.request<AutomodConfig>(`/servers/${serverId}/automod`);
  }

  updateAutomodConfig(
    serverId: string,
    updates: UpdateAutomodConfigRequest,
  ): Promise<AutomodConfig> {
    return this.request<AutomodConfig>(`/servers/${serverId}/automod`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  listWordFilters(serverId: string): Promise<AutomodWordFilter[]> {
    return this.request<AutomodWordFilter[]>(
      `/servers/${serverId}/automod/words`,
    );
  }

  addWordFilter(serverId: string, word: string): Promise<AutomodWordFilter> {
    return this.request<AutomodWordFilter>(
      `/servers/${serverId}/automod/words`,
      {
        method: "POST",
        body: JSON.stringify({ word }),
      },
    );
  }

  removeWordFilter(serverId: string, word: string): Promise<void> {
    return this.request<void>(
      `/servers/${serverId}/automod/words/${encodeURIComponent(word)}`,
      { method: "DELETE" },
    );
  }

  listAutomodLogs(serverId: string): Promise<AutomodLog[]> {
    return this.request<AutomodLog[]>(`/servers/${serverId}/automod/logs`);
  }

  listBans(serverId: string): Promise<ServerBan[]> {
    return this.request<ServerBan[]>(`/servers/${serverId}/bans`);
  }

  removeBan(serverId: string, userId: string): Promise<void> {
    return this.request<void>(`/servers/${serverId}/bans/${userId}`, {
      method: "DELETE",
    });
  }

  // ─── Bots ────────────────────────────────────────────────────────────────

  listBots(): Promise<{ bots: BotDto[] }> {
    return this.request<{ bots: BotDto[] }>("/bots");
  }

  createBot(data: CreateBotRequest): Promise<BotCreatedResponse> {
    return this.request<BotCreatedResponse>("/bots", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  revokeBot(botId: string): Promise<void> {
    return this.request(`/bots/${botId}`, { method: "DELETE" });
  }

  regenerateBotToken(botId: string): Promise<BotCreatedResponse> {
    return this.request<BotCreatedResponse>(`/bots/${botId}/token/regenerate`, {
      method: "POST",
    });
  }

  updateBot(botId: string, data: UpdateBotRequest): Promise<BotDto> {
    return this.request<BotDto>(`/bots/${botId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  getBotLogs(botId: string): Promise<{ logs: BotLogEntry[] }> {
    return this.request<{ logs: BotLogEntry[] }>(`/bots/${botId}/logs`);
  }

  /** Download a server data export as a ZIP file and trigger a browser download. */
  async exportServer(serverId: string): Promise<void> {
    const headers: Record<string, string> = {};
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const res = await fetch(`${this.apiBase}/servers/${serverId}/export`, {
      headers,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "Export failed");
      throw new ApiRequestError(res.status, text);
    }

    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
    const filename = filenameMatch ? filenameMatch[1] : `server-export.zip`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ─── Moderation ──────────────────────────────────────────────────────────

  kickMember(
    serverId: string,
    userId: string,
    data?: KickMemberRequest,
  ): Promise<void> {
    return this.request(`/servers/${serverId}/members/${userId}/kick`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    });
  }

  banMember(
    serverId: string,
    userId: string,
    data?: BanMemberRequest,
  ): Promise<void> {
    return this.request(`/servers/${serverId}/members/${userId}/ban`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    });
  }

  timeoutMember(
    serverId: string,
    userId: string,
    data: TimeoutMemberRequest,
  ): Promise<void> {
    return this.request(`/servers/${serverId}/members/${userId}/timeout`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  removeTimeout(serverId: string, userId: string): Promise<void> {
    return this.request(`/servers/${serverId}/members/${userId}/timeout`, {
      method: "DELETE",
    });
  }

  // ─── Invites ──────────────────────────────────────────────────────────────

  listInvites(serverId: string): Promise<ServerInviteDto[]> {
    return this.request<ServerInviteDto[]>(`/servers/${serverId}/invites`);
  }

  createInvite(
    serverId: string,
    data: CreateInviteRequest,
  ): Promise<ServerInviteDto> {
    return this.request<ServerInviteDto>(`/servers/${serverId}/invites`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  deleteInvite(serverId: string, inviteId: string): Promise<void> {
    return this.request<void>(`/servers/${serverId}/invites/${inviteId}`, {
      method: "DELETE",
    });
  }

  previewInvite(code: string): Promise<InvitePreviewDto> {
    return this.request<InvitePreviewDto>(
      `/invites/${encodeURIComponent(code)}`,
    );
  }

  acceptInvite(code: string): Promise<{ message: string; server_id: string }> {
    return this.request<{ message: string; server_id: string }>(
      `/invites/${encodeURIComponent(code)}/accept`,
      { method: "POST" },
    );
  }

  // ─── Webhooks ─────────────────────────────────────────────────────────────

  listWebhooks(serverId: string): Promise<{ webhooks: WebhookDto[] }> {
    return this.request<{ webhooks: WebhookDto[] }>(
      `/servers/${serverId}/webhooks`,
    );
  }

  createWebhook(
    serverId: string,
    data: CreateWebhookRequest,
  ): Promise<WebhookCreatedResponse> {
    return this.request<WebhookCreatedResponse>(
      `/servers/${serverId}/webhooks`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
  }

  updateWebhook(
    serverId: string,
    webhookId: string,
    data: UpdateWebhookRequest,
  ): Promise<WebhookDto> {
    return this.request<WebhookDto>(
      `/servers/${serverId}/webhooks/${webhookId}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      },
    );
  }

  deleteWebhook(serverId: string, webhookId: string): Promise<void> {
    return this.request<void>(`/servers/${serverId}/webhooks/${webhookId}`, {
      method: "DELETE",
    });
  }

  testWebhook(serverId: string, webhookId: string): Promise<void> {
    return this.request<void>(
      `/servers/${serverId}/webhooks/${webhookId}/test`,
      { method: "POST" },
    );
  }

  // ─── Audit Logs ──────────────────────────────────────────────────────────────

  getAuditLogs(serverId: string, query?: AuditLogQuery): Promise<AuditLog[]> {
    const params = new URLSearchParams();
    if (query?.action) params.set("action", query.action);
    if (query?.actor_id) params.set("actor_id", query.actor_id);
    if (query?.target_type) params.set("target_type", query.target_type);
    if (query?.before) params.set("before", query.before);
    if (query?.limit) params.set("limit", String(query.limit));
    const qs = params.toString();
    return this.request<AuditLog[]>(
      `/servers/${serverId}/audit-logs${qs ? `?${qs}` : ""}`,
    );
  }

  // ─── Roles ──────────────────────────────────────────────────────────────────

  listRoles(serverId: string): Promise<RoleDto[]> {
    return this.request<RoleDto[]>(`/servers/${serverId}/roles`);
  }

  createRole(serverId: string, data: CreateRoleRequest): Promise<RoleDto> {
    return this.request<RoleDto>(`/servers/${serverId}/roles`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  updateRole(
    serverId: string,
    roleId: string,
    data: UpdateRoleRequest,
  ): Promise<RoleDto> {
    return this.request<RoleDto>(`/servers/${serverId}/roles/${roleId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  deleteRole(serverId: string, roleId: string): Promise<void> {
    return this.request<void>(`/servers/${serverId}/roles/${roleId}`, {
      method: "DELETE",
    });
  }

  assignRole(serverId: string, userId: string, roleId: string): Promise<void> {
    return this.request<void>(
      `/servers/${serverId}/members/${userId}/roles/${roleId}`,
      { method: "PUT" },
    );
  }

  removeRole(serverId: string, userId: string, roleId: string): Promise<void> {
    return this.request<void>(
      `/servers/${serverId}/members/${userId}/roles/${roleId}`,
      { method: "DELETE" },
    );
  }

  // ─── Admin ──────────────────────────────────────────────────────────────────

  getAdminStats(): Promise<AdminStatsResponse> {
    return this.request<AdminStatsResponse>("/admin/stats");
  }

  getAdminUsers(query?: AdminUsersQuery): Promise<AdminUsersResponse> {
    const params = new URLSearchParams();
    if (query?.page) params.set("page", String(query.page));
    if (query?.per_page) params.set("per_page", String(query.per_page));
    if (query?.search) params.set("search", query.search);
    if (query?.sort_by) params.set("sort_by", query.sort_by);
    const qs = params.toString();
    return this.request<AdminUsersResponse>(
      `/admin/users${qs ? `?${qs}` : ""}`,
    );
  }

  updateAdminUser(userId: string, data: UpdateAdminUserRequest): Promise<void> {
    return this.request<void>(`/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  deleteAdminUser(userId: string): Promise<void> {
    return this.request<void>(`/admin/users/${userId}`, {
      method: "DELETE",
    });
  }

  getAdminServers(query?: AdminServersQuery): Promise<AdminServersResponse> {
    const params = new URLSearchParams();
    if (query?.page) params.set("page", String(query.page));
    if (query?.per_page) params.set("per_page", String(query.per_page));
    if (query?.search) params.set("search", query.search);
    if (query?.sort_by) params.set("sort_by", query.sort_by);
    const qs = params.toString();
    return this.request<AdminServersResponse>(
      `/admin/servers${qs ? `?${qs}` : ""}`,
    );
  }

  deleteAdminServer(serverId: string): Promise<void> {
    return this.request<void>(`/admin/servers/${serverId}`, {
      method: "DELETE",
    });
  }

  getAdminSettings(): Promise<InstanceSettings> {
    return this.request<InstanceSettings>("/admin/settings");
  }

  updateAdminSettings(
    data: UpdateInstanceSettingsRequest,
  ): Promise<InstanceSettings> {
    return this.request<InstanceSettings>("/admin/settings", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  /** Public endpoint — no auth required. */
  getRegistrationMode(): Promise<{ registration_mode: RegistrationMode }> {
    return this.request<{ registration_mode: RegistrationMode }>(
      "/instance/registration-mode",
      { skipRefresh: true },
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
