/**
 * EmojiAutocomplete component tests.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmojiAutocomplete } from "../components/messages/EmojiAutocomplete";

vi.mock("../stores/customEmojiStore", () => ({
  useCustomEmojiStore: (
    selector: (state: Record<string, unknown>) => unknown,
  ) =>
    selector({
      getEmojis: () => [],
    }),
}));

vi.mock("../api/client", () => ({
  api: {
    setToken: vi.fn(),
    getToken: vi.fn(),
    setSessionExpiredCallback: vi.fn(),
  },
  ApiRequestError: class extends Error {},
}));

describe("EmojiAutocomplete", () => {
  it("renders emoji suggestions for a matching query", () => {
    render(
      <EmojiAutocomplete
        query="fire"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        activeIndex={0}
      />,
    );

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText(":fire:")).toBeInTheDocument();
  });

  it("returns null for non-matching query", () => {
    const { container } = render(
      <EmojiAutocomplete
        query="zzzznothing999"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        activeIndex={0}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("calls onSelect when an emoji option is clicked", () => {
    const onSelect = vi.fn();
    render(
      <EmojiAutocomplete
        query="heart"
        onSelect={onSelect}
        onClose={vi.fn()}
        activeIndex={0}
      />,
    );

    const options = screen.getAllByRole("option");
    fireEvent.mouseDown(options[0]);

    expect(onSelect).toHaveBeenCalled();
  });

  it("highlights the active index option", () => {
    render(
      <EmojiAutocomplete
        query="smile"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        activeIndex={1}
      />,
    );

    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
  });
});
