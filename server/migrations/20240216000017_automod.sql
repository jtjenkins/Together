-- Auto-moderation configuration per server (one row per server, created on first PATCH)
CREATE TABLE automod_configs (
    server_id           UUID    PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    enabled             BOOLEAN NOT NULL DEFAULT FALSE,
    -- Spam detection: block a user who sends too many messages within a sliding window
    spam_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
    spam_max_messages   INTEGER NOT NULL DEFAULT 5  CHECK (spam_max_messages BETWEEN 1 AND 50),
    spam_window_secs    INTEGER NOT NULL DEFAULT 5  CHECK (spam_window_secs  BETWEEN 1 AND 60),
    spam_action         TEXT    NOT NULL DEFAULT 'delete'
                                CHECK (spam_action IN ('delete','timeout','kick','ban')),
    -- Duplicate detection: block identical content posted within 30 seconds
    duplicate_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    -- Word / phrase blocklist
    word_filter_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    word_filter_action  TEXT    NOT NULL DEFAULT 'delete'
                                CHECK (word_filter_action IN ('delete','timeout','kick','ban')),
    -- Timeout duration in minutes (applied for 'timeout' actions from any rule)
    timeout_minutes     INTEGER NOT NULL DEFAULT 10 CHECK (timeout_minutes BETWEEN 1 AND 10080),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Word / phrase blocklist (per server, case-insensitive matching at runtime)
CREATE TABLE automod_word_filters (
    id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id   UUID    NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    word        TEXT    NOT NULL,
    created_by  UUID    REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (server_id, word)
);
CREATE INDEX automod_word_filters_server_idx ON automod_word_filters (server_id);

-- Server bans: prevents banned users from rejoining after a kick+ban action
CREATE TABLE server_bans (
    user_id     UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    reason      TEXT,
    banned_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, server_id)
);
CREATE INDEX server_bans_server_idx ON server_bans (server_id);

-- Active timeouts: while an entry exists with expires_at > NOW() the user cannot
-- post messages in that server. Expired rows are cleaned up lazily.
CREATE TABLE automod_timeouts (
    user_id     UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    expires_at  TIMESTAMP WITH TIME ZONE NOT NULL,
    reason      TEXT,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, server_id)
);
CREATE INDEX automod_timeouts_expiry_idx ON automod_timeouts (expires_at);

-- Audit log: one row per auto-mod action taken
CREATE TABLE automod_logs (
    id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id       UUID    NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    channel_id      UUID    REFERENCES channels(id) ON DELETE SET NULL,
    user_id         UUID    REFERENCES users(id)   ON DELETE SET NULL,
    username        TEXT    NOT NULL,
    rule_type       TEXT    NOT NULL,  -- 'spam' | 'duplicate' | 'word_filter'
    action_taken    TEXT    NOT NULL,  -- 'delete' | 'timeout' | 'kick' | 'ban'
    message_content TEXT,
    matched_term    TEXT,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX automod_logs_server_idx ON automod_logs (server_id, created_at DESC);
