/**
 * useMobileLayout hook tests.
 *
 * Tests responsive breakpoint detection and resize handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMobileLayout } from "../hooks/useMobileLayout";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useMobileLayout", () => {
  it("returns true when window width is below 768", () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      value: 375,
    });
    const { result } = renderHook(() => useMobileLayout());
    expect(result.current).toBe(true);
  });

  it("returns false when window width is 768 or above", () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      value: 1024,
    });
    const { result } = renderHook(() => useMobileLayout());
    expect(result.current).toBe(false);
  });

  it("updates when window is resized below breakpoint", () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      value: 1024,
    });
    const { result } = renderHook(() => useMobileLayout());
    expect(result.current).toBe(false);

    // Resize to mobile
    act(() => {
      Object.defineProperty(window, "innerWidth", {
        writable: true,
        value: 500,
      });
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(150);
    });

    expect(result.current).toBe(true);
  });

  it("updates when window is resized above breakpoint", () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      value: 375,
    });
    const { result } = renderHook(() => useMobileLayout());
    expect(result.current).toBe(true);

    // Resize to desktop
    act(() => {
      Object.defineProperty(window, "innerWidth", {
        writable: true,
        value: 1024,
      });
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(150);
    });

    expect(result.current).toBe(false);
  });

  it("debounces rapid resize events", () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      value: 1024,
    });
    const { result } = renderHook(() => useMobileLayout());

    // Fire multiple resize events rapidly
    act(() => {
      Object.defineProperty(window, "innerWidth", {
        writable: true,
        value: 500,
      });
      window.dispatchEvent(new Event("resize"));
    });

    // Not yet updated (debounced)
    // Advance just a tiny bit — not enough for debounce
    act(() => {
      vi.advanceTimersByTime(50);
    });

    // Change back to desktop before debounce fires
    act(() => {
      Object.defineProperty(window, "innerWidth", {
        writable: true,
        value: 1024,
      });
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(150);
    });

    // Should end up at desktop since that was the last resize
    expect(result.current).toBe(false);
  });
});
