/**
 * PollForm component tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PollForm } from "../components/messages/PollForm";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    createPoll: vi.fn(),
    setToken: vi.fn(),
    getToken: vi.fn(),
    setSessionExpiredCallback: vi.fn(),
  },
  ApiRequestError: class extends Error {},
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PollForm", () => {
  it("renders with prefilled question", () => {
    render(
      <PollForm
        channelId="ch-1"
        prefill="Favorite color?"
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Favorite color?")).toBeInTheDocument();
  });

  it("shows error when question is empty", async () => {
    render(
      <PollForm
        channelId="ch-1"
        prefill=""
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    // Fill in options but leave question empty
    const optionInputs = screen.getAllByPlaceholderText(/Option/);
    await user.type(optionInputs[0], "Red");
    await user.type(optionInputs[1], "Blue");
    await user.click(screen.getByRole("button", { name: "Create Poll" }));
    expect(screen.getByText("Question is required")).toBeInTheDocument();
  });

  it("shows error when fewer than 2 valid options", async () => {
    render(
      <PollForm
        channelId="ch-1"
        prefill="Q?"
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const optionInputs = screen.getAllByPlaceholderText(/Option/);
    await user.type(optionInputs[0], "Only one");
    // Option 2 left empty
    await user.click(screen.getByRole("button", { name: "Create Poll" }));
    expect(screen.getByText("At least 2 options required")).toBeInTheDocument();
  });

  it("submits successfully", async () => {
    const onSubmit = vi.fn();
    vi.mocked(api.createPoll).mockResolvedValue(undefined as never);

    render(
      <PollForm
        channelId="ch-1"
        prefill="Fav color?"
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const optionInputs = screen.getAllByPlaceholderText(/Option/);
    await user.type(optionInputs[0], "Red");
    await user.type(optionInputs[1], "Blue");
    await user.click(screen.getByRole("button", { name: "Create Poll" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
  });

  it("shows error on API failure", async () => {
    vi.mocked(api.createPoll).mockRejectedValue(new Error("fail"));

    render(
      <PollForm
        channelId="ch-1"
        prefill="Q?"
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const optionInputs = screen.getAllByPlaceholderText(/Option/);
    await user.type(optionInputs[0], "A");
    await user.type(optionInputs[1], "B");
    await user.click(screen.getByRole("button", { name: "Create Poll" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to create poll")).toBeInTheDocument();
    });
  });

  it("adds and removes options", async () => {
    render(
      <PollForm
        channelId="ch-1"
        prefill="Q?"
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const user = userEvent.setup();

    // Start with 2 options
    expect(screen.getAllByPlaceholderText(/Option/)).toHaveLength(2);

    // Add an option
    await user.click(screen.getByText("+ Add Option"));
    expect(screen.getAllByPlaceholderText(/Option/)).toHaveLength(3);

    // Remove an option
    await user.click(screen.getByRole("button", { name: "Remove option 3" }));
    expect(screen.getAllByPlaceholderText(/Option/)).toHaveLength(2);
  });

  it("Cancel button calls onClose", async () => {
    const onClose = vi.fn();
    render(
      <PollForm
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
      <PollForm
        channelId="ch-1"
        prefill=""
        onSubmit={vi.fn()}
        onClose={onClose}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Close poll form" }));
    expect(onClose).toHaveBeenCalled();
  });
});
