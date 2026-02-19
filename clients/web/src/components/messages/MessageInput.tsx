import { useState, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { useMessageStore } from '../../stores/messageStore';
import { useChannelStore } from '../../stores/channelStore';
import styles from './MessageInput.module.css';

interface MessageInputProps {
  channelId: string;
}

export function MessageInput({ channelId }: MessageInputProps) {
  const [content, setContent] = useState('');
  const sendMessage = useMessageStore((s) => s.sendMessage);
  const replyingTo = useMessageStore((s) => s.replyingTo);
  const setReplyingTo = useMessageStore((s) => s.setReplyingTo);
  const channels = useChannelStore((s) => s.channels);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const channel = channels.find((c) => c.id === channelId);

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) return;

    try {
      await sendMessage(channelId, {
        content: trimmed,
        reply_to: replyingTo?.id,
      });
      setContent('');
      inputRef.current?.focus();
    } catch {
      // Error shown via store
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape' && replyingTo) {
      setReplyingTo(null);
    }
  };

  return (
    <div className={styles.container}>
      {replyingTo && (
        <div className={styles.replyBar}>
          <span className={styles.replyText}>
            Replying to <strong>{replyingTo.author_id ? 'message' : 'someone'}</strong>
          </span>
          <button
            className={styles.replyClose}
            onClick={() => setReplyingTo(null)}
            aria-label="Cancel reply"
          >
            &times;
          </button>
        </div>
      )}
      <form className={styles.form} onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className={styles.input}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Message #${channel?.name ?? 'channel'}`}
          rows={1}
          maxLength={4000}
          aria-label="Message input"
        />
      </form>
    </div>
  );
}
