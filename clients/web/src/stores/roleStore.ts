import { create } from "zustand";
import type {
  RoleDto,
  MemberRoleInfo,
  CreateRoleRequest,
  UpdateRoleRequest,
  RoleDeleteEvent,
  MemberRoleEvent,
  ChannelPermissionOverride,
} from "../types";
import { PERMISSIONS } from "../types";
import { api, ApiRequestError } from "../api/client";
import { useAuthStore } from "./authStore";
import { useServerStore } from "./serverStore";

interface RoleState {
  roles: Record<string, RoleDto[]>;
  myPermissions: Record<string, number>;
  channelOverrides: Record<string, ChannelPermissionOverride[]>;
  isLoading: boolean;
  error: string | null;

  fetchRoles: (serverId: string) => Promise<void>;
  createRole: (serverId: string, data: CreateRoleRequest) => Promise<RoleDto>;
  updateRole: (
    serverId: string,
    roleId: string,
    data: UpdateRoleRequest,
  ) => Promise<RoleDto>;
  deleteRole: (serverId: string, roleId: string) => Promise<void>;
  assignRole: (
    serverId: string,
    userId: string,
    roleId: string,
  ) => Promise<void>;
  removeRole: (
    serverId: string,
    userId: string,
    roleId: string,
  ) => Promise<void>;

  computeMyPermissions: (serverId: string) => void;
  setRolesFromReady: (
    serverRoles: Record<string, RoleDto[]>,
    memberRoles?: Record<string, MemberRoleInfo[]>,
  ) => void;

  setChannelOverridesFromReady: (
    overrides: Record<string, ChannelPermissionOverride[]>,
  ) => void;
  handleChannelOverrideUpdate: (override: ChannelPermissionOverride) => void;
  handleChannelOverrideDelete: (event: {
    channel_id: string;
    override_id: string;
  }) => void;
  computeChannelPermissions: (serverId: string, channelId: string) => number;

  handleRoleCreate: (role: RoleDto) => void;
  handleRoleUpdate: (role: RoleDto) => void;
  handleRoleDelete: (event: RoleDeleteEvent) => void;
  handleMemberRoleAdd: (event: MemberRoleEvent) => void;
  handleMemberRoleRemove: (event: MemberRoleEvent) => void;

  clearError: () => void;
}

function computePermissions(roles: RoleDto[], myRoleIds: string[]): number {
  let perms = 0;
  for (const role of roles) {
    if (myRoleIds.includes(role.id)) {
      perms |= role.permissions;
    }
  }
  return perms;
}

export const useRoleStore = create<RoleState>((set, get) => ({
  roles: {},
  myPermissions: {},
  channelOverrides: {},
  isLoading: false,
  error: null,

  fetchRoles: async (serverId) => {
    set({ isLoading: true });
    try {
      const roles = await api.listRoles(serverId);
      set((state) => ({
        roles: { ...state.roles, [serverId]: roles },
        isLoading: false,
      }));
      get().computeMyPermissions(serverId);
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to fetch roles";
      set({ error: message, isLoading: false });
    }
  },

  createRole: async (serverId, data) => {
    try {
      const role = await api.createRole(serverId, data);
      set((state) => ({
        roles: {
          ...state.roles,
          [serverId]: [...(state.roles[serverId] || []), role],
        },
      }));
      return role;
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to create role";
      set({ error: message });
      throw err;
    }
  },

  updateRole: async (serverId, roleId, data) => {
    try {
      const updated = await api.updateRole(serverId, roleId, data);
      set((state) => ({
        roles: {
          ...state.roles,
          [serverId]: (state.roles[serverId] || []).map((r) =>
            r.id === roleId ? updated : r,
          ),
        },
      }));
      get().computeMyPermissions(serverId);
      return updated;
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to update role";
      set({ error: message });
      throw err;
    }
  },

  deleteRole: async (serverId, roleId) => {
    try {
      await api.deleteRole(serverId, roleId);
      set((state) => ({
        roles: {
          ...state.roles,
          [serverId]: (state.roles[serverId] || []).filter(
            (r) => r.id !== roleId,
          ),
        },
      }));
      get().computeMyPermissions(serverId);
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to delete role";
      set({ error: message });
      throw err;
    }
  },

  assignRole: async (serverId, userId, roleId) => {
    try {
      await api.assignRole(serverId, userId, roleId);
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to assign role";
      set({ error: message });
      throw err;
    }
  },

  removeRole: async (serverId, userId, roleId) => {
    try {
      await api.removeRole(serverId, userId, roleId);
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Failed to remove role";
      set({ error: message });
      throw err;
    }
  },

  computeMyPermissions: (serverId) => {
    const currentUserId = useAuthStore.getState().user?.id;
    if (!currentUserId) return;

    const members = useServerStore.getState().members;
    const member = members.find((m) => m.user_id === currentUserId);
    const myRoleIds = (member?.roles || []).map((r) => r.id);
    const serverRoles = get().roles[serverId] || [];
    const perms = computePermissions(serverRoles, myRoleIds);

    set((state) => ({
      myPermissions: { ...state.myPermissions, [serverId]: perms },
    }));
  },

  setRolesFromReady: (serverRoles, memberRoles) => {
    set((state) => ({
      roles: { ...state.roles, ...serverRoles },
    }));

    // Compute permissions for each server if member roles are provided
    if (memberRoles) {
      const currentUserId = useAuthStore.getState().user?.id;
      if (!currentUserId) return;

      const newPerms: Record<string, number> = {};
      for (const serverId of Object.keys(serverRoles)) {
        const myRoleIds = (memberRoles[serverId] || []).map((r) => r.id);
        newPerms[serverId] = computePermissions(
          serverRoles[serverId],
          myRoleIds,
        );
      }
      set((state) => ({
        myPermissions: { ...state.myPermissions, ...newPerms },
      }));
    }
  },

  setChannelOverridesFromReady: (overrides) => {
    set((state) => ({
      channelOverrides: { ...state.channelOverrides, ...overrides },
    }));
  },

  handleChannelOverrideUpdate: (override) => {
    set((state) => {
      const existing = state.channelOverrides[override.channel_id] || [];
      const idx = existing.findIndex((o) => o.id === override.id);
      const updated =
        idx >= 0
          ? existing.map((o) => (o.id === override.id ? override : o))
          : [...existing, override];
      return {
        channelOverrides: {
          ...state.channelOverrides,
          [override.channel_id]: updated,
        },
      };
    });
  },

  handleChannelOverrideDelete: (event) => {
    set((state) => {
      const existing = state.channelOverrides[event.channel_id] || [];
      return {
        channelOverrides: {
          ...state.channelOverrides,
          [event.channel_id]: existing.filter(
            (o) => o.id !== event.override_id,
          ),
        },
      };
    });
  },

  computeChannelPermissions: (serverId, channelId) => {
    const currentUserId = useAuthStore.getState().user?.id;
    if (!currentUserId) return 0;

    // Check if owner — owners bypass everything
    const servers = useServerStore.getState().servers;
    const server = servers.find((s) => s.id === serverId);
    if (server?.owner_id === currentUserId) return 0x7fffffff; // all bits set

    // Compute base permissions from roles + default member permissions
    // Default member perms match the server's DEFAULT_MEMBER_PERMS constant
    const DEFAULT_MEMBER_PERMS =
      PERMISSIONS.VIEW_CHANNEL |
      PERMISSIONS.SEND_MESSAGES |
      PERMISSIONS.ADD_REACTIONS |
      PERMISSIONS.ATTACH_FILES |
      PERMISSIONS.CONNECT_VOICE |
      PERMISSIONS.SPEAK; // 123

    const members = useServerStore.getState().members;
    const member = members.find((m) => m.user_id === currentUserId);
    const myRoleIds = (member?.roles || []).map((r) => r.id);
    const serverRoles = get().roles[serverId] || [];
    let perms =
      computePermissions(serverRoles, myRoleIds) | DEFAULT_MEMBER_PERMS;

    // ADMINISTRATOR bypasses all overrides
    if ((perms & PERMISSIONS.ADMINISTRATOR) !== 0) return 0x7fffffff;

    // Apply role overrides for this channel
    const overrides = get().channelOverrides[channelId] || [];
    let roleAllow = 0;
    let roleDeny = 0;
    for (const ov of overrides) {
      if (ov.role_id && myRoleIds.includes(ov.role_id)) {
        roleAllow |= ov.allow;
        roleDeny |= ov.deny;
      }
    }
    perms = (perms & ~roleDeny) | roleAllow;

    // Apply user-specific overrides (highest priority)
    for (const ov of overrides) {
      if (ov.user_id === currentUserId) {
        perms = (perms & ~ov.deny) | ov.allow;
      }
    }

    return perms;
  },

  handleRoleCreate: (role) => {
    set((state) => ({
      roles: {
        ...state.roles,
        [role.server_id]: [...(state.roles[role.server_id] || []), role],
      },
    }));
  },

  handleRoleUpdate: (role) => {
    set((state) => ({
      roles: {
        ...state.roles,
        [role.server_id]: (state.roles[role.server_id] || []).map((r) =>
          r.id === role.id ? role : r,
        ),
      },
    }));
    get().computeMyPermissions(role.server_id);
  },

  handleRoleDelete: (event) => {
    set((state) => ({
      roles: {
        ...state.roles,
        [event.server_id]: (state.roles[event.server_id] || []).filter(
          (r) => r.id !== event.role_id,
        ),
      },
    }));
    get().computeMyPermissions(event.server_id);
  },

  handleMemberRoleAdd: (event) => {
    const currentUserId = useAuthStore.getState().user?.id;
    if (event.user_id === currentUserId) {
      get().computeMyPermissions(event.server_id);
    }
  },

  handleMemberRoleRemove: (event) => {
    const currentUserId = useAuthStore.getState().user?.id;
    if (event.user_id === currentUserId) {
      get().computeMyPermissions(event.server_id);
    }
  },

  clearError: () => set({ error: null }),
}));
