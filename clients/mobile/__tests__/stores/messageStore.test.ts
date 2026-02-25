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
    listThreadReplies: jest.fn(),
    createThreadReply: jest.fn(),
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
    thread_id: null,
    thread_reply_count: 0,
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
    threadCache: {},
    activeThreadId: null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
  // Return empty attachments by default
  mockApi.listAttachments.mockResolvedValue([]);
  mockApi.listThreadReplies.mockResolvedValue([]);
  mockApi.createThreadReply.mockResolvedValue(makeMessage("reply-default"));
});

describe("messageStore", () => {
  describe("fetchMessages", () => {
    it("loads messages on success", async () => {
      // API returns newest-first (DESC); the store reverses to oldest-first.
      const newestFirst = [makeMessage("2"), makeMessage("1")];
      mockApi.listMessages.mockResolvedValueOnce(newestFirst);
      await useMessageStore.getState().fetchMessages("ch-1");
      const { messages } = useMessageStore.getState();
      expect(messages[0].id).toBe("1");
      expect(messages[1].id).toBe("2");
      expect(useMessageStore.getState().isLoading).toBe(false);
    });

    it("prepends older messages when before cursor is provided", async () => {
      const existing = [makeMessage("3")];
      useMessageStore.setState({ messages: existing });
      // API returns newest-first; store reverses → [msg-1, msg-2] prepended before msg-3.
      const newestFirst = [makeMessage("2"), makeMessage("1")];
      mockApi.listMessages.mockResolvedValueOnce(newestFirst);
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

  describe("threads", () => {
    describe("openThread / closeThread", () => {
      it("sets activeThreadId on openThread", () => {
        useMessageStore.getState().openThread("msg-1");
        expect(useMessageStore.getState().activeThreadId).toBe("msg-1");
      });

      it("clears activeThreadId on closeThread", () => {
        useMessageStore.setState({ activeThreadId: "msg-1" });
        useMessageStore.getState().closeThread();
        expect(useMessageStore.getState().activeThreadId).toBeNull();
      });
    });

    describe("fetchThreadReplies", () => {
      it("populates threadCache on success", async () => {
        const replies = [{ ...makeMessage("r1"), thread_id: "root-1" }];
        mockApi.listThreadReplies.mockResolvedValueOnce(replies);

        await useMessageStore.getState().fetchThreadReplies("ch-1", "root-1");

        expect(useMessageStore.getState().threadCache["root-1"]).toEqual(
          replies,
        );
        expect(useMessageStore.getState().isLoading).toBe(false);
      });

      it("sets error and clears isLoading on failure", async () => {
        mockApi.listThreadReplies.mockRejectedValueOnce(
          new ApiRequestError(500, "Server error"),
        );

        await useMessageStore.getState().fetchThreadReplies("ch-1", "root-1");

        expect(useMessageStore.getState().error).toBe("Server error");
        expect(useMessageStore.getState().isLoading).toBe(false);
      });

      it("clears prior error before fetching", async () => {
        useMessageStore.setState({ error: "old error" });
        let resolvePromise!: () => void;
        mockApi.listThreadReplies.mockReturnValueOnce(
          new Promise<never[]>((res) => {
            resolvePromise = () => res([]);
          }),
        );

        const promise = useMessageStore
          .getState()
          .fetchThreadReplies("ch-1", "root-1");
        expect(useMessageStore.getState().error).toBeNull();
        resolvePromise();
        await promise;
      });
    });

    describe("sendThreadReply", () => {
      it("appends reply to threadCache and bumps root count", async () => {
        const root = makeMessage("root-1");
        const reply = {
          ...makeMessage("reply-1"),
          thread_id: "root-1",
          thread_reply_count: 0,
        };
        useMessageStore.setState({
          messages: [root],
          threadCache: { "root-1": [] },
        });
        mockApi.createThreadReply.mockResolvedValueOnce(reply);

        await useMessageStore
          .getState()
          .sendThreadReply("ch-1", "root-1", "Hello thread");

        const state = useMessageStore.getState();
        expect(state.threadCache["root-1"]).toContainEqual(reply);
        expect(
          state.messages.find((m) => m.id === "root-1")?.thread_reply_count,
        ).toBe(1);
      });

      it("throws and sets error on API failure", async () => {
        mockApi.createThreadReply.mockRejectedValueOnce(
          new ApiRequestError(400, "Bad request"),
        );

        await expect(
          useMessageStore.getState().sendThreadReply("ch-1", "root-1", "Hello"),
        ).rejects.toBeDefined();

        expect(useMessageStore.getState().error).toBe("Bad request");
      });
    });

    describe("addThreadMessage", () => {
      it("appends message to threadCache when cache entry exists", () => {
        const root = makeMessage("root-1");
        const reply = { ...makeMessage("reply-1"), thread_id: "root-1" };
        useMessageStore.setState({
          messages: [root],
          threadCache: { "root-1": [] },
        });

        useMessageStore.getState().addThreadMessage(reply);

        expect(useMessageStore.getState().threadCache["root-1"]).toContainEqual(
          reply,
        );
        expect(useMessageStore.getState().messages[0].thread_reply_count).toBe(
          1,
        );
      });

      it("does not double-count when message already in cache", () => {
        const root = { ...makeMessage("root-1"), thread_reply_count: 1 };
        const reply = { ...makeMessage("reply-1"), thread_id: "root-1" };
        useMessageStore.setState({
          messages: [root],
          threadCache: { "root-1": [reply] },
        });

        useMessageStore.getState().addThreadMessage(reply);

        expect(useMessageStore.getState().threadCache["root-1"]).toHaveLength(
          1,
        );
        expect(useMessageStore.getState().messages[0].thread_reply_count).toBe(
          1,
        );
      });

      it("still increments count even when thread is not open", () => {
        const root = makeMessage("root-1");
        const reply = { ...makeMessage("reply-1"), thread_id: "root-1" };
        useMessageStore.setState({ messages: [root], threadCache: {} });

        useMessageStore.getState().addThreadMessage(reply);

        expect(
          useMessageStore.getState().threadCache["root-1"],
        ).toBeUndefined();
        expect(useMessageStore.getState().messages[0].thread_reply_count).toBe(
          1,
        );
      });

      it("warns and ignores messages with null thread_id", () => {
        const msg = makeMessage("msg-1");
        const warnSpy = jest
          .spyOn(console, "warn")
          .mockImplementation(() => undefined);

        useMessageStore.getState().addThreadMessage(msg);

        expect(warnSpy).toHaveBeenCalled();
        expect(useMessageStore.getState().threadCache).toEqual({});
        warnSpy.mockRestore();
      });
    });
  });
});
