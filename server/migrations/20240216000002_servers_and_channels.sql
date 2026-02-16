-- Migration: Servers and Channels
-- Description: Discord-like servers (guilds) and channels

-- Servers table (called "guilds" in Discord)
CREATE TABLE servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    icon_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for finding servers by owner
CREATE INDEX idx_servers_owner ON servers(owner_id);

-- Server membership table
CREATE TABLE server_members (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    nickname TEXT,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, server_id)
);

-- Indexes for membership queries
CREATE INDEX idx_server_members_server ON server_members(server_id);
CREATE INDEX idx_server_members_user ON server_members(user_id);

-- Channels table (text and voice)
CREATE TABLE channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('text', 'voice')),
    category TEXT,
    position INT NOT NULL DEFAULT 0,
    topic TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for channel queries
CREATE INDEX idx_channels_server ON channels(server_id);
CREATE INDEX idx_channels_position ON channels(server_id, position);
CREATE INDEX idx_channels_type ON channels(server_id, type);

-- Trigger to auto-update updated_at on servers table
CREATE TRIGGER update_servers_updated_at
    BEFORE UPDATE ON servers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE servers IS 'Discord-like servers/guilds that contain channels';
COMMENT ON TABLE server_members IS 'Many-to-many relationship between users and servers';
COMMENT ON TABLE channels IS 'Text and voice channels within servers';
COMMENT ON COLUMN channels.type IS 'Channel type: text or voice';
COMMENT ON COLUMN channels.category IS 'Optional category name for organizing channels';
COMMENT ON COLUMN channels.position IS 'Display order within the server (0-indexed)';
