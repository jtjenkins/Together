-- Webhooks: per-server outbound HTTP callbacks for real-time event delivery.
--
-- Design decisions:
--   - event_types stores a JSONB array of strings (e.g. ["message.created", "member.joined"])
--     so the set can be queried with the @> operator without a separate join table.
--   - secret is stored in plaintext (it is sent TO the receiver as an HMAC key, not
--     a credential we verify, so hashing it would be counterproductive).
--   - delivery_failures is a counter reset to 0 on any successful delivery and
--     incremented on each failed attempt; used for UI health indication only.
--     Actual retry logic lives in the in-memory delivery queue.

CREATE TABLE IF NOT EXISTS webhooks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id       UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    created_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    url             TEXT NOT NULL CHECK (char_length(url) BETWEEN 1 AND 2000),
    secret          TEXT NOT NULL,
    event_types     JSONB NOT NULL DEFAULT '["message.created"]'::jsonb,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    delivery_failures INT NOT NULL DEFAULT 0,
    last_used_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX webhooks_server_id_idx ON webhooks (server_id);

-- Automatically keep updated_at current.
CREATE OR REPLACE FUNCTION touch_webhooks_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER webhooks_updated_at
    BEFORE UPDATE ON webhooks
    FOR EACH ROW EXECUTE FUNCTION touch_webhooks_updated_at();
