-- Migration: Roles and Permissions
-- Description: Discord-compatible role-based permission system

-- Roles table
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    permissions BIGINT NOT NULL DEFAULT 0,
    color TEXT,
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for role queries
CREATE INDEX idx_roles_server ON roles(server_id);
CREATE INDEX idx_roles_position ON roles(server_id, position);

-- Member roles (many-to-many between members and roles)
CREATE TABLE member_roles (
    user_id UUID NOT NULL,
    server_id UUID NOT NULL,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, server_id, role_id),
    FOREIGN KEY (user_id, server_id)
        REFERENCES server_members(user_id, server_id) ON DELETE CASCADE
);

-- Index for finding user's roles
CREATE INDEX idx_member_roles_user_server ON member_roles(user_id, server_id);

-- Channel permission overrides
CREATE TABLE channel_permission_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    allow BIGINT NOT NULL DEFAULT 0,
    deny BIGINT NOT NULL DEFAULT 0,
    -- Ensure either role_id OR user_id is set, but not both
    CHECK (
        (role_id IS NOT NULL AND user_id IS NULL) OR
        (role_id IS NULL AND user_id IS NOT NULL)
    ),
    -- Ensure unique combinations of channel + role or channel + user
    UNIQUE NULLS NOT DISTINCT (channel_id, role_id, user_id)
);

-- Indexes for permission override queries
CREATE INDEX idx_channel_perms_channel ON channel_permission_overrides(channel_id);
CREATE INDEX idx_channel_perms_role ON channel_permission_overrides(role_id)
    WHERE role_id IS NOT NULL;
CREATE INDEX idx_channel_perms_user ON channel_permission_overrides(user_id)
    WHERE user_id IS NOT NULL;

-- Comments for documentation
COMMENT ON TABLE roles IS 'Server roles with permission bitflags (Discord-compatible)';
COMMENT ON TABLE member_roles IS 'Assignment of roles to server members';
COMMENT ON TABLE channel_permission_overrides IS 'Per-channel permission overrides for roles or users';
COMMENT ON COLUMN roles.permissions IS 'Permission bitflags: VIEW_CHANNEL=1, SEND_MESSAGES=2, etc.';
COMMENT ON COLUMN roles.color IS 'Hex color code for role display (e.g., #FF5733)';
COMMENT ON COLUMN roles.position IS 'Role hierarchy position (higher = more powerful)';
COMMENT ON COLUMN channel_permission_overrides.allow IS 'Permissions explicitly allowed';
COMMENT ON COLUMN channel_permission_overrides.deny IS 'Permissions explicitly denied';

-- Permission bitflag reference (for documentation)
-- Bit 0  (1):       VIEW_CHANNEL
-- Bit 1  (2):       SEND_MESSAGES
-- Bit 2  (4):       MANAGE_MESSAGES
-- Bit 3  (8):       ATTACH_FILES
-- Bit 4  (16):      ADD_REACTIONS
-- Bit 5  (32):      CONNECT_VOICE
-- Bit 6  (64):      SPEAK
-- Bit 7  (128):     MUTE_MEMBERS
-- Bit 8  (256):     KICK_MEMBERS
-- Bit 9  (512):     BAN_MEMBERS
-- Bit 10 (1024):    MANAGE_CHANNELS
-- Bit 11 (2048):    MANAGE_ROLES
-- Bit 12 (4096):    MANAGE_SERVER
-- Bit 13 (8192):    ADMINISTRATOR (grants all permissions)
