import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SlashCommandPicker } from "../components/messages/SlashCommandPicker";
import { SLASH_COMMANDS, type SlashCommand } from "../utils/slashCommands";

// ── Helpers ──────────────────────────────────────────────────────────────────

function setup(overrides: {
  query?: string;
  activeIndex?: number;
  onSelect?: (cmd: SlashCommand) => void;
  onClose?: () => void;
}) {
  const props = {
    query: overrides.query ?? "",
    activeIndex: overrides.activeIndex ?? 0,
    onSelect: overrides.onSelect ?? vi.fn(),
    onClose: overrides.onClose ?? vi.fn(),
  };
  const user = userEvent.setup();
  const result = render(<SlashCommandPicker {...props} />);
  return { user, ...props, ...result };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SlashCommandPicker", () => {
  describe("rendering matching commands", () => {
    it("renders all commands for an empty query", () => {
      setup({ query: "" });
      // Every command should appear with its /<name> label.
      for (const cmd of SLASH_COMMANDS) {
        expect(screen.getByText(`/${cmd.name}`)).toBeInTheDocument();
      }
    });

    it("renders only matching commands for a prefix query", () => {
      setup({ query: "gi" });
      expect(screen.getByText("/giphy")).toBeInTheDocument();
      // Other commands that do NOT start with "gi" should not be rendered.
      const nonMatching = SLASH_COMMANDS.filter(
        (c) => !c.name.startsWith("gi"),
      );
      for (const cmd of nonMatching) {
        expect(screen.queryByText(`/${cmd.name}`)).not.toBeInTheDocument();
      }
    });

    it("returns nothing (null) when no commands match", () => {
      const { container } = setup({ query: "zzznotacommand" });
      // Component returns null when results are empty — nothing rendered.
      expect(container.firstChild).toBeNull();
    });

    it("renders the listbox role with accessible label", () => {
      setup({ query: "" });
      expect(
        screen.getByRole("listbox", { name: "Slash commands" }),
      ).toBeInTheDocument();
    });

    it("renders argHint when present", () => {
      setup({ query: "gi" });
      // The giphy command has argHint "[search query]"
      expect(screen.getByText("[search query]")).toBeInTheDocument();
    });

    it("renders the description for each matched command", () => {
      setup({ query: "poll" });
      expect(screen.getByText("Create a poll")).toBeInTheDocument();
    });
  });

  describe("active index highlighting", () => {
    it("marks the option at activeIndex as aria-selected=true", () => {
      setup({ query: "", activeIndex: 1 });
      const options = screen.getAllByRole("option");
      expect(options[1]).toHaveAttribute("aria-selected", "true");
    });

    it("all other options have aria-selected=false", () => {
      setup({ query: "", activeIndex: 0 });
      const options = screen.getAllByRole("option");
      options.slice(1).forEach((opt) => {
        expect(opt).toHaveAttribute("aria-selected", "false");
      });
    });
  });

  describe("selection", () => {
    it("calls onSelect with the clicked command", async () => {
      const onSelect = vi.fn();
      const { user } = setup({ query: "", onSelect });

      // Click the /giphy option.
      await user.pointer({
        target: screen.getByText("/giphy"),
        keys: "[MouseLeft]",
      });

      expect(onSelect).toHaveBeenCalledOnce();
      expect(onSelect.mock.calls[0][0].name).toBe("giphy");
    });

    it("does not call onSelect for a non-matching query (no options rendered)", () => {
      const onSelect = vi.fn();
      setup({ query: "zzz", onSelect });
      // The component returns null — no options to click.
      expect(screen.queryByRole("option")).toBeNull();
      expect(onSelect).not.toHaveBeenCalled();
    });
  });
});
