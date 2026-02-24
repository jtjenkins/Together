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
  });
  vi.clearAllMocks();
  vi.mocked(api.listAttachments).mockResolvedValue([]);
  vi.mocked(api.uploadAttachments).mockResolvedValue([]);
});

describe("messageStore", () => {
  describe("fetchMessages", () => {
    it("should fetch and store messages", async () => {
      const messages = [mockMsg({ id: "msg-1" }), mockMsg({ id: "msg-2" })];
      vi.mocked(api.listMessages).mockResolvedValueOnce(messages);

      await useMessageStore.getState().fetchMessages("ch-1");

      expect(api.listMessages).toHaveBeenCalledWith("ch-1", {
        before: undefined,
        limit: 50,
      });
      expect(useMessageStore.getState().messages).toEqual(messages);
      expect(useMessageStore.getState().hasMore).toBe(false);
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
});
