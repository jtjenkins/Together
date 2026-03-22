import { describe, it, expect, vi, beforeEach } from "vitest";
import { useMessageStore } from "../stores/messageStore";
import { api } from "../api/client";
import type { Message, PollDto } from "../types";

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
    getMessage: vi.fn(),
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
  pinned: false,
  pinned_by: null,
  pinned_at: null,
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
    replyTargetCache: {},
    highlightedMessageId: null,
    threadCache: {},
    activeThreadId: null,
    isThreadLoading: false,
    threadError: null,
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

    it("should set isLoading true before fetching", async () => {
      vi.mocked(api.listMessages).mockImplementation(async () => {
        expect(useMessageStore.getState().isLoading).toBe(true);
        return [];
      });

      await useMessageStore.getState().fetchMessages("ch-1");
    });

    it("should set error and isLoading false on fetch failure with generic Error", async () => {
      vi.mocked(api.listMessages).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await useMessageStore.getState().fetchMessages("ch-1");

      expect(useMessageStore.getState().error).toBe("Failed to fetch messages");
      expect(useMessageStore.getState().isLoading).toBe(false);
    });

    it("should extract message from ApiRequestError on fetch failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.listMessages).mockRejectedValueOnce(
        new MockApiRequestError(500, "Server error"),
      );

      await useMessageStore.getState().fetchMessages("ch-1");

      expect(useMessageStore.getState().error).toBe("Server error");
    });

    it("should handle rejected attachment fetches gracefully", async () => {
      const consoleSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const messages = [mockMsg({ id: "msg-1" })];
      vi.mocked(api.listMessages).mockResolvedValueOnce(messages);
      vi.mocked(api.listAttachments).mockRejectedValueOnce(
        new Error("Attachment fetch failed"),
      );

      await useMessageStore.getState().fetchMessages("ch-1");

      // Should not throw — attachment failures are non-fatal
      expect(
        useMessageStore.getState().attachmentCache["msg-1"],
      ).toBeUndefined();
      consoleSpy.mockRestore();
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

    it("should not modify other messages", () => {
      const msg1 = mockMsg({ id: "msg-1", content: "First" });
      const msg2 = mockMsg({ id: "msg-2", content: "Second" });
      useMessageStore.setState({ messages: [msg1, msg2] });

      const updated = { ...msg1, content: "Updated" };
      useMessageStore.getState().updateMessage(updated);

      expect(useMessageStore.getState().messages[0].content).toBe("Updated");
      expect(useMessageStore.getState().messages[1].content).toBe("Second");
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

    it("should not modify other messages", () => {
      const msg1 = mockMsg({ id: "msg-1" });
      const msg2 = mockMsg({ id: "msg-2", content: "Keep me" });
      useMessageStore.setState({ messages: [msg1, msg2] });

      useMessageStore
        .getState()
        .removeMessage({ id: "msg-1", channel_id: "ch-1" });

      expect(useMessageStore.getState().messages[1].deleted).toBe(false);
      expect(useMessageStore.getState().messages[1].content).toBe("Keep me");
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
        attachmentCache: { "msg-1": [mockAttachment()] },
        replyTargetCache: { "msg-reply": mockMsg({ id: "msg-reply" }) },
        highlightedMessageId: "msg-1",
        threadCache: {
          "root-1": [mockMsg({ id: "reply-1", thread_id: "root-1" })],
        },
        activeThreadId: "root-1",
      });

      useMessageStore.getState().clearMessages();

      expect(useMessageStore.getState().messages).toEqual([]);
      expect(useMessageStore.getState().hasMore).toBe(true);
      expect(useMessageStore.getState().replyingTo).toBeNull();
      expect(useMessageStore.getState().attachmentCache).toEqual({});
      expect(useMessageStore.getState().replyTargetCache).toEqual({});
      expect(useMessageStore.getState().highlightedMessageId).toBeNull();
      expect(useMessageStore.getState().threadCache).toEqual({});
      expect(useMessageStore.getState().activeThreadId).toBeNull();
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

    it("should set error and re-throw on sendMessage failure with generic Error", async () => {
      vi.mocked(api.createMessage).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await expect(
        useMessageStore.getState().sendMessage("ch-1", { content: "Hi" }),
      ).rejects.toBeDefined();

      expect(useMessageStore.getState().error).toBe("Failed to send message");
    });

    it("should extract message from ApiRequestError on send failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.createMessage).mockRejectedValueOnce(
        new MockApiRequestError(403, "Timed out"),
      );

      await expect(
        useMessageStore.getState().sendMessage("ch-1", { content: "Hi" }),
      ).rejects.toBeDefined();

      expect(useMessageStore.getState().error).toBe("Timed out");
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

    it("should set error and re-throw on edit failure with generic Error", async () => {
      vi.mocked(api.updateMessage).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await expect(
        useMessageStore.getState().editMessage("msg-1", "Edited"),
      ).rejects.toBeDefined();

      expect(useMessageStore.getState().error).toBe("Failed to edit message");
    });

    it("should extract message from ApiRequestError on edit failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.updateMessage).mockRejectedValueOnce(
        new MockApiRequestError(403, "Not your message"),
      );

      await expect(
        useMessageStore.getState().editMessage("msg-1", "Edited"),
      ).rejects.toBeDefined();

      expect(useMessageStore.getState().error).toBe("Not your message");
    });
  });

  describe("deleteMessage", () => {
    it("should call api.deleteMessage", async () => {
      vi.mocked(api.deleteMessage).mockResolvedValueOnce(undefined);

      await useMessageStore.getState().deleteMessage("msg-1");

      expect(api.deleteMessage).toHaveBeenCalledWith("msg-1");
    });

    it("should set error and re-throw on delete failure with generic Error", async () => {
      vi.mocked(api.deleteMessage).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await expect(
        useMessageStore.getState().deleteMessage("msg-1"),
      ).rejects.toBeDefined();

      expect(useMessageStore.getState().error).toBe("Failed to delete message");
    });

    it("should extract message from ApiRequestError on delete failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      vi.mocked(api.deleteMessage).mockRejectedValueOnce(
        new MockApiRequestError(403, "Not allowed"),
      );

      await expect(
        useMessageStore.getState().deleteMessage("msg-1"),
      ).rejects.toBeDefined();

      expect(useMessageStore.getState().error).toBe("Not allowed");
    });
  });

  describe("cacheAttachments", () => {
    it("should store attachments in the cache keyed by message ID", () => {
      const attachments = [mockAttachment()];

      useMessageStore.getState().cacheAttachments("msg-1", attachments);

      expect(useMessageStore.getState().attachmentCache["msg-1"]).toEqual(
        attachments,
      );
    });

    it("should merge with existing cache entries", () => {
      useMessageStore.setState({
        attachmentCache: { "msg-existing": [mockAttachment()] },
      });
      const newAttachments = [
        { ...mockAttachment(), id: "att-2", message_id: "msg-2" },
      ];

      useMessageStore.getState().cacheAttachments("msg-2", newAttachments);

      expect(
        useMessageStore.getState().attachmentCache["msg-existing"],
      ).toBeDefined();
      expect(useMessageStore.getState().attachmentCache["msg-2"]).toBeDefined();
    });
  });

  describe("ensureReplyTarget", () => {
    it("should fetch and cache a message not in the main list", async () => {
      const replyTarget = mockMsg({ id: "msg-reply", content: "Original" });
      vi.mocked(api.getMessage).mockResolvedValueOnce(replyTarget);

      await useMessageStore.getState().ensureReplyTarget("ch-1", "msg-reply");

      expect(api.getMessage).toHaveBeenCalledWith("ch-1", "msg-reply");
      expect(useMessageStore.getState().replyTargetCache["msg-reply"]).toEqual(
        replyTarget,
      );
    });

    it("should skip fetch if message is already in main list", async () => {
      const msg = mockMsg({ id: "msg-1" });
      useMessageStore.setState({ messages: [msg] });

      await useMessageStore.getState().ensureReplyTarget("ch-1", "msg-1");

      expect(api.getMessage).not.toHaveBeenCalled();
    });

    it("should skip fetch if message is already in reply cache", async () => {
      const cached = mockMsg({ id: "msg-reply" });
      useMessageStore.setState({
        replyTargetCache: { "msg-reply": cached },
      });

      await useMessageStore.getState().ensureReplyTarget("ch-1", "msg-reply");

      expect(api.getMessage).not.toHaveBeenCalled();
    });

    it("should not throw on API failure (non-fatal)", async () => {
      vi.mocked(api.getMessage).mockRejectedValueOnce(new Error("Not found"));

      await expect(
        useMessageStore.getState().ensureReplyTarget("ch-1", "msg-missing"),
      ).resolves.toBeUndefined();
    });
  });

  describe("setHighlightedMessageId", () => {
    it("should set the highlighted message ID", () => {
      useMessageStore.getState().setHighlightedMessageId("msg-1");
      expect(useMessageStore.getState().highlightedMessageId).toBe("msg-1");
    });

    it("should clear the highlighted message ID", () => {
      useMessageStore.setState({ highlightedMessageId: "msg-1" });
      useMessageStore.getState().setHighlightedMessageId(null);
      expect(useMessageStore.getState().highlightedMessageId).toBeNull();
    });
  });

  describe("updateMessagePoll", () => {
    it("should update the poll on a matching message", () => {
      const poll: PollDto = {
        id: "poll-1",
        question: "Yes?",
        options: [],
        total_votes: 0,
        user_vote: null,
      };
      const msg = mockMsg({ id: "msg-1", poll });
      useMessageStore.setState({ messages: [msg] });

      const updatedPoll: PollDto = { ...poll, total_votes: 1 };
      useMessageStore.getState().updateMessagePoll("poll-1", updatedPoll);

      expect(useMessageStore.getState().messages[0].poll?.total_votes).toBe(1);
    });

    it("should not modify messages without the matching poll ID", () => {
      const msg = mockMsg({ id: "msg-1" }); // no poll
      useMessageStore.setState({ messages: [msg] });

      useMessageStore.getState().updateMessagePoll("poll-nonexistent", {
        id: "poll-nonexistent",
        question: "Q?",
        options: [],
        total_votes: 0,
        user_vote: null,
      });

      expect(useMessageStore.getState().messages[0].poll).toBeUndefined();
    });
  });

  describe("updatePinnedStatus", () => {
    it("should set pinned to true for the matching message", () => {
      const msg = mockMsg({
        id: "msg-1",
        pinned: false,
        pinned_by: null,
        pinned_at: null,
      });
      useMessageStore.setState({ messages: [msg] });

      useMessageStore.getState().updatePinnedStatus("msg-1", true);

      expect(useMessageStore.getState().messages[0].pinned).toBe(true);
    });

    it("should set pinned to false and clear pinned_by and pinned_at", () => {
      const msg = mockMsg({
        id: "msg-1",
        pinned: true,
        pinned_by: "user-1",
        pinned_at: "2024-06-01T00:00:00Z",
      });
      useMessageStore.setState({ messages: [msg] });

      useMessageStore.getState().updatePinnedStatus("msg-1", false);

      const updated = useMessageStore.getState().messages[0];
      expect(updated.pinned).toBe(false);
      expect(updated.pinned_by).toBeNull();
      expect(updated.pinned_at).toBeNull();
    });

    it("should not modify other messages", () => {
      const msg1 = mockMsg({ id: "msg-1", pinned: false });
      const msg2 = mockMsg({ id: "msg-2", pinned: false });
      useMessageStore.setState({ messages: [msg1, msg2] });

      useMessageStore.getState().updatePinnedStatus("msg-1", true);

      expect(useMessageStore.getState().messages[1].pinned).toBe(false);
    });
  });

  describe("clearError", () => {
    it("should clear the error", () => {
      useMessageStore.setState({ error: "Some error" });

      useMessageStore.getState().clearError();

      expect(useMessageStore.getState().error).toBeNull();
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

    it("should extract ApiRequestError message on upload failure", async () => {
      const { ApiRequestError: MockApiRequestError } = await import(
        "../api/client"
      );
      const msg = mockMsg({ id: "msg-1" });
      vi.mocked(api.createMessage).mockResolvedValueOnce(msg);
      vi.mocked(api.uploadAttachments).mockRejectedValueOnce(
        new MockApiRequestError(413, "File too large"),
      );

      const file = new File(["data"], "big.bin", {
        type: "application/octet-stream",
      });
      await useMessageStore
        .getState()
        .sendMessage("ch-1", { content: "Hi" }, [file]);

      expect(useMessageStore.getState().error).toBe("File too large");
    });

    it("should not call uploadAttachments when no files provided", async () => {
      vi.mocked(api.createMessage).mockResolvedValueOnce(mockMsg());

      await useMessageStore.getState().sendMessage("ch-1", { content: "Hi" });

      expect(api.uploadAttachments).not.toHaveBeenCalled();
    });

    it("should not call uploadAttachments when files array is empty", async () => {
      vi.mocked(api.createMessage).mockResolvedValueOnce(mockMsg());

      await useMessageStore
        .getState()
        .sendMessage("ch-1", { content: "Hi" }, []);

      expect(api.uploadAttachments).not.toHaveBeenCalled();
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
        expect(useMessageStore.getState().isThreadLoading).toBe(false);
      });

      it("should set threadError and clear isThreadLoading on failure", async () => {
        vi.mocked(api.listThreadReplies).mockRejectedValueOnce(
          new Error("Network error"),
        );

        await useMessageStore.getState().fetchThreadReplies("ch-1", "root-1");

        expect(useMessageStore.getState().threadError).toBeTruthy();
        expect(useMessageStore.getState().isThreadLoading).toBe(false);
      });

      it("should extract message from ApiRequestError on thread fetch failure", async () => {
        const { ApiRequestError: MockApiRequestError } = await import(
          "../api/client"
        );
        vi.mocked(api.listThreadReplies).mockRejectedValueOnce(
          new MockApiRequestError(404, "Thread not found"),
        );

        await useMessageStore.getState().fetchThreadReplies("ch-1", "root-1");

        expect(useMessageStore.getState().threadError).toBe("Thread not found");
      });

      it("should clear prior threadError before fetching", async () => {
        useMessageStore.setState({ threadError: "old error" });
        vi.mocked(api.listThreadReplies).mockResolvedValueOnce([]);

        const promise = useMessageStore
          .getState()
          .fetchThreadReplies("ch-1", "root-1");
        expect(useMessageStore.getState().threadError).toBeNull();
        await promise;
      });

      it("should set isThreadLoading true before fetching", async () => {
        vi.mocked(api.listThreadReplies).mockImplementation(async () => {
          expect(useMessageStore.getState().isThreadLoading).toBe(true);
          return [];
        });

        await useMessageStore.getState().fetchThreadReplies("ch-1", "root-1");
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

      it("should create threadCache entry from ?? [] when messageId not pre-populated", async () => {
        const reply = mockMsg({ id: "reply-1", thread_id: "root-1" });
        useMessageStore.setState({ threadCache: {} });
        vi.mocked(api.createThreadReply).mockResolvedValueOnce(reply);

        await useMessageStore
          .getState()
          .sendThreadReply("ch-1", "root-1", "Hello thread");

        expect(useMessageStore.getState().threadCache["root-1"]).toContainEqual(
          reply,
        );
      });

      it("should not duplicate reply if already in cache", async () => {
        const reply = mockMsg({ id: "reply-1", thread_id: "root-1" });
        const root = mockMsg({ id: "root-1", thread_reply_count: 1 });
        useMessageStore.setState({
          messages: [root],
          threadCache: { "root-1": [reply] },
        });
        vi.mocked(api.createThreadReply).mockResolvedValueOnce(reply);

        await useMessageStore
          .getState()
          .sendThreadReply("ch-1", "root-1", "Hello again");

        expect(useMessageStore.getState().threadCache["root-1"]).toHaveLength(
          1,
        );
        // Count should not change since reply was already cached
        expect(useMessageStore.getState().messages[0].thread_reply_count).toBe(
          1,
        );
      });

      it("should throw and set error on API failure", async () => {
        vi.mocked(api.createThreadReply).mockRejectedValueOnce(
          new Error("Server error"),
        );

        await expect(
          useMessageStore.getState().sendThreadReply("ch-1", "root-1", "Hello"),
        ).rejects.toBeDefined();

        expect(useMessageStore.getState().error).toBe(
          "Failed to send thread reply",
        );
      });

      it("should extract message from ApiRequestError on send reply failure", async () => {
        const { ApiRequestError: MockApiRequestError } = await import(
          "../api/client"
        );
        vi.mocked(api.createThreadReply).mockRejectedValueOnce(
          new MockApiRequestError(403, "Thread locked"),
        );

        await expect(
          useMessageStore.getState().sendThreadReply("ch-1", "root-1", "Hello"),
        ).rejects.toBeDefined();

        expect(useMessageStore.getState().error).toBe("Thread locked");
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
