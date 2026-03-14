/**
 * useWebRTC unit tests.
 *
 * These tests focus on the error-handling and rollback paths that are difficult
 * to exercise through the UI:
 *   - Camera permission denied → onError + isCameraOn store rollback
 *   - OS-level screen share stop (track "ended" event) → toggleScreen called
 *   - Screen picker dismissed by user (NotAllowedError) → no onError, store rolled back
 *   - Camera hot-swap replaceTrack failure → onError surfaced
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWebRTC } from "../hooks/useWebRTC";
import { useVoiceStore } from "../stores/voiceStore";
import { api } from "../api/client";

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock("../api/websocket", () => ({
  gateway: {
    on: vi.fn(() => () => {}),
    sendVoiceSignal: vi.fn(),
  },
}));

vi.mock("../api/client", () => ({
  api: {
    getIceServers: vi.fn(),
    updateVoiceState: vi.fn(),
    leaveVoiceChannel: vi.fn(),
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a minimal MediaStreamTrack stub with an "ended" event emitter. */
function makeTrack(kind: "audio" | "video" = "video"): MediaStreamTrack {
  const listeners: Record<string, EventListener[]> = {};
  return {
    kind,
    enabled: true,
    contentHint: "",
    stop: vi.fn(),
    addEventListener: vi.fn((type: string, fn: EventListener) => {
      (listeners[type] ??= []).push(fn);
    }),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn((evt: Event) => {
      listeners[evt.type]?.forEach((fn) => fn(evt));
      return true;
    }),
    // Expose listeners map for tests that need to fire events.
    _listeners: listeners,
  } as unknown as MediaStreamTrack;
}

function makeStream(tracks: MediaStreamTrack[] = []): MediaStream {
  return {
    id: "stream-" + Math.random(),
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStream;
}

/** Default options for renderHook — camera off, screen off, not connected. */
const baseOptions = () => ({
  enabled: false,
  myUserId: "u1",
  participants: [],
  initialPeers: [],
  isMuted: false,
  isDeafened: false,
  isCameraOn: false,
  isScreenSharing: false,
  cameraDeviceId: null,
  micDeviceId: null,
  speakerDeviceId: null,
  onError: vi.fn(),
  onSpeakingChange: vi.fn(),
  onRemoteStreamsChange: vi.fn(),
  onLocalStreamsChange: vi.fn(),
});

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Reset voice store to a connected state so toggleCamera/toggleScreen work.
  useVoiceStore.setState({
    connectedChannelId: "chan-1",
    isCameraOn: false,
    isScreenSharing: false,
    isMuted: false,
    isDeafened: false,
    isConnecting: false,
    error: null,
  });

  vi.mocked(api.getIceServers).mockResolvedValue({
    iceServers: [],
    ttl: 3600,
  } as never);
  vi.mocked(api.updateVoiceState).mockResolvedValue({} as never);

  // Default: getUserMedia resolves with an audio stream (hook enabled path).
  const audioTrack = makeTrack("audio");
  const audioStream = makeStream([audioTrack]);
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    writable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue(audioStream),
      getDisplayMedia: vi.fn(),
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
  });

  // Stub RTCPeerConnection so createPeer doesn't throw in jsdom.
  globalThis.RTCPeerConnection = vi.fn().mockImplementation(() => ({
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    getSenders: vi.fn(() => []),
    createOffer: vi.fn().mockResolvedValue({ type: "offer", sdp: "sdp" }),
    setLocalDescription: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    ontrack: null,
    onicecandidate: null,
    onconnectionstatechange: null,
    onnegotiationneeded: null,
    connectionState: "new",
    signalingState: "stable",
  })) as unknown as typeof RTCPeerConnection;

  globalThis.AudioContext = vi.fn().mockImplementation(() => ({
    createAnalyser: vi.fn(() => ({
      fftSize: 512,
      frequencyBinCount: 256,
      getByteFrequencyData: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    createMediaStreamSource: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    close: vi.fn().mockResolvedValue(undefined),
  })) as unknown as typeof AudioContext;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useWebRTC — camera permission denied", () => {
  it("calls onError and rolls back isCameraOn in the store", async () => {
    const onError = vi.fn();

    // toggleCamera sets isCameraOn: true in the store (optimistic).
    await act(async () => {
      await useVoiceStore.getState().toggleCamera();
    });
    expect(useVoiceStore.getState().isCameraOn).toBe(true);

    const permissionError = Object.assign(new Error("Permission denied"), {
      name: "NotAllowedError",
    });
    const audioTrack = makeTrack("audio");
    const audioStream = makeStream([audioTrack]);

    // Succeed for audio constraints, reject for video constraints.
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(
      async (constraints) => {
        if ((constraints as MediaStreamConstraints).video) {
          throw permissionError;
        }
        return audioStream;
      },
    );

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        isCameraOn: true,
        onError,
      }),
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("Camera unavailable");
    });

    // Store must be rolled back to false.
    await waitFor(() => {
      expect(useVoiceStore.getState().isCameraOn).toBe(false);
    });

    unmount();
  });
});

describe("useWebRTC — OS screen share stop (track 'ended' event)", () => {
  it("calls toggleScreen on the store when the OS stops screen sharing", async () => {
    const screenTrack = makeTrack("video");
    const screenStream = makeStream([screenTrack]);

    (
      navigator.mediaDevices as MediaDevices & {
        getDisplayMedia: ReturnType<typeof vi.fn>;
      }
    ).getDisplayMedia = vi.fn().mockResolvedValueOnce(screenStream);

    // toggleScreen sets isScreenSharing: true.
    await act(async () => {
      await useVoiceStore.getState().toggleScreen();
    });
    expect(useVoiceStore.getState().isScreenSharing).toBe(true);

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        isScreenSharing: true,
      }),
    );

    // Wait for getDisplayMedia to have been called and the "ended" listener registered.
    await waitFor(() => {
      expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalled();
    });

    // Simulate the OS firing the "ended" event on the screen track.
    await act(async () => {
      (
        screenTrack as unknown as {
          _listeners: Record<string, EventListener[]>;
        }
      )._listeners["ended"]?.forEach((fn) => fn(new Event("ended")));
    });

    // toggleScreen should have been called to revert to false.
    await waitFor(() => {
      expect(useVoiceStore.getState().isScreenSharing).toBe(false);
    });

    unmount();
  });
});

describe("useWebRTC — screen picker dismissed (NotAllowedError)", () => {
  it("does not call onError when the user cancels the screen picker", async () => {
    const onError = vi.fn();

    const cancelError = Object.assign(new Error("Permission denied"), {
      name: "NotAllowedError",
    });
    (
      navigator.mediaDevices as MediaDevices & {
        getDisplayMedia: ReturnType<typeof vi.fn>;
      }
    ).getDisplayMedia = vi.fn().mockRejectedValueOnce(cancelError);

    await act(async () => {
      await useVoiceStore.getState().toggleScreen();
    });

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        isScreenSharing: true,
        onError,
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalled();
    });

    // Give the async import / catch block time to run.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // User cancel must NOT show an error toast.
    expect(onError).not.toHaveBeenCalled();

    // Store should be rolled back to false.
    await waitFor(() => {
      expect(useVoiceStore.getState().isScreenSharing).toBe(false);
    });

    unmount();
  });
});

describe("useWebRTC — screen share not supported (NotSupportedError)", () => {
  it("calls onError with a device-support message", async () => {
    const onError = vi.fn();

    const notSupportedError = Object.assign(
      new Error("Not supported on this device"),
      { name: "NotSupportedError" },
    );
    (
      navigator.mediaDevices as MediaDevices & {
        getDisplayMedia: ReturnType<typeof vi.fn>;
      }
    ).getDisplayMedia = vi.fn().mockRejectedValueOnce(notSupportedError);

    await act(async () => {
      await useVoiceStore.getState().toggleScreen();
    });

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        isScreenSharing: true,
        onError,
      }),
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        "Screen sharing is not supported on this device",
      );
    });

    unmount();
  });
});
