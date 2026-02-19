import { useEffect } from 'react';
import { gateway } from '../api/websocket';
import { useAuthStore } from '../stores/authStore';
import { useServerStore } from '../stores/serverStore';
import { useMessageStore } from '../stores/messageStore';
import { useChannelStore } from '../stores/channelStore';
import type { ReadyEvent, Message, PresenceUpdateEvent, MessageDeleteEvent } from '../types';

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

  useEffect(() => {
    const unsubs = [
      gateway.on('READY', (data: ReadyEvent) => {
        setUser(data.user);
        setServers(data.servers);
      }),

      gateway.on('MESSAGE_CREATE', (msg: Message) => {
        if (msg.channel_id === activeChannelId) {
          addMessage(msg);
        }
      }),

      gateway.on('MESSAGE_UPDATE', (msg: Message) => {
        if (msg.channel_id === activeChannelId) {
          updateMessage(msg);
        }
      }),

      gateway.on('MESSAGE_DELETE', (event: MessageDeleteEvent) => {
        if (event.channel_id === activeChannelId) {
          removeMessage(event);
        }
      }),

      gateway.on('PRESENCE_UPDATE', (event: PresenceUpdateEvent) => {
        updateMemberPresence(event.user_id, event.status, event.custom_status);
      }),

      gateway.on('connected', () => {
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
    updateMemberPresence,
    fetchMembers,
    activeServerId,
    activeChannelId,
  ]);
}
