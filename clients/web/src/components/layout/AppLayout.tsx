import { useEffect } from "react";
import { ServerSidebar } from "./ServerSidebar";
import { ChannelSidebar } from "./ChannelSidebar";
import { DMSidebar } from "../dm/DMSidebar";
import { DMConversation } from "../dm/DMConversation";
import { ChatArea } from "../messages/ChatArea";
import { ThreadPanel } from "../messages/ThreadPanel";
import { VoiceChannel } from "../voice/VoiceChannel";
import { MemberSidebar } from "./MemberSidebar";
import { useServerStore } from "../../stores/serverStore";
import { useChannelStore } from "../../stores/channelStore";
import { useDmStore } from "../../stores/dmStore";
import { useMessageStore } from "../../stores/messageStore";
import { useWebSocket } from "../../hooks/useWebSocket";
import styles from "./AppLayout.module.css";

export function AppLayout() {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const activeChannelId = useChannelStore((s) => s.activeChannelId);
  const channels = useChannelStore((s) => s.channels);
  const fetchServers = useServerStore((s) => s.fetchServers);
  const activeDmChannelId = useDmStore((s) => s.activeDmChannelId);
  const activeThreadId = useMessageStore((s) => s.activeThreadId);
  const openThread = useMessageStore((s) => s.openThread);
  const closeThread = useMessageStore((s) => s.closeThread);

  useWebSocket();

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const activeChannel = channels.find((c) => c.id === activeChannelId);

  // Show DM view when no server is selected (home screen).
  const showDmView = !activeServerId;

  return (
    <div className={styles.layout}>
      <ServerSidebar />
      {showDmView ? (
        <>
          <DMSidebar />
          {activeDmChannelId ? (
            <DMConversation channelId={activeDmChannelId} />
          ) : (
            <div className={styles.placeholder}>
              <div className={styles.placeholderContent}>
                <div className={styles.welcomeIcon}>T</div>
                <h2>Welcome to Together</h2>
                <p>Select a server from the sidebar or open a Direct Message</p>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <ChannelSidebar serverId={activeServerId!} />
          {activeChannelId ? (
            activeChannel?.type === "voice" ? (
              <VoiceChannel channelId={activeChannelId} />
            ) : (
              <ChatArea channelId={activeChannelId} onOpenThread={openThread} />
            )
          ) : (
            <div className={styles.placeholder}>
              <div className={styles.placeholderContent}>
                <h2>Select a channel</h2>
                <p>Pick a text channel from the sidebar to start chatting</p>
              </div>
            </div>
          )}
          {activeChannelId && activeThreadId ? (
            <ThreadPanel
              channelId={activeChannelId}
              rootMessageId={activeThreadId}
              onClose={closeThread}
            />
          ) : (
            <MemberSidebar />
          )}
        </>
      )}
    </div>
  );
}
