import { useState, type FormEvent } from 'react';
import { Modal } from '../common/Modal';
import { useAuthStore } from '../../stores/authStore';
import type { UserStatus } from '../../types';
import styles from '../servers/ServerModals.module.css';

interface UserSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const STATUS_OPTIONS: { value: UserStatus; label: string; color: string }[] = [
  { value: 'online', label: 'Online', color: 'var(--status-online)' },
  { value: 'away', label: 'Away', color: 'var(--status-away)' },
  { value: 'dnd', label: 'Do Not Disturb', color: 'var(--status-dnd)' },
  { value: 'offline', label: 'Invisible', color: 'var(--status-offline)' },
];

export function UserSettingsModal({ open, onClose }: UserSettingsModalProps) {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const updatePresence = useAuthStore((s) => s.updatePresence);

  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || '');
  const [status, setStatus] = useState<UserStatus>(user?.status || 'online');
  const [customStatus, setCustomStatus] = useState(user?.custom_status || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!user) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      await updateProfile({
        avatar_url: avatarUrl.trim() || null,
        custom_status: customStatus.trim() || null,
      });
      if (status !== user.status) {
        updatePresence(status, customStatus.trim() || null);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="User Settings">
      {error && <div className={styles.error}>{error}</div>}
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label}>Username</label>
          <input
            className={styles.input}
            type="text"
            value={user.username}
            disabled
            style={{ opacity: 0.6 }}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="settings-avatar">
            Avatar URL <span className={styles.optional}>(optional)</span>
          </label>
          <input
            id="settings-avatar"
            className={styles.input}
            type="url"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://example.com/avatar.png"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="settings-status">
            Status
          </label>
          <select
            id="settings-status"
            className={styles.select}
            value={status}
            onChange={(e) => setStatus(e.target.value as UserStatus)}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="settings-custom-status">
            Custom Status <span className={styles.optional}>(optional)</span>
          </label>
          <input
            id="settings-custom-status"
            className={styles.input}
            type="text"
            value={customStatus}
            onChange={(e) => setCustomStatus(e.target.value)}
            placeholder="What are you up to?"
          />
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles.submitBtn} disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
