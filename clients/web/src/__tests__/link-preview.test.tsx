import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { LinkPreview } from "../components/messages/LinkPreview";

vi.mock("../api/client", () => ({
  api: {
    getLinkPreview: vi.fn(),
  },
}));

import { api } from "../api/client";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LinkPreview", () => {
  describe("loading state", () => {
    it("renders a skeleton while loading", () => {
      vi.mocked(api.getLinkPreview).mockReturnValue(new Promise(() => {}));
      const { container } = render(<LinkPreview url="https://example.com" />);
      expect(container.firstChild).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });

  describe("successful fetch", () => {
    it("renders site name, title, and description", async () => {
      vi.mocked(api.getLinkPreview).mockResolvedValue({
        url: "https://example.com",
        title: "Example Title",
        description: "An example description.",
        image: null,
        site_name: "Example Site",
      });
      render(<LinkPreview url="https://example.com" />);
      await waitFor(() =>
        expect(screen.getByText("Example Title")).toBeInTheDocument(),
      );
      expect(screen.getByText("An example description.")).toBeInTheDocument();
      expect(screen.getByText("Example Site")).toBeInTheDocument();
    });

    it("renders a thumbnail image when og:image is present", async () => {
      vi.mocked(api.getLinkPreview).mockResolvedValue({
        url: "https://example.com",
        title: "With Image",
        description: null,
        image: "https://example.com/og.jpg",
        site_name: null,
      });
      render(<LinkPreview url="https://example.com" />);
      await waitFor(() => {
        const img = screen.getByRole("img");
        expect(img).toHaveAttribute("src", "https://example.com/og.jpg");
      });
    });

    it("title links to the URL in a new tab", async () => {
      vi.mocked(api.getLinkPreview).mockResolvedValue({
        url: "https://example.com",
        title: "Click Me",
        description: null,
        image: null,
        site_name: null,
      });
      render(<LinkPreview url="https://example.com" />);
      await waitFor(() => {
        const link = screen.getByRole("link", { name: "Click Me" });
        expect(link).toHaveAttribute("href", "https://example.com");
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noreferrer");
      });
    });

    it("renders nothing (empty) when title is null", async () => {
      vi.mocked(api.getLinkPreview).mockResolvedValue({
        url: "https://example.com",
        title: null,
        description: "No title here",
        image: null,
        site_name: null,
      });
      const { container } = render(<LinkPreview url="https://example.com" />);
      await waitFor(() => {
        expect(container).toBeEmptyDOMElement();
      });
    });

    it("skips site_name when null", async () => {
      vi.mocked(api.getLinkPreview).mockResolvedValue({
        url: "https://example.com",
        title: "Just Title",
        description: null,
        image: null,
        site_name: null,
      });
      render(<LinkPreview url="https://example.com" />);
      await waitFor(() =>
        expect(screen.getByText("Just Title")).toBeInTheDocument(),
      );
      expect(screen.queryByTestId("site-name")).not.toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("renders nothing when the API call rejects", async () => {
      vi.mocked(api.getLinkPreview).mockRejectedValue(
        new Error("Network error"),
      );
      const { container } = render(<LinkPreview url="https://example.com" />);
      await waitFor(() => {
        expect(container).toBeEmptyDOMElement();
      });
    });
  });
});
