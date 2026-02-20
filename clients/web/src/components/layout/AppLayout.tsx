import { useEffect } from "react";
import { ServerSidebar } from "./ServerSidebar";
import { ChannelSidebar } from "./ChannelSidebar";
import { ChatArea } from "../messages/ChatArea";
import { VoiceChannel } from "../voice/VoiceChannel";
import { MemberSidebar } from "./MemberSidebar";
import { useServerStore } from "../../stores/serverStore";
import { useChannelStore } from "../../stores/channelStore";
import { useWebSocket } from "../../hooks/useWebSocket";
import styles from "./AppLayout.module.css";

export function AppLayout() {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const activeChannelId = useChannelStore((s) => s.activeChannelId);
  const channels = useChannelStore((s) => s.channels);
  const fetchServers = useServerStore((s) => s.fetchServers);

  useWebSocket();

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const activeChannel = channels.find((c) => c.id === activeChannelId);

  return (
    <div className={styles.layout}>
      <ServerSidebar />
      {activeServerId ? (
        <>
          <ChannelSidebar serverId={activeServerId} />
          {activeChannelId ? (
            activeChannel?.type === "voice" ? (
              <VoiceChannel channelId={activeChannelId} />
            ) : (
              <ChatArea channelId={activeChannelId} />
            )
          ) : (
            <div className={styles.placeholder}>
              <div className={styles.placeholderContent}>
                <h2>Select a channel</h2>
                <p>Pick a text channel from the sidebar to start chatting</p>
              </div>
            </div>
          )}
          <MemberSidebar />
        </>
      ) : (
        <div className={styles.placeholder}>
          <div className={styles.placeholderContent}>
            <div className={styles.welcomeIcon}>T</div>
            <h2>Welcome to Together</h2>
            <p>
              Select a server from the sidebar or create a new one to get
              started
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
