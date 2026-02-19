import { useEffect, useState } from 'react';
import { useChannelStore } from '../../stores/channelStore';
import { useMessageStore } from '../../stores/messageStore';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import { CreateChannelModal } from '../channels/CreateChannelModal';
import { EditChannelModal } from '../channels/EditChannelModal';
import { ContextMenu, ContextMenuItem } from '../common/ContextMenu';
import type { Channel } from '../../types';
import styles from './ChannelSidebar.module.css';

interface ChannelSidebarProps {
  serverId: string;
}

export function ChannelSidebar({ serverId }: ChannelSidebarProps) {
  const channels = useChannelStore((s) => s.channels);
  const activeChannelId = useChannelStore((s) => s.activeChannelId);
  const setActiveChannel = useChannelStore((s) => s.setActiveChannel);
  const fetchChannels = useChannelStore((s) => s.fetchChannels);
  const deleteChannel = useChannelStore((s) => s.deleteChannel);
  const clearMessages = useMessageStore((s) => s.clearMessages);
  const servers = useServerStore((s) => s.servers);
  const user = useAuthStore((s) => s.user);

  const [showCreate, setShowCreate] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    channel: Channel;
  } | null>(null);

  const server = servers.find((s) => s.id === serverId);
  const isOwner = server?.owner_id === user?.id;

  useEffect(() => {
    fetchChannels(serverId);
  }, [serverId, fetchChannels]);

  const handleSelectChannel = (id: string) => {
    if (id !== activeChannelId) {
      clearMessages();
      setActiveChannel(id);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, channel: Channel) => {
    e.preventDefault();
    if (isOwner) {
      setContextMenu({ x: e.clientX, y: e.clientY, channel });
    }
  };

  // Group channels by category
  const textChannels = channels.filter((c) => c.type === 'text');
  const voiceChannels = channels.filter((c) => c.type === 'voice');

  const categories = new Map<string, Channel[]>();
  for (const ch of textChannels) {
    const cat = ch.category || 'Text Channels';
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(ch);
  }
  if (voiceChannels.length > 0) {
    categories.set('Voice Channels', voiceChannels);
  }

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <h2 className={styles.serverName}>{server?.name ?? 'Server'}</h2>
      </div>

      <div className={styles.channelList}>
        {Array.from(categories.entries()).map(([category, chans]) => (
          <div key={category} className={styles.category}>
            <div className={styles.categoryHeader}>
              <span className={styles.categoryName}>{category}</span>
              {isOwner && (
                <button
                  className={styles.addBtn}
                  onClick={() => setShowCreate(true)}
                  title="Create Channel"
                >
                  +
                </button>
              )}
            </div>
            {chans.map((channel) => (
              <button
                key={channel.id}
                className={`${styles.channel} ${channel.id === activeChannelId ? styles.active : ''}`}
                onClick={() => handleSelectChannel(channel.id)}
                onContextMenu={(e) => handleContextMenu(e, channel)}
              >
                <span className={styles.channelIcon}>
                  {channel.type === 'text' ? '#' : '\u{1F50A}'}
                </span>
                <span className={styles.channelName}>{channel.name}</span>
              </button>
            ))}
          </div>
        ))}

        {channels.length === 0 && (
          <div className={styles.empty}>
            <p>No channels yet</p>
            {isOwner && (
              <button
                className={styles.createBtn}
                onClick={() => setShowCreate(true)}
              >
                Create Channel
              </button>
            )}
          </div>
        )}
      </div>

      <CreateChannelModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        serverId={serverId}
      />

      {editingChannel && (
        <EditChannelModal
          open={true}
          onClose={() => setEditingChannel(null)}
          serverId={serverId}
          channel={editingChannel}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        >
          <ContextMenuItem
            label="Edit Channel"
            onClick={() => {
              setEditingChannel(contextMenu.channel);
              setContextMenu(null);
            }}
          />
          <ContextMenuItem
            label="Delete Channel"
            danger
            onClick={() => {
              deleteChannel(serverId, contextMenu.channel.id);
              setContextMenu(null);
            }}
          />
        </ContextMenu>
      )}
    </div>
  );
}
