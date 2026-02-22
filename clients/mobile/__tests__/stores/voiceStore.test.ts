import { useVoiceStore } from "../../src/stores/voiceStore";
import { api, ApiRequestError } from "../../src/api/client";

jest.mock("../../src/api/client", () => ({
  api: {
    joinVoiceChannel: jest.fn(),
    leaveVoiceChannel: jest.fn(),
    updateVoiceState: jest.fn(),
  },
  ApiRequestError: class ApiRequestError extends Error {
    status: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.status = statusCode;
      this.name = "ApiRequestError";
    }
  },
}));

const mockApi = api as jest.Mocked<typeof api>;

const fakeParticipant = {
  user_id: "u1",
  username: "alice",
  channel_id: "ch-voice",
  self_mute: false,
  self_deaf: false,
  server_mute: false,
  server_deaf: false,
  joined_at: "2024-01-01",
};

function resetStore() {
  useVoiceStore.setState({
    connectedChannelId: null,
    isMuted: false,
    isDeafened: false,
    isConnecting: false,
    error: null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
});

describe("voiceStore", () => {
  describe("join", () => {
    it("sets connectedChannelId and mute/deafen from server response", async () => {
      mockApi.joinVoiceChannel.mockResolvedValueOnce(fakeParticipant);
      await useVoiceStore.getState().join("ch-voice");
      const { connectedChannelId, isMuted, isDeafened, isConnecting } =
        useVoiceStore.getState();
      expect(connectedChannelId).toBe("ch-voice");
      expect(isMuted).toBe(false);
      expect(isDeafened).toBe(false);
      expect(isConnecting).toBe(false);
    });

    it("sets error and rethrows on failure", async () => {
      mockApi.joinVoiceChannel.mockRejectedValueOnce(
        new ApiRequestError(403, "Forbidden"),
      );
      await expect(
        useVoiceStore.getState().join("ch-voice"),
      ).rejects.toBeDefined();
      expect(useVoiceStore.getState().error).toBe("Forbidden");
      expect(useVoiceStore.getState().isConnecting).toBe(false);
    });
  });

  describe("leave", () => {
    it("clears connectedChannelId immediately and calls API", async () => {
      useVoiceStore.setState({ connectedChannelId: "ch-voice" });
      mockApi.leaveVoiceChannel.mockResolvedValueOnce(undefined);
      await useVoiceStore.getState().leave();
      expect(useVoiceStore.getState().connectedChannelId).toBeNull();
      expect(useVoiceStore.getState().isMuted).toBe(false);
      expect(useVoiceStore.getState().isDeafened).toBe(false);
      expect(mockApi.leaveVoiceChannel).toHaveBeenCalledWith("ch-voice");
    });

    it("does not rethrow when API call fails", async () => {
      useVoiceStore.setState({ connectedChannelId: "ch-voice" });
      mockApi.leaveVoiceChannel.mockRejectedValueOnce(new Error("Network"));
      await expect(useVoiceStore.getState().leave()).resolves.toBeUndefined();
      // State was still cleared before the failed API call
      expect(useVoiceStore.getState().connectedChannelId).toBeNull();
    });
  });

  describe("toggleMute", () => {
    it("optimistically updates isMuted and calls API", async () => {
      useVoiceStore.setState({
        connectedChannelId: "ch-voice",
        isMuted: false,
      });
      mockApi.updateVoiceState.mockResolvedValueOnce({
        ...fakeParticipant,
        self_mute: true,
      });
      await useVoiceStore.getState().toggleMute();
      expect(mockApi.updateVoiceState).toHaveBeenCalledWith("ch-voice", {
        self_mute: true,
      });
    });

    it("rolls back isMuted on API failure", async () => {
      useVoiceStore.setState({
        connectedChannelId: "ch-voice",
        isMuted: false,
      });
      mockApi.updateVoiceState.mockRejectedValueOnce(new Error("Server error"));
      await expect(useVoiceStore.getState().toggleMute()).rejects.toBeDefined();
      expect(useVoiceStore.getState().isMuted).toBe(false);
    });
  });

  describe("toggleDeafen", () => {
    it("optimistically updates isDeafened and calls API", async () => {
      useVoiceStore.setState({
        connectedChannelId: "ch-voice",
        isDeafened: false,
      });
      mockApi.updateVoiceState.mockResolvedValueOnce({
        ...fakeParticipant,
        self_deaf: true,
      });
      await useVoiceStore.getState().toggleDeafen();
      expect(mockApi.updateVoiceState).toHaveBeenCalledWith("ch-voice", {
        self_deaf: true,
      });
    });

    it("rolls back isDeafened on API failure", async () => {
      useVoiceStore.setState({
        connectedChannelId: "ch-voice",
        isDeafened: false,
      });
      mockApi.updateVoiceState.mockRejectedValueOnce(new Error("Server error"));
      await expect(
        useVoiceStore.getState().toggleDeafen(),
      ).rejects.toBeDefined();
      expect(useVoiceStore.getState().isDeafened).toBe(false);
    });
  });
});
