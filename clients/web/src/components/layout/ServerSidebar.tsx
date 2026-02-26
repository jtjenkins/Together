import { useState } from "react";
import { Compass, Plus } from "lucide-react";
import { useServerStore } from "../../stores/serverStore";
import { useChannelStore } from "../../stores/channelStore";
import { useAuthStore } from "../../stores/authStore";
import { CreateServerModal } from "../servers/CreateServerModal";
import { BrowseServersModal } from "../servers/BrowseServersModal";
import { ServerSettingsModal } from "../servers/ServerSettingsModal";
import { ContextMenu, ContextMenuItem } from "../common/ContextMenu";
import { UserPanel } from "../users/UserPanel";
import type { ServerDto } from "../../types";
import styles from "./ServerSidebar.module.css";

interface ServerSidebarProps {
  showBrowse: boolean;
  onShowBrowse: (show: boolean) => void;
}

export function ServerSidebar({
  showBrowse,
  onShowBrowse,
}: ServerSidebarProps) {
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const deleteServer = useServerStore((s) => s.deleteServer);
  const leaveServer = useServerStore((s) => s.leaveServer);
  const clearChannels = useChannelStore((s) => s.clearChannels);
  const user = useAuthStore((s) => s.user);
  const [showCreate, setShowCreate] = useState(false);
  const [editingServer, setEditingServer] = useState<ServerDto | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    server: ServerDto;
  } | null>(null);

  const handleSelectServer = (id: string) => {
    if (id !== activeServerId) {
      clearChannels();
      setActiveServer(id);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, server: ServerDto) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, server });
  };

  const isOwner = (server: ServerDto) => server.owner_id === user?.id;

  return (
    <div className={styles.sidebar}>
      <div className={styles.serverList}>
        <button
          className={`${styles.serverIcon} ${styles.homeIcon} ${!activeServerId ? styles.active : ""}`}
          onClick={() => {
            clearChannels();
            setActiveServer(null);
          }}
          title="Home"
        >
          T
        </button>

        <div className={styles.separator} />

        {servers.map((server) => (
          <button
            key={server.id}
            className={`${styles.serverIcon} ${server.id === activeServerId ? styles.active : ""}`}
            onClick={() => handleSelectServer(server.id)}
            onContextMenu={(e) => handleContextMenu(e, server)}
            title={server.name}
          >
            {server.icon_url ? (
              <img
                src={server.icon_url}
                alt={server.name}
                className={styles.icon}
              />
            ) : (
              <span>{server.name.charAt(0).toUpperCase()}</span>
            )}
          </button>
        ))}

        <button
          className={`${styles.serverIcon} ${styles.browseIcon}`}
          onClick={() => onShowBrowse(true)}
          title="Browse Servers"
        >
          <Compass size={20} />
        </button>

        <button
          className={`${styles.serverIcon} ${styles.addIcon}`}
          onClick={() => setShowCreate(true)}
          title="Create Server"
        >
          <Plus size={20} />
        </button>
      </div>

      <UserPanel />

      <CreateServerModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
      />

      <BrowseServersModal
        open={showBrowse}
        onClose={() => onShowBrowse(false)}
      />

      {editingServer && (
        <ServerSettingsModal
          open={true}
          onClose={() => setEditingServer(null)}
          server={editingServer}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        >
          <ContextMenuItem
            label="Server Settings"
            onClick={() => {
              setEditingServer(contextMenu.server);
              setContextMenu(null);
            }}
          />
          {isOwner(contextMenu.server) ? (
            <ContextMenuItem
              label="Delete Server"
              danger
              onClick={() => {
                deleteServer(contextMenu.server.id);
                setContextMenu(null);
              }}
            />
          ) : (
            <ContextMenuItem
              label="Leave Server"
              danger
              onClick={() => {
                leaveServer(contextMenu.server.id);
                setContextMenu(null);
              }}
            />
          )}
        </ContextMenu>
      )}
    </div>
  );
}
