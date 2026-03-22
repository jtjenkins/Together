import { useEffect } from "react";
import { gateway } from "../api/websocket";
import { useAuthStore } from "../stores/authStore";
import { useServerStore } from "../stores/serverStore";
import { useMessageStore } from "../stores/messageStore";
import { useChannelStore } from "../stores/channelStore";
import { useDmStore } from "../stores/dmStore";
import { useReadStateStore } from "../stores/readStateStore";
import { useTypingStore } from "../stores/typingStore";
import { useCustomEmojiStore } from "../stores/customEmojiStore";
import { useRoleStore } from "../stores/roleStore";

import type {
  ReadyEvent,
  Message,
  PresenceUpdateEvent,
  MessageDeleteEvent,
  DirectMessageChannel,
  DirectMessage,
  ReactionEvent,
  PollVoteEvent,
  TypingStartEvent,
  CustomEmoji,
  MemberModerationEvent,
  MemberTimeoutEvent,
  RoleDto,
  RoleDeleteEvent,
  MemberRoleEvent,
  MemberRoleInfo,
} from "../types";

export function useWebSocket() {
  const setUser = useAuthStore((s) => s.setUser);
  const setServers = useServerStore((s) => s.setServers);
  const updateMemberPresence = useServerStore((s) => s.updateMemberPresence);
  const fetchMembers = useServerStore((s) => s.fetchMembers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const activeChannelId = useChannelStore((s) => s.activeChannelId);
  const addMessage = useMessageStore((s) => s.addMessage);
  const updateMessage = useMessageStore((s) => s.updateMessage);
  const removeMessage = useMessageStore((s) => s.removeMessage);
  const addThreadMessage = useMessageStore((s) => s.addThreadMessage);
  const updateMessagePoll = useMessageStore((s) => s.updateMessagePoll);

  const setDmChannels = useDmStore((s) => s.setChannels);
  const addDmChannel = useDmStore((s) => s.addChannel);
  const addDmMessage = useDmStore((s) => s.addMessage);
  const activeDmChannelId = useDmStore((s) => s.activeDmChannelId);

  const setUnreadCounts = useReadStateStore((s) => s.setUnreadCounts);
  const incrementUnread = useReadStateStore((s) => s.incrementUnread);
  const setMentionCounts = useReadStateStore((s) => s.setMentionCounts);
  const incrementMention = useReadStateStore((s) => s.incrementMention);

  const addTypingUser = useTypingStore((s) => s.addTypingUser);

  const removeMemberLocally = useServerStore((s) => s.removeMemberLocally);
  const setMemberTimeout = useServerStore((s) => s.setMemberTimeout);

  const handleRoleCreate = useRoleStore((s) => s.handleRoleCreate);
  const handleRoleUpdate = useRoleStore((s) => s.handleRoleUpdate);
  const handleRoleDelete = useRoleStore((s) => s.handleRoleDelete);
  const handleMemberRoleAdd = useRoleStore((s) => s.handleMemberRoleAdd);
  const handleMemberRoleRemove = useRoleStore((s) => s.handleMemberRoleRemove);

  useEffect(() => {
    const unsubs = [
      gateway.on("READY", (data: ReadyEvent) => {
        setUser(data.user);
        setServers(data.servers);
        if (data.dm_channels) setDmChannels(data.dm_channels);
        if (data.unread_counts) setUnreadCounts(data.unread_counts);
        if (data.mention_counts) setMentionCounts(data.mention_counts);
      }),

      gateway.on("MESSAGE_CREATE", (msg: Message) => {
        if (msg.channel_id === activeChannelId) {
          addMessage(msg);
        } else {
          incrementUnread(msg.channel_id);
          const currentUserId = useAuthStore.getState().user?.id;
          const isMentioned =
            msg.author_id !== currentUserId &&
            (msg.mention_everyone ||
              (currentUserId != null &&
                msg.mention_user_ids.includes(currentUserId)));
          if (isMentioned) {
            incrementMention(msg.channel_id);
          }
        }
      }),

      gateway.on("MESSAGE_UPDATE", (msg: Message) => {
        if (msg.channel_id === activeChannelId) {
          updateMessage(msg);
        }
      }),

      gateway.on("MESSAGE_DELETE", (event: MessageDeleteEvent) => {
        if (event.channel_id === activeChannelId) {
          removeMessage(event);
        }
      }),

      gateway.on("PRESENCE_UPDATE", (event: PresenceUpdateEvent) => {
        updateMemberPresence(
          event.user_id,
          event.status,
          event.custom_status,
          event.activity,
        );
      }),

      gateway.on("DM_CHANNEL_CREATE", (channel: DirectMessageChannel) => {
        addDmChannel(channel);
      }),

      gateway.on("DM_MESSAGE_CREATE", (msg: DirectMessage) => {
        addDmMessage(msg);
        if (msg.channel_id !== activeDmChannelId) {
          incrementUnread(msg.channel_id);
        }
      }),

      gateway.on("THREAD_MESSAGE_CREATE", (msg: Message) => {
        addThreadMessage(msg);
      }),

      gateway.on("POLL_VOTE", (event: PollVoteEvent) => {
        updateMessagePoll(event.poll_id, event.updated_poll);
      }),

      // Reaction events are handled by the ReactionBar component via its own
      // store subscription — no action needed here at the app level.
      gateway.on("REACTION_ADD", (_event: ReactionEvent) => {}),
      gateway.on("REACTION_REMOVE", (_event: ReactionEvent) => {}),

      gateway.on("TYPING_START", (event: TypingStartEvent) => {
        addTypingUser(
          event.user_id,
          event.username || "Unknown",
          event.channel_id,
        );
      }),

      gateway.on("CUSTOM_EMOJI_CREATE", (emoji: CustomEmoji) => {
        useCustomEmojiStore.getState().addEmoji(emoji);
      }),

      gateway.on(
        "CUSTOM_EMOJI_DELETE",
        (data: { server_id: string; emoji_id: string }) => {
          useCustomEmojiStore
            .getState()
            .removeEmoji(data.server_id, data.emoji_id);
        },
      ),

      gateway.on("MEMBER_KICK", (event: MemberModerationEvent) => {
        const currentUserId = useAuthStore.getState().user?.id;
        if (event.user_id === currentUserId) {
          // Current user was kicked — remove server from list
          useServerStore
            .getState()
            .setServers(
              useServerStore
                .getState()
                .servers.filter((s) => s.id !== event.server_id),
            );
          if (useServerStore.getState().activeServerId === event.server_id) {
            useServerStore.getState().setActiveServer(null);
          }
          alert("You have been kicked from the server.");
        } else {
          removeMemberLocally(event.user_id);
        }
      }),

      gateway.on("MEMBER_BAN", (event: MemberModerationEvent) => {
        const currentUserId = useAuthStore.getState().user?.id;
        if (event.user_id === currentUserId) {
          // Current user was banned — remove server from list
          useServerStore
            .getState()
            .setServers(
              useServerStore
                .getState()
                .servers.filter((s) => s.id !== event.server_id),
            );
          if (useServerStore.getState().activeServerId === event.server_id) {
            useServerStore.getState().setActiveServer(null);
          }
          alert("You have been banned from the server.");
        } else {
          removeMemberLocally(event.user_id);
        }
      }),

      gateway.on("MEMBER_TIMEOUT", (event: MemberTimeoutEvent) => {
        setMemberTimeout(event.user_id, event.expires_at);
      }),

      gateway.on("MEMBER_TIMEOUT_REMOVE", (event: MemberModerationEvent) => {
        setMemberTimeout(event.user_id, null);
      }),

      gateway.on("MEMBER_UNBAN", () => {
        // Unban is informational — no local state change needed.
        // The ban list panel re-fetches on open.
      }),

      gateway.on("ROLE_CREATE", (role: RoleDto) => {
        handleRoleCreate(role);
      }),

      gateway.on("ROLE_UPDATE", (role: RoleDto) => {
        handleRoleUpdate(role);
      }),

      gateway.on("ROLE_DELETE", (event: RoleDeleteEvent) => {
        handleRoleDelete(event);
      }),

      gateway.on("MEMBER_ROLE_ADD", (event: MemberRoleEvent) => {
        handleMemberRoleAdd(event);
        // Update member's roles in serverStore
        const members = useServerStore.getState().members;
        const member = members.find((m) => m.user_id === event.user_id);
        if (member) {
          const roleInfo: MemberRoleInfo = {
            id: event.role_id,
            name: event.role_name,
            color: event.role_color,
            position: 0,
          };
          const existingRoles = member.roles || [];
          if (!existingRoles.some((r) => r.id === event.role_id)) {
            useServerStore.setState({
              members: members.map((m) =>
                m.user_id === event.user_id
                  ? { ...m, roles: [...existingRoles, roleInfo] }
                  : m,
              ),
            });
          }
        }
      }),

      gateway.on("MEMBER_ROLE_REMOVE", (event: MemberRoleEvent) => {
        handleMemberRoleRemove(event);
        // Update member's roles in serverStore
        const members = useServerStore.getState().members;
        const member = members.find((m) => m.user_id === event.user_id);
        if (member && member.roles) {
          useServerStore.setState({
            members: members.map((m) =>
              m.user_id === event.user_id
                ? {
                    ...m,
                    roles: (m.roles || []).filter(
                      (r) => r.id !== event.role_id,
                    ),
                  }
                : m,
            ),
          });
        }
      }),

      gateway.on("connected", () => {
        if (activeServerId) {
          fetchMembers(activeServerId);
        }
      }),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [
    setUser,
    setServers,
    addMessage,
    updateMessage,
    removeMessage,
    addThreadMessage,
    updateMemberPresence,
    fetchMembers,
    activeServerId,
    activeChannelId,
    setDmChannels,
    addDmChannel,
    addDmMessage,
    activeDmChannelId,
    setUnreadCounts,
    incrementUnread,
    setMentionCounts,
    incrementMention,
    updateMessagePoll,
    addTypingUser,
    removeMemberLocally,
    setMemberTimeout,
    handleRoleCreate,
    handleRoleUpdate,
    handleRoleDelete,
    handleMemberRoleAdd,
    handleMemberRoleRemove,
  ]);
}
