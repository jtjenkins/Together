/**
 * UserProfileCard component tests.
 *
 * Tests loading state, error state, full profile rendering,
 * outside click close, and escape key close.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { UserProfileCard } from "../components/users/UserProfileCard";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    getUserProfile: vi.fn(),
    setToken: vi.fn(),
    getToken: vi.fn(),
    setSessionExpiredCallback: vi.fn(),
  },
  ApiRequestError: class extends Error {},
}));

function makeAnchorRef() {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({
      top: 100,
      left: 50,
      right: 200,
      bottom: 120,
      width: 150,
      height: 20,
      x: 50,
      y: 100,
    }) as DOMRect;
  document.body.appendChild(el);
  return { current: el };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("UserProfileCard", () => {
  it("shows loading state initially", () => {
    vi.mocked(api.getUserProfile).mockReturnValue(new Promise(() => {}));
    const anchorRef = makeAnchorRef();

    render(
      <UserProfileCard userId="u1" anchorRef={anchorRef} onClose={vi.fn()} />,
    );

    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it("shows profile unavailable when API fails", async () => {
    vi.mocked(api.getUserProfile).mockRejectedValue(new Error("404"));
    const anchorRef = makeAnchorRef();

    render(
      <UserProfileCard userId="u1" anchorRef={anchorRef} onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Profile unavailable")).toBeInTheDocument();
    });
  });

  it("renders full profile with avatar, username, pronouns, bio, custom status, and activity", async () => {
    vi.mocked(api.getUserProfile).mockResolvedValue({
      id: "u1",
      username: "TestUser",
      avatar_url: "https://example.com/avatar.png",
      status: "online",
      pronouns: "they/them",
      bio: "Hello world",
      custom_status: "Coding",
      activity: "Playing Rust",
    } as never);
    const anchorRef = makeAnchorRef();

    render(
      <UserProfileCard userId="u1" anchorRef={anchorRef} onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("TestUser")).toBeInTheDocument();
    });

    expect(screen.getByText("they/them")).toBeInTheDocument();
    expect(screen.getByText("Hello world")).toBeInTheDocument();
    expect(screen.getByText("Coding")).toBeInTheDocument();
    expect(screen.getByText("Playing Rust")).toBeInTheDocument();
    expect(screen.getByText("About Me")).toBeInTheDocument();
    const img = screen.getByRole("dialog").querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("https://example.com/avatar.png");
  });

  it("renders avatar fallback when no avatar_url", async () => {
    vi.mocked(api.getUserProfile).mockResolvedValue({
      id: "u1",
      username: "alice",
      avatar_url: null,
      status: "away",
      pronouns: null,
      bio: null,
      custom_status: null,
      activity: null,
    } as never);
    const anchorRef = makeAnchorRef();

    render(
      <UserProfileCard userId="u1" anchorRef={anchorRef} onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("A")).toBeInTheDocument();
    });
  });

  it("closes on outside click", async () => {
    vi.mocked(api.getUserProfile).mockResolvedValue({
      id: "u1",
      username: "alice",
      avatar_url: null,
      status: "online",
      pronouns: null,
      bio: null,
      custom_status: null,
      activity: null,
    } as never);
    const anchorRef = makeAnchorRef();
    const onClose = vi.fn();

    render(
      <UserProfileCard userId="u1" anchorRef={anchorRef} onClose={onClose} />,
    );

    await waitFor(() => {
      expect(screen.getByText("alice")).toBeInTheDocument();
    });

    // Click outside the card and anchor
    const outsideEl = document.createElement("div");
    document.body.appendChild(outsideEl);
    fireEvent.mouseDown(outsideEl);

    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape key", async () => {
    vi.mocked(api.getUserProfile).mockResolvedValue({
      id: "u1",
      username: "bob",
      avatar_url: null,
      status: "dnd",
      pronouns: null,
      bio: null,
      custom_status: null,
      activity: null,
    } as never);
    const anchorRef = makeAnchorRef();
    const onClose = vi.fn();

    render(
      <UserProfileCard userId="u1" anchorRef={anchorRef} onClose={onClose} />,
    );

    await waitFor(() => {
      expect(screen.getByText("bob")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  it("renders profile without optional fields", async () => {
    vi.mocked(api.getUserProfile).mockResolvedValue({
      id: "u1",
      username: "minimal",
      avatar_url: null,
      status: "offline",
      pronouns: null,
      bio: null,
      custom_status: null,
      activity: null,
    } as never);
    const anchorRef = makeAnchorRef();

    render(
      <UserProfileCard userId="u1" anchorRef={anchorRef} onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("minimal")).toBeInTheDocument();
    });

    expect(screen.queryByText("About Me")).not.toBeInTheDocument();
  });
});
