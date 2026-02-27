import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmojiPicker } from "../components/messages/EmojiPicker";
import { EMOJI_CATEGORIES } from "../utils/emoji";

function setup(overrides?: { onSelect?: () => void; onClose?: () => void }) {
  const onSelect = overrides?.onSelect ?? vi.fn();
  const onClose = overrides?.onClose ?? vi.fn();
  const user = userEvent.setup();
  const result = render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
  return { user, onSelect, onClose, ...result };
}

describe("EmojiPicker", () => {
  describe("initial render", () => {
    it("renders a search input", () => {
      setup();
      expect(screen.getByPlaceholderText("Search emoji…")).toBeInTheDocument();
    });

    it("renders a tab for every category", () => {
      setup();
      for (const cat of EMOJI_CATEGORIES) {
        // Each tab renders the category icon as its text content
        expect(screen.getByTitle(cat.label)).toBeInTheDocument();
      }
    });

    it("shows the first category's emojis by default", () => {
      setup();
      const firstCat = EMOJI_CATEGORIES[0];
      // At least one emoji from the first category should be visible
      const firstEmoji = firstCat.emojis[0];
      expect(screen.getByTitle(`:${firstEmoji.name}:`)).toBeInTheDocument();
    });

    it("each emoji button has a title showing its :name:", () => {
      setup();
      const firstCat = EMOJI_CATEGORIES[0];
      const sample = firstCat.emojis[2];
      const btn = screen.getByTitle(`:${sample.name}:`);
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveTextContent(sample.emoji);
    });
  });

  describe("emoji selection", () => {
    it("calls onSelect with the emoji character when an emoji is clicked", async () => {
      const { user, onSelect } = setup();
      const firstCat = EMOJI_CATEGORIES[0];
      const target = firstCat.emojis[0];
      await user.click(screen.getByTitle(`:${target.name}:`));
      expect(onSelect).toHaveBeenCalledWith(target.emoji);
    });

    it("calls onClose after selecting an emoji", async () => {
      const { user, onClose } = setup();
      const target = EMOJI_CATEGORIES[0].emojis[0];
      await user.click(screen.getByTitle(`:${target.name}:`));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("calls onSelect before onClose", async () => {
      const callOrder: string[] = [];
      const onSelect = vi.fn(() => callOrder.push("select"));
      const onClose = vi.fn(() => callOrder.push("close"));
      const user = userEvent.setup();
      render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
      const target = EMOJI_CATEGORIES[0].emojis[0];
      await user.click(screen.getByTitle(`:${target.name}:`));
      expect(callOrder).toEqual(["select", "close"]);
    });
  });

  describe("category tabs", () => {
    it("clicking a different category tab shows that category's emojis", async () => {
      const { user } = setup();
      const secondCat = EMOJI_CATEGORIES[1];
      await user.click(screen.getByTitle(secondCat.label));
      // An emoji from the second category should now be present
      const sample = secondCat.emojis[0];
      expect(screen.getByTitle(`:${sample.name}:`)).toBeInTheDocument();
    });

    it("clicking a category tab hides the previous category's unique emojis", async () => {
      const { user } = setup();
      const firstCat = EMOJI_CATEGORIES[0];
      const secondCat = EMOJI_CATEGORIES[1];
      // Pick an emoji that's only in the first category (not in the second)
      const firstOnlyEmoji = firstCat.emojis.find(
        (e) => !secondCat.emojis.some((e2) => e2.name === e.name),
      );
      // Switch to second category
      await user.click(screen.getByTitle(secondCat.label));
      if (firstOnlyEmoji) {
        expect(
          screen.queryByTitle(`:${firstOnlyEmoji.name}:`),
        ).not.toBeInTheDocument();
      }
    });
  });

  describe("search", () => {
    it("typing in the search box hides the category tabs", async () => {
      const { user } = setup();
      const search = screen.getByPlaceholderText("Search emoji…");
      await user.type(search, "smile");
      // None of the category tab labels should be visible when searching
      for (const cat of EMOJI_CATEGORIES) {
        expect(screen.queryByTitle(cat.label)).not.toBeInTheDocument();
      }
    });

    it("typing 'thumbsup' shows the 👍 emoji", async () => {
      const { user } = setup();
      await user.type(screen.getByPlaceholderText("Search emoji…"), "thumbsup");
      expect(screen.getByTitle(":thumbsup:")).toBeInTheDocument();
    });

    it("clicking a search result calls onSelect with the correct emoji", async () => {
      const { user, onSelect } = setup();
      await user.type(screen.getByPlaceholderText("Search emoji…"), "thumbsup");
      await user.click(screen.getByTitle(":thumbsup:"));
      expect(onSelect).toHaveBeenCalledWith("👍");
    });

    it("shows 'No results' for a query that matches nothing", async () => {
      const { user } = setup();
      await user.type(
        screen.getByPlaceholderText("Search emoji…"),
        "zzzz_no_match_999",
      );
      expect(screen.getByText("No results")).toBeInTheDocument();
    });

    it("clearing the search restores the category tabs", async () => {
      const { user } = setup();
      const search = screen.getByPlaceholderText("Search emoji…");
      await user.type(search, "smile");
      await user.clear(search);
      // Category tabs should reappear
      expect(screen.getByTitle(EMOJI_CATEGORIES[0].label)).toBeInTheDocument();
    });
  });

  describe("keyboard and focus", () => {
    it("focuses the search input on mount", () => {
      setup();
      expect(screen.getByPlaceholderText("Search emoji…")).toHaveFocus();
    });

    it("pressing Escape calls onClose", async () => {
      const { user, onClose } = setup();
      await user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe("outside click", () => {
    it("clicking outside the picker calls onClose", async () => {
      const { user, onClose } = setup();
      // Click the document body, which is outside the picker element
      await user.click(document.body);
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});
