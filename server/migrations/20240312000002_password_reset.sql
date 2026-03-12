-- Migration: Password Reset
-- Description: Password reset tokens for self-service password recovery

-- Password reset tokens table
CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,  -- SHA-256 hash of the reset token
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT chk_token_not_expired CHECK (expires_at > created_at)
);

-- Index for looking up tokens by user
CREATE INDEX idx_password_reset_tokens_user
    ON password_reset_tokens(user_id, created_at DESC);

-- Index for token hash lookup (unique index already exists, this is for faster scans)
CREATE INDEX idx_password_reset_tokens_hash
    ON password_reset_tokens(token_hash);

-- Comments for documentation
COMMENT ON TABLE password_reset_tokens IS 'Time-limited tokens for password reset flow';
COMMENT ON COLUMN password_reset_tokens.token_hash IS 'SHA-256 hash of the reset token (not stored in plain text)';
COMMENT ON COLUMN password_reset_tokens.expires_at IS 'Token expiration timestamp (typically 1 hour from creation)';
COMMENT ON COLUMN password_reset_tokens.used_at IS 'When the token was used (null if unused)';
