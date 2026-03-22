/**
 * StatusMenu component tests.
 *
 * Tests status selection, custom status/activity save, clear, and close behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatusMenu } from "../components/users/StatusMenu";
import { useAuthStore } from "../stores/authStore";

const mockUpdatePresence = vi.fn();

const baseUser: {
  id: string;
  username: string;
  email: string | null;
  avatar_url: string | null;
  bio: string | null;
  pronouns: string | null;
  status: "online";
  custom_status: string | null;
  activity: string | null;
  created_at: string;
  is_admin: boolean;
} = {
  id: "1",
  username: "testuser",
  email: "test@example.com",
  avatar_url: null,
  bio: null,
  pronouns: null,
  status: "online",
  custom_status: null,
  activity: null,
  created_at: new Date().toISOString(),
  is_admin: false,
};

vi.mock("../stores/authStore", () => ({
  useAuthStore: vi.fn(),
}));
vi.mock("../api/client", () => ({
  api: {
    setToken: vi.fn(),
    getToken: vi.fn(),
    setSessionExpiredCallback: vi.fn(),
  },
  ApiRequestError: class extends Error {},
}));

function setupMock(overrides: Partial<typeof baseUser> = {}) {
  const user = { ...baseUser, ...overrides };
  mockUpdatePresence.mockReset();
  vi.mocked(useAuthStore).mockImplementation((selector?: unknown) => {
    const state = {
      user,
      updatePresence: mockUpdatePresence,
    };
    if (typeof selector === "function")
      return (selector as (s: typeof state) => unknown)(state);
    return state;
  });
}

beforeEach(() => {
  setupMock();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("StatusMenu", () => {
  it("renders all status options", () => {
    render(<StatusMenu onClose={vi.fn()} />);
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.getByText("Away")).toBeInTheDocument();
    expect(screen.getByText("Do Not Disturb")).toBeInTheDocument();
    expect(screen.getByText("Invisible")).toBeInTheDocument();
  });

  it("clicking a status option calls updatePresence", async () => {
    render(<StatusMenu onClose={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Away"));
    expect(mockUpdatePresence).toHaveBeenCalledWith("away", null, null);
  });

  it("Save button calls updatePresence with custom status and activity", async () => {
    const onClose = vi.fn();
    render(<StatusMenu onClose={onClose} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Custom Status"), "Working hard");
    await user.type(screen.getByLabelText("Activity"), "Playing games");
    await user.click(screen.getByText("Save"));

    expect(mockUpdatePresence).toHaveBeenCalledWith(
      "online",
      "Working hard",
      "Playing games",
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("Enter key in custom status input triggers save", async () => {
    const onClose = vi.fn();
    render(<StatusMenu onClose={onClose} />);
    const user = userEvent.setup();

    const input = screen.getByLabelText("Custom Status");
    await user.type(input, "Busy");
    await user.keyboard("{Enter}");

    expect(mockUpdatePresence).toHaveBeenCalledWith("online", "Busy", null);
    expect(onClose).toHaveBeenCalled();
  });

  it("Clear all button resets custom status and activity", async () => {
    setupMock({ custom_status: "Old status", activity: "Old activity" });
    render(<StatusMenu onClose={vi.fn()} />);
    const user = userEvent.setup();

    // The inputs should be pre-filled
    expect(screen.getByDisplayValue("Old status")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Old activity")).toBeInTheDocument();

    // Modify to show the clear button (it only shows when values differ)
    await user.clear(screen.getByLabelText("Custom Status"));
    await user.type(screen.getByLabelText("Custom Status"), "New status");

    await user.click(screen.getByText("Clear all"));

    expect(mockUpdatePresence).toHaveBeenCalledWith("online", null, null);
  });

  it("closes on outside click", () => {
    const onClose = vi.fn();
    render(<StatusMenu onClose={onClose} />);

    const outsideEl = document.createElement("div");
    document.body.appendChild(outsideEl);
    fireEvent.mouseDown(outsideEl);

    expect(onClose).toHaveBeenCalled();
    outsideEl.remove();
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(<StatusMenu onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when user is null", () => {
    vi.mocked(useAuthStore).mockImplementation((selector?: unknown) => {
      const state = { user: null, updatePresence: vi.fn() };
      if (typeof selector === "function")
        return (selector as (s: typeof state) => unknown)(state);
      return state;
    });

    const { container } = render(<StatusMenu onClose={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("saves empty strings as null", async () => {
    setupMock({ custom_status: "Old", activity: "Playing" });
    const onClose = vi.fn();
    render(<StatusMenu onClose={onClose} />);
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText("Custom Status"));
    await user.clear(screen.getByLabelText("Activity"));
    await user.click(screen.getByText("Save"));

    expect(mockUpdatePresence).toHaveBeenCalledWith("online", null, null);
  });
});
