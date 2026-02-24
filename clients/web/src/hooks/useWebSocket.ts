import { useEffect } from "react";
import { gateway } from "../api/websocket";
import { useAuthStore } from "../stores/authStore";
import { useServerStore } from "../stores/serverStore";
import { useMessageStore } from "../stores/messageStore";
import { useChannelStore } from "../stores/channelStore";
import { useDmStore } from "../stores/dmStore";
import { useReadStateStore } from "../stores/readStateStore";
import type {
  ReadyEvent,
  Message,
  PresenceUpdateEvent,
  MessageDeleteEvent,
  DirectMessageChannel,
  DirectMessage,
  ReactionEvent,
} from "../types";

export function useWebSocket() {
  const setUser = useAuthStore((s) => s.setUser);
  const user = useAuthStore((s) => s.user);
  const setServers = useServerStore((s) => s.setServers);
  const updateMemberPresence = useServerStore((s) => s.updateMemberPresence);
  const fetchMembers = useServerStore((s) => s.fetchMembers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const activeChannelId = useChannelStore((s) => s.activeChannelId);
  const addMessage = useMessageStore((s) => s.addMessage);
  const updateMessage = useMessageStore((s) => s.updateMessage);
  const removeMessage = useMessageStore((s) => s.removeMessage);

  const setDmChannels = useDmStore((s) => s.setChannels);
  const addDmChannel = useDmStore((s) => s.addChannel);
  const addDmMessage = useDmStore((s) => s.addMessage);
  const activeDmChannelId = useDmStore((s) => s.activeDmChannelId);

  const setUnreadCounts = useReadStateStore((s) => s.setUnreadCounts);
  const incrementUnread = useReadStateStore((s) => s.incrementUnread);
  const setMentionCounts = useReadStateStore((s) => s.setMentionCounts);
  const incrementMention = useReadStateStore((s) => s.incrementMention);

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
          const isMentioned =
            msg.mention_everyone ||
            (user?.id != null && msg.mention_user_ids.includes(user.id));
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
        updateMemberPresence(event.user_id, event.status, event.custom_status);
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

      // Reaction events are handled by the ReactionBar component via its own
      // store subscription — no action needed here at the app level.
      gateway.on("REACTION_ADD", (_event: ReactionEvent) => {}),
      gateway.on("REACTION_REMOVE", (_event: ReactionEvent) => {}),

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
    user,
    setServers,
    addMessage,
    updateMessage,
    removeMessage,
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
  ]);
}
