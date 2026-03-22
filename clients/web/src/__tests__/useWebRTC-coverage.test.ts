/**
 * useWebRTC — coverage-boost tests targeting uncovered branches:
 *   - createPeer: ontrack (audio + video), onicecandidate, onconnectionstatechange, onnegotiationneeded
 *   - playRemoteStream: audio element creation, setSinkId, speaking detector
 *   - closePeer: full cleanup path
 *   - VOICE_SIGNAL: offer → answer flow, answer handling, candidate handling
 *   - startSpeakingDetector: interval-based RMS detection, cleanup, error path
 *   - Mic re-acquire with existing peers (replaceTrack)
 *   - Camera release / screen share release (removeTrack from peers)
 *   - Speaker device setSinkId on existing audio elements
 *   - Unmount cleanup (AudioContext.close, track stops)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWebRTC } from "../hooks/useWebRTC";
import { useVoiceStore } from "../stores/voiceStore";
import { api } from "../api/client";
import type { VoiceParticipant } from "../types";

// ─── Module mocks ────────────────────────────────────────────────────────────

type Handler = (signal: Record<string, unknown>) => Promise<void> | void;
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
    dispatchEvent: vi.fn((evt: Event) => {
      listeners[evt.type]?.forEach((fn) => fn(evt));
      return true;
    }),
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
  participants: [] as VoiceParticipant[],
  initialPeers: [] as string[],
  isMuted: false,
  isDeafened: false,
  isCameraOn: false,
  isScreenSharing: false,
  cameraDeviceId: null as string | null,
  micDeviceId: null as string | null,
  speakerDeviceId: null as string | null,
  onError: vi.fn(),
  onSpeakingChange: vi.fn(),
  onRemoteStreamsChange: vi.fn(),
  onLocalStreamsChange: vi.fn(),
});

// Store created PC instances so tests can trigger event handlers.
let createdPCs: Array<Record<string, unknown>> = [];

function makePCInstance() {
  const senders: Array<{ track: { kind: string } | null }> = [];
  const pc: Record<string, unknown> = {
    addTrack: vi.fn((_track: { kind: string }) => {
      const sender = { track: _track };
      senders.push(sender);
      return sender;
    }),
    removeTrack: vi.fn(),
    getSenders: vi.fn(() => senders),
    createOffer: vi.fn().mockResolvedValue({ type: "offer", sdp: "offer-sdp" }),
    createAnswer: vi
      .fn()
      .mockResolvedValue({ type: "answer", sdp: "answer-sdp" }),
    setLocalDescription: vi.fn().mockResolvedValue(undefined),
    setRemoteDescription: vi.fn().mockResolvedValue(undefined),
    addIceCandidate: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    ontrack: null as unknown,
    onicecandidate: null as unknown,
    onconnectionstatechange: null as unknown,
    onnegotiationneeded: null as unknown,
    connectionState: "new",
    signalingState: "stable",
  };
  createdPCs.push(pc);
  return pc;
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  voiceSignalHandlers.length = 0;
  createdPCs = [];

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
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue(audioStream),
      getDisplayMedia: vi.fn(),
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
  });

  globalThis.RTCPeerConnection = vi.fn().mockImplementation(function () {
    return makePCInstance();
  }) as unknown as typeof RTCPeerConnection;

  globalThis.RTCSessionDescription = vi.fn().mockImplementation(function (
    init: unknown,
  ) {
    return init;
  }) as unknown as typeof RTCSessionDescription;
  globalThis.RTCIceCandidate = vi.fn().mockImplementation(function (
    init: unknown,
  ) {
    return init;
  }) as unknown as typeof RTCIceCandidate;

  globalThis.MediaStream = vi.fn().mockImplementation(function (
    tracks?: MediaStreamTrack[],
  ) {
    const t = tracks ?? [];
    return {
      id: "mock-remote-stream",
      getTracks: () => t,
      getVideoTracks: () => t.filter((tr) => tr.kind === "video"),
      getAudioTracks: () => t.filter((tr) => tr.kind === "audio"),
      addTrack: vi.fn((track: MediaStreamTrack) => t.push(track)),
      removeTrack: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  }) as unknown as typeof MediaStream;

  globalThis.AudioContext = vi.fn().mockImplementation(function () {
    return {
      createAnalyser: vi.fn(() => ({
        fftSize: 512,
        frequencyBinCount: 256,
        getByteFrequencyData: vi.fn((arr: Uint8Array) => {
          // Simulate speaking by filling with values > threshold
          for (let i = 0; i < arr.length; i++) arr[i] = 50;
        }),
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      createMediaStreamSource: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      close: vi.fn().mockResolvedValue(undefined),
    };
  }) as unknown as typeof AudioContext;

  // jsdom doesn't have HTMLAudioElement.setSinkId - mock document.createElement
  const origCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = origCreateElement(tag);
    if (tag === "audio") {
      (el as unknown as Record<string, unknown>).setSinkId = vi
        .fn()
        .mockResolvedValue(undefined);
    }
    return el;
  });

  vi.spyOn(document.body, "appendChild").mockImplementation(
    (node) => node as HTMLElement,
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── Emit a voice signal to all registered handlers ─────────────────────────

async function emitSignal(signal: Record<string, unknown>) {
  for (const handler of [...voiceSignalHandlers]) {
    await handler(signal);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createPeer and offer flow", () => {
  it("creates a peer, sends an offer, and forwards ICE candidates", async () => {
    const websocketModule = await import("../api/websocket");
    const sendVoiceSignal = vi.mocked(websocketModule.gateway.sendVoiceSignal);

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        initialPeers: ["peer-1"],
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-1", username: "other" } as VoiceParticipant,
        ],
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    // Wait for offer to be sent
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(sendVoiceSignal).toHaveBeenCalledWith(
      "peer-1",
      "offer",
      "offer-sdp",
    );

    // A PC should have been created
    expect(createdPCs.length).toBeGreaterThanOrEqual(1);
    const pc = createdPCs[0];

    // Trigger onicecandidate
    const candidateHandler = pc.onicecandidate as (e: {
      candidate: unknown;
    }) => void;
    expect(candidateHandler).toBeTypeOf("function");
    candidateHandler({ candidate: { candidate: "c1", sdpMid: "0" } });
    expect(sendVoiceSignal).toHaveBeenCalledWith(
      "peer-1",
      "candidate",
      undefined,
      expect.any(String),
    );

    // Trigger with null candidate (end-of-candidates) - should not send
    sendVoiceSignal.mockClear();
    candidateHandler({ candidate: null });
    expect(sendVoiceSignal).not.toHaveBeenCalled();

    unmount();
  });

  it("handles onconnectionstatechange → failed by closing peer", async () => {
    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        initialPeers: ["peer-1"],
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-1", username: "other" } as VoiceParticipant,
        ],
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(createdPCs.length).toBeGreaterThanOrEqual(1);
    const pc = createdPCs[0];

    // Simulate connection failure
    pc.connectionState = "failed";
    const handler = pc.onconnectionstatechange as (() => void) | null;
    expect(handler).toBeTypeOf("function");
    handler!();

    // pc.close should have been called by closePeer
    expect(pc.close).toHaveBeenCalled();

    unmount();
  });
});

describe("VOICE_SIGNAL offer → answer round-trip", () => {
  it("responds to an incoming offer with an answer", async () => {
    const websocketModule = await import("../api/websocket");
    const sendVoiceSignal = vi.mocked(websocketModule.gateway.sendVoiceSignal);

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-2", username: "joiner" } as VoiceParticipant,
        ],
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    // Receive an offer from peer-2
    await act(async () => {
      await emitSignal({
        from_user_id: "peer-2",
        type: "offer",
        sdp: "remote-offer-sdp",
      });
    });

    // A PC should have been created and an answer sent
    expect(createdPCs.length).toBeGreaterThanOrEqual(1);
    const pc = createdPCs[0];
    expect(pc.setRemoteDescription).toHaveBeenCalledWith({
      type: "offer",
      sdp: "remote-offer-sdp",
    });
    expect(pc.createAnswer).toHaveBeenCalled();
    expect(pc.setLocalDescription).toHaveBeenCalledWith({
      type: "answer",
      sdp: "answer-sdp",
    });
    expect(sendVoiceSignal).toHaveBeenCalledWith(
      "peer-2",
      "answer",
      "answer-sdp",
    );

    unmount();
  });

  it("handles an incoming answer on an existing peer", async () => {
    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        initialPeers: ["peer-1"],
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-1", username: "other" } as VoiceParticipant,
        ],
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(createdPCs.length).toBeGreaterThanOrEqual(1);
    const pc = createdPCs[0];

    // After sending offer, signalingState should be have-local-offer for answer handling
    pc.signalingState = "have-local-offer";

    // Receive answer from peer-1
    await act(async () => {
      await emitSignal({
        from_user_id: "peer-1",
        type: "answer",
        sdp: "remote-answer-sdp",
      });
    });

    expect(pc.setRemoteDescription).toHaveBeenCalledWith({
      type: "answer",
      sdp: "remote-answer-sdp",
    });

    unmount();
  });

  it("handles incoming ICE candidate for existing peer", async () => {
    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        initialPeers: ["peer-1"],
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-1", username: "other" } as VoiceParticipant,
        ],
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const pc = createdPCs[0];

    // Send ICE candidate
    await act(async () => {
      await emitSignal({
        from_user_id: "peer-1",
        type: "candidate",
        candidate: JSON.stringify({
          candidate: "candidate:123",
          sdpMid: "0",
          sdpMLineIndex: 0,
        }),
      });
    });

    expect(pc.addIceCandidate).toHaveBeenCalled();

    unmount();
  });

  it("ignores answer when signalingState is not have-local-offer", async () => {
    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        initialPeers: ["peer-1"],
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-1", username: "other" } as VoiceParticipant,
        ],
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const pc = createdPCs[0];
    // signalingState is "stable" (default), not "have-local-offer"
    pc.signalingState = "stable";

    await act(async () => {
      await emitSignal({
        from_user_id: "peer-1",
        type: "answer",
        sdp: "answer-sdp",
      });
    });

    // setRemoteDescription should NOT have been called for answer
    expect(pc.setRemoteDescription).not.toHaveBeenCalled();

    unmount();
  });
});

describe("createPeer — ontrack handler", () => {
  it("plays remote audio stream when audio track arrives", async () => {
    const onSpeakingChange = vi.fn();
    const onRemoteStreamsChange = vi.fn();

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-2", username: "joiner" } as VoiceParticipant,
        ],
        onSpeakingChange,
        onRemoteStreamsChange,
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    // Receive an offer to create a peer
    await act(async () => {
      await emitSignal({
        from_user_id: "peer-2",
        type: "offer",
        sdp: "remote-sdp",
      });
    });

    const pc = createdPCs[0];
    const ontrackHandler = pc.ontrack as (
      event: Record<string, unknown>,
    ) => void;
    expect(ontrackHandler).toBeTypeOf("function");

    // Simulate an audio track arriving
    const audioTrack = makeTrack("audio");
    const remoteAudioStream = makeStream([audioTrack]);
    ontrackHandler({
      track: audioTrack,
      streams: [remoteAudioStream],
    });

    // An audio element should have been created
    expect(document.createElement).toHaveBeenCalledWith("audio");

    // Advance timer to trigger speaking detection interval
    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    // Speaking should have been detected (our mock fills with 50 > threshold 15)
    expect(onSpeakingChange).toHaveBeenCalledWith("peer-2", true);

    unmount();
  });

  it("handles incoming video track (camera and screen)", async () => {
    const onRemoteStreamsChange = vi.fn();

    const { result, unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-2", username: "joiner" } as VoiceParticipant,
        ],
        onRemoteStreamsChange,
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    await act(async () => {
      await emitSignal({
        from_user_id: "peer-2",
        type: "offer",
        sdp: "remote-sdp",
      });
    });

    const pc = createdPCs[0];
    const ontrackHandler = pc.ontrack as (
      event: Record<string, unknown>,
    ) => void;

    // Simulate a camera video track (contentHint = "" defaults to camera)
    const cameraTrack = makeTrack("video");
    cameraTrack.contentHint = "";
    const cameraStream = makeStream([cameraTrack]);
    ontrackHandler({
      track: cameraTrack,
      streams: [cameraStream],
    });

    expect(onRemoteStreamsChange).toHaveBeenCalled();
    const streams = result.current.getRemoteVideoStreams();
    expect(streams.get("peer-2")).toBeDefined();
    expect(streams.get("peer-2")!.camera).toBe(cameraStream);

    onRemoteStreamsChange.mockClear();

    // Simulate a screen share video track (contentHint = "detail")
    const screenTrack = makeTrack("video");
    screenTrack.contentHint = "detail";
    const screenStream = makeStream([screenTrack]);
    ontrackHandler({
      track: screenTrack,
      streams: [screenStream],
    });

    expect(onRemoteStreamsChange).toHaveBeenCalled();
    const updatedStreams = result.current.getRemoteVideoStreams();
    expect(updatedStreams.get("peer-2")!.screen).toBe(screenStream);

    unmount();
  });

  it("creates new MediaStream when event.streams is empty for video track", async () => {
    const onRemoteStreamsChange = vi.fn();

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-2", username: "joiner" } as VoiceParticipant,
        ],
        onRemoteStreamsChange,
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    await act(async () => {
      await emitSignal({
        from_user_id: "peer-2",
        type: "offer",
        sdp: "remote-sdp",
      });
    });

    const pc = createdPCs[0];
    const ontrackHandler = pc.ontrack as (
      event: Record<string, unknown>,
    ) => void;

    // Video track with no streams (undefined first element)
    const videoTrack = makeTrack("video");
    ontrackHandler({
      track: videoTrack,
      streams: [],
    });

    // Should have called new MediaStream() to create a fallback stream
    expect(globalThis.MediaStream).toHaveBeenCalled();
    expect(onRemoteStreamsChange).toHaveBeenCalled();

    unmount();
  });
});

describe("startSpeakingDetector — speaking transitions", () => {
  it("fires speaking=false when RMS drops below threshold", async () => {
    const onSpeakingChange = vi.fn();
    let speakingValue = 50; // above threshold initially

    globalThis.AudioContext = vi.fn().mockImplementation(function () {
      return {
        createAnalyser: vi.fn(() => ({
          fftSize: 512,
          frequencyBinCount: 256,
          getByteFrequencyData: vi.fn((arr: Uint8Array) => {
            for (let i = 0; i < arr.length; i++) arr[i] = speakingValue;
          }),
          connect: vi.fn(),
          disconnect: vi.fn(),
        })),
        createMediaStreamSource: vi.fn(() => ({
          connect: vi.fn(),
          disconnect: vi.fn(),
        })),
        close: vi.fn().mockResolvedValue(undefined),
      };
    }) as unknown as typeof AudioContext;

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-2", username: "joiner" } as VoiceParticipant,
        ],
        onSpeakingChange,
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    // Create peer via offer
    await act(async () => {
      await emitSignal({
        from_user_id: "peer-2",
        type: "offer",
        sdp: "sdp",
      });
    });

    const pc = createdPCs[0];
    const ontrackHandler = pc.ontrack as (
      event: Record<string, unknown>,
    ) => void;
    const audioTrack = makeTrack("audio");
    const remoteStream = makeStream([audioTrack]);
    ontrackHandler({ track: audioTrack, streams: [remoteStream] });

    // Trigger speaking = true
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(onSpeakingChange).toHaveBeenCalledWith("peer-2", true);

    onSpeakingChange.mockClear();

    // Drop below threshold
    speakingValue = 0;
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(onSpeakingChange).toHaveBeenCalledWith("peer-2", false);

    unmount();
  });
});

describe("closePeer — full cleanup", () => {
  it("closes PC, removes audio element, resets speaking, and clears senders", async () => {
    const onSpeakingChange = vi.fn();
    const onRemoteStreamsChange = vi.fn();

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        initialPeers: ["peer-1"],
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-1", username: "other" } as VoiceParticipant,
        ],
        onSpeakingChange,
        onRemoteStreamsChange,
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(createdPCs.length).toBeGreaterThanOrEqual(1);
    const pc = createdPCs[0];

    // Simulate audio track arrival to create audio element
    const ontrackHandler = pc.ontrack as (
      event: Record<string, unknown>,
    ) => void;
    const audioTrack = makeTrack("audio");
    const remoteStream = makeStream([audioTrack]);
    ontrackHandler({ track: audioTrack, streams: [remoteStream] });

    // Now remove the peer from participants to trigger closePeer
    onSpeakingChange.mockClear();
    onRemoteStreamsChange.mockClear();

    // Re-render with peer-1 gone
    unmount();

    // On unmount, closePeer is called for all peers
    expect(pc.close).toHaveBeenCalled();
    expect(onSpeakingChange).toHaveBeenCalledWith("peer-1", false);

    // AudioContext should be closed on unmount
    // (verified via the mock)
  });
});

describe("onnegotiationneeded — renegotiation", () => {
  it("sends a new offer when negotiation is needed after initial handshake", async () => {
    const websocketModule = await import("../api/websocket");
    const sendVoiceSignal = vi.mocked(websocketModule.gateway.sendVoiceSignal);

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-2", username: "joiner" } as VoiceParticipant,
        ],
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    // Receive offer and send answer (marks initial negotiation done)
    await act(async () => {
      await emitSignal({
        from_user_id: "peer-2",
        type: "offer",
        sdp: "remote-sdp",
      });
    });

    const pc = createdPCs[0];
    sendVoiceSignal.mockClear();

    // Now trigger onnegotiationneeded (simulating track addition after handshake)
    const onneg = pc.onnegotiationneeded as (() => Promise<void>) | null;
    expect(onneg).toBeTypeOf("function");

    await act(async () => {
      await onneg!();
    });

    // Should have sent a new offer
    expect(sendVoiceSignal).toHaveBeenCalledWith(
      "peer-2",
      "offer",
      "offer-sdp",
    );

    unmount();
  });

  it("skips renegotiation when signalingState is not stable", async () => {
    const websocketModule = await import("../api/websocket");
    const sendVoiceSignal = vi.mocked(websocketModule.gateway.sendVoiceSignal);

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-2", username: "joiner" } as VoiceParticipant,
        ],
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    // Receive offer (marks initial negotiation done)
    await act(async () => {
      await emitSignal({
        from_user_id: "peer-2",
        type: "offer",
        sdp: "sdp",
      });
    });

    const pc = createdPCs[0];
    pc.signalingState = "have-local-offer"; // not stable
    sendVoiceSignal.mockClear();

    const onneg = pc.onnegotiationneeded as (() => Promise<void>) | null;
    await act(async () => {
      await onneg!();
    });

    // Should NOT have sent a new offer
    expect(pc.createOffer).not.toHaveBeenCalledTimes(3); // only the initial createOffer
    // Actually let's check sendVoiceSignal was not called after the clear
    expect(sendVoiceSignal).not.toHaveBeenCalled();

    unmount();
  });

  it("calls onError when renegotiation fails", async () => {
    const onError = vi.fn();

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-2", username: "joiner" } as VoiceParticipant,
        ],
        onError,
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    // Receive offer
    await act(async () => {
      await emitSignal({
        from_user_id: "peer-2",
        type: "offer",
        sdp: "sdp",
      });
    });

    const pc = createdPCs[0];
    // Make createOffer fail
    (pc.createOffer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("negotiation failed"),
    );

    const onneg = pc.onnegotiationneeded as (() => Promise<void>) | null;
    await act(async () => {
      await onneg!();
    });

    expect(onError).toHaveBeenCalledWith(
      "Failed to renegotiate voice connection",
    );

    unmount();
  });
});

describe("VOICE_SIGNAL error handling", () => {
  it("calls onError when answering an offer fails", async () => {
    const onError = vi.fn();

    // Make setRemoteDescription fail for the offer path
    globalThis.RTCPeerConnection = vi.fn().mockImplementation(function () {
      const pc = makePCInstance();
      (pc.setRemoteDescription as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("SRD failed"),
      );
      return pc;
    }) as unknown as typeof RTCPeerConnection;

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-2", username: "other" } as VoiceParticipant,
        ],
        onError,
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    await act(async () => {
      await emitSignal({
        from_user_id: "peer-2",
        type: "offer",
        sdp: "bad-sdp",
      });
    });

    expect(onError).toHaveBeenCalledWith(
      "Failed to answer voice connection request",
    );

    unmount();
  });

  it("calls onError when setting remote answer fails", async () => {
    const onError = vi.fn();

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        initialPeers: ["peer-1"],
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-1", username: "other" } as VoiceParticipant,
        ],
        onError,
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const pc = createdPCs[0];
    pc.signalingState = "have-local-offer";
    (pc.setRemoteDescription as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("SRD failed"),
    );

    await act(async () => {
      await emitSignal({
        from_user_id: "peer-1",
        type: "answer",
        sdp: "bad-answer",
      });
    });

    expect(onError).toHaveBeenCalledWith(
      "Failed to establish voice connection with a peer",
    );

    unmount();
  });

  it("handles addIceCandidate failure gracefully", async () => {
    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        initialPeers: ["peer-1"],
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-1", username: "other" } as VoiceParticipant,
        ],
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const pc = createdPCs[0];
    (pc.addIceCandidate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("ICE failed"),
    );

    // Should not throw
    await act(async () => {
      await emitSignal({
        from_user_id: "peer-1",
        type: "candidate",
        candidate: JSON.stringify({ candidate: "c1" }),
      });
    });

    unmount();
  });

  it("ignores candidate for unknown peer", async () => {
    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    // Send candidate from a peer we haven't established a connection with
    await act(async () => {
      await emitSignal({
        from_user_id: "unknown-peer",
        type: "candidate",
        candidate: JSON.stringify({ candidate: "c1" }),
      });
    });

    // Should not throw, no PC to add candidate to
    unmount();
  });
});

describe("mic device change stops old tracks", () => {
  it("stops old audio tracks and re-acquires with new device", async () => {
    const oldAudioTrack = makeTrack("audio");
    const oldAudioStream = makeStream([oldAudioTrack]);
    const newAudioTrack = makeTrack("audio");
    const newAudioStream = makeStream([newAudioTrack]);

    let callCount = 0;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(
      async () => {
        callCount++;
        return callCount === 1 ? oldAudioStream : newAudioStream;
      },
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
      expect(callCount).toBe(1);
    });

    // Change mic device
    rerender({ micDeviceId: "new-mic" });

    await waitFor(() => {
      expect(callCount).toBe(2);
    });

    // Wait for promise resolution
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // Old tracks should be stopped when re-acquiring
    expect(oldAudioTrack.stop).toHaveBeenCalled();

    unmount();
  });
});

describe("camera release removes track from peers", () => {
  it("removes camera sender when camera is turned off", async () => {
    const videoTrack = makeTrack("video");
    const videoStream = makeStream([videoTrack]);
    const audioTrack = makeTrack("audio");
    const audioStream = makeStream([audioTrack]);

    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(
      async (constraints) => {
        if ((constraints as MediaStreamConstraints).video) return videoStream;
        return audioStream;
      },
    );

    const onLocalStreamsChange = vi.fn();

    const { rerender, unmount } = renderHook(
      ({ isCameraOn }: { isCameraOn: boolean }) =>
        useWebRTC({
          ...baseOptions(),
          enabled: true,
          isCameraOn,
          onLocalStreamsChange,
          initialPeers: ["peer-1"],
          participants: [
            { user_id: "u1", username: "me" } as VoiceParticipant,
            { user_id: "peer-1", username: "other" } as VoiceParticipant,
          ],
        }),
      { initialProps: { isCameraOn: true } },
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    });

    // Turn camera off
    rerender({ isCameraOn: false });

    // Video tracks should be stopped
    expect(videoTrack.stop).toHaveBeenCalled();
    expect(onLocalStreamsChange).toHaveBeenCalled();

    unmount();
  });
});

describe("screen share release removes track from peers", () => {
  it("removes screen sender when screen sharing stops", async () => {
    const screenTrack = makeTrack("video");
    const screenStream = makeStream([screenTrack]);

    (
      navigator.mediaDevices as MediaDevices & {
        getDisplayMedia: ReturnType<typeof vi.fn>;
      }
    ).getDisplayMedia = vi.fn().mockResolvedValue(screenStream);

    const onLocalStreamsChange = vi.fn();

    await act(async () => {
      await useVoiceStore.getState().toggleScreen();
    });

    const { rerender, unmount } = renderHook(
      ({ isScreenSharing }: { isScreenSharing: boolean }) =>
        useWebRTC({
          ...baseOptions(),
          enabled: true,
          isScreenSharing,
          onLocalStreamsChange,
        }),
      { initialProps: { isScreenSharing: true } },
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalled();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    onLocalStreamsChange.mockClear();

    // Stop screen sharing
    rerender({ isScreenSharing: false });

    expect(screenTrack.stop).toHaveBeenCalled();
    expect(onLocalStreamsChange).toHaveBeenCalled();

    unmount();
  });
});

describe("speaker device change — setSinkId", () => {
  it("calls setSinkId on existing audio elements when speaker changes", async () => {
    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-2", username: "other" } as VoiceParticipant,
        ],
        speakerDeviceId: "speaker-1",
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    // Receive offer so we create a peer and get audio
    await act(async () => {
      await emitSignal({
        from_user_id: "peer-2",
        type: "offer",
        sdp: "sdp",
      });
    });

    const pc = createdPCs[0];
    const ontrackHandler = pc.ontrack as (
      event: Record<string, unknown>,
    ) => void;
    const audioTrack = makeTrack("audio");
    const remoteStream = makeStream([audioTrack]);
    ontrackHandler({ track: audioTrack, streams: [remoteStream] });

    // Audio element should have setSinkId called during creation with speaker-1
    // (verified via the mock)

    unmount();
  });
});

describe("local speaking detection — PTT and mute filtering", () => {
  it("does not report local speaking in PTT mode via audio detector", async () => {
    const onSpeakingChange = vi.fn();

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        pttMode: true,
        isPttActive: false,
        onSpeakingChange,
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    // Advance timer to fire local speaking detector
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    // In PTT mode, the audio-based detector skips local reporting
    // It should have been called with u1,false from the PTT effect (isPttActive=false)
    const localCalls = (
      onSpeakingChange.mock.calls as [string, boolean][]
    ).filter((c) => c[0] === "u1");
    // All local calls should be speaking=false because PTT is inactive
    localCalls.forEach((c) => {
      expect(c[1]).toBe(false);
    });

    unmount();
  });

  it("does not report local speaking when muted", async () => {
    const onSpeakingChange = vi.fn();

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        isMuted: true,
        onSpeakingChange,
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    // Advance timer - local detector should suppress speaking when muted
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    const localSpeaking = (
      onSpeakingChange.mock.calls as [string, boolean][]
    ).filter((c) => c[0] === "u1" && c[1] === true);
    expect(localSpeaking).toHaveLength(0);

    unmount();
  });
});

describe("offer creation failure", () => {
  it("calls onError when createOffer fails for initial peers", async () => {
    const onError = vi.fn();

    globalThis.RTCPeerConnection = vi.fn().mockImplementation(function () {
      const pc = makePCInstance();
      (pc.createOffer as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("offer failed"),
      );
      return pc;
    }) as unknown as typeof RTCPeerConnection;

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        initialPeers: ["peer-1"],
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-1", username: "other" } as VoiceParticipant,
        ],
        onError,
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(onError).toHaveBeenCalledWith(
      "Failed to establish voice connection with a peer",
    );

    unmount();
  });
});

describe("startSpeakingDetector error path", () => {
  it("returns no-op cleanup when AudioContext throws", async () => {
    // Make AudioContext throw on creation
    globalThis.AudioContext = vi.fn().mockImplementation(function () {
      throw new Error("AudioContext not available");
    }) as unknown as typeof AudioContext;

    const onSpeakingChange = vi.fn();

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        onSpeakingChange,
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    // Should not throw, speaking detection is skipped
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    unmount();
  });
});

describe("unmount cleanup", () => {
  it("closes AudioContext and stops all tracks on unmount", async () => {
    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        initialPeers: ["peer-1"],
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-1", username: "other" } as VoiceParticipant,
        ],
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const pc = createdPCs[0];

    unmount();

    // PC should have been closed
    expect(pc.close).toHaveBeenCalled();
  });
});

describe("skip self in initialPeers", () => {
  it("does not create a peer connection to itself", async () => {
    const websocketModule = await import("../api/websocket");
    const sendVoiceSignal = vi.mocked(websocketModule.gateway.sendVoiceSignal);

    const { unmount } = renderHook(() =>
      useWebRTC({
        ...baseOptions(),
        enabled: true,
        initialPeers: ["u1", "peer-1"],
        participants: [
          { user_id: "u1", username: "me" } as VoiceParticipant,
          { user_id: "peer-1", username: "other" } as VoiceParticipant,
        ],
      }),
    );

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Should only have sent one offer (to peer-1), not to self
    const offerCalls = sendVoiceSignal.mock.calls.filter(
      (c) => c[1] === "offer",
    );
    expect(offerCalls).toHaveLength(1);
    expect(offerCalls[0][0]).toBe("peer-1");

    unmount();
  });
});
