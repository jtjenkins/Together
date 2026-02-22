// Mock AsyncStorage before any imports so native module is never loaded
const mockAsyncStorage: Record<string, string> = {};

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    multiGet: jest.fn((keys: string[]) =>
      Promise.resolve(
        keys.map(
          (k) => [k, mockAsyncStorage[k] ?? null] as [string, string | null],
        ),
      ),
    ),
    getItem: jest.fn((key: string) =>
      Promise.resolve(mockAsyncStorage[key] ?? null),
    ),
    setItem: jest.fn((key: string, value: string) => {
      mockAsyncStorage[key] = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      delete mockAsyncStorage[key];
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      Object.keys(mockAsyncStorage).forEach((k) => delete mockAsyncStorage[k]);
      return Promise.resolve();
    }),
  },
}));

// Import after mock is registered
import { initStorage, storage } from "../../src/utils/storage";
import AsyncStorage from "@react-native-async-storage/async-storage";

function clearAsyncStorageData() {
  Object.keys(mockAsyncStorage).forEach((k) => delete mockAsyncStorage[k]);
}

beforeEach(() => {
  clearAsyncStorageData();
  // Reset the module-level in-memory cache between tests
  storage.clear();
  jest.clearAllMocks();
  // Reinitialise the mock implementations since jest.clearAllMocks resets them
  (AsyncStorage.multiGet as jest.Mock).mockImplementation((keys: string[]) =>
    Promise.resolve(
      keys.map(
        (k) => [k, mockAsyncStorage[k] ?? null] as [string, string | null],
      ),
    ),
  );
  (AsyncStorage.setItem as jest.Mock).mockImplementation(
    (key: string, value: string) => {
      mockAsyncStorage[key] = value;
      return Promise.resolve();
    },
  );
  (AsyncStorage.removeItem as jest.Mock).mockImplementation((key: string) => {
    delete mockAsyncStorage[key];
    return Promise.resolve();
  });
  (AsyncStorage.clear as jest.Mock).mockImplementation(() => {
    Object.keys(mockAsyncStorage).forEach((k) => delete mockAsyncStorage[k]);
    return Promise.resolve();
  });
});

describe("storage", () => {
  describe("initStorage", () => {
    it("loads existing values into the cache", async () => {
      mockAsyncStorage["together_server_url"] = "https://example.com";
      mockAsyncStorage["together_access_token"] = "tok123";

      await initStorage();

      expect(storage.getItem("together_server_url")).toBe(
        "https://example.com",
      );
      expect(storage.getItem("together_access_token")).toBe("tok123");
    });

    it("leaves missing keys as null in the cache", async () => {
      await initStorage();
      expect(storage.getItem("together_server_url")).toBeNull();
    });
  });

  describe("storage.getItem", () => {
    it("returns null for a key not set", () => {
      expect(storage.getItem("nonexistent_key_xyz")).toBeNull();
    });

    it("returns the value after setItem", () => {
      storage.setItem("key1", "value1");
      expect(storage.getItem("key1")).toBe("value1");
    });
  });

  describe("storage.setItem", () => {
    it("persists to AsyncStorage asynchronously", async () => {
      storage.setItem("key2", "value2");
      await new Promise((r) => setTimeout(r, 0));
      expect(AsyncStorage.setItem).toHaveBeenCalledWith("key2", "value2");
    });
  });

  describe("storage.removeItem", () => {
    it("removes the key from the cache immediately", () => {
      storage.setItem("key3", "value3");
      storage.removeItem("key3");
      expect(storage.getItem("key3")).toBeNull();
    });

    it("calls AsyncStorage.removeItem asynchronously", async () => {
      storage.setItem("key4", "value4");
      storage.removeItem("key4");
      await new Promise((r) => setTimeout(r, 0));
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith("key4");
    });
  });

  describe("storage.clear", () => {
    it("clears keys from the in-memory cache", () => {
      storage.setItem("a", "1");
      storage.setItem("b", "2");
      storage.clear();
      expect(storage.getItem("a")).toBeNull();
      expect(storage.getItem("b")).toBeNull();
    });

    it("calls AsyncStorage.clear asynchronously", async () => {
      storage.clear();
      await new Promise((r) => setTimeout(r, 0));
      expect(AsyncStorage.clear).toHaveBeenCalled();
    });
  });
});
