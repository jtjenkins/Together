import { useEffect, useRef, type ReactNode } from 'react';
import styles from './ContextMenu.module.css';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={styles.menu}
      style={{ left: x, top: y }}
      role="menu"
    >
      {children}
    </div>
  );
}

interface ContextMenuItemProps {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

export function ContextMenuItem({ label, onClick, danger }: ContextMenuItemProps) {
  return (
    <button
      className={`${styles.item} ${danger ? styles.danger : ''}`}
      onClick={onClick}
      role="menuitem"
    >
      {label}
    </button>
  );
}
