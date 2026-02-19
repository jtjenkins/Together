import { useServerStore } from '../../stores/serverStore';
import type { MemberDto, UserStatus } from '../../types';
import styles from './MemberSidebar.module.css';

function StatusIndicator({ status }: { status: UserStatus }) {
  return <span className={`${styles.status} ${styles[status]}`} />;
}

function MemberItem({ member }: { member: MemberDto }) {
  return (
    <div className={`${styles.member} ${member.status === 'offline' ? styles.offline : ''}`}>
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
      </div>
    </div>
  );
}

export function MemberSidebar() {
  const members = useServerStore((s) => s.members);

  const onlineMembers = members.filter((m) => m.status !== 'offline');
  const offlineMembers = members.filter((m) => m.status === 'offline');

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
      {members.length === 0 && (
        <div className={styles.empty}>No members</div>
      )}
    </div>
  );
}
