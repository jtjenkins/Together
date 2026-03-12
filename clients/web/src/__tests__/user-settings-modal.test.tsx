import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserSettingsModal } from "../components/users/UserSettingsModal";
import { useAuthStore } from "../stores/authStore";

vi.mock("../stores/authStore", () => ({
  useAuthStore: vi.fn(),
}));
vi.mock("../components/users/AdminTab", () => ({
  AdminTab: () => <div data-testid="admin-tab-content">AdminTab</div>,
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
  status: "online" as const,
  custom_status: null,
  created_at: new Date().toISOString(),
  is_admin: false,
};

function setupMock(overrides: Partial<typeof baseUser> = {}) {
  const user = { ...baseUser, ...overrides };
  vi.mocked(useAuthStore).mockImplementation((selector?: unknown) => {
    const state = {
      user,
      updateProfile: vi.fn(),
      updatePresence: vi.fn(),
    };
    if (typeof selector === "function")
      return (selector as (s: typeof state) => unknown)(state);
    return state;
  });
}

beforeEach(() => {
  setupMock();
});

describe("UserSettingsModal", () => {
  it("does not render tab bar for non-admin user", () => {
    render(<UserSettingsModal open={true} onClose={vi.fn()} />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("renders tab bar for admin user", () => {
    setupMock({ is_admin: true });
    render(<UserSettingsModal open={true} onClose={vi.fn()} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Admin" })).toBeInTheDocument();
  });

  it("switches to Admin tab and renders AdminTab", async () => {
    setupMock({ is_admin: true });
    render(<UserSettingsModal open={true} onClose={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Admin" }));
    expect(screen.getByTestId("admin-tab-content")).toBeInTheDocument();
  });

  it("resets to Profile tab when modal closes and reopens", async () => {
    setupMock({ is_admin: true });
    const onClose = vi.fn();
    const { rerender } = render(
      <UserSettingsModal open={true} onClose={onClose} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Admin" }));
    rerender(<UserSettingsModal open={false} onClose={onClose} />);
    rerender(<UserSettingsModal open={true} onClose={onClose} />);
    expect(screen.getByRole("tab", { name: "Profile" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
