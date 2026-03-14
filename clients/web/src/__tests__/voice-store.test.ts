import { describe, it, expect, vi, beforeEach } from "vitest";
import { useVoiceStore } from "../stores/voiceStore";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    joinVoiceChannel: vi.fn(),
    leaveVoiceChannel: vi.fn(),
    updateVoiceState: vi.fn(),
  },
}));

beforeEach(() => {
  useVoiceStore.setState({
    connectedChannelId: null,
    isMuted: false,
    isDeafened: false,
    isCameraOn: false,
    isScreenSharing: false,
    isConnecting: false,
    error: null,
  });
  vi.clearAllMocks();
});

describe("toggleCamera", () => {
  it("optimistically sets isCameraOn to true and calls API", async () => {
    vi.mocked(api.updateVoiceState).mockResolvedValueOnce({} as never);
    useVoiceStore.setState({ connectedChannelId: "chan-1" });

    await useVoiceStore.getState().toggleCamera();

    expect(useVoiceStore.getState().isCameraOn).toBe(true);
    expect(api.updateVoiceState).toHaveBeenCalledWith("chan-1", {
      self_video: true,
    });
  });

  it("reverts isCameraOn on API failure", async () => {
    vi.mocked(api.updateVoiceState).mockRejectedValueOnce(new Error("fail"));
    useVoiceStore.setState({ connectedChannelId: "chan-1", isCameraOn: false });

    await expect(useVoiceStore.getState().toggleCamera()).rejects.toThrow();
    expect(useVoiceStore.getState().isCameraOn).toBe(false);
  });

  it("does nothing when not in a channel", async () => {
    await useVoiceStore.getState().toggleCamera();
    expect(api.updateVoiceState).not.toHaveBeenCalled();
  });
});

describe("toggleScreen", () => {
  it("optimistically sets isScreenSharing to true and calls API", async () => {
    vi.mocked(api.updateVoiceState).mockResolvedValueOnce({} as never);
    useVoiceStore.setState({ connectedChannelId: "chan-1" });

    await useVoiceStore.getState().toggleScreen();

    expect(useVoiceStore.getState().isScreenSharing).toBe(true);
    expect(api.updateVoiceState).toHaveBeenCalledWith("chan-1", {
      self_screen: true,
    });
  });

  it("reverts isScreenSharing on API failure", async () => {
    vi.mocked(api.updateVoiceState).mockRejectedValueOnce(new Error("fail"));
    useVoiceStore.setState({
      connectedChannelId: "chan-1",
      isScreenSharing: false,
    });

    await expect(useVoiceStore.getState().toggleScreen()).rejects.toThrow();
    expect(useVoiceStore.getState().isScreenSharing).toBe(false);
  });

  it("does nothing when not in a channel", async () => {
    await useVoiceStore.getState().toggleScreen();
    expect(api.updateVoiceState).not.toHaveBeenCalled();
  });
});

describe("leave", () => {
  it("resets isCameraOn and isScreenSharing to false", async () => {
    vi.mocked(api.leaveVoiceChannel).mockResolvedValueOnce(undefined as never);
    useVoiceStore.setState({
      connectedChannelId: "chan-1",
      isCameraOn: true,
      isScreenSharing: true,
    });

    await useVoiceStore.getState().leave();

    expect(useVoiceStore.getState().isCameraOn).toBe(false);
    expect(useVoiceStore.getState().isScreenSharing).toBe(false);
  });
});

describe("join", () => {
  it("initialises isCameraOn and isScreenSharing from server response", async () => {
    vi.mocked(api.joinVoiceChannel).mockResolvedValueOnce({
      user_id: "u1",
      channel_id: "chan-1",
      self_mute: false,
      self_deaf: false,
      self_video: true,
      self_screen: false,
      server_mute: false,
      server_deaf: false,
      joined_at: new Date().toISOString(),
    } as never);

    await useVoiceStore.getState().join("chan-1");

    expect(useVoiceStore.getState().isCameraOn).toBe(true);
    expect(useVoiceStore.getState().isScreenSharing).toBe(false);
  });
});
