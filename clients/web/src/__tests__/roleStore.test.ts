/**
 * roleStore tests — covers CRUD operations, event handlers,
 * permission computation, and error handling.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useRoleStore } from "../stores/roleStore";
import { api, ApiRequestError } from "../api/client";
import { useAuthStore } from "../stores/authStore";
import { useServerStore } from "../stores/serverStore";

vi.mock("../api/client", () => {
  class MockApiRequestError extends Error {
    public status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = "ApiRequestError";
    }
  }
  return {
    api: {
      listRoles: vi.fn(),
      createRole: vi.fn(),
      updateRole: vi.fn(),
      deleteRole: vi.fn(),
      assignRole: vi.fn(),
      removeRole: vi.fn(),
      setToken: vi.fn(),
      getToken: vi.fn(),
      setSessionExpiredCallback: vi.fn(),
    },
    ApiRequestError: MockApiRequestError,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  // Reset store state
  useRoleStore.setState({
    roles: {},
    myPermissions: {},
    isLoading: false,
    error: null,
  });
  // Mock auth store
  (useAuthStore as unknown as { getState: () => unknown }).getState = () => ({
    user: { id: "current-user" },
  });
  // Mock server store
  (useServerStore as unknown as { getState: () => unknown }).getState = () => ({
    members: [{ user_id: "current-user", roles: [{ id: "r1" }] }],
  });
});

describe("roleStore — fetchRoles", () => {
  it("fetches roles and updates state", async () => {
    const roles = [
      {
        id: "r1",
        name: "Admin",
        permissions: 8,
        server_id: "s1",
        position: 1,
        color: null,
        created_at: "",
      },
    ];
    vi.mocked(api.listRoles).mockResolvedValue(roles as never);

    await useRoleStore.getState().fetchRoles("s1");

    expect(useRoleStore.getState().roles["s1"]).toEqual(roles);
    expect(useRoleStore.getState().isLoading).toBe(false);
  });

  it("sets error on failure", async () => {
    vi.mocked(api.listRoles).mockRejectedValue(
      new ApiRequestError(403, "Forbidden"),
    );

    await useRoleStore.getState().fetchRoles("s1");

    expect(useRoleStore.getState().error).toBe("Forbidden");
    expect(useRoleStore.getState().isLoading).toBe(false);
  });

  it("sets generic error for non-ApiRequestError", async () => {
    vi.mocked(api.listRoles).mockRejectedValue(new Error("unknown"));

    await useRoleStore.getState().fetchRoles("s1");

    expect(useRoleStore.getState().error).toBe("Failed to fetch roles");
  });
});

describe("roleStore — createRole", () => {
  it("creates role and adds to state", async () => {
    const role = {
      id: "r2",
      name: "Mod",
      permissions: 4,
      server_id: "s1",
      position: 2,
      color: null,
      created_at: "",
    };
    vi.mocked(api.createRole).mockResolvedValue(role as never);

    const result = await useRoleStore.getState().createRole("s1", {
      name: "Mod",
      permissions: 4,
    } as never);

    expect(result).toEqual(role);
    expect(useRoleStore.getState().roles["s1"]).toContainEqual(role);
  });

  it("sets error and rethrows on failure", async () => {
    vi.mocked(api.createRole).mockRejectedValue(
      new ApiRequestError(400, "Bad request"),
    );

    await expect(
      useRoleStore
        .getState()
        .createRole("s1", { name: "X", permissions: 0 } as never),
    ).rejects.toThrow();

    expect(useRoleStore.getState().error).toBe("Bad request");
  });
});

describe("roleStore — updateRole", () => {
  it("updates role in state", async () => {
    useRoleStore.setState({
      roles: {
        s1: [
          {
            id: "r1",
            name: "Admin",
            permissions: 8,
            server_id: "s1",
            position: 1,
            color: null,
            created_at: "",
          },
        ],
      },
    });
    const updated = {
      id: "r1",
      name: "Super Admin",
      permissions: 16,
      server_id: "s1",
      position: 1,
      color: null,
      created_at: "",
    };
    vi.mocked(api.updateRole).mockResolvedValue(updated as never);

    await useRoleStore
      .getState()
      .updateRole("s1", "r1", { name: "Super Admin" } as never);

    expect(useRoleStore.getState().roles["s1"][0].name).toBe("Super Admin");
  });

  it("sets error on failure", async () => {
    vi.mocked(api.updateRole).mockRejectedValue(new Error("fail"));

    await expect(
      useRoleStore.getState().updateRole("s1", "r1", {} as never),
    ).rejects.toThrow();

    expect(useRoleStore.getState().error).toBe("Failed to update role");
  });
});

describe("roleStore — deleteRole", () => {
  it("removes role from state", async () => {
    useRoleStore.setState({
      roles: {
        s1: [
          {
            id: "r1",
            name: "Admin",
            permissions: 8,
            server_id: "s1",
            position: 1,
            color: null,
            created_at: "",
          },
          {
            id: "r2",
            name: "Mod",
            permissions: 4,
            server_id: "s1",
            position: 2,
            color: null,
            created_at: "",
          },
        ],
      },
    });
    vi.mocked(api.deleteRole).mockResolvedValue(undefined as never);

    await useRoleStore.getState().deleteRole("s1", "r1");

    expect(useRoleStore.getState().roles["s1"]).toHaveLength(1);
    expect(useRoleStore.getState().roles["s1"][0].id).toBe("r2");
  });

  it("sets error on failure", async () => {
    vi.mocked(api.deleteRole).mockRejectedValue(
      new ApiRequestError(404, "Not found"),
    );

    await expect(
      useRoleStore.getState().deleteRole("s1", "r1"),
    ).rejects.toThrow();

    expect(useRoleStore.getState().error).toBe("Not found");
  });
});

describe("roleStore — assignRole / removeRole", () => {
  it("assignRole calls API", async () => {
    vi.mocked(api.assignRole).mockResolvedValue(undefined as never);
    await useRoleStore.getState().assignRole("s1", "u1", "r1");
    expect(api.assignRole).toHaveBeenCalledWith("s1", "u1", "r1");
  });

  it("assignRole sets error on failure", async () => {
    vi.mocked(api.assignRole).mockRejectedValue(new Error("fail"));

    await expect(
      useRoleStore.getState().assignRole("s1", "u1", "r1"),
    ).rejects.toThrow();

    expect(useRoleStore.getState().error).toBe("Failed to assign role");
  });

  it("removeRole calls API", async () => {
    vi.mocked(api.removeRole).mockResolvedValue(undefined as never);
    await useRoleStore.getState().removeRole("s1", "u1", "r1");
    expect(api.removeRole).toHaveBeenCalledWith("s1", "u1", "r1");
  });

  it("removeRole sets error on failure", async () => {
    vi.mocked(api.removeRole).mockRejectedValue(
      new ApiRequestError(403, "Forbidden"),
    );

    await expect(
      useRoleStore.getState().removeRole("s1", "u1", "r1"),
    ).rejects.toThrow();

    expect(useRoleStore.getState().error).toBe("Forbidden");
  });
});

describe("roleStore — event handlers", () => {
  it("handleRoleCreate adds role to server", () => {
    const role = {
      id: "r1",
      name: "Admin",
      permissions: 8,
      server_id: "s1",
      position: 1,
      color: null,
      created_at: "",
    };
    useRoleStore.getState().handleRoleCreate(role as never);

    expect(useRoleStore.getState().roles["s1"]).toContainEqual(role);
  });

  it("handleRoleUpdate replaces role in state", () => {
    useRoleStore.setState({
      roles: {
        s1: [
          {
            id: "r1",
            name: "Old",
            permissions: 0,
            server_id: "s1",
            position: 1,
            color: null,
            created_at: "",
          },
        ],
      },
    });
    const updated = {
      id: "r1",
      name: "New",
      permissions: 8,
      server_id: "s1",
      position: 1,
      color: null,
      created_at: "",
    };
    useRoleStore.getState().handleRoleUpdate(updated as never);

    expect(useRoleStore.getState().roles["s1"][0].name).toBe("New");
  });

  it("handleRoleDelete removes role", () => {
    useRoleStore.setState({
      roles: {
        s1: [
          {
            id: "r1",
            name: "Admin",
            permissions: 8,
            server_id: "s1",
            position: 1,
            color: null,
            created_at: "",
          },
        ],
      },
    });
    useRoleStore
      .getState()
      .handleRoleDelete({ server_id: "s1", role_id: "r1" });

    expect(useRoleStore.getState().roles["s1"]).toHaveLength(0);
  });

  it("handleMemberRoleAdd recomputes permissions when current user is affected", () => {
    useRoleStore.setState({
      roles: {
        s1: [
          {
            id: "r1",
            name: "Admin",
            permissions: 8,
            server_id: "s1",
            position: 1,
            color: null,
            created_at: "",
          },
        ],
      },
    });
    useRoleStore.getState().handleMemberRoleAdd({
      user_id: "current-user",
      role_id: "r1",
      server_id: "s1",
      role_name: "Admin",
      role_color: null,
    } as never);

    expect(useRoleStore.getState().myPermissions["s1"]).toBe(8);
  });

  it("handleMemberRoleRemove recomputes permissions when current user is affected", () => {
    useRoleStore.setState({
      roles: {
        s1: [
          {
            id: "r1",
            name: "Admin",
            permissions: 8,
            server_id: "s1",
            position: 1,
            color: null,
            created_at: "",
          },
        ],
      },
      myPermissions: { s1: 8 },
    });

    // Simulate removing the role — update server store mock
    (useServerStore as unknown as { getState: () => unknown }).getState =
      () => ({
        members: [{ user_id: "current-user", roles: [] }],
      });

    useRoleStore.getState().handleMemberRoleRemove({
      user_id: "current-user",
      role_id: "r1",
      server_id: "s1",
      role_name: "Admin",
      role_color: null,
    } as never);

    expect(useRoleStore.getState().myPermissions["s1"]).toBe(0);
  });

  it("handleMemberRoleAdd does not recompute for other users", () => {
    const spy = vi.spyOn(useRoleStore.getState(), "computeMyPermissions");
    useRoleStore.getState().handleMemberRoleAdd({
      user_id: "other-user",
      role_id: "r1",
      server_id: "s1",
      role_name: "Admin",
      role_color: null,
    } as never);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("roleStore — setRolesFromReady", () => {
  it("sets roles from READY payload", () => {
    useRoleStore.getState().setRolesFromReady({
      s1: [
        {
          id: "r1",
          name: "Admin",
          permissions: 8,
          server_id: "s1",
          position: 1,
          color: null,
          created_at: "",
        },
      ],
    } as never);

    expect(useRoleStore.getState().roles["s1"]).toHaveLength(1);
  });

  it("computes permissions when memberRoles are provided", () => {
    useRoleStore.getState().setRolesFromReady(
      {
        s1: [
          {
            id: "r1",
            name: "Admin",
            permissions: 8,
            server_id: "s1",
            position: 1,
            color: null,
            created_at: "",
          },
        ],
      } as never,
      {
        s1: [{ id: "r1", name: "Admin", color: null }],
      } as never,
    );

    expect(useRoleStore.getState().myPermissions["s1"]).toBe(8);
  });
});

describe("roleStore — computeMyPermissions", () => {
  it("computes no permissions when user has no roles", () => {
    (useServerStore as unknown as { getState: () => unknown }).getState =
      () => ({
        members: [{ user_id: "current-user", roles: [] }],
      });
    useRoleStore.setState({
      roles: {
        s1: [
          {
            id: "r1",
            name: "Admin",
            permissions: 8,
            server_id: "s1",
            position: 1,
            color: null,
            created_at: "",
          },
        ],
      },
    });

    useRoleStore.getState().computeMyPermissions("s1");

    expect(useRoleStore.getState().myPermissions["s1"]).toBe(0);
  });

  it("does nothing when current user is null", () => {
    (useAuthStore as unknown as { getState: () => unknown }).getState = () => ({
      user: null,
    });

    useRoleStore.getState().computeMyPermissions("s1");

    // Should not crash
    expect(useRoleStore.getState().myPermissions).toEqual({});
  });
});

describe("roleStore — clearError", () => {
  it("clears the error state", () => {
    useRoleStore.setState({ error: "some error" });
    useRoleStore.getState().clearError();
    expect(useRoleStore.getState().error).toBeNull();
  });
});
