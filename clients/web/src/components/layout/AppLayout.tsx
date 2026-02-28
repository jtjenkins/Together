import { useEffect, useState } from "react";
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
import { useMobileLayout } from "../../hooks/useMobileLayout";
import { ErrorBoundary } from "../ErrorBoundary";
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
  const [showBrowse, setShowBrowse] = useState(false);

  const isMobile = useMobileLayout();
  const [mobilePanel, setMobilePanel] = useState<
    "servers" | "channels" | "chat"
  >("servers");

  useWebSocket();

  useEffect(() => {
    fetchServers().then(() => {
      const { servers, error } = useServerStore.getState();
      // Only auto-open browse when fetch succeeded AND the user has no servers yet.
      if (!error && servers.length === 0) {
        setShowBrowse(true);
      }
    });
  }, [fetchServers]);

  // Auto-advance mobile panels when store state changes
  useEffect(() => {
    if (isMobile && activeServerId) setMobilePanel("channels");
  }, [activeServerId, isMobile]);

  useEffect(() => {
    if (isMobile && activeChannelId) setMobilePanel("chat");
  }, [activeChannelId, isMobile]);

  useEffect(() => {
    if (isMobile && activeDmChannelId) setMobilePanel("chat");
  }, [activeDmChannelId, isMobile]);

  const activeChannel = channels.find((c) => c.id === activeChannelId);

  // Show DM view when no server is selected (home screen).
  const showDmView = !activeServerId;

  return (
    <div className={styles.layout}>
      <div
        className={`${styles.serverPanel} ${isMobile && mobilePanel !== "servers" ? styles.mobileHidden : ""}`}
      >
        <ServerSidebar showBrowse={showBrowse} onShowBrowse={setShowBrowse} />
      </div>

      <div
        className={`${styles.channelPanel} ${isMobile && mobilePanel !== "channels" ? styles.mobileHidden : ""}`}
      >
        {showDmView ? (
          <DMSidebar
            onBack={isMobile ? () => setMobilePanel("servers") : undefined}
          />
        ) : (
          <ChannelSidebar
            serverId={activeServerId!}
            onBack={isMobile ? () => setMobilePanel("servers") : undefined}
          />
        )}
      </div>

      <div
        className={`${styles.contentPanel} ${isMobile && mobilePanel !== "chat" ? styles.mobileHidden : ""}`}
      >
        <ErrorBoundary>
          {showDmView ? (
            activeDmChannelId ? (
              <DMConversation channelId={activeDmChannelId} />
            ) : (
              <div className={styles.placeholder}>
                <div className={styles.placeholderContent}>
                  <div className={styles.welcomeIcon}>T</div>
                  <h2>Welcome to Together</h2>
                  <p>
                    Select a server from the sidebar or open a Direct Message
                  </p>
                </div>
              </div>
            )
          ) : activeChannelId ? (
            activeChannel?.type === "voice" ? (
              <VoiceChannel
                channelId={activeChannelId}
                onBack={isMobile ? () => setMobilePanel("channels") : undefined}
              />
            ) : (
              <ChatArea
                channelId={activeChannelId}
                onOpenThread={openThread}
                onBack={isMobile ? () => setMobilePanel("channels") : undefined}
              />
            )
          ) : (
            <div className={styles.placeholder}>
              <div className={styles.placeholderContent}>
                <h2>Select a channel</h2>
                <p>Pick a text channel from the sidebar to start chatting</p>
              </div>
            </div>
          )}
          {!isMobile &&
            (activeChannelId && activeThreadId ? (
              <ThreadPanel
                channelId={activeChannelId}
                rootMessageId={activeThreadId}
                onClose={closeThread}
              />
            ) : (
              <MemberSidebar />
            ))}
        </ErrorBoundary>
      </div>
    </div>
  );
}
