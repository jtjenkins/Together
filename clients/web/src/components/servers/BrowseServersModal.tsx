import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import { useServerStore } from "../../stores/serverStore";
import styles from "./ServerModals.module.css";
import { api } from "../../api/client";

interface BrowseServersModalProps {
  open: boolean;
  onClose: () => void;
}

export function BrowseServersModal({ open, onClose }: BrowseServersModalProps) {
  const discoverableServers = useServerStore((s) => s.discoverableServers);
  const isBrowseLoading = useServerStore((s) => s.isBrowseLoading);
  const browseError = useServerStore((s) => s.browseError);
  const fetchDiscoverableServers = useServerStore(
    (s) => s.fetchDiscoverableServers,
  );
  const servers = useServerStore((s) => s.servers);
  const joinServer = useServerStore((s) => s.joinServer);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Invite code
  const [inviteCode, setInviteCode] = useState("");
  const [inviteJoining, setInviteJoining] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const fetchServers = useServerStore((s) => s.fetchServers);

  useEffect(() => {
    if (open) {
      fetchDiscoverableServers();
    }
  }, [open, fetchDiscoverableServers]);

  const handleInviteJoin = async (e: FormEvent) => {
    e.preventDefault();
    const code = inviteCode.trim();
    if (!code) return;
    setInviteJoining(true);
    setInviteError(null);
    setInviteSuccess(null);
    try {
      await api.acceptInvite(code);
      await fetchServers();
      await fetchDiscoverableServers();
      setInviteSuccess("Joined server successfully!");
      setInviteCode("");
    } catch (err) {
      setInviteError(
        err instanceof Error ? err.message : "Failed to join via invite code",
      );
    } finally {
      setInviteJoining(false);
    }
  };

  const joinedIds = new Set(servers.map((s) => s.id));

  const handleJoin = async (id: string) => {
    setJoiningId(id);
    setJoinError(null);
    try {
      await joinServer(id);
      await fetchDiscoverableServers();
    } catch (err) {
      setJoinError(
        err instanceof Error ? err.message : "Failed to join server",
      );
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Browse Servers">
      {/* Invite code input */}
      <form
        onSubmit={handleInviteJoin}
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "16px",
          alignItems: "center",
        }}
      >
        <input
          className={styles.input}
          type="text"
          placeholder="Enter invite code"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          style={{ flex: 1 }}
        />
        <button
          type="submit"
          className={styles.joinBtn}
          disabled={!inviteCode.trim() || inviteJoining}
        >
          {inviteJoining ? "Joining..." : "Join"}
        </button>
      </form>
      {inviteError && <div className={styles.error}>{inviteError}</div>}
      {inviteSuccess && (
        <div
          style={{
            background: "rgba(67, 181, 129, 0.1)",
            border: "1px solid rgba(67, 181, 129, 0.3)",
            color: "#43b581",
            padding: "8px 12px",
            borderRadius: "var(--radius-md)",
            fontSize: "13px",
            marginBottom: "8px",
          }}
        >
          {inviteSuccess}
        </div>
      )}

      {browseError && <div className={styles.error}>{browseError}</div>}
      {joinError && <div className={styles.error}>{joinError}</div>}

      {isBrowseLoading ? (
        <div className={styles.browseEmpty}>Loading servers…</div>
      ) : discoverableServers.length === 0 ? (
        <div className={styles.browseEmpty}>
          No public servers available yet.
        </div>
      ) : (
        <div className={styles.browseList}>
          {discoverableServers.map((server) => {
            const isJoined = joinedIds.has(server.id);
            return (
              <div key={server.id} className={styles.serverCard}>
                <div className={styles.cardAvatar}>
                  {server.icon_url ? (
                    <img
                      src={server.icon_url}
                      alt={server.name}
                      className={styles.cardAvatarImg}
                    />
                  ) : (
                    <span>{server.name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className={styles.cardInfo}>
                  <div className={styles.cardName}>{server.name}</div>
                  <div className={styles.cardMeta}>
                    {server.member_count}{" "}
                    {server.member_count === 1 ? "member" : "members"}
                  </div>
                </div>
                {isJoined ? (
                  <span className={styles.joinedBadge}>Joined</span>
                ) : server.require_invite ? (
                  <span
                    className={styles.joinedBadge}
                    title="This server requires an invite to join"
                  >
                    Invite Required
                  </span>
                ) : (
                  <button
                    className={styles.joinBtn}
                    disabled={joiningId === server.id}
                    onClick={() => handleJoin(server.id)}
                  >
                    {joiningId === server.id ? "Joining…" : "Join"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className={styles.actions} style={{ marginTop: "16px" }}>
        <button className={styles.cancelBtn} onClick={onClose}>
          Skip for now
        </button>
      </div>
    </Modal>
  );
}
