/**
 * UserPanel component tests.
 *
 * Tests rendering with and without user, avatar display, logout button,
 * and settings modal toggle.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserPanel } from "../components/users/UserPanel";
import { useAuthStore } from "../stores/authStore";

const mockLogout = vi.fn();

vi.mock("../stores/authStore", () => ({
  useAuthStore: vi.fn(),
}));
vi.mock("../components/users/UserSettingsModal", () => ({
  UserSettingsModal: ({
    open,
    onClose,
  }: {
    open: boolean;
    onClose: () => void;
  }) =>
    open ? (
      <div data-testid="settings-modal">
        <button onClick={onClose}>CloseModal</button>
      </div>
    ) : null,
}));
vi.mock("../api/client", () => ({
  api: {
    setToken: vi.fn(),
    getToken: vi.fn(),
    setSessionExpiredCallback: vi.fn(),
  },
  ApiRequestError: class extends Error {},
}));

const baseUser = {
  id: "1",
  username: "testuser",
  email: "test@example.com",
  avatar_url: null,
  bio: null,
  pronouns: null,
  status: "online" as const,
  custom_status: null,
  created_at: new Date().toISOString(),
  is_admin: false,
};

function setupMock(overrides: Partial<typeof baseUser> | null = {}) {
  const user = overrides === null ? null : { ...baseUser, ...overrides };
  mockLogout.mockReset();
  vi.mocked(useAuthStore).mockImplementation((selector?: unknown) => {
    const state = { user, logout: mockLogout };
    if (typeof selector === "function")
      return (selector as (s: typeof state) => unknown)(state);
    return state;
  });
}

beforeEach(() => {
  setupMock();
});

describe("UserPanel", () => {
  it("renders nothing when user is null", () => {
    setupMock(null);
    const { container } = render(<UserPanel />);
    expect(container.innerHTML).toBe("");
  });

  it("displays username", () => {
    render(<UserPanel />);
    expect(screen.getByText("testuser")).toBeInTheDocument();
  });

  it("displays avatar fallback when no avatar_url", () => {
    render(<UserPanel />);
    expect(screen.getByText("T")).toBeInTheDocument();
  });

  it("displays avatar image when avatar_url is set", () => {
    setupMock({ avatar_url: "https://example.com/a.png" });
    const { container } = render(<UserPanel />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("https://example.com/a.png");
  });

  it("displays pronouns when set", () => {
    setupMock({ pronouns: "he/him" });
    render(<UserPanel />);
    expect(screen.getByText("he/him")).toBeInTheDocument();
  });

  it("displays custom status when set", () => {
    setupMock({ custom_status: "Working" });
    render(<UserPanel />);
    expect(screen.getByText("Working")).toBeInTheDocument();
  });

  it("displays bio when set", () => {
    setupMock({ bio: "Hello world" });
    render(<UserPanel />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("shows status text as status name when no custom status", () => {
    setupMock({ custom_status: null, status: "online" });
    render(<UserPanel />);
    expect(screen.getByText("online")).toBeInTheDocument();
  });

  it("logout button calls logout", async () => {
    render(<UserPanel />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(mockLogout).toHaveBeenCalled();
  });

  it("clicking user info opens settings modal", async () => {
    render(<UserPanel />);
    const user = userEvent.setup();

    // Settings modal should not be visible initially
    expect(screen.queryByTestId("settings-modal")).not.toBeInTheDocument();

    // Click user info to open settings
    await user.click(screen.getByText("testuser"));

    expect(screen.getByTestId("settings-modal")).toBeInTheDocument();
  });

  it("closing the settings modal hides it", async () => {
    render(<UserPanel />);
    const user = userEvent.setup();

    await user.click(screen.getByText("testuser"));
    expect(screen.getByTestId("settings-modal")).toBeInTheDocument();

    await user.click(screen.getByText("CloseModal"));
    expect(screen.queryByTestId("settings-modal")).not.toBeInTheDocument();
  });
});
