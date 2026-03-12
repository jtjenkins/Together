-- Migration: Audit Logging
-- Description: Track admin actions for security and compliance

-- Audit log table
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id UUID,
    details JSONB DEFAULT '{}',
    ip_address INET,
    created_at TIMESTAMPT DEFAULT NOW()
);

-- Index for querying by server (most common query)
CREATE INDEX idx_audit_logs_server_time
    ON audit_logs(server_id, created_at DESC);

-- Index for querying by actor
CREATE INDEX idx_audit_logs_actor
    ON audit_logs(actor_id, created_at DESC);

-- Index for querying by action type
CREATE INDEX idx_audit_logs_action
    ON audit_logs(server_id, action, created_at DESC);

-- Comments for documentation
COMMENT ON TABLE audit_logs IS 'Audit trail of admin actions for security and compliance';
COMMENT ON COLUMN audit_logs.action IS 'Action type: server.update, channel.create, member.kick, etc.';
COMMENT ON COLUMN audit_logs.target_type IS 'Type of target: server, channel, user, role';
COMMENT ON COLUMN audit_logs.target_id IS 'ID of the target entity';
COMMENT ON COLUMN audit_logs.details IS 'Additional context as JSON (old/new values, reason, etc.)';
COMMENT ON COLUMN audit_logs.ip_address IS 'IP address of the actor (if available)';
