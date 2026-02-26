import { describe, it, expect, vi, beforeEach } from "vitest";
import { useMessageStore } from "../stores/messageStore";
import { api } from "../api/client";
import type { Message } from "../types";

vi.mock("../api/client", () => ({
  api: {
    listMessages: vi.fn(),
    createMessage: vi.fn(),
    updateMessage: vi.fn(),
    deleteMessage: vi.fn(),
    listAttachments: vi.fn().mockResolvedValue([]),
    uploadAttachments: vi.fn().mockResolvedValue([]),
    listThreadReplies: vi.fn(),
    createThreadReply: vi.fn(),
  },
  ApiRequestError: class extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const mockMsg = (overrides: Partial<Message> = {}): Message => ({
  id: "msg-1",
  channel_id: "ch-1",
  author_id: "user-1",
  content: "Hello world",
  reply_to: null,
  mention_user_ids: [],
  mention_everyone: false,
  thread_id: null,
  thread_reply_count: 0,
  edited_at: null,
  deleted: false,
  created_at: "2024-01-01T00:00:00Z",
  ...overrides,
});

const mockAttachment = () => ({
  id: "att-1",
  message_id: "msg-1",
  filename: "image.png",
  file_size: 1024,
  mime_type: "image/png",
  url: "/files/image.png",
  width: 800 as const,
  height: 600 as const,
  created_at: "2024-01-01T00:00:00Z",
});

beforeEach(() => {
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
  vi.clearAllMocks();
  vi.mocked(api.listAttachments).mockResolvedValue([]);
  vi.mocked(api.uploadAttachments).mockResolvedValue([]);
  vi.mocked(api.listThreadReplies).mockResolvedValue([]);
  vi.mocked(api.createThreadReply).mockResolvedValue(mockMsg());
});

describe("messageStore", () => {
  describe("fetchMessages", () => {
    it("should fetch and store messages (oldest-first after reversal)", async () => {
      // API returns newest-first (DESC); the store must reverse to oldest-first.
      const newestFirst = [
        mockMsg({ id: "msg-2", created_at: "2024-01-01T00:00:02Z" }),
        mockMsg({ id: "msg-1", created_at: "2024-01-01T00:00:01Z" }),
      ];
      vi.mocked(api.listMessages).mockResolvedValueOnce(newestFirst);

      await useMessageStore.getState().fetchMessages("ch-1");

      expect(api.listMessages).toHaveBeenCalledWith("ch-1", {
        before: undefined,
        limit: 50,
      });
      const stored = useMessageStore.getState().messages;
      expect(stored[0].id).toBe("msg-1");
      expect(stored[1].id).toBe("msg-2");
      expect(useMessageStore.getState().hasMore).toBe(false);
    });

    it("should reverse API response so store holds oldest-first", async () => {
      // API returns newest-first (DESC); the store must reverse to oldest-first
      // to match the append order used by addMessage() for WebSocket events.
      const newestFirst = [
        mockMsg({ id: "msg-2", created_at: "2024-01-01T00:00:02Z" }),
        mockMsg({ id: "msg-1", created_at: "2024-01-01T00:00:01Z" }),
      ];
      vi.mocked(api.listMessages).mockResolvedValueOnce(newestFirst);

      await useMessageStore.getState().fetchMessages("ch-1");

      const stored = useMessageStore.getState().messages;
      expect(stored[0].id).toBe("msg-1");
      expect(stored[1].id).toBe("msg-2");
    });

    it("should set hasMore to true when 50 messages returned", async () => {
      const messages = Array.from({ length: 50 }, (_, i) =>
        mockMsg({ id: `msg-${i}` }),
      );
      vi.mocked(api.listMessages).mockResolvedValueOnce(messages);

      await useMessageStore.getState().fetchMessages("ch-1");

      expect(useMessageStore.getState().hasMore).toBe(true);
    });

    it("should prepend messages when loading older", async () => {
      const existing = [mockMsg({ id: "msg-2" })];
      useMessageStore.setState({ messages: existing });

      const older = [mockMsg({ id: "msg-1" })];
      vi.mocked(api.listMessages).mockResolvedValueOnce(older);

      await useMessageStore.getState().fetchMessages("ch-1", "msg-2");

      expect(useMessageStore.getState().messages).toHaveLength(2);
      expect(useMessageStore.getState().messages[0].id).toBe("msg-1");
    });
  });

  describe("addMessage", () => {
    it("should add a new message", () => {
      const msg = mockMsg();
      useMessageStore.getState().addMessage(msg);
      expect(useMessageStore.getState().messages).toEqual([msg]);
    });

    it("should not add duplicate messages", () => {
      const msg = mockMsg();
      useMessageStore.getState().addMessage(msg);
      useMessageStore.getState().addMessage(msg);
      expect(useMessageStore.getState().messages).toHaveLength(1);
    });
  });

  describe("updateMessage", () => {
    it("should update an existing message", () => {
      const msg = mockMsg();
      useMessageStore.setState({ messages: [msg] });

      const updated = {
        ...msg,
        content: "Updated",
        edited_at: "2024-01-01T00:01:00Z",
      };
      useMessageStore.getState().updateMessage(updated);

      expect(useMessageStore.getState().messages[0].content).toBe("Updated");
      expect(useMessageStore.getState().messages[0].edited_at).not.toBeNull();
    });
  });

  describe("removeMessage", () => {
    it("should mark a message as deleted", () => {
      const msg = mockMsg();
      useMessageStore.setState({ messages: [msg] });

      useMessageStore
        .getState()
        .removeMessage({ id: msg.id, channel_id: msg.channel_id });

      expect(useMessageStore.getState().messages[0].deleted).toBe(true);
      expect(useMessageStore.getState().messages[0].content).toBe("");
    });
  });

  describe("setReplyingTo", () => {
    it("should set replying to a message", () => {
      const msg = mockMsg();
      useMessageStore.getState().setReplyingTo(msg);
      expect(useMessageStore.getState().replyingTo).toEqual(msg);
    });

    it("should clear replying to", () => {
      useMessageStore.getState().setReplyingTo(mockMsg());
      useMessageStore.getState().setReplyingTo(null);
      expect(useMessageStore.getState().replyingTo).toBeNull();
    });
  });

  describe("clearMessages", () => {
    it("should clear all messages and reset state", () => {
      useMessageStore.setState({
        messages: [mockMsg()],
        hasMore: false,
        replyingTo: mockMsg(),
      });

      useMessageStore.getState().clearMessages();

      expect(useMessageStore.getState().messages).toEqual([]);
      expect(useMessageStore.getState().hasMore).toBe(true);
      expect(useMessageStore.getState().replyingTo).toBeNull();
    });
  });

  describe("sendMessage", () => {
    it("should call createMessage API and clear reply", async () => {
      vi.mocked(api.createMessage).mockResolvedValueOnce(mockMsg());
      useMessageStore.setState({ replyingTo: mockMsg({ id: "reply-target" }) });

      await useMessageStore
        .getState()
        .sendMessage("ch-1", { content: "Hello" });

      expect(api.createMessage).toHaveBeenCalledWith("ch-1", {
        content: "Hello",
      });
      expect(useMessageStore.getState().replyingTo).toBeNull();
    });
  });

  describe("editMessage", () => {
    it("should update message content via API", async () => {
      const msg = mockMsg();
      useMessageStore.setState({ messages: [msg] });

      const updated = {
        ...msg,
        content: "Edited",
        edited_at: "2024-01-01T00:01:00Z",
      };
      vi.mocked(api.updateMessage).mockResolvedValueOnce(updated);

      await useMessageStore.getState().editMessage("msg-1", "Edited");

      expect(api.updateMessage).toHaveBeenCalledWith("msg-1", {
        content: "Edited",
      });
      expect(useMessageStore.getState().messages[0].content).toBe("Edited");
    });
  });

  describe("attachments", () => {
    it("should populate attachmentCache when fetching messages with attachments", async () => {
      const messages = [mockMsg({ id: "msg-1" })];
      const attachment = mockAttachment();
      vi.mocked(api.listMessages).mockResolvedValueOnce(messages);
      vi.mocked(api.listAttachments).mockResolvedValueOnce([attachment]);

      await useMessageStore.getState().fetchMessages("ch-1");

      expect(api.listAttachments).toHaveBeenCalledWith("msg-1");
      expect(useMessageStore.getState().attachmentCache["msg-1"]).toEqual([
        attachment,
      ]);
    });

    it("should not add empty attachment arrays to cache", async () => {
      const messages = [mockMsg({ id: "msg-1" })];
      vi.mocked(api.listMessages).mockResolvedValueOnce(messages);
      vi.mocked(api.listAttachments).mockResolvedValueOnce([]);

      await useMessageStore.getState().fetchMessages("ch-1");

      expect(
        useMessageStore.getState().attachmentCache["msg-1"],
      ).toBeUndefined();
    });

    it("should upload attachments and cache them when sending with files", async () => {
      const msg = mockMsg({ id: "msg-1" });
      const attachment = mockAttachment();
      vi.mocked(api.createMessage).mockResolvedValueOnce(msg);
      vi.mocked(api.uploadAttachments).mockResolvedValueOnce([attachment]);

      const file = new File(["data"], "image.png", { type: "image/png" });
      await useMessageStore
        .getState()
        .sendMessage("ch-1", { content: "Hi" }, [file]);

      expect(api.uploadAttachments).toHaveBeenCalledWith("msg-1", [file]);
      expect(useMessageStore.getState().attachmentCache["msg-1"]).toEqual([
        attachment,
      ]);
    });

    it("should set error but not throw when upload fails after message is sent", async () => {
      const msg = mockMsg({ id: "msg-1" });
      vi.mocked(api.createMessage).mockResolvedValueOnce(msg);
      vi.mocked(api.uploadAttachments).mockRejectedValueOnce(
        new Error("Network error"),
      );

      const file = new File(["data"], "image.png", { type: "image/png" });
      await expect(
        useMessageStore
          .getState()
          .sendMessage("ch-1", { content: "Hi" }, [file]),
      ).resolves.toBeUndefined();

      expect(useMessageStore.getState().error).toBeTruthy();
    });

    it("should clear attachmentCache on clearMessages", () => {
      useMessageStore.setState({
        attachmentCache: { "msg-1": [mockAttachment()] },
      });

      useMessageStore.getState().clearMessages();

      expect(useMessageStore.getState().attachmentCache).toEqual({});
    });
  });

  describe("threads", () => {
    describe("openThread / closeThread", () => {
      it("should set activeThreadId on openThread", () => {
        useMessageStore.getState().openThread("msg-1");
        expect(useMessageStore.getState().activeThreadId).toBe("msg-1");
      });

      it("should clear activeThreadId on closeThread", () => {
        useMessageStore.setState({ activeThreadId: "msg-1" });
        useMessageStore.getState().closeThread();
        expect(useMessageStore.getState().activeThreadId).toBeNull();
      });
    });

    describe("fetchThreadReplies", () => {
      it("should populate threadCache on success", async () => {
        const replies = [mockMsg({ id: "reply-1", thread_id: "root-1" })];
        vi.mocked(api.listThreadReplies).mockResolvedValueOnce(replies);

        await useMessageStore.getState().fetchThreadReplies("ch-1", "root-1");

        expect(api.listThreadReplies).toHaveBeenCalledWith("ch-1", "root-1");
        expect(useMessageStore.getState().threadCache["root-1"]).toEqual(
          replies,
        );
        expect(useMessageStore.getState().isLoading).toBe(false);
      });

      it("should set error and clear isLoading on failure", async () => {
        vi.mocked(api.listThreadReplies).mockRejectedValueOnce(
          new Error("Network error"),
        );

        await useMessageStore.getState().fetchThreadReplies("ch-1", "root-1");

        expect(useMessageStore.getState().error).toBeTruthy();
        expect(useMessageStore.getState().isLoading).toBe(false);
      });

      it("should clear prior error before fetching", async () => {
        useMessageStore.setState({ error: "old error" });
        vi.mocked(api.listThreadReplies).mockResolvedValueOnce([]);

        // Don't await — check state during the async gap
        const promise = useMessageStore
          .getState()
          .fetchThreadReplies("ch-1", "root-1");
        expect(useMessageStore.getState().error).toBeNull();
        await promise;
      });
    });

    describe("sendThreadReply", () => {
      it("should append reply to threadCache and bump root message count", async () => {
        const root = mockMsg({ id: "root-1", thread_reply_count: 0 });
        const reply = mockMsg({
          id: "reply-1",
          thread_id: "root-1",
          thread_reply_count: 0,
        });
        useMessageStore.setState({
          messages: [root],
          threadCache: { "root-1": [] },
        });
        vi.mocked(api.createThreadReply).mockResolvedValueOnce(reply);

        await useMessageStore
          .getState()
          .sendThreadReply("ch-1", "root-1", "Hello thread");

        const state = useMessageStore.getState();
        expect(state.threadCache["root-1"]).toContainEqual(reply);
        expect(
          state.messages.find((m) => m.id === "root-1")?.thread_reply_count,
        ).toBe(1);
      });

      it("should throw and set error on API failure", async () => {
        vi.mocked(api.createThreadReply).mockRejectedValueOnce(
          new Error("Server error"),
        );

        await expect(
          useMessageStore.getState().sendThreadReply("ch-1", "root-1", "Hello"),
        ).rejects.toBeDefined();

        expect(useMessageStore.getState().error).toBeTruthy();
      });
    });

    describe("addThreadMessage", () => {
      it("should append message to threadCache when cache entry exists", () => {
        const root = mockMsg({ id: "root-1", thread_reply_count: 0 });
        const reply = mockMsg({ id: "reply-1", thread_id: "root-1" });
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

      it("should not append duplicate messages to threadCache", () => {
        const root = mockMsg({ id: "root-1", thread_reply_count: 1 });
        const reply = mockMsg({ id: "reply-1", thread_id: "root-1" });
        useMessageStore.setState({
          messages: [root],
          threadCache: { "root-1": [reply] },
        });

        useMessageStore.getState().addThreadMessage(reply);

        expect(useMessageStore.getState().threadCache["root-1"]).toHaveLength(
          1,
        );
        // Count must not increase again — the message was already cached
        expect(useMessageStore.getState().messages[0].thread_reply_count).toBe(
          1,
        );
      });

      it("should not create cache entry when thread is not open", () => {
        const root = mockMsg({ id: "root-1", thread_reply_count: 0 });
        const reply = mockMsg({ id: "reply-1", thread_id: "root-1" });
        useMessageStore.setState({ messages: [root], threadCache: {} });

        useMessageStore.getState().addThreadMessage(reply);

        expect(
          useMessageStore.getState().threadCache["root-1"],
        ).toBeUndefined();
        // Count still increments so the thread footer badge stays accurate
        expect(useMessageStore.getState().messages[0].thread_reply_count).toBe(
          1,
        );
      });

      it("should ignore messages with null thread_id", () => {
        const msg = mockMsg({ id: "msg-1", thread_id: null });
        const consoleSpy = vi
          .spyOn(console, "warn")
          .mockImplementation(() => undefined);

        useMessageStore.getState().addThreadMessage(msg);

        expect(consoleSpy).toHaveBeenCalled();
        expect(useMessageStore.getState().threadCache).toEqual({});
        consoleSpy.mockRestore();
      });
    });
  });
});
