import { useEffect } from "react";
import { gateway } from "../api/websocket";
import { useAuthStore } from "../stores/authStore";
import { useServerStore } from "../stores/serverStore";
import { useMessageStore } from "../stores/messageStore";
import { useChannelStore } from "../stores/channelStore";
import type {
  ReadyEvent,
  Message,
  PresenceUpdateEvent,
  MessageDeleteEvent,
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
      }),

      gateway.on("MESSAGE_CREATE", (msg: Message) => {
        if (msg.channel_id === useChannelStore.getState().activeChannelId) {
          useMessageStore.getState().addMessage(msg);
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
