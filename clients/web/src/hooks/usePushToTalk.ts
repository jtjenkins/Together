import { useEffect, useRef } from "react";

interface UsePushToTalkOptions {
  /** Attach listeners only when true (PTT mode active and in a voice channel). */
  enabled: boolean;
  /** KeyboardEvent.code for the PTT key, e.g. "Space", "KeyV". */
  pttKey: string;
  /** Called when the PTT key is first pressed. */
  onPress: () => void;
  /** Called when the PTT key is released or the window loses focus. */
  onRelease: () => void;
}

/**
 * Browser-scoped push-to-talk: listens for keydown/keyup on the window.
 * Events only fire when the tab has focus, so PTT is naturally scoped to
 * the browser window — no OS-level hooks required.
 *
 * Auto-releases when the window loses focus to prevent the mic from staying
 * open after Alt-Tab or switching apps.
 */
export function usePushToTalk({
  enabled,
  pttKey,
  onPress,
  onRelease,
}: UsePushToTalkOptions): void {
  // Track whether the key is currently held to suppress key-repeat events.
  const activeRef = useRef(false);

  // Use refs so the effect doesn't need to re-subscribe when callbacks change.
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const onReleaseRef = useRef(onRelease);
  onReleaseRef.current = onRelease;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== pttKey) return;
      // Prevent page scroll when Space is used as PTT key.
      if (e.code === "Space") e.preventDefault();
      // Ignore key-repeat events (browser fires keydown repeatedly while held).
      if (activeRef.current) return;
      activeRef.current = true;
      onPressRef.current();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code !== pttKey) return;
      if (!activeRef.current) return;
      activeRef.current = false;
      onReleaseRef.current();
    };

    // Release when the page loses focus (e.g. Alt-Tab) so the mic doesn't
    // stay open indefinitely after the user switches away.
    const handleBlur = () => {
      if (activeRef.current) {
        activeRef.current = false;
        onReleaseRef.current();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      // Ensure release fires if PTT was held when the hook is disabled.
      if (activeRef.current) {
        activeRef.current = false;
        onReleaseRef.current();
      }
    };
  }, [enabled, pttKey]);
}
