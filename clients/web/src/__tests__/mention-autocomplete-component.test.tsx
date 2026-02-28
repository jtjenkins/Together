import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MentionAutocomplete } from "../components/messages/MentionAutocomplete";
import type { MemberDto } from "../types";

function makeMember(
  username: string,
  nickname: string | null = null,
): MemberDto {
  return {
    user_id: `id-${username}`,
    username,
    avatar_url: null,
    status: "online",
    nickname,
    joined_at: new Date().toISOString(),
  };
}

const MEMBERS: MemberDto[] = [
  makeMember("alice"),
  makeMember("bob", "Bobby"),
  makeMember("carol"),
];

describe("MentionAutocomplete component", () => {
  it("returns null when no members match the query", () => {
    const { container } = render(
      <MentionAutocomplete
        query="zzz"
        members={MEMBERS}
        activeIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders @username for each matching member", () => {
    render(
      <MentionAutocomplete
        query="ali"
        members={MEMBERS}
        activeIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("@alice")).toBeInTheDocument();
  });

  it("renders nickname when member has one", () => {
    render(
      <MentionAutocomplete
        query="bob"
        members={MEMBERS}
        activeIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Bobby")).toBeInTheDocument();
  });

  it("does not render nickname element when member has none", () => {
    render(
      <MentionAutocomplete
        query="carol"
        members={MEMBERS}
        activeIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Only username row — no extra nickname text
    expect(screen.queryByText("@carol")).toBeInTheDocument();
    // carol has no nickname so the nickname span should not be present
    const rows = screen.getAllByRole("option");
    expect(rows).toHaveLength(1);
    // The row should contain the avatar initial (uppercase) + username — no nickname span
    expect(rows[0].textContent).toBe("C@carol");
  });

  it("marks the active item with aria-selected=true", () => {
    render(
      <MentionAutocomplete
        query=""
        members={MEMBERS}
        activeIndex={1}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[2]).toHaveAttribute("aria-selected", "false");
  });

  it("calls onSelect with the raw username on mouse click", () => {
    const onSelect = vi.fn();
    render(
      <MentionAutocomplete
        query="ali"
        members={MEMBERS}
        activeIndex={0}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );
    fireEvent.mouseDown(screen.getByText("@alice").closest("[role='option']")!);
    expect(onSelect).toHaveBeenCalledWith("alice");
  });
});
