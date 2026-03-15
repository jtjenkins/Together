import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePushToTalk } from "../hooks/usePushToTalk";

function fireKeyDown(code: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
}

function fireKeyUp(code: string) {
  window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
}

describe("usePushToTalk", () => {
  let onPress: ReturnType<typeof vi.fn>;
  let onRelease: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onPress = vi.fn();
    onRelease = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls onPress when the PTT key is pressed", () => {
    renderHook(() =>
      usePushToTalk({ enabled: true, pttKey: "Space", onPress, onRelease }),
    );

    fireKeyDown("Space");
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("calls onRelease when the PTT key is released", () => {
    renderHook(() =>
      usePushToTalk({ enabled: true, pttKey: "Space", onPress, onRelease }),
    );

    fireKeyDown("Space");
    fireKeyUp("Space");
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("does not call onPress for a different key", () => {
    renderHook(() =>
      usePushToTalk({ enabled: true, pttKey: "KeyV", onPress, onRelease }),
    );

    fireKeyDown("Space");
    expect(onPress).not.toHaveBeenCalled();
  });

  it("suppresses key-repeat (only calls onPress once while held)", () => {
    renderHook(() =>
      usePushToTalk({ enabled: true, pttKey: "Space", onPress, onRelease }),
    );

    // Browser fires repeated keydown events while a key is held
    fireKeyDown("Space");
    fireKeyDown("Space");
    fireKeyDown("Space");
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not call onPress or onRelease when disabled", () => {
    renderHook(() =>
      usePushToTalk({ enabled: false, pttKey: "Space", onPress, onRelease }),
    );

    fireKeyDown("Space");
    fireKeyUp("Space");
    expect(onPress).not.toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("calls onRelease when the window loses focus while key is held", () => {
    renderHook(() =>
      usePushToTalk({ enabled: true, pttKey: "Space", onPress, onRelease }),
    );

    fireKeyDown("Space");
    window.dispatchEvent(new Event("blur"));
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("does not call onRelease on blur if key was not held", () => {
    renderHook(() =>
      usePushToTalk({ enabled: true, pttKey: "Space", onPress, onRelease }),
    );

    window.dispatchEvent(new Event("blur"));
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("calls onRelease on unmount if key is held", () => {
    const { unmount } = renderHook(() =>
      usePushToTalk({ enabled: true, pttKey: "Space", onPress, onRelease }),
    );

    fireKeyDown("Space");
    unmount();
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("works with non-Space keys", () => {
    renderHook(() =>
      usePushToTalk({ enabled: true, pttKey: "KeyV", onPress, onRelease }),
    );

    fireKeyDown("KeyV");
    expect(onPress).toHaveBeenCalledTimes(1);
    fireKeyUp("KeyV");
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("removes listeners when disabled changes to false", () => {
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        usePushToTalk({ enabled, pttKey: "Space", onPress, onRelease }),
      { initialProps: { enabled: true } },
    );

    fireKeyDown("Space");
    expect(onPress).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    onPress.mockClear();

    fireKeyDown("Space");
    expect(onPress).not.toHaveBeenCalled();
  });
});
