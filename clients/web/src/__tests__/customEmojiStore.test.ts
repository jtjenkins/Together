import { describe, it, expect, vi, beforeEach } from "vitest";
import { useCustomEmojiStore } from "../stores/customEmojiStore";
import type { CustomEmoji } from "../types";

const mockEmoji: CustomEmoji = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  server_id: "server-1",
  created_by: "user-1",
  name: "test_emoji",
  url: "/emojis/aaaaaaaa-0000-0000-0000-000000000001",
  content_type: "image/png",
  file_size: 1024,
  created_at: "2026-03-14T00:00:00Z",
};

beforeEach(() => {
  useCustomEmojiStore.setState({ emojis: {} });
});

describe("customEmojiStore", () => {
  it("addEmoji stores emoji by server_id", () => {
    useCustomEmojiStore.getState().addEmoji(mockEmoji);
    const emojis = useCustomEmojiStore.getState().getEmojis("server-1");
    expect(emojis).toHaveLength(1);
    expect(emojis[0].name).toBe("test_emoji");
  });

  it("addEmoji is idempotent", () => {
    useCustomEmojiStore.getState().addEmoji(mockEmoji);
    useCustomEmojiStore.getState().addEmoji(mockEmoji);
    expect(useCustomEmojiStore.getState().getEmojis("server-1")).toHaveLength(
      1,
    );
  });

  it("removeEmoji removes by id", () => {
    useCustomEmojiStore.getState().addEmoji(mockEmoji);
    useCustomEmojiStore.getState().removeEmoji("server-1", mockEmoji.id);
    expect(useCustomEmojiStore.getState().getEmojis("server-1")).toHaveLength(
      0,
    );
  });

  it("getEmojis returns [] for unknown server", () => {
    expect(useCustomEmojiStore.getState().getEmojis("unknown")).toEqual([]);
  });

  it("loadEmojis is a no-op if server already loaded", async () => {
    useCustomEmojiStore.setState({ emojis: { "server-1": [mockEmoji] } });
    const spy = vi.spyOn(useCustomEmojiStore.getState(), "refreshEmojis");
    await useCustomEmojiStore.getState().loadEmojis("server-1");
    expect(spy).not.toHaveBeenCalled();
  });
});
