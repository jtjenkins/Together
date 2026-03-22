/**
 * useTypingIndicator hook tests.
 *
 * Tests debouncing behavior and channel-null guard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../api/websocket", () => ({
  gateway: {
    sendTypingStart: vi.fn(),
  },
}));

import { useTypingIndicator } from "../hooks/useTypingIndicator";
import { gateway } from "../api/websocket";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTypingIndicator", () => {
  it("sends typing indicator on first call", () => {
    const { result } = renderHook(() => useTypingIndicator("ch-1"));

    act(() => {
      result.current.onTyping();
    });

    expect(gateway.sendTypingStart).toHaveBeenCalledWith("ch-1");
  });

  it("debounces rapid calls within 3 seconds", () => {
    const { result } = renderHook(() => useTypingIndicator("ch-1"));

    act(() => {
      result.current.onTyping();
    });

    expect(gateway.sendTypingStart).toHaveBeenCalledTimes(1);

    // Call again immediately
    act(() => {
      result.current.onTyping();
    });

    expect(gateway.sendTypingStart).toHaveBeenCalledTimes(1);

    // Advance past debounce window
    act(() => {
      vi.advanceTimersByTime(3001);
    });

    act(() => {
      result.current.onTyping();
    });

    expect(gateway.sendTypingStart).toHaveBeenCalledTimes(2);
  });

  it("does not send when channelId is null", () => {
    const { result } = renderHook(() => useTypingIndicator(null));

    act(() => {
      result.current.onTyping();
    });

    expect(gateway.sendTypingStart).not.toHaveBeenCalled();
  });

  it("updates channelId when it changes", () => {
    const { result, rerender } = renderHook(
      ({ channelId }: { channelId: string | null }) =>
        useTypingIndicator(channelId),
      { initialProps: { channelId: "ch-1" } },
    );

    act(() => {
      result.current.onTyping();
    });
    expect(gateway.sendTypingStart).toHaveBeenCalledWith("ch-1");

    // Change channel
    rerender({ channelId: "ch-2" });

    // Advance past debounce
    act(() => {
      vi.advanceTimersByTime(3001);
    });

    act(() => {
      result.current.onTyping();
    });

    expect(gateway.sendTypingStart).toHaveBeenCalledWith("ch-2");
  });
});
