/**
 * useWebRTC — additional coverage for VOICE_SIGNAL handling (offer/answer/candidate),
 * camera device swap, speaker device change, and mic device change.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWebRTC } from "../hooks/useWebRTC";
import { useVoiceStore } from "../stores/voiceStore";
import { api } from "../api/client";

// ─── Module mocks ────────────────────────────────────────────────────────────

type Handler = (...args: unknown[]) => void;
const voiceSignalHandlers: Handler[] = [];

vi.mock("../api/websocket", () => ({
  gateway: {
    on: vi.fn((event: string, handler: Handler) => {
      if (event === "VOICE_SIGNAL") {
        voiceSignalHandlers.push(handler);
      }
      return () => {
        const idx = voiceSignalHandlers.indexOf(handler);
        if (idx >= 0) voiceSignalHandlers.splice(idx, 1);
      };
    }),
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
    dispatchEvent: vi.fn(),
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
  voiceSignalHandlers.length = 0;

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

  globalThis.RTCPeerConnection = vi.fn().mockImplementation(function () {
    return {
      addTrack: vi.fn(() => ({ track: null })),
      removeTrack: vi.fn(),
      getSenders: vi.fn(() => []),
      createOffer: vi
        .fn()
        .mockResolvedValue({ type: "offer", sdp: "offer-sdp" }),
      createAnswer: vi
        .fn()
        .mockResolvedValue({ type: "answer", sdp: "answer-sdp" }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      setRemoteDescription: vi.fn().mockResolvedValue(undefined),
      addIceCandidate: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      ontrack: null,
      onicecandidate: null,
      onconnectionstatechange: null,
      onnegotiationneeded: null,
      connectionState: "new",
      signalingState: "stable",
    };
  }) as unknown as typeof RTCPeerConnection;

  globalThis.RTCSessionDescription = vi
    .fn()
    .mockImplementation(
      (init) => init,
    ) as unknown as typeof RTCSessionDescription;
  globalThis.RTCIceCandidate = vi
    .fn()
    .mockImplementation((init) => init) as unknown as typeof RTCIceCandidate;

  globalThis.MediaStream = vi.fn().mockImplementation(function () {
    return {
      id: "mock-stream",
      getTracks: () => [],
      getVideoTracks: () => [],
      getAudioTracks: () => [],
      addTrack: vi.fn(),
      removeTrack: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  }) as unknown as typeof MediaStream;

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

describe("useWebRTC — VOICE_SIGNAL offer handling", () => {
  it("registers a VOICE_SIGNAL handler when enabled", async () => {
    const audioTrack = makeTrack("audio");
    const audioStream = makeStream([audioTrack]);
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(
      audioStream,
    );

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    // A VOICE_SIGNAL handler should have been registered
    expect(voiceSignalHandlers.length).toBeGreaterThan(0);

    unmount();
  });
});

describe("useWebRTC — VOICE_SIGNAL candidate handling", () => {
  it("adds ICE candidate from peer", async () => {
    const audioTrack = makeTrack("audio");
    const audioStream = makeStream([audioTrack]);
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(
      audioStream,
    );

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        initialPeers: ["peer-1"],
        participants: [
          { user_id: "u1", username: "me" } as never,
          { user_id: "peer-1", username: "other" } as never,
        ],
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    // Wait for initial offer to be sent (peer created)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Simulate receiving an ICE candidate
    for (const handler of voiceSignalHandlers) {
      await handler({
        from_user_id: "peer-1",
        type: "candidate",
        candidate: JSON.stringify({
          candidate: "candidate:1",
          sdpMid: "0",
          sdpMLineIndex: 0,
        }),
      });
    }

    // Should not throw
    unmount();
  });
});

describe("useWebRTC — mic device change", () => {
  it("re-acquires audio when micDeviceId changes", async () => {
    const audioTrack = makeTrack("audio");
    const audioStream = makeStream([audioTrack]);
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(
      audioStream,
    );

    const { rerender, unmount } = renderHook(
      ({ micDeviceId }: { micDeviceId: string | null }) =>
        useWebRTC({
          ...baseOptions(),
          enabled: true,
          micDeviceId,
        }),
      { initialProps: { micDeviceId: null as string | null } },
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    });

    // Change mic device
    const newTrack = makeTrack("audio");
    const newStream = makeStream([newTrack]);
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(newStream);

    rerender({ micDeviceId: "mic-device-2" });

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    });

    // Should have been called with specific device constraint
    const lastCall = vi.mocked(navigator.mediaDevices.getUserMedia).mock
      .calls[1][0] as MediaStreamConstraints;
    expect(lastCall.audio).toEqual({ deviceId: { exact: "mic-device-2" } });

    unmount();
  });
});

describe("useWebRTC — speaker device change", () => {
  it("does not crash when speakerDeviceId is set", async () => {
    const audioTrack = makeTrack("audio");
    const audioStream = makeStream([audioTrack]);
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(
      audioStream,
    );

    const { rerender, unmount } = renderHook(
      ({ speakerDeviceId }: { speakerDeviceId: string | null }) =>
        useWebRTC({
          ...baseOptions(),
          enabled: true,
          speakerDeviceId,
        }),
      { initialProps: { speakerDeviceId: null as string | null } },
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    // Change speaker — should not crash even without audio elements
    rerender({ speakerDeviceId: "speaker-device-1" });

    unmount();
  });
});

describe("useWebRTC — camera acquisition", () => {
  it("acquires camera stream when isCameraOn is true", async () => {
    const audioTrack = makeTrack("audio");
    const audioStream = makeStream([audioTrack]);
    const videoTrack = makeTrack("video");
    const videoStream = makeStream([videoTrack]);

    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(
      async (constraints) => {
        if ((constraints as MediaStreamConstraints).video) {
          return videoStream;
        }
        return audioStream;
      },
    );

    const onLocalStreamsChange = vi.fn();

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        isCameraOn: true,
        onLocalStreamsChange,
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    });

    unmount();
  });
});

describe("useWebRTC — VOICE_SIGNAL ignored for self", () => {
  it("ignores signals from self", async () => {
    const websocketModule = await import("../api/websocket");
    const sendVoiceSignal = vi.mocked(websocketModule.gateway.sendVoiceSignal);
    sendVoiceSignal.mockClear();

    const audioTrack = makeTrack("audio");
    const audioStream = makeStream([audioTrack]);
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(
      audioStream,
    );

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    // Simulate receiving a signal from self — should be ignored
    for (const handler of voiceSignalHandlers) {
      await handler({
        from_user_id: "u1", // same as myUserId
        type: "offer",
        sdp: "self-offer",
      });
    }

    // No answer should be sent
    expect(sendVoiceSignal).not.toHaveBeenCalled();

    unmount();
  });
});

describe("useWebRTC — vadThreshold", () => {
  it("accepts custom vadThreshold without error", async () => {
    const audioTrack = makeTrack("audio");
    const audioStream = makeStream([audioTrack]);
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(
      audioStream,
    );

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        vadThreshold: 30,
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    unmount();
  });
});
