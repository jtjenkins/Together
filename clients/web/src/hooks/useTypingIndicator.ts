import { useCallback, useRef } from "react";
import { gateway } from "../api/websocket";

/**
 * Hook to send typing indicators when the user is typing.
 *
 * Usage:
 * ```tsx
 * const { onTyping } = useTypingIndicator(channelId);
 * <input onChange={(e) => { onTyping(); ... }} />
 * ```
 */
export function useTypingIndicator(channelId: string | null) {
  const lastSentRef = useRef<number>(0);
  const TYPING_DEBOUNCE_MS = 3000; // Send at most every 3 seconds

  const onTyping = useCallback(() => {
    if (!channelId) return;

    const now = Date.now();
    if (now - lastSentRef.current < TYPING_DEBOUNCE_MS) {
      return;
    }

    lastSentRef.current = now;
    gateway.sendTypingStart(channelId);
  }, [channelId]);

  return { onTyping };
}
