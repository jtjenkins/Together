import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageInput } from "../components/messages/MessageInput";
import { useMessageStore } from "../stores/messageStore";
import { useChannelStore } from "../stores/channelStore";
import { useServerStore } from "../stores/serverStore";
import type { MemberDto } from "../types";

// ── Store mocks ──────────────────────────────────────────────────────────────

vi.mock("../stores/messageStore", () => ({ useMessageStore: vi.fn() }));
vi.mock("../stores/channelStore", () => ({ useChannelStore: vi.fn() }));
vi.mock("../stores/serverStore", () => ({ useServerStore: vi.fn() }));

// MentionAutocomplete renders its own dropdown; no need to mock it.

const mockSendMessage = vi.fn();

function makeMember(username: string): MemberDto {
  return {
    user_id: `id-${username}`,
    username,
    avatar_url: null,
    status: "online",
    nickname: null,
    joined_at: new Date().toISOString(),
  };
}

const MEMBERS = [makeMember("alice"), makeMember("bob"), makeMember("carol")];

function setupMocks() {
  const messageState = {
    sendMessage: mockSendMessage,
    replyingTo: null,
    setReplyingTo: vi.fn(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useMessageStore).mockImplementation((selector?: any) =>
    typeof selector === "function" ? selector(messageState) : messageState,
  );

  const channelState = {
    channels: [{ id: "ch-1", name: "general", kind: "text", server_id: "s-1", position: 0, created_at: "" }],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useChannelStore).mockImplementation((selector?: any) =>
    typeof selector === "function" ? selector(channelState) : channelState,
  );

  const serverState = { members: MEMBERS };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useServerStore).mockImplementation((selector?: any) =>
    typeof selector === "function" ? selector(serverState) : serverState,
  );
}

beforeEach(() => {
  mockSendMessage.mockReset();
  setupMocks();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function getTextarea() {
  return screen.getByRole("textbox", { name: /message input/i });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("MessageInput — mention keyboard integration", () => {
  it("shows mention dropdown when @ is typed at start of input", async () => {
    const user = userEvent.setup();
    render(<MessageInput channelId="ch-1" />);
    await user.click(getTextarea());
    await user.type(getTextarea(), "@al");
    expect(screen.getByRole("listbox", { name: /member suggestions/i })).toBeInTheDocument();
  });

  it("pressing Enter while dropdown is open inserts the mention and closes the dropdown", async () => {
    const user = userEvent.setup();
    render(<MessageInput channelId="ch-1" />);
    await user.click(getTextarea());
    await user.type(getTextarea(), "@al");
    // dropdown should be visible
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    // Enter selects the first (active) item
    await user.keyboard("{Enter}");
    // dropdown should be gone
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // textarea should contain the inserted mention followed by a space
    expect((getTextarea() as HTMLTextAreaElement).value).toMatch(/^@alice /);
  });

  it("pressing Escape while dropdown is open closes it without inserting", async () => {
    const user = userEvent.setup();
    render(<MessageInput channelId="ch-1" />);
    await user.click(getTextarea());
    await user.type(getTextarea(), "@al");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // Original text should be unchanged
    expect((getTextarea() as HTMLTextAreaElement).value).toBe("@al");
  });

  it("pressing Enter without an open dropdown submits the message", async () => {
    const user = userEvent.setup();
    mockSendMessage.mockResolvedValue(undefined);
    render(<MessageInput channelId="ch-1" />);
    await user.click(getTextarea());
    await user.type(getTextarea(), "hello world");
    await user.keyboard("{Enter}");
    expect(mockSendMessage).toHaveBeenCalledWith(
      "ch-1",
      expect.objectContaining({ content: "hello world" }),
      undefined,
    );
  });
});
