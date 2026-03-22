/**
 * GifPicker component tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GifPicker } from "../components/messages/GifPicker";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    searchGifs: vi.fn(),
    setToken: vi.fn(),
    getToken: vi.fn(),
    setSessionExpiredCallback: vi.fn(),
  },
  ApiRequestError: class extends Error {},
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GifPicker", () => {
  it("renders with initial query", () => {
    render(
      <GifPicker initialQuery="cats" onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByDisplayValue("cats")).toBeInTheDocument();
  });

  it("searches for GIFs after debounce", async () => {
    const mockGifs = [
      {
        url: "https://giphy.com/cats.gif",
        preview_url: "https://giphy.com/cats-preview.gif",
        title: "Cute Cat",
        width: 200,
        height: 150,
      },
    ];
    vi.mocked(api.searchGifs).mockResolvedValue(mockGifs as never);

    render(
      <GifPicker initialQuery="cats" onSelect={vi.fn()} onClose={vi.fn()} />,
    );

    // Advance past the 400ms debounce
    await vi.advanceTimersByTimeAsync(500);

    await waitFor(() => {
      expect(api.searchGifs).toHaveBeenCalledWith("cats", 15);
    });

    await waitFor(() => {
      expect(screen.getByTitle("Cute Cat")).toBeInTheDocument();
    });
  });

  it("selecting a GIF calls onSelect", async () => {
    const onSelect = vi.fn();
    const mockGifs = [
      {
        url: "https://giphy.com/cats.gif",
        preview_url: "https://giphy.com/cats-preview.gif",
        title: "Cute Cat",
        width: 200,
        height: 150,
      },
    ];
    vi.mocked(api.searchGifs).mockResolvedValue(mockGifs as never);

    render(
      <GifPicker initialQuery="cats" onSelect={onSelect} onClose={vi.fn()} />,
    );

    await vi.advanceTimersByTimeAsync(500);

    await waitFor(() => {
      expect(screen.getByTitle("Cute Cat")).toBeInTheDocument();
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByTitle("Cute Cat"));

    expect(onSelect).toHaveBeenCalledWith(mockGifs[0]);
  });

  it("shows error on API failure", async () => {
    vi.mocked(api.searchGifs).mockRejectedValue(new Error("API key missing"));

    render(
      <GifPicker initialQuery="cats" onSelect={vi.fn()} onClose={vi.fn()} />,
    );

    await vi.advanceTimersByTimeAsync(500);

    await waitFor(() => {
      expect(screen.getByText(/Could not load GIFs/)).toBeInTheDocument();
    });
  });

  it("shows no results message for empty results", async () => {
    vi.mocked(api.searchGifs).mockResolvedValue([] as never);

    render(
      <GifPicker
        initialQuery="xyznoexist"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await vi.advanceTimersByTimeAsync(500);

    await waitFor(() => {
      expect(screen.getByText("No GIFs found")).toBeInTheDocument();
    });
  });

  it("close button calls onClose", async () => {
    const onClose = vi.fn();
    render(<GifPicker initialQuery="" onSelect={vi.fn()} onClose={onClose} />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "Close GIF picker" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("does not search when query is empty", async () => {
    render(<GifPicker initialQuery="" onSelect={vi.fn()} onClose={vi.fn()} />);

    await vi.advanceTimersByTimeAsync(500);

    expect(api.searchGifs).not.toHaveBeenCalled();
  });
});
