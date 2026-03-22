/**
 * UserSettingsModal — form submission and error handling tests.
 *
 * Covers the handleSubmit path (profile update, presence update, error display)
 * and handleClose path that were previously untested.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

const mockUpdateProfile = vi.fn();
const mockUpdatePresence = vi.fn();

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

function setupMock(overrides: Partial<typeof baseUser> = {}) {
  const user = { ...baseUser, ...overrides };
  mockUpdateProfile.mockReset();
  mockUpdatePresence.mockReset();
  vi.mocked(useAuthStore).mockImplementation((selector?: unknown) => {
    const state = {
      user,
      updateProfile: mockUpdateProfile,
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

describe("UserSettingsModal — form submission", () => {
  it("calls updateProfile and closes modal on successful submit", async () => {
    const onClose = vi.fn();
    mockUpdateProfile.mockResolvedValue(undefined);
    render(<UserSettingsModal open={true} onClose={onClose} />);
    const user = userEvent.setup();

    // Fill in bio
    const bioInput = screen.getByLabelText(/Bio/);
    await user.type(bioInput, "Hello world");

    // Submit form
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        avatar_url: null,
        bio: "Hello world",
        pronouns: null,
        custom_status: null,
      });
    });

    // Modal should close after successful save
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("calls updatePresence when status changes", async () => {
    const onClose = vi.fn();
    mockUpdateProfile.mockResolvedValue(undefined);
    render(<UserSettingsModal open={true} onClose={onClose} />);
    const user = userEvent.setup();

    // Change status to "away"
    const statusSelect = screen.getByLabelText("Status");
    await user.selectOptions(statusSelect, "away");

    // Submit
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mockUpdatePresence).toHaveBeenCalledWith("away", null);
    });
  });

  it("does not call updatePresence when status is unchanged", async () => {
    const onClose = vi.fn();
    mockUpdateProfile.mockResolvedValue(undefined);
    render(<UserSettingsModal open={true} onClose={onClose} />);
    const user = userEvent.setup();

    // Submit without changing status
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalled();
    });

    expect(mockUpdatePresence).not.toHaveBeenCalled();
  });

  it("displays error message when updateProfile fails", async () => {
    mockUpdateProfile.mockRejectedValue(new Error("Network error"));
    render(<UserSettingsModal open={true} onClose={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  it("displays generic error for non-Error rejections", async () => {
    mockUpdateProfile.mockRejectedValue("something broke");
    render(<UserSettingsModal open={true} onClose={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to update profile")).toBeInTheDocument();
    });
  });

  it("shows Saving... while submitting", async () => {
    let resolveUpdate: (() => void) | undefined;
    mockUpdateProfile.mockImplementation(
      () => new Promise<void>((r) => (resolveUpdate = r)),
    );
    render(<UserSettingsModal open={true} onClose={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(screen.getByText("Saving...")).toBeInTheDocument();

    resolveUpdate!();

    await waitFor(() => {
      expect(screen.queryByText("Saving...")).not.toBeInTheDocument();
    });
  });

  it("Cancel button closes the modal", async () => {
    const onClose = vi.fn();
    render(<UserSettingsModal open={true} onClose={onClose} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when user is null", () => {
    vi.mocked(useAuthStore).mockImplementation((selector?: unknown) => {
      const state = {
        user: null,
        updateProfile: vi.fn(),
        updatePresence: vi.fn(),
      };
      if (typeof selector === "function")
        return (selector as (s: typeof state) => unknown)(state);
      return state;
    });

    const { container } = render(
      <UserSettingsModal open={true} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("sends trimmed avatar_url, bio, and pronouns", async () => {
    mockUpdateProfile.mockResolvedValue(undefined);
    render(<UserSettingsModal open={true} onClose={vi.fn()} />);
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText(/Avatar URL/),
      "  https://x.com/a.png  ",
    );
    await user.type(screen.getByLabelText(/Bio/), "  my bio  ");
    await user.type(screen.getByLabelText(/Pronouns/), "  they/them  ");

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        avatar_url: "https://x.com/a.png",
        bio: "my bio",
        pronouns: "they/them",
        custom_status: null,
      });
    });
  });

  it("pre-fills form fields from user data", () => {
    setupMock({
      avatar_url: "https://example.com/avatar.png",
      bio: "I love coding",
      pronouns: "she/her",
      custom_status: "Working hard",
    });

    render(<UserSettingsModal open={true} onClose={vi.fn()} />);

    expect(
      screen.getByDisplayValue("https://example.com/avatar.png"),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("I love coding")).toBeInTheDocument();
    expect(screen.getByDisplayValue("she/her")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Working hard")).toBeInTheDocument();
  });
});
