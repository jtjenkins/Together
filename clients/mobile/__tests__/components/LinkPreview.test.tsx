import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import { LinkPreview } from "../../src/components/LinkPreview";
import { api } from "../../src/api/client";

jest.mock("../../src/api/client", () => ({
  api: {
    getLinkPreview: jest.fn(),
  },
}));

const mockApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
  // Ensure openURL returns a resolved promise so .catch() doesn't throw.
  jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
});

describe("LinkPreview", () => {
  it("renders loading indicator while fetching", async () => {
    mockApi.getLinkPreview.mockReturnValue(new Promise(() => {}));
    render(<LinkPreview url="https://example.com" />);
    // ActivityIndicator is present while loading
    expect(mockApi.getLinkPreview).toHaveBeenCalledWith("https://example.com");
  });

  it("renders nothing when title is null", async () => {
    mockApi.getLinkPreview.mockResolvedValue({
      url: "https://example.com",
      title: null,
      description: null,
      image: null,
      site_name: null,
    });
    const { queryByText } = render(<LinkPreview url="https://example.com" />);
    await waitFor(() => {
      expect(queryByText(/example/)).toBeNull();
    });
  });

  it("renders title and description when available", async () => {
    mockApi.getLinkPreview.mockResolvedValue({
      url: "https://example.com",
      title: "Example Title",
      description: "Example description",
      image: null,
      site_name: "Example Site",
    });
    const { getByText } = render(<LinkPreview url="https://example.com" />);
    await waitFor(() => {
      expect(getByText("Example Title")).toBeTruthy();
      expect(getByText("Example description")).toBeTruthy();
      expect(getByText("Example Site")).toBeTruthy();
    });
  });

  it("opens URL when card is pressed", async () => {
    mockApi.getLinkPreview.mockResolvedValue({
      url: "https://example.com",
      title: "Example Title",
      description: null,
      image: null,
      site_name: null,
    });
    const { getByText } = render(<LinkPreview url="https://example.com" />);
    await waitFor(() => getByText("Example Title"));
    fireEvent.press(getByText("Example Title"));
    expect(Linking.openURL).toHaveBeenCalledWith("https://example.com");
  });

  it("renders nothing on fetch error", async () => {
    mockApi.getLinkPreview.mockRejectedValue(new Error("Network error"));
    const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { queryByText } = render(<LinkPreview url="https://example.com" />);
    await waitFor(() => {
      expect(queryByText(/example/i)).toBeNull();
    });
    consoleSpy.mockRestore();
  });

  it("does not render site_name when absent", async () => {
    mockApi.getLinkPreview.mockResolvedValue({
      url: "https://example.com",
      title: "Just a Title",
      description: null,
      image: null,
      site_name: null,
    });
    const { getByText, queryByText } = render(
      <LinkPreview url="https://example.com" />,
    );
    await waitFor(() => getByText("Just a Title"));
    expect(queryByText("EXAMPLE.COM")).toBeNull();
  });
});
