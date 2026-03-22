-- Migration: Server Invite Links
-- Description: Enable invite-based server membership for private servers

CREATE TABLE server_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    code TEXT UNIQUE NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    max_uses INT,
    uses INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup by invite code (used on every accept)
CREATE INDEX idx_server_invites_code ON server_invites(code);

-- List invites for a server (admin view)
CREATE INDEX idx_server_invites_server ON server_invites(server_id, created_at DESC);
