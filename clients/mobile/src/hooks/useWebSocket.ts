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
  DmChannelCreateEvent,
  DmMessageCreateEvent,
  ReactionAddEvent,
  ReactionRemoveEvent,
  PollVoteEvent,
} from "../types";

export function useWebSocket() {
  const setUser = useAuthStore((s) => s.setUser);
  const setServers = useServerStore((s) => s.setServers);
  const updateMemberPresence = useServerStore((s) => s.updateMemberPresence);
  const fetchMembers = useServerStore((s) => s.fetchMembers);
  const activeServerId = useServerStore((s) => s.activeServerId);

  useEffect(() => {
    const unsubs = [
      gateway.on("READY", (data: ReadyEvent) => {
        setUser(data.user);
        setServers(data.servers);
        useDmStore.getState().setDmChannels(data.dm_channels ?? []);
        useReadStateStore.getState().setUnreadCounts(data.unread_counts ?? []);
        useReadStateStore
          .getState()
          .setMentionCounts(data.mention_counts ?? []);
      }),

      gateway.on("MESSAGE_CREATE", (msg: Message) => {
        const activeChannelId = useChannelStore.getState().activeChannelId;
        if (msg.channel_id === activeChannelId) {
          useMessageStore.getState().addMessage(msg);
        } else {
          useReadStateStore.getState().incrementUnread(msg.channel_id);
          const currentUserId = useAuthStore.getState().user?.id ?? null;
          const isMentioned =
            msg.author_id !== currentUserId &&
            (msg.mention_everyone ||
              (currentUserId !== null &&
                msg.mention_user_ids.includes(currentUserId)));
          if (isMentioned) {
            useReadStateStore.getState().incrementMention(msg.channel_id);
          }
        }
      }),

      gateway.on("MESSAGE_UPDATE", (msg: Message) => {
        if (msg.channel_id === useChannelStore.getState().activeChannelId) {
          useMessageStore.getState().updateMessage(msg);
        }
      }),

      gateway.on("MESSAGE_DELETE", (event: MessageDeleteEvent) => {
        if (event.channel_id === useChannelStore.getState().activeChannelId) {
          useMessageStore.getState().removeMessage(event);
        }
      }),

      gateway.on("PRESENCE_UPDATE", (event: PresenceUpdateEvent) => {
        updateMemberPresence(event.user_id, event.status, event.custom_status);
      }),

      gateway.on("DM_CHANNEL_CREATE", (data: DmChannelCreateEvent) => {
        useDmStore.getState().addDmChannel({
          id: data.id,
          recipient: data.recipient,
          created_at: data.created_at,
          last_message_at: data.last_message_at,
        });
      }),

      gateway.on("DM_MESSAGE_CREATE", (data: DmMessageCreateEvent) => {
        useDmStore.getState().addDmMessage(data);
        const activeDmChannelId = useDmStore.getState().activeDmChannelId;
        if (data.channel_id !== activeDmChannelId) {
          useReadStateStore.getState().incrementUnread(data.channel_id);
        }
      }),

      gateway.on("THREAD_MESSAGE_CREATE", (msg: Message) => {
        useMessageStore.getState().addThreadMessage(msg);
      }),

      gateway.on("REACTION_ADD", (_data: ReactionAddEvent) => {
        // Reaction state is managed locally in ChatScreen via listReactions;
        // no global store update required for MVP.
      }),

      gateway.on("REACTION_REMOVE", (_data: ReactionRemoveEvent) => {
        // Same as REACTION_ADD — local screen state handles re-fetch.
      }),

      gateway.on("POLL_VOTE", (event: PollVoteEvent) => {
        useMessageStore
          .getState()
          .updateMessagePoll(event.poll_id, event.updated_poll);
      }),

      gateway.on("connected", () => {
        if (activeServerId) {
          fetchMembers(activeServerId);
        }
      }),

      gateway.on("permanently_disconnected", () => {
        console.error("[WebSocket] Permanently disconnected after max retries");
      }),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [setUser, setServers, updateMemberPresence, fetchMembers, activeServerId]);
}
