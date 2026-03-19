import { useRef, useState } from "react";
import { useAuthStore } from "../../stores/authStore";
import { Mail } from "lucide-react";
import { useServerStore } from "../../stores/serverStore";
import { useDmStore } from "../../stores/dmStore";
import type { MemberDto, UserStatus } from "../../types";
import { UserProfileCard } from "../users/UserProfileCard";
import styles from "./MemberSidebar.module.css";

function StatusIndicator({ status }: { status: UserStatus }) {
  return <span className={`${styles.status} ${styles[status]}`} />;
}

function MemberItem({ member }: { member: MemberDto }) {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const openOrCreateDm = useDmStore((s) => s.openOrCreateDm);
  const setActiveDmChannel = useDmStore((s) => s.setActiveDmChannel);
  const setActiveServer = useServerStore((s) => s.setActiveServer);

  const [showProfile, setShowProfile] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  const handleMessage = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const channel = await openOrCreateDm(member.user_id);
    setActiveDmChannel(channel.id);
    setActiveServer(null);
  };

  const handleRowClick = () => {
    setShowProfile((prev) => !prev);
  };

  return (
    <>
      <div
        ref={rowRef}
        className={`${styles.member} ${member.status === "offline" ? styles.offline : ""}`}
        onClick={handleRowClick}
        style={{ cursor: "pointer" }}
        role="button"
        tabIndex={0}
        aria-label={`View profile of ${member.nickname || member.username}`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleRowClick();
        }}
      >
        <div className={styles.avatarWrapper}>
          {member.avatar_url ? (
            <img src={member.avatar_url} alt="" className={styles.avatar} />
          ) : (
            <div className={styles.avatarFallback}>
              {member.username.charAt(0).toUpperCase()}
            </div>
          )}
          <StatusIndicator status={member.status} />
        </div>
        <div className={styles.info}>
          <span className={styles.username}>
            {member.nickname || member.username}
          </span>
          {member.activity && (
            <span className={styles.activity}>{member.activity}</span>
          )}
        </div>
        {currentUserId !== member.user_id && (
          <button
            className={styles.dmBtn}
            onClick={handleMessage}
            title={`Message ${member.nickname || member.username}`}
            aria-label={`Message ${member.nickname || member.username}`}
          >
            <Mail size={14} />
          </button>
        )}
      </div>

      {showProfile && (
        <UserProfileCard
          userId={member.user_id}
          anchorRef={rowRef}
          onClose={() => setShowProfile(false)}
        />
      )}
    </>
  );
}

export function MemberSidebar() {
  const members = useServerStore((s) => s.members);

  const onlineMembers = members.filter((m) => m.status !== "offline");
  const offlineMembers = members.filter((m) => m.status === "offline");

  return (
    <div className={styles.sidebar}>
      {onlineMembers.length > 0 && (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>
            Online &mdash; {onlineMembers.length}
          </h3>
          {onlineMembers.map((m) => (
            <MemberItem key={m.user_id} member={m} />
          ))}
        </div>
      )}
      {offlineMembers.length > 0 && (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>
            Offline &mdash; {offlineMembers.length}
          </h3>
          {offlineMembers.map((m) => (
            <MemberItem key={m.user_id} member={m} />
          ))}
        </div>
      )}
      {members.length === 0 && <div className={styles.empty}>No members</div>}
    </div>
  );
}
