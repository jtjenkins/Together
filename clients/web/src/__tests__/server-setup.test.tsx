import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerSetup } from "../components/desktop/ServerSetup";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("ServerSetup", () => {
  it("renders the URL input and Connect button", () => {
    render(<ServerSetup onComplete={vi.fn()} />);
    expect(screen.getByLabelText("Server URL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("shows an error for empty input without calling fetch", async () => {
    const onComplete = vi.fn();
    render(<ServerSetup onComplete={onComplete} />);
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByText("Please enter a server URL.")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("shows an error for a non-URL string without calling fetch", async () => {
    const onComplete = vi.fn();
    render(<ServerSetup onComplete={onComplete} />);
    await userEvent.type(screen.getByLabelText("Server URL"), "not-a-url");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByText(/Invalid URL/)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("shows an error for a non-http(s) scheme without calling fetch", async () => {
    const onComplete = vi.fn();
    render(<ServerSetup onComplete={onComplete} />);
    await userEvent.type(
      screen.getByLabelText("Server URL"),
      "ftp://example.com",
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByText(/http:\/\/ or https:\/\//)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("shows an error when the server is unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const onComplete = vi.fn();
    render(<ServerSetup onComplete={onComplete} />);
    await userEvent.type(
      screen.getByLabelText("Server URL"),
      "http://localhost:8080",
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByText(/Could not reach the server/);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("calls onComplete with the validated URL when the server responds", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);
    const onComplete = vi.fn();
    render(<ServerSetup onComplete={onComplete} />);
    await userEvent.type(
      screen.getByLabelText("Server URL"),
      "http://localhost:8080",
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith("http://localhost:8080"),
    );
  });

  it("strips a trailing slash before calling onComplete", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);
    const onComplete = vi.fn();
    render(<ServerSetup onComplete={onComplete} />);
    await userEvent.type(
      screen.getByLabelText("Server URL"),
      "http://localhost:8080/",
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith("http://localhost:8080"),
    );
  });

  it("accepts an https URL", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);
    const onComplete = vi.fn();
    render(<ServerSetup onComplete={onComplete} />);
    await userEvent.type(
      screen.getByLabelText("Server URL"),
      "https://together.example.com",
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith("https://together.example.com"),
    );
  });

  it("shows Connecting… and disables inputs while checking", async () => {
    // Never resolve so we can inspect the checking state
    mockFetch.mockReturnValueOnce(new Promise(() => {}));
    render(<ServerSetup onComplete={vi.fn()} />);
    await userEvent.type(
      screen.getByLabelText("Server URL"),
      "http://localhost:8080",
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(
      await screen.findByRole("button", { name: "Connecting…" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Server URL")).toBeDisabled();
  });
});
