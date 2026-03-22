/**
 * EventForm component tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventForm } from "../components/messages/EventForm";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    createEvent: vi.fn(),
    setToken: vi.fn(),
    getToken: vi.fn(),
    setSessionExpiredCallback: vi.fn(),
  },
  ApiRequestError: class extends Error {},
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EventForm", () => {
  it("renders with prefilled name", () => {
    render(
      <EventForm
        channelId="ch-1"
        prefill="Game Night"
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Game Night")).toBeInTheDocument();
  });

  it("shows error when name is empty", async () => {
    render(
      <EventForm
        channelId="ch-1"
        prefill=""
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Schedule Event" }));
    expect(screen.getByText("Event name is required")).toBeInTheDocument();
  });

  it("submits successfully and calls onSubmit", async () => {
    const onSubmit = vi.fn();
    vi.mocked(api.createEvent).mockResolvedValue(undefined as never);

    render(
      <EventForm
        channelId="ch-1"
        prefill="Game Night"
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Schedule Event" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(api.createEvent).toHaveBeenCalled();
  });

  it("shows error on API failure", async () => {
    vi.mocked(api.createEvent).mockRejectedValue(new Error("Server error"));

    render(
      <EventForm
        channelId="ch-1"
        prefill="Game Night"
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Schedule Event" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to create event")).toBeInTheDocument();
    });
  });

  it("Cancel button calls onClose", async () => {
    const onClose = vi.fn();
    render(
      <EventForm
        channelId="ch-1"
        prefill=""
        onSubmit={vi.fn()}
        onClose={onClose}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("close button calls onClose", async () => {
    const onClose = vi.fn();
    render(
      <EventForm
        channelId="ch-1"
        prefill=""
        onSubmit={vi.fn()}
        onClose={onClose}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Close event form" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows Scheduling... while submitting", async () => {
    let resolveApi: (() => void) | undefined;
    vi.mocked(api.createEvent).mockImplementation(
      () => new Promise<void>((r) => (resolveApi = r)),
    );

    render(
      <EventForm
        channelId="ch-1"
        prefill="Game Night"
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Schedule Event" }));

    expect(screen.getByText(/Scheduling/)).toBeInTheDocument();

    resolveApi!();
    await waitFor(() => {
      expect(screen.queryByText(/Scheduling/)).not.toBeInTheDocument();
    });
  });
});
