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
    addWordFilter: vi.fn(),
    removeWordFilter: vi.fn(),
    listAutomodLogs: vi.fn(),
    setToken: vi.fn(),
    getToken: vi.fn(),
    setSessionExpiredCallback: vi.fn(),
  },
  ApiRequestError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

const baseConfig = {
  server_id: "server-1",
  enabled: false,
  spam_enabled: false,
  spam_max_messages: 5,
  spam_window_secs: 5,
  spam_action: "delete" as const,
  duplicate_enabled: false,
  word_filter_enabled: false,
  word_filter_action: "delete" as const,
  timeout_minutes: 10,
  updated_at: new Date().toISOString(),
};

beforeEach(() => {
  vi.mocked(api.getAutomodConfig).mockResolvedValue(baseConfig);
  vi.mocked(api.listWordFilters).mockResolvedValue([]);
  vi.mocked(api.listAutomodLogs).mockResolvedValue([]);
  vi.mocked(api.updateAutomodConfig).mockResolvedValue(baseConfig);
});

describe("AutomodSettings", () => {
  it("shows loading state initially", () => {
    vi.mocked(api.getAutomodConfig).mockReturnValue(new Promise(() => {}));
    render(<AutomodSettings serverId="server-1" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it('shows "No automod actions yet" in logs tab when logs are empty', async () => {
    render(<AutomodSettings serverId="server-1" />);
    await waitFor(() =>
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument(),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Logs" }));
    expect(screen.getByText("No automod actions yet.")).toBeInTheDocument();
  });

  it('shows "No words in filter" in words tab when list is empty', async () => {
    render(<AutomodSettings serverId="server-1" />);
    await waitFor(() =>
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument(),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Word Filter" }));
    expect(screen.getByText("No words in filter.")).toBeInTheDocument();
  });

  it("calls updateAutomodConfig when a toggle changes", async () => {
    const updatedConfig = { ...baseConfig, enabled: true };
    vi.mocked(api.updateAutomodConfig).mockResolvedValueOnce(updatedConfig);

    render(<AutomodSettings serverId="server-1" />);
    await waitFor(() =>
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument(),
    );

    const user = userEvent.setup();
    const toggle = screen.getByRole("checkbox", {
      name: "Enable Auto-Moderation",
    });
    await user.click(toggle);

    expect(api.updateAutomodConfig).toHaveBeenCalledWith("server-1", {
      enabled: true,
    });
  });
});
