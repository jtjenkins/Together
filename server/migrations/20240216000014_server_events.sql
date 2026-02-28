-- server/migrations/20240216000014_server_events.sql
CREATE TABLE server_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  UUID NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
    description TEXT CHECK (char_length(description) <= 2000),
    starts_at   TIMESTAMPTZ NOT NULL,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_server_events_server_starts ON server_events(server_id, starts_at);
