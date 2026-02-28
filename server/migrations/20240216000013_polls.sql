-- server/migrations/20240216000013_polls.sql
CREATE TABLE polls (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    server_id  UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    question   TEXT NOT NULL CHECK (char_length(question) BETWEEN 1 AND 500),
    options    JSONB NOT NULL,  -- [{"id": "<uuid>", "text": "Option text"}]
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ends_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE poll_votes (
    poll_id   UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    option_id UUID NOT NULL,
    voted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (poll_id, user_id)   -- one vote per user per poll; upsert replaces
);

CREATE INDEX idx_poll_votes_poll_id ON poll_votes(poll_id);
CREATE INDEX idx_polls_channel_id ON polls(channel_id);
