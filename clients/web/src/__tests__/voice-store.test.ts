import { describe, it, expect, vi, beforeEach } from "vitest";
import { useVoiceStore } from "../stores/voiceStore";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    joinVoiceChannel: vi.fn(),
    leaveVoiceChannel: vi.fn(),
    updateVoiceState: vi.fn(),
  },
  ApiRequestError: class extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
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

describe("voiceStore", () => {
  describe("join", () => {
    it("should set connecting state, call API, and store voice state from response", async () => {
      vi.mocked(api.joinVoiceChannel).mockResolvedValueOnce({
        user_id: "u1",
        channel_id: "chan-1",
        self_mute: true,
        self_deaf: false,
        self_video: true,
        self_screen: false,
        server_mute: false,
        server_deaf: false,
        joined_at: new Date().toISOString(),
      } as never);

      const result = await useVoiceStore.getState().join("chan-1");

      expect(api.joinVoiceChannel).toHaveBeenCalledWith("chan-1");
      expect(useVoiceStore.getState().connectedChannelId).toBe("chan-1");
      expect(useVoiceStore.getState().isMuted).toBe(true);
      expect(useVoiceStore.getState().isDeafened).toBe(false);
      expect(useVoiceStore.getState().isCameraOn).toBe(true);
      expect(useVoiceStore.getState().isScreenSharing).toBe(false);
      expect(useVoiceStore.getState().isConnecting).toBe(false);
      expect(result.user_id).toBe("u1");
    });

    it("should set isConnecting true and clear error before calling API", async () => {
      useVoiceStore.setState({ error: "old error" });
      vi.mocked(api.joinVoiceChannel).mockImplementation(async () => {
        expect(useVoiceStore.getState().isConnecting).toBe(true);
        expect(useVoiceStore.getState().error).toBeNull();
        return {
          user_id: "u1",
          channel_id: "chan-1",
          self_mute: false,
          self_deaf: false,
          self_video: false,
          self_screen: false,
          server_mute: false,
          server_deaf: false,
          joined_at: new Date().toISOString(),
        } as never;
      });

      await useVoiceStore.getState().join("chan-1");
    });

    it("should set error and re-throw on join failure with generic Error", async () => {
      vi.mocked(api.joinVoiceChannel).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await expect(useVoiceStore.getState().join("chan-1")).rejects.toThrow();

      expect(useVoiceStore.getState().error).toBe("Failed to join voice");
      expect(useVoiceStore.getState().isConnecting).toBe(false);
      expect(useVoiceStore.getState().connectedChannelId).toBeNull();
    });

    it("should extract message from ApiRequestError on join failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.joinVoiceChannel).mockRejectedValueOnce(
        new MockApiRequestError(403, "Channel full"),
      );

      await expect(
        useVoiceStore.getState().join("chan-1"),
      ).rejects.toBeDefined();

      expect(useVoiceStore.getState().error).toBe("Channel full");
      expect(useVoiceStore.getState().isConnecting).toBe(false);
    });

    it("should initialise all voice flags from server response", async () => {
      vi.mocked(api.joinVoiceChannel).mockResolvedValueOnce({
        user_id: "u1",
        channel_id: "chan-1",
        self_mute: false,
        self_deaf: true,
        self_video: false,
        self_screen: true,
        server_mute: false,
        server_deaf: false,
        joined_at: new Date().toISOString(),
      } as never);

      await useVoiceStore.getState().join("chan-1");

      expect(useVoiceStore.getState().isMuted).toBe(false);
      expect(useVoiceStore.getState().isDeafened).toBe(true);
      expect(useVoiceStore.getState().isCameraOn).toBe(false);
      expect(useVoiceStore.getState().isScreenSharing).toBe(true);
    });
  });

  describe("leave", () => {
    it("should reset all voice state and call API", async () => {
      vi.mocked(api.leaveVoiceChannel).mockResolvedValueOnce(
        undefined as never,
      );
      useVoiceStore.setState({
        connectedChannelId: "chan-1",
        isMuted: true,
        isDeafened: true,
        isCameraOn: true,
        isScreenSharing: true,
      });

      await useVoiceStore.getState().leave();

      expect(useVoiceStore.getState().connectedChannelId).toBeNull();
      expect(useVoiceStore.getState().isMuted).toBe(false);
      expect(useVoiceStore.getState().isDeafened).toBe(false);
      expect(useVoiceStore.getState().isCameraOn).toBe(false);
      expect(useVoiceStore.getState().isScreenSharing).toBe(false);
      expect(api.leaveVoiceChannel).toHaveBeenCalledWith("chan-1");
    });

    it("should do nothing when not connected to any channel", async () => {
      await useVoiceStore.getState().leave();

      expect(api.leaveVoiceChannel).not.toHaveBeenCalled();
    });

    it("should not throw when API call fails (fire-and-forget)", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      vi.mocked(api.leaveVoiceChannel).mockRejectedValueOnce(
        new Error("Server unreachable"),
      );
      useVoiceStore.setState({ connectedChannelId: "chan-1" });

      await expect(useVoiceStore.getState().leave()).resolves.toBeUndefined();

      // State should still be reset even though API failed
      expect(useVoiceStore.getState().connectedChannelId).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe("toggleMute", () => {
    it("should optimistically toggle mute to true and call API", async () => {
      vi.mocked(api.updateVoiceState).mockResolvedValueOnce({} as never);
      useVoiceStore.setState({ connectedChannelId: "chan-1", isMuted: false });

      await useVoiceStore.getState().toggleMute();

      expect(useVoiceStore.getState().isMuted).toBe(true);
      expect(api.updateVoiceState).toHaveBeenCalledWith("chan-1", {
        self_mute: true,
      });
    });

    it("should optimistically toggle mute to false and call API", async () => {
      vi.mocked(api.updateVoiceState).mockResolvedValueOnce({} as never);
      useVoiceStore.setState({ connectedChannelId: "chan-1", isMuted: true });

      await useVoiceStore.getState().toggleMute();

      expect(useVoiceStore.getState().isMuted).toBe(false);
      expect(api.updateVoiceState).toHaveBeenCalledWith("chan-1", {
        self_mute: false,
      });
    });

    it("should revert isMuted on API failure", async () => {
      vi.mocked(api.updateVoiceState).mockRejectedValueOnce(new Error("fail"));
      useVoiceStore.setState({ connectedChannelId: "chan-1", isMuted: false });

      await expect(useVoiceStore.getState().toggleMute()).rejects.toThrow();
      expect(useVoiceStore.getState().isMuted).toBe(false);
    });

    it("should do nothing when not in a channel", async () => {
      await useVoiceStore.getState().toggleMute();
      expect(api.updateVoiceState).not.toHaveBeenCalled();
    });
  });

  describe("toggleDeafen", () => {
    it("should optimistically toggle deafen to true and call API", async () => {
      vi.mocked(api.updateVoiceState).mockResolvedValueOnce({} as never);
      useVoiceStore.setState({
        connectedChannelId: "chan-1",
        isDeafened: false,
      });

      await useVoiceStore.getState().toggleDeafen();

      expect(useVoiceStore.getState().isDeafened).toBe(true);
      expect(api.updateVoiceState).toHaveBeenCalledWith("chan-1", {
        self_deaf: true,
      });
    });

    it("should optimistically toggle deafen to false and call API", async () => {
      vi.mocked(api.updateVoiceState).mockResolvedValueOnce({} as never);
      useVoiceStore.setState({
        connectedChannelId: "chan-1",
        isDeafened: true,
      });

      await useVoiceStore.getState().toggleDeafen();

      expect(useVoiceStore.getState().isDeafened).toBe(false);
      expect(api.updateVoiceState).toHaveBeenCalledWith("chan-1", {
        self_deaf: false,
      });
    });

    it("should revert isDeafened on API failure", async () => {
      vi.mocked(api.updateVoiceState).mockRejectedValueOnce(new Error("fail"));
      useVoiceStore.setState({
        connectedChannelId: "chan-1",
        isDeafened: false,
      });

      await expect(useVoiceStore.getState().toggleDeafen()).rejects.toThrow();
      expect(useVoiceStore.getState().isDeafened).toBe(false);
    });

    it("should do nothing when not in a channel", async () => {
      await useVoiceStore.getState().toggleDeafen();
      expect(api.updateVoiceState).not.toHaveBeenCalled();
    });
  });

  describe("toggleCamera", () => {
    it("should optimistically set isCameraOn to true and call API", async () => {
      vi.mocked(api.updateVoiceState).mockResolvedValueOnce({} as never);
      useVoiceStore.setState({ connectedChannelId: "chan-1" });

      await useVoiceStore.getState().toggleCamera();

      expect(useVoiceStore.getState().isCameraOn).toBe(true);
      expect(api.updateVoiceState).toHaveBeenCalledWith("chan-1", {
        self_video: true,
      });
    });

    it("should toggle isCameraOn from true to false", async () => {
      vi.mocked(api.updateVoiceState).mockResolvedValueOnce({} as never);
      useVoiceStore.setState({
        connectedChannelId: "chan-1",
        isCameraOn: true,
      });

      await useVoiceStore.getState().toggleCamera();

      expect(useVoiceStore.getState().isCameraOn).toBe(false);
      expect(api.updateVoiceState).toHaveBeenCalledWith("chan-1", {
        self_video: false,
      });
    });

    it("should revert isCameraOn on API failure", async () => {
      vi.mocked(api.updateVoiceState).mockRejectedValueOnce(new Error("fail"));
      useVoiceStore.setState({
        connectedChannelId: "chan-1",
        isCameraOn: false,
      });

      await expect(useVoiceStore.getState().toggleCamera()).rejects.toThrow();
      expect(useVoiceStore.getState().isCameraOn).toBe(false);
    });

    it("should do nothing when not in a channel", async () => {
      await useVoiceStore.getState().toggleCamera();
      expect(api.updateVoiceState).not.toHaveBeenCalled();
    });
  });

  describe("toggleScreen", () => {
    it("should optimistically set isScreenSharing to true and call API", async () => {
      vi.mocked(api.updateVoiceState).mockResolvedValueOnce({} as never);
      useVoiceStore.setState({ connectedChannelId: "chan-1" });

      await useVoiceStore.getState().toggleScreen();

      expect(useVoiceStore.getState().isScreenSharing).toBe(true);
      expect(api.updateVoiceState).toHaveBeenCalledWith("chan-1", {
        self_screen: true,
      });
    });

    it("should toggle isScreenSharing from true to false", async () => {
      vi.mocked(api.updateVoiceState).mockResolvedValueOnce({} as never);
      useVoiceStore.setState({
        connectedChannelId: "chan-1",
        isScreenSharing: true,
      });

      await useVoiceStore.getState().toggleScreen();

      expect(useVoiceStore.getState().isScreenSharing).toBe(false);
      expect(api.updateVoiceState).toHaveBeenCalledWith("chan-1", {
        self_screen: false,
      });
    });

    it("should revert isScreenSharing on API failure", async () => {
      vi.mocked(api.updateVoiceState).mockRejectedValueOnce(new Error("fail"));
      useVoiceStore.setState({
        connectedChannelId: "chan-1",
        isScreenSharing: false,
      });

      await expect(useVoiceStore.getState().toggleScreen()).rejects.toThrow();
      expect(useVoiceStore.getState().isScreenSharing).toBe(false);
    });

    it("should do nothing when not in a channel", async () => {
      await useVoiceStore.getState().toggleScreen();
      expect(api.updateVoiceState).not.toHaveBeenCalled();
    });
  });

  describe("clearError", () => {
    it("should clear the error", () => {
      useVoiceStore.setState({ error: "Some error" });

      useVoiceStore.getState().clearError();

      expect(useVoiceStore.getState().error).toBeNull();
    });
  });
});
