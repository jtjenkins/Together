import { api, ApiRequestError } from "../../src/api/client";
import { storage } from "../../src/utils/storage";

// Mock storage so we control SERVER_URL_KEY reads
jest.mock("../../src/utils/storage", () => ({
  storage: {
    getItem: jest.fn(() => "https://test.server"),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
  },
}));

const mockFetch = jest.fn();
(globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch;

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  // Reset the client state between tests
  api.setToken(null);
  api.setServerUrl("https://test.server");
});

describe("ApiClient", () => {
  describe("setToken / Authorization header", () => {
    it("adds Authorization header when token is set", async () => {
      api.setToken("mytoken");
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "1" }));
      await api.getCurrentUser();
      const [, opts] = mockFetch.mock.calls[0];
      expect((opts.headers as Record<string, string>)["Authorization"]).toBe(
        "Bearer mytoken",
      );
    });

    it("omits Authorization header when token is null", async () => {
      api.setToken(null);
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "1" }));
      await api.getCurrentUser();
      const [, opts] = mockFetch.mock.calls[0];
      expect(
        (opts.headers as Record<string, string>)["Authorization"],
      ).toBeUndefined();
    });
  });

  describe("GET request", () => {
    it("resolves with parsed JSON on 200", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ servers: [] }));
      const result = await api.listServers();
      expect(result).toEqual({ servers: [] });
    });
  });

  describe("POST request", () => {
    it("sends JSON body and Content-Type header", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ access_token: "t", refresh_token: "r", user: {} }),
      );
      await api.login({ username: "alice", password: "pass" });
      const [, opts] = mockFetch.mock.calls[0];
      expect((opts.headers as Record<string, string>)["Content-Type"]).toBe(
        "application/json",
      );
      expect(JSON.parse(opts.body as string)).toEqual({
        username: "alice",
        password: "pass",
      });
    });
  });

  describe("error handling", () => {
    it("throws ApiRequestError on 401", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: "Unauthorized" }),
      });
      await expect(api.getCurrentUser()).rejects.toBeInstanceOf(
        ApiRequestError,
      );
    });

    it("includes the status code in ApiRequestError", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: "Forbidden" }),
      });
      try {
        await api.getCurrentUser();
      } catch (err) {
        expect((err as ApiRequestError).status).toBe(403);
      }
    });

    it("throws ApiRequestError on 500", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Server error" }),
      });
      await expect(api.listServers()).rejects.toBeInstanceOf(ApiRequestError);
    });
  });

  describe("204 No Content", () => {
    it("returns undefined for 204 responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: jest.fn(),
      });
      const result = await api.deleteServer("srv-1");
      expect(result).toBeUndefined();
    });
  });

  describe("setServerUrl", () => {
    it("throws TypeError for an invalid URL", () => {
      expect(() => api.setServerUrl("not-a-url")).toThrow(TypeError);
    });

    it("accepts a valid https URL", () => {
      expect(() => api.setServerUrl("https://my.server")).not.toThrow();
    });
  });

  describe("login", () => {
    it("calls /auth/login with POST", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          access_token: "at",
          refresh_token: "rt",
          user: { id: "u1" },
        }),
      );
      const res = await api.login({ username: "bob", password: "secret" });
      expect(res.access_token).toBe("at");
      const [url] = mockFetch.mock.calls[0];
      expect(url).toMatch(/\/auth\/login$/);
    });
  });

  describe("register", () => {
    it("calls /auth/register with POST", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          access_token: "at",
          refresh_token: "rt",
          user: { id: "u2" },
        }),
      );
      await api.register({ username: "carol", password: "secret" });
      const [url] = mockFetch.mock.calls[0];
      expect(url).toMatch(/\/auth\/register$/);
    });
  });
});
