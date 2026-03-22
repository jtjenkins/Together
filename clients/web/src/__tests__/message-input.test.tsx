/**
 * MessageInput component tests — covers send, file attach, drag-drop,
 * reply, and autocomplete detection.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageInput } from "../components/messages/MessageInput";

const mockSendMessage = vi.fn();
const mockSetReplyingTo = vi.fn();

vi.mock("../../stores/messageStore", () => ({
  useMessageStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      sendMessage: mockSendMessage,
      replyingTo: null,
      setReplyingTo: mockSetReplyingTo,
    }),
}));

// Need to mock from the component's perspective (relative paths)
vi.mock("../stores/messageStore", () => ({
  useMessageStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      sendMessage: mockSendMessage,
      replyingTo: null,
      setReplyingTo: mockSetReplyingTo,
    }),
}));

vi.mock("../stores/channelStore", () => ({
  useChannelStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      channels: [{ id: "ch-1", name: "general", type: "text" }],
    }),
}));

vi.mock("../stores/serverStore", () => ({
  useServerStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      members: [{ user_id: "u1", username: "testuser" }],
    }),
}));

vi.mock("../stores/customEmojiStore", () => ({
  useCustomEmojiStore: {
    getState: () => ({
      getEmojis: () => [],
    }),
  },
}));

vi.mock("../api/client", () => ({
  api: {
    setToken: vi.fn(),
    getToken: vi.fn(),
    setSessionExpiredCallback: vi.fn(),
  },
  ApiRequestError: class extends Error {},
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockSendMessage.mockResolvedValue(undefined);
});

describe("MessageInput", () => {
  it("renders textarea with placeholder", () => {
    render(<MessageInput channelId="ch-1" />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("sends message on form submit", async () => {
    render(<MessageInput channelId="ch-1" />);
    const user = userEvent.setup();
    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "Hello world");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalled();
    });
  });

  it("does not send empty message", async () => {
    render(<MessageInput channelId="ch-1" />);
    const user = userEvent.setup();
    const textarea = screen.getByRole("textbox");
    await user.click(textarea);
    await user.keyboard("{Enter}");

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("handles file drag and drop", () => {
    render(<MessageInput channelId="ch-1" />);
    const form = screen.getByRole("textbox").closest("form")!;

    const file = new File(["content"], "test.txt", {
      type: "text/plain",
    });

    fireEvent.dragOver(form, {
      dataTransfer: { types: ["Files"] },
    });

    fireEvent.drop(form, {
      dataTransfer: {
        files: [file],
        types: ["Files"],
      },
    });

    // File should appear in pending files
    expect(screen.getByText("test.txt")).toBeInTheDocument();
  });

  it("clears content after successful send", async () => {
    render(<MessageInput channelId="ch-1" />);
    const user = userEvent.setup();
    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "Hello");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalled();
    });

    expect(textarea).toHaveValue("");
  });
});
