import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "@testing-library/react";
import { AuthForm } from "../components/auth/AuthForm";
import { useAuthStore } from "../stores/authStore";
import { api } from "../api/client";

// Mock the auth store
vi.mock("../stores/authStore", () => ({
  useAuthStore: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: {
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
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

const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockClearError = vi.fn();

function setupMock(error: string | null = null) {
  const state = {
    user: null,
    isAuthenticated: false,
    isLoading: false,
    error,
    login: mockLogin,
    register: mockRegister,
    logout: vi.fn(),
    updateProfile: vi.fn(),
    updatePresence: vi.fn(),
    setUser: vi.fn(),
    restoreSession: vi.fn(),
    clearError: mockClearError,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useAuthStore).mockImplementation((selector?: any) => {
    if (typeof selector === "function") return selector(state);
    return state;
  });
}

beforeEach(() => {
  mockLogin.mockReset();
  mockRegister.mockReset();
  mockClearError.mockReset();
  vi.mocked(api.resetPassword).mockReset();
  vi.mocked(api.forgotPassword).mockReset();
  setupMock();
});

describe("AuthForm", () => {
  it("renders login form by default", () => {
    render(<AuthForm />);
    expect(screen.getByText("Welcome back!")).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign In" })).toBeInTheDocument();
  });

  it("switches to register form when toggle is clicked", async () => {
    render(<AuthForm />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Register"));
    expect(screen.getByText("Create an account")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create Account" }),
    ).toBeInTheDocument();
  });

  it("switches back to login from register", async () => {
    render(<AuthForm />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Register"));
    await user.click(screen.getByText("Sign In"));
    expect(screen.getByText("Welcome back!")).toBeInTheDocument();
  });

  it("calls login with correct credentials", async () => {
    mockLogin.mockResolvedValueOnce(undefined);
    render(<AuthForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Username"), "testuser");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    expect(mockLogin).toHaveBeenCalledWith({
      username: "testuser",
      password: "password123",
    });
  });

  it("calls register with correct data", async () => {
    mockRegister.mockResolvedValueOnce(undefined);
    render(<AuthForm />);
    const user = userEvent.setup();

    await user.click(screen.getByText("Register"));
    await user.type(screen.getByLabelText("Username"), "newuser");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    expect(mockRegister).toHaveBeenCalledWith({
      username: "newuser",
      email: undefined,
      password: "password123",
    });
  });

  it("displays error message when present", () => {
    setupMock("Invalid credentials");
    render(<AuthForm />);
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid credentials");
  });

  it("clears error when switching mode", async () => {
    render(<AuthForm />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Register"));
    expect(mockClearError).toHaveBeenCalled();
  });

  it("shows Together branding", () => {
    render(<AuthForm />);
    expect(screen.getByText("Together")).toBeInTheDocument();
  });
});

describe("AuthForm — reset view", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows 'Have a reset token?' link on login view", () => {
    render(<AuthForm />);
    expect(screen.getByText("Have a reset token?")).toBeInTheDocument();
  });

  it("switches to reset view when link is clicked", async () => {
    render(<AuthForm />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Have a reset token?"));
    expect(
      screen.getByRole("heading", { name: "Reset Password" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Reset Token")).toBeInTheDocument();
    expect(screen.getByLabelText("New Password")).toBeInTheDocument();
  });

  it("'Back to login' from reset view returns to login", async () => {
    render(<AuthForm />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Have a reset token?"));
    await user.click(screen.getByText("Back to login"));
    expect(screen.getByText("Welcome back!")).toBeInTheDocument();
  });

  it("calls resetPassword with token and new password on submit", async () => {
    vi.mocked(api.resetPassword).mockResolvedValueOnce(undefined);
    render(<AuthForm />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Have a reset token?"));
    await user.type(screen.getByLabelText("Reset Token"), "my-token-abc");
    await user.type(screen.getByLabelText("New Password"), "newpassword123");
    await user.click(screen.getByRole("button", { name: "Reset Password" }));
    expect(api.resetPassword).toHaveBeenCalledWith({
      token: "my-token-abc",
      new_password: "newpassword123",
    });
  });

  it("shows success message after reset and transitions to login", async () => {
    vi.mocked(api.resetPassword).mockResolvedValueOnce(undefined);
    render(<AuthForm />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Have a reset token?"));
    await user.type(screen.getByLabelText("Reset Token"), "my-token");
    await user.type(screen.getByLabelText("New Password"), "newpassword123");
    await user.click(screen.getByRole("button", { name: "Reset Password" }));

    expect(
      await screen.findByText("Password reset. You can now log in."),
    ).toBeInTheDocument();
    // Wait for the 2-second auto-transition back to login.
    expect(
      await screen.findByText("Welcome back!", undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
  }, 6000);

  it("shows error when resetPassword rejects", async () => {
    vi.mocked(api.resetPassword).mockRejectedValueOnce(
      new Error("Invalid or expired reset token"),
    );
    render(<AuthForm />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Have a reset token?"));
    await user.type(screen.getByLabelText("Reset Token"), "bad-token");
    await user.type(screen.getByLabelText("New Password"), "newpassword123");
    await user.click(screen.getByRole("button", { name: "Reset Password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid or expired reset token",
    );
  });
});
