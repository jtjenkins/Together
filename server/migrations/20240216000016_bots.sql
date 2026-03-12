-- Migration: Bots
-- Description: Bot registry and is_bot flag for users

-- Add is_bot flag to users table
ALTER TABLE users ADD COLUMN is_bot BOOLEAN NOT NULL DEFAULT FALSE;

-- Bot registry: each row is a registered bot with its hashed static token
CREATE TABLE bots (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
    description TEXT        CHECK (char_length(description) <= 512),
    token_hash  TEXT        NOT NULL UNIQUE,
    created_by  UUID        NOT NULL REFERENCES users(id),
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bots_token_hash  ON bots(token_hash);
CREATE INDEX idx_bots_created_by  ON bots(created_by);
CREATE INDEX idx_bots_user_id     ON bots(user_id);

-- Comments for documentation
COMMENT ON TABLE bots IS 'Registry of bot accounts with their hashed authentication tokens';
COMMENT ON COLUMN bots.user_id IS 'The user account associated with this bot';
COMMENT ON COLUMN bots.token_hash IS 'Bcrypt hash of the static bot token used for authentication';
COMMENT ON COLUMN bots.created_by IS 'Human user who registered this bot';
COMMENT ON COLUMN bots.revoked_at IS 'When the bot token was revoked; NULL means token is active';
COMMENT ON COLUMN users.is_bot IS 'True if this user account represents a bot';
