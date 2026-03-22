/**
 * AutomodSettings — comprehensive tests for rules, word filters, logs tabs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AutomodSettings } from "../components/servers/AutomodSettings";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    getAutomodConfig: vi.fn(),
    updateAutomodConfig: vi.fn(),
    listWordFilters: vi.fn(),
    listAutomodLogs: vi.fn(),
    addWordFilter: vi.fn(),
    removeWordFilter: vi.fn(),
    setToken: vi.fn(),
    getToken: vi.fn(),
    setSessionExpiredCallback: vi.fn(),
  },
  ApiRequestError: class extends Error {},
}));

const defaultConfig = {
  server_id: "s1",
  enabled: false,
  spam_enabled: false,
  spam_max_messages: 5,
  spam_window_secs: 5,
  spam_action: "delete" as const,
  duplicate_enabled: false,
  word_filter_enabled: false,
  word_filter_action: "delete" as const,
  timeout_minutes: 10,
  updated_at: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getAutomodConfig).mockResolvedValue(defaultConfig as never);
  vi.mocked(api.listWordFilters).mockResolvedValue([] as never);
  vi.mocked(api.listAutomodLogs).mockResolvedValue([] as never);
});

describe("AutomodSettings", () => {
  it("shows loading initially", () => {
    vi.mocked(api.getAutomodConfig).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.listWordFilters).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.listAutomodLogs).mockReturnValue(new Promise(() => {}));
    render(<AutomodSettings serverId="s1" />);
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it("renders rules tab after loading", async () => {
    render(<AutomodSettings serverId="s1" />);
    await waitFor(() => {
      expect(screen.getByText("Auto-Moderation")).toBeInTheDocument();
    });
    expect(screen.getByText("Rules")).toBeInTheDocument();
    expect(screen.getAllByText("Word Filter").length).toBeGreaterThan(0);
    expect(screen.getByText("Logs")).toBeInTheDocument();
  });

  it("enables automod when checkbox is toggled", async () => {
    const updatedConfig = { ...defaultConfig, enabled: true };
    vi.mocked(api.updateAutomodConfig).mockResolvedValue(
      updatedConfig as never,
    );

    render(<AutomodSettings serverId="s1" />);
    await waitFor(() => {
      expect(screen.getByText("Auto-Moderation")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("checkbox", { name: "Enable Auto-Moderation" }),
    );

    expect(api.updateAutomodConfig).toHaveBeenCalledWith("s1", {
      enabled: true,
    });
  });

  it("shows error when config update fails", async () => {
    vi.mocked(api.updateAutomodConfig).mockRejectedValue(
      new Error("Forbidden"),
    );

    render(<AutomodSettings serverId="s1" />);
    await waitFor(() => {
      expect(screen.getByText("Auto-Moderation")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("checkbox", { name: "Enable Auto-Moderation" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Forbidden")).toBeInTheDocument();
    });
  });

  it("switches to Word Filter tab", async () => {
    render(<AutomodSettings serverId="s1" />);
    await waitFor(() => {
      expect(screen.getByText("Auto-Moderation")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    // Click the Word Filter tab button (not the fieldset legend with same text)
    const wordFilterButtons = screen.getAllByText("Word Filter");
    // The tab button is the one that is a <button> element
    const tabButton = wordFilterButtons.find((el) => el.tagName === "BUTTON")!;
    await user.click(tabButton);

    expect(
      screen.getByPlaceholderText("Add a word or phrase…"),
    ).toBeInTheDocument();
  });

  it("adds a word filter", async () => {
    vi.mocked(api.addWordFilter).mockResolvedValue({
      id: "w1",
      word: "badword",
      server_id: "s1",
    } as never);

    render(<AutomodSettings serverId="s1" />);
    await waitFor(() => {
      expect(screen.getByText("Auto-Moderation")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    // Click the Word Filter tab button (not the fieldset legend with same text)
    const wordFilterButtons = screen.getAllByText("Word Filter");
    // The tab button is the one that is a <button> element
    const tabButton = wordFilterButtons.find((el) => el.tagName === "BUTTON")!;
    await user.click(tabButton);

    const input = screen.getByPlaceholderText("Add a word or phrase…");
    await user.type(input, "badword");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.getByText("badword")).toBeInTheDocument();
    });
  });

  it("removes a word filter", async () => {
    vi.mocked(api.listWordFilters).mockResolvedValue([
      { id: "w1", word: "badword", server_id: "s1" },
    ] as never);
    vi.mocked(api.removeWordFilter).mockResolvedValue(undefined as never);

    render(<AutomodSettings serverId="s1" />);
    await waitFor(() => {
      expect(screen.getByText("Auto-Moderation")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    // Click the Word Filter tab button (not the fieldset legend with same text)
    const wordFilterButtons = screen.getAllByText("Word Filter");
    // The tab button is the one that is a <button> element
    const tabButton = wordFilterButtons.find((el) => el.tagName === "BUTTON")!;
    await user.click(tabButton);

    await waitFor(() => {
      expect(screen.getByText("badword")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Remove badword" }));

    await waitFor(() => {
      expect(screen.queryByText("badword")).not.toBeInTheDocument();
    });
  });

  it("switches to Logs tab and shows empty state", async () => {
    render(<AutomodSettings serverId="s1" />);
    await waitFor(() => {
      expect(screen.getByText("Auto-Moderation")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText("Logs"));

    expect(screen.getByText("No automod actions yet.")).toBeInTheDocument();
  });

  it("switches to Logs tab and shows log entries", async () => {
    vi.mocked(api.listAutomodLogs).mockResolvedValue([
      {
        id: "l1",
        rule_type: "spam",
        action_taken: "delete",
        user_id: "u1",
        username: "spammer",
        matched_term: null,
        created_at: "2024-01-01T00:00:00Z",
      },
    ] as never);

    render(<AutomodSettings serverId="s1" />);
    await waitFor(() => {
      expect(screen.getByText("Auto-Moderation")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText("Logs"));

    await waitFor(() => {
      expect(screen.getByText(/spammer/)).toBeInTheDocument();
    });
  });

  it("handles null config gracefully (new server)", async () => {
    vi.mocked(api.getAutomodConfig).mockResolvedValue(null as never);

    render(<AutomodSettings serverId="s1" />);
    await waitFor(() => {
      expect(screen.getByText("Auto-Moderation")).toBeInTheDocument();
    });

    // Should show unchecked enable checkbox (default false)
    const checkbox = screen.getByRole("checkbox", {
      name: "Enable Auto-Moderation",
    });
    expect(checkbox).not.toBeChecked();
  });
});
