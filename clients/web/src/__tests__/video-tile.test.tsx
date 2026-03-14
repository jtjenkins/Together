import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { VideoTile } from "../components/voice/VideoTile";

function makeStream(): MediaStream {
  return {
    id: "test-stream",
    getTracks: () => [],
    getVideoTracks: () => [],
    getAudioTracks: () => [],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStream;
}

describe("VideoTile", () => {
  it("renders a video element", () => {
    const { container } = render(
      <VideoTile
        stream={makeStream()}
        username="Alice"
        isLocal={false}
        isScreen={false}
      />,
    );
    expect(container.querySelector("video")).not.toBeNull();
  });

  it("shows the username label", () => {
    render(
      <VideoTile
        stream={makeStream()}
        username="Alice"
        isLocal={false}
        isScreen={false}
      />,
    );
    expect(screen.getByText("Alice")).toBeTruthy();
  });

  it("mutes local tiles", () => {
    const { container } = render(
      <VideoTile
        stream={makeStream()}
        username="Me"
        isLocal={true}
        isScreen={false}
      />,
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.muted).toBe(true);
  });

  it("does not mute remote tiles", () => {
    const { container } = render(
      <VideoTile
        stream={makeStream()}
        username="Bob"
        isLocal={false}
        isScreen={false}
      />,
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.muted).toBe(false);
  });

  it("shows Screen badge when isScreen is true", () => {
    render(
      <VideoTile
        stream={makeStream()}
        username="Alice"
        isLocal={false}
        isScreen={true}
      />,
    );
    expect(screen.getByText("Screen")).toBeTruthy();
  });

  it("does not show Screen badge for camera tiles", () => {
    render(
      <VideoTile
        stream={makeStream()}
        username="Alice"
        isLocal={false}
        isScreen={false}
      />,
    );
    expect(screen.queryByText("Screen")).toBeNull();
  });
});
