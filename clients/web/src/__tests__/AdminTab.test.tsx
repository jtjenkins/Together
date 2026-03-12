import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminTab } from "../components/users/AdminTab";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    forgotPassword: vi.fn(),
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

beforeEach(() => {
  vi.mocked(api.forgotPassword).mockReset();
});

describe("AdminTab", () => {
  it("renders email input and submit button", () => {
    render(<AdminTab />);
    expect(screen.getByLabelText("User's Email Address")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Generate Reset Token" }),
    ).toBeInTheDocument();
  });

  it("shows token box and warning on success", async () => {
    vi.mocked(api.forgotPassword).mockResolvedValueOnce({
      message: "ok",
      token: "abc123token",
      expires_in_seconds: 3600,
      note: "share this",
    });
    render(<AdminTab />);
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("User's Email Address"),
      "user@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Generate Reset Token" }),
    );
    await waitFor(() =>
      expect(screen.getByText("abc123token")).toBeInTheDocument(),
    );
    expect(screen.getByText(/expires in 1 hour/i)).toBeInTheDocument();
  });

  it("copy button writes token to clipboard", async () => {
    vi.mocked(api.forgotPassword).mockResolvedValueOnce({
      message: "ok",
      token: "abc123token",
      expires_in_seconds: 3600,
      note: "share this",
    });
    render(<AdminTab />);
    const user = userEvent.setup();
    const writeTextSpy = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    await user.type(
      screen.getByLabelText("User's Email Address"),
      "user@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Generate Reset Token" }),
    );
    await waitFor(() =>
      expect(screen.getByText("abc123token")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeTextSpy).toHaveBeenCalledWith("abc123token");
  });

  it("clears token result when email input is changed", async () => {
    vi.mocked(api.forgotPassword).mockResolvedValueOnce({
      message: "ok",
      token: "abc123token",
      expires_in_seconds: 3600,
      note: "share this",
    });
    render(<AdminTab />);
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("User's Email Address"),
      "user@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Generate Reset Token" }),
    );
    await waitFor(() =>
      expect(screen.getByText("abc123token")).toBeInTheDocument(),
    );
    await user.type(screen.getByLabelText("User's Email Address"), "x");
    expect(screen.queryByText("abc123token")).not.toBeInTheDocument();
  });

  it("shows error on API failure", async () => {
    vi.mocked(api.forgotPassword).mockRejectedValueOnce(
      new Error("No user found with email: bad@example.com"),
    );
    render(<AdminTab />);
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("User's Email Address"),
      "bad@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Generate Reset Token" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No user found with email",
    );
  });
});
