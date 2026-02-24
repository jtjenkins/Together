import { useMessageStore } from "../../src/stores/messageStore";
import { api, ApiRequestError } from "../../src/api/client";

jest.mock("../../src/api/client", () => ({
  api: {
    listMessages: jest.fn(),
    createMessage: jest.fn(),
    updateMessage: jest.fn(),
    deleteMessage: jest.fn(),
    uploadAttachments: jest.fn(),
    listAttachments: jest.fn(),
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

function makeMessage(id: string, channelId = "ch-1", content = "Hello") {
  return {
    id,
    channel_id: channelId,
    author_id: "u1",
    content,
    reply_to: null,
    mention_user_ids: [] as string[],
    mention_everyone: false,
    edited_at: null,
    deleted: false,
    created_at: `2024-01-0${id}`,
  };
}

function resetStore() {
  useMessageStore.setState({
    messages: [],
    isLoading: false,
    hasMore: true,
    error: null,
    replyingTo: null,
    attachmentCache: {},
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
  // Return empty attachments by default
  mockApi.listAttachments.mockResolvedValue([]);
});

describe("messageStore", () => {
  describe("fetchMessages", () => {
    it("loads messages on success", async () => {
      const msgs = [makeMessage("1"), makeMessage("2")];
      mockApi.listMessages.mockResolvedValueOnce(msgs);
      await useMessageStore.getState().fetchMessages("ch-1");
      expect(useMessageStore.getState().messages).toEqual(msgs);
      expect(useMessageStore.getState().isLoading).toBe(false);
    });

    it("prepends older messages when before cursor is provided", async () => {
      const existing = [makeMessage("3")];
      useMessageStore.setState({ messages: existing });
      const older = [makeMessage("1"), makeMessage("2")];
      mockApi.listMessages.mockResolvedValueOnce(older);
      await useMessageStore.getState().fetchMessages("ch-1", "msg-3");
      const { messages } = useMessageStore.getState();
      expect(messages[0].id).toBe("1");
      expect(messages[messages.length - 1].id).toBe("3");
    });

    it("sets hasMore=false when fewer than 50 messages returned", async () => {
      mockApi.listMessages.mockResolvedValueOnce([makeMessage("1")]);
      await useMessageStore.getState().fetchMessages("ch-1");
      expect(useMessageStore.getState().hasMore).toBe(false);
    });
  });

  describe("addMessage", () => {
    it("appends a new message", () => {
      const msg = makeMessage("1");
      useMessageStore.getState().addMessage(msg);
      expect(useMessageStore.getState().messages).toContainEqual(msg);
    });

    it("does not add duplicate messages", () => {
      const msg = makeMessage("1");
      useMessageStore.getState().addMessage(msg);
      useMessageStore.getState().addMessage(msg);
      expect(useMessageStore.getState().messages).toHaveLength(1);
    });
  });

  describe("removeMessage", () => {
    it("marks the message as deleted with empty content", () => {
      const msg = makeMessage("1");
      useMessageStore.setState({ messages: [msg] });
      useMessageStore.getState().removeMessage({ id: "1", channel_id: "ch-1" });
      const updated = useMessageStore.getState().messages[0];
      expect(updated.deleted).toBe(true);
      expect(updated.content).toBe("");
    });
  });

  describe("sendMessage", () => {
    it("creates a message successfully", async () => {
      const created = makeMessage("10");
      mockApi.createMessage.mockResolvedValueOnce(created);
      await useMessageStore
        .getState()
        .sendMessage("ch-1", { content: "Hello" });
      expect(mockApi.createMessage).toHaveBeenCalledWith("ch-1", {
        content: "Hello",
      });
    });

    it("sets error state on createMessage failure", async () => {
      mockApi.createMessage.mockRejectedValueOnce(
        new ApiRequestError(400, "Bad request"),
      );
      await expect(
        useMessageStore.getState().sendMessage("ch-1", { content: "Hi" }),
      ).rejects.toBeDefined();
      expect(useMessageStore.getState().error).toBe("Bad request");
    });

    it("sets error when file upload fails but message is created", async () => {
      const created = makeMessage("11");
      mockApi.createMessage.mockResolvedValueOnce(created);
      mockApi.uploadAttachments.mockRejectedValueOnce(new Error("Upload fail"));
      await useMessageStore
        .getState()
        .sendMessage("ch-1", { content: "With file" }, [
          { uri: "file://img.jpg", name: "img.jpg", type: "image/jpeg" },
        ]);
      expect(useMessageStore.getState().error).toContain("upload failed");
    });
  });

  describe("editMessage", () => {
    it("updates message content in state", async () => {
      const original = makeMessage("5");
      useMessageStore.setState({ messages: [original] });
      const updated = { ...original, content: "Updated" };
      mockApi.updateMessage.mockResolvedValueOnce(updated);
      await useMessageStore.getState().editMessage("5", "Updated");
      expect(useMessageStore.getState().messages[0].content).toBe("Updated");
    });
  });
});
